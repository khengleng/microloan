import {
  Injectable,
  UnauthorizedException,
  ConflictException,
  ForbiddenException,
  BadRequestException,
  GoneException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { LoginDto } from './dto/login.dto';
import { RegisterTenantDto } from './dto/register-tenant.dto';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { Role } from '@microloan/db';
import { generateSecret } from 'otplib';
import { totpCodeMatches } from './totp';
import * as qrcode from 'qrcode';
import { createHash, randomUUID, randomBytes } from 'crypto';
import { Prisma } from '@microloan/db';
import { permissionsForRole } from '../authz/role-permissions';
import { NotificationsService } from '../notifications/notifications.service';
import { encryptField, decryptField } from '../common/field-crypto';
import { SystemContext } from '../prisma/tenant-context';
import { GoogleIdentityService } from './google-identity.service';
import { GoogleRegisterTenantDto } from './dto/google-auth.dto';
import { SignupPaymentService } from '../billing/signup-payment.service';
import { PlanTierService } from '../plan-tiers/plan-tier.service';
import type { PlanTierView } from '../plan-tiers/plan-tier.service';
import { durationMs, operationalConfig } from '../config/operational-config';

// ── Security constants ───────────────────────────────────────────────────────
// Lockout threshold and duration, MFA-challenge and reset-link lifetimes are
// deployment settings (AUTH_* in .env.example; defaults 5 attempts, 30 minutes,
// 5 minutes and 60 minutes), read through operationalConfig().
const GENERIC_AUTH_ERROR = 'Invalid credentials'; // Never reveal which field failed
const REFRESH_TOKEN_TYPE = 'refresh';

const otpauth = {
  keyuri: (email: string, issuer: string, secret: string) => {
    return `otpauth://totp/${issuer}:${email}?secret=${secret}&issuer=${issuer}`;
  }
};

@Injectable()
export class AuthService {
  constructor(
    private jwtService: JwtService,
    private prisma: PrismaService,
    private audit: AuditService,
    private notifications: NotificationsService,
    private google: GoogleIdentityService,
    private signupPayments: SignupPaymentService,
    private planTiers: PlanTierService,
  ) { }

  /**
   * Resolve the tier a signup asked for.
   *
   * An explicit choice must be a real, currently-offered tier — an unknown or
   * retired name is refused rather than quietly downgraded, because the
   * applicant is choosing what to pay for. Omitting the plan means "whatever
   * the free tier is", which the operator defines.
   */
  private async resolveSignupTier(requested?: string | null): Promise<PlanTierView> {
    if (requested) return this.planTiers.requireSelectable(requested);

    const fallback = await this.planTiers.defaultTier();
    if (!fallback) {
      throw new BadRequestException(
        'Signup is unavailable: this platform has no subscription plans configured.',
      );
    }
    return fallback;
  }

  private hashResetToken(raw: string): string {
    const pepper = process.env.JWT_REFRESH_TOKEN_PEPPER || '';
    return createHash('sha256').update(`${raw}${pepper}`).digest('hex');
  }

  /**
   * Self-service forgot-password. Always returns a generic response (no account
   * enumeration). When an account exists, a single-use, 1-hour token is created
   * and emailed as a reset link (delivery requires an email provider — #7).
   */
  @SystemContext('pre-auth: resolving an account by email')
  async forgotPassword(email: string, resetBaseUrl: string) {
    const generic = { message: 'If an account exists for that email, a password reset link has been sent.' };
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user || !user.isActive) return generic;

    const { auth, platformName } = operationalConfig();
    const resetMinutes = auth.passwordResetMinutes;
    const raw = randomBytes(32).toString('hex');
    await this.prisma.passwordResetToken.create({
      data: {
        userId: user.id,
        tokenHash: this.hashResetToken(raw),
        expiresAt: new Date(Date.now() + resetMinutes * 60_000),
      },
    });

    const url = `${resetBaseUrl.replace(/\/$/, '')}/reset-password?token=${raw}`;
    // Fire-and-forget so email network latency doesn't create a timing side-channel
    // that would let an attacker distinguish existing vs non-existing accounts.
    void this.notifications.sendEmail(
      user.email,
      `Reset your ${platformName} password`,
      `<p>We received a request to reset your password.</p>
       <p><a href="${url}">Click here to set a new password</a> (this link expires in ${resetMinutes === 60 ? '1 hour' : `${resetMinutes} minutes`}).</p>
       <p>If you didn't request this, you can safely ignore this email.</p>`,
    );

    await this.audit.logSecurityEvent({
      actorUserId: user.id,
      actorRole: user.role,
      actorTenantId: user.tenantId || null,
      targetType: 'User',
      targetId: user.id,
      action: 'PASSWORD_RESET_REQUESTED',
      result: 'SUCCESS',
    });
    return generic;
  }

  /**
   * Complete a self-service reset: validate the token, set the new password,
   * revoke all sessions, and consume the token.
   */
  @SystemContext('pre-auth: redeeming a reset token')
  async resetPassword(token: string, newPassword: string) {
    // Not 401: the person resetting has no session, and a 401 reads to the web
    // client as "your session expired" and bounces them to Sign in before the
    // reset page can say the link is no good.
    if (!token) throw new BadRequestException('Invalid or expired reset link.');
    if (!newPassword || newPassword.length < 12) {
      throw new BadRequestException('Password must be at least 12 characters.');
    }
    const rec = await this.prisma.passwordResetToken.findUnique({
      where: { tokenHash: this.hashResetToken(token) },
    });
    if (!rec || rec.usedAt || rec.expiresAt < new Date()) {
      throw new GoneException('Invalid or expired reset link.');
    }

    const hash = await bcrypt.hash(newPassword, await bcrypt.genSalt());
    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: rec.userId },
        data: { passwordHash: hash, loginAttempts: 0, lockedUntil: null },
      }),
      this.prisma.passwordResetToken.update({ where: { id: rec.id }, data: { usedAt: new Date() } }),
      this.prisma.refreshToken.updateMany({
        where: { userId: rec.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    ]);

    await this.audit.logSecurityEvent({
      actorUserId: rec.userId,
      actorRole: null,
      actorTenantId: null,
      targetType: 'User',
      targetId: rec.userId,
      action: 'PASSWORD_RESET_COMPLETED',
      result: 'SUCCESS',
    });
    return { success: true };
  }

  private readonly EMAIL_TAKEN =
    'Registration failed. This email is already tied to an existing organization ' +
    '(possibly suspended or in the Trash). To reuse this email, the organization must ' +
    'be permanently PURGED from the platform by a Superadmin.';

  /**
   * Provision a workspace and its first TENANT_ADMIN.
   *
   * Shared by the password and Google signup paths so the payment gate cannot
   * be sidestepped by picking the other one. FREE activates immediately;
   * every other plan lands in PENDING_PAYMENT with a KHQR attached, and
   * `JwtStrategy` refuses to issue a session for a non-ACTIVE tenant until a
   * SUPERADMIN confirms the transfer.
   */
  private async provisionTenant(params: {
    organizationName: string;
    adminEmail: string;
    tier: PlanTierView;
    passwordHash?: string;
    googleIdentity?: { providerAccountId: string; email: string };
    ip?: string;
  }) {
    const { organizationName, adminEmail, tier, ip } = params;
    const plan = tier.name;
    // Priced, therefore gated. Derived from the tier's amount rather than its
    // name, so an operator who creates a second free tier gets a free tier
    // instead of one that silently demands payment for $0.00.
    const paid = tier.requiresPayment;

    // Where a paid workspace parks while it waits for confirmation. It must be
    // a tier that actually exists, or the tenant's first quota check would fall
    // back to the cheapest tier with a warning.
    const holdingTier = paid ? await this.planTiers.defaultTier() : null;

    // Fail before creating anything if a paid plan is impossible to settle.
    if (paid && !(await this.signupPayments.isConfigured())) {
      throw new BadRequestException(
        'Paid plans are unavailable: this platform has no KHQR merchant configured. ' +
          'Choose the FREE plan or contact platform support.',
      );
    }

    const result = await this.prisma.$transaction(async (tx) => {
      const tenant = await tx.tenant.create({
        data: {
          name: organizationName,
          // A paid workspace is inert until payment is confirmed. The plan is
          // NOT applied yet — it is stored on the PlanPayment and only written
          // to the tenant on confirmation, so an unpaid workspace can never
          // hold paid quota limits.
          status: paid ? 'PENDING_PAYMENT' : 'ACTIVE',
          plan: paid ? (holdingTier?.name ?? plan) : plan,
        },
      });

      const user = await tx.user.create({
        data: {
          tenantId: tenant.id,
          email: adminEmail,
          passwordHash: params.passwordHash ?? null,
          role: Role.TENANT_ADMIN,
        },
      });

      if (params.googleIdentity) {
        await tx.federatedIdentity.create({
          data: {
            userId: user.id,
            provider: GoogleIdentityService.PROVIDER,
            providerAccountId: params.googleIdentity.providerAccountId,
            email: params.googleIdentity.email,
          },
        });
      }

      const payment = paid
        ? await this.signupPayments.createForTenant(tenant.id, tier, tx)
        : null;

      await this.audit.logSecurityEvent({
        actorUserId: user.id,
        actorRole: user.role,
        actorTenantId: tenant.id,
        targetType: 'Tenant',
        targetId: tenant.id,
        action: 'TENANT_CREATE',
        newValue: {
          organizationName,
          plan,
          status: tenant.status,
          signupMethod: params.googleIdentity ? 'GOOGLE' : 'PASSWORD',
          paymentReference: payment?.reference,
        },
        ipAddress: ip || 'unknown',
        result: 'SUCCESS',
      });

      return { tenant, user, payment };
    });

    if (!result.payment) {
      return {
        tenantId: result.tenant.id,
        tenantName: result.tenant.name,
        adminEmail: result.user.email,
        plan,
        status: result.tenant.status,
        paymentRequired: false as const,
        message: 'Organization registered successfully. You can now log in.',
      };
    }

    return {
      tenantId: result.tenant.id,
      tenantName: result.tenant.name,
      adminEmail: result.user.email,
      plan,
      status: result.tenant.status,
      paymentRequired: true as const,
      payment: {
        reference: result.payment.reference,
        amount: result.payment.amount,
        currency: result.payment.currency,
        qrPayload: result.payment.qrPayload,
        qrImage: await this.signupPayments.renderQr(result.payment.qrPayload),
      },
      message:
        'Organization created. Scan the QR to pay for your plan — your workspace ' +
        'activates once the platform team confirms the transfer. Keep your payment ' +
        'reference to check the status.',
    };
  }

  @SystemContext('pre-auth: provisioning a new organization')
  async registerTenant(dto: RegisterTenantDto, ip?: string) {
    const email = dto.adminEmail.toLowerCase();
    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing) {
      throw new ConflictException(this.EMAIL_TAKEN);
    }

    // Resolved before hashing: a bad plan should cost a 400, not 12 rounds of
    // bcrypt.
    const tier = await this.resolveSignupTier(dto.plan);
    const salt = await bcrypt.genSalt(12); // 12 rounds for stronger hashing
    const passwordHash = await bcrypt.hash(dto.adminPassword, salt);

    return this.provisionTenant({
      organizationName: dto.organizationName,
      adminEmail: email,
      tier,
      passwordHash,
      ip,
    });
  }

  /**
   * Public plan catalogue for the signup page — price, currency and whether
   * the plan goes through the payment gate. Served from the API so the web
   * bundle never carries a second, drifting copy of the pricing.
   */
  @SystemContext('pre-auth: public plan catalogue for the signup page')
  async plans() {
    return {
      khqrConfigured: await this.signupPayments.isConfigured(),
      plans: (await this.planTiers.catalogue()).map((tier) => ({
        name: tier.name,
        displayName: tier.displayName,
        description: tier.description,
        amount: tier.amount,
        currency: tier.currency,
        requiresPayment: tier.requiresPayment,
        // `null` on a ceiling means unlimited — the signup page renders it as
        // "Unlimited" rather than as a missing value.
        limits: tier.limits,
      })),
    };
  }

  /** Whether the client should offer a Google button at all. */
  googleAvailable() {
    return {
      enabled: this.google.isConfigured(),
      clientId: this.google.clientId ?? null,
    };
  }

  /**
   * Sign in with Google.
   *
   * Resolution order matters. A linked identity wins outright. Failing that,
   * the account is matched on the provider-verified email and linked on first
   * use — `GoogleIdentityService` has already refused to return an unverified
   * email, which is what makes that link safe. An unknown email is NOT
   * auto-provisioned: staff accounts belong to a tenant and are created by
   * that tenant's admin.
   */
  @SystemContext('pre-auth: resolving a Google identity')
  async loginWithGoogle(idToken: string, ip?: string) {
    const profile = await this.google.verify(idToken);

    const identity = await this.prisma.federatedIdentity.findUnique({
      where: {
        provider_providerAccountId: {
          provider: GoogleIdentityService.PROVIDER,
          providerAccountId: profile.subject,
        },
      },
      include: { user: { include: { tenant: { select: { status: true, name: true } } } } },
    });

    let user = identity?.user ?? null;

    if (!user) {
      const byEmail = await this.prisma.user.findUnique({
        where: { email: profile.email },
        include: { tenant: { select: { status: true, name: true } } },
      });

      if (!byEmail) {
        await this.auditSecurityEvent(null, profile.email, 'GOOGLE_LOGIN_UNKNOWN_EMAIL', ip);
        throw new UnauthorizedException(
          'No account is registered for this Google address. Ask your administrator ' +
            'to invite you, or register a new organization.',
        );
      }

      // The platform operator's account is never linked automatically: a
      // re-provisioned mailbox at the same address must not inherit it.
      if (byEmail.role === Role.SUPERADMIN) {
        await this.auditSecurityEvent(null, profile.email, 'GOOGLE_LINK_REFUSED_PRIVILEGED', ip, byEmail.id);
        throw new UnauthorizedException('Sign in with your password; this account cannot be linked to Google automatically.');
      }

      await this.prisma.federatedIdentity.create({
        data: {
          userId: byEmail.id,
          provider: GoogleIdentityService.PROVIDER,
          providerAccountId: profile.subject,
          email: profile.email,
        },
      });
      await this.audit.logSecurityEvent({
        actorUserId: byEmail.id,
        actorRole: byEmail.role,
        actorTenantId: byEmail.tenantId,
        targetType: 'User',
        targetId: byEmail.id,
        action: 'GOOGLE_IDENTITY_LINKED',
        ipAddress: ip || 'unknown',
        result: 'SUCCESS',
      });
      user = byEmail;
    }

    // Same gates as password login, in the same order — including the
    // lockout, which federated sign-in must not get around.
    if (user.lockedUntil && new Date() < user.lockedUntil) {
      await this.auditSecurityEvent(user.tenantId, profile.email, 'LOGIN_ACCOUNT_LOCKED', ip, user.id);
      throw new ForbiddenException('This account is temporarily locked. Try again later.');
    }
    if (user.role !== Role.SUPERADMIN && user.tenant?.status !== 'ACTIVE') {
      throw new ForbiddenException(this.inactiveTenantMessage(user.tenant?.status, user.tenant?.name));
    }
    if (user.isActive === false) {
      await this.auditSecurityEvent(user.tenantId, profile.email, 'LOGIN_SUSPENDED', ip, user.id);
      throw new ForbiddenException('Your staff account has been suspended by your administrator.');
    }

    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        loginAttempts: 0,
        lockedUntil: null,
        lastLoginAt: new Date(),
        lastLoginIp: ip || null,
      },
    });
    await this.prisma.federatedIdentity.updateMany({
      where: {
        provider: GoogleIdentityService.PROVIDER,
        providerAccountId: profile.subject,
      },
      data: { lastLoginAt: new Date(), email: profile.email },
    });

    // Federated sign-in does not bypass MFA: if the account has TOTP enrolled,
    // the second factor is still required.
    if (user.twoFactorEnabled) {
      await this.audit.logAction(user.tenantId!, user.id, 'LOGIN', 'User', user.id, {
        event: 'MFA_CHALLENGE_ISSUED',
        method: 'GOOGLE',
        ip: ip || 'unknown',
      });
      const mfaToken = this.jwtService.sign(
        { sub: user.id, mfaChallenge: true },
        { secret: process.env.JWT_ACCESS_SECRET!, expiresIn: operationalConfig().auth.mfaChallengeTtl as any },
      );
      return { mfaRequired: true, mfaToken, message: 'Please provide your TOTP code' };
    }

    await this.audit.logSecurityEvent({
      actorUserId: user.id,
      actorRole: user.role,
      actorTenantId: user.tenantId || null,
      targetType: 'User',
      targetId: user.id,
      action: 'LOGIN',
      newValue: { method: 'GOOGLE' },
      ipAddress: ip || 'unknown',
      result: 'SUCCESS',
    });

    return this.generateTokens(
      user.id,
      user.email,
      user.role,
      user.tenantId || null,
      user.branchId || null,
    );
  }

  /** Register a new workspace using a Google account as the admin credential. */
  @SystemContext('pre-auth: provisioning a new organization via Google')
  async registerTenantWithGoogle(dto: GoogleRegisterTenantDto, ip?: string) {
    const profile = await this.google.verify(dto.idToken);

    const existingIdentity = await this.prisma.federatedIdentity.findUnique({
      where: {
        provider_providerAccountId: {
          provider: GoogleIdentityService.PROVIDER,
          providerAccountId: profile.subject,
        },
      },
    });
    if (existingIdentity) {
      throw new ConflictException(
        'This Google account is already linked to an organization. Sign in instead.',
      );
    }

    const existingUser = await this.prisma.user.findUnique({ where: { email: profile.email } });
    if (existingUser) {
      throw new ConflictException(this.EMAIL_TAKEN);
    }

    const tier = await this.resolveSignupTier(dto.plan);

    return this.provisionTenant({
      organizationName: dto.organizationName,
      adminEmail: profile.email,
      tier,
      googleIdentity: { providerAccountId: profile.subject, email: profile.email },
      ip,
    });
  }

  /** Distinguishes "not paid yet" from "suspended" — very different fixes. */
  private inactiveTenantMessage(status?: string | null, name?: string | null): string {
    if (status === 'PENDING_PAYMENT') {
      return (
        `${name || 'Your organization'} is awaiting plan payment confirmation. ` +
        'Once the platform team confirms your transfer, you can sign in.'
      );
    }
    return (
      `Organization ${name || 'Isolated Environment'} has been suspended or is pending ` +
      'data erasure. Please contact platform support.'
    );
  }

  @SystemContext('pre-auth: resolving credentials by email')
  async login(loginDto: LoginDto, ip?: string) {
    const user: any = await this.prisma.user.findUnique({
      where: { email: loginDto.email },
      include: { tenant: { select: { status: true, name: true } } }
    });

    // ── User not found — generic error, equal timing ─────────────────────
    if (!user) {
      await this.auditSecurityEvent(null, loginDto.email, 'LOGIN_UNKNOWN_EMAIL', ip);
      // Compare against a dummy to prevent timing attacks
      await bcrypt.compare(loginDto.password, '$2b$12$dummyhashfortimingnormalisation');
      throw new UnauthorizedException(GENERIC_AUTH_ERROR);
    }

    // ── Organization Suspended check ─────────────────────────────────────
    if (user.role !== Role.SUPERADMIN && user.tenant?.status !== 'ACTIVE') {
      throw new ForbiddenException(
        this.inactiveTenantMessage(user.tenant?.status, user.tenant?.name),
      );
    }

    // ── User Suspended check ────────────────────────────────────────────
    if (user.isActive === false) {
      await this.auditSecurityEvent(user.tenantId, loginDto.email, 'LOGIN_SUSPENDED', ip, user.id);
      throw new ForbiddenException('Your staff account has been suspended by your administrator.');
    }

    // ── Account lockout check ────────────────────────────────────────────
    if (user.lockedUntil && new Date() < user.lockedUntil) {
      const minutesLeft = Math.ceil((user.lockedUntil.getTime() - Date.now()) / 60000);
      await this.auditSecurityEvent(user.tenantId, loginDto.email, 'LOGIN_ACCOUNT_LOCKED', ip, user.id);
      throw new ForbiddenException(
        `Account is temporarily locked due to too many failed attempts. Try again in ${minutesLeft} minute(s).`
      );
    }

    // ── Password check ───────────────────────────────────────────────────
    // A federated-only account (Google signup) has no password hash. Burn the
    // same time as a real comparison, then refuse — telling the caller to use
    // Google is safe here because they have already proven the account exists
    // by getting past the lookup, and it avoids a dead end.
    if (!user.passwordHash) {
      await bcrypt.compare(loginDto.password, '$2b$12$dummyhashfortimingnormalisation');
      await this.auditSecurityEvent(
        user.tenantId, loginDto.email, 'LOGIN_NO_PASSWORD_CREDENTIAL', ip, user.id,
      );
      throw new UnauthorizedException(
        'This account signs in with Google. Use the “Continue with Google” button.',
      );
    }

    const isMatch = await bcrypt.compare(loginDto.password, user.passwordHash);

    if (!isMatch) {
      const { newAttempts, shouldLock, maxFailedLogins, lockoutMinutes } =
        await this.recordFailedAttempt(user.id);

      await this.auditSecurityEvent(user.tenantId, loginDto.email, 'LOGIN_FAILED', ip, user.id, {
        attempt: newAttempts,
        locked: shouldLock,
      });

      if (shouldLock) {
        throw new ForbiddenException(
          `Account locked for ${lockoutMinutes} minutes after ${maxFailedLogins} failed attempts.`
        );
      }

      const remaining = maxFailedLogins - newAttempts;
      throw new UnauthorizedException(
        remaining > 0
          ? `${GENERIC_AUTH_ERROR}. ${remaining} attempt(s) remaining before lockout.`
          : GENERIC_AUTH_ERROR,
      );
    }

    // ── Success: reset failed attempts, update last login ────────────────
    await (this.prisma.user as any).update({
      where: { id: user.id },
      data: {
        loginAttempts: 0,
        lockedUntil: null,
        lastLoginAt: new Date(),
        lastLoginIp: ip || null,
      },
    });

    if (user.twoFactorEnabled) {
      await this.audit.logAction(user.tenantId, user.id, 'LOGIN', 'User', user.id, {
        event: 'MFA_CHALLENGE_ISSUED',
        role: user.role,
        ip: ip || 'unknown',
      });
      // Issue a short-lived, single-purpose token — never expose the raw userId
      const mfaToken = this.jwtService.sign(
        { sub: user.id, mfaChallenge: true },
        {
          secret: process.env.JWT_ACCESS_SECRET!,
          expiresIn: operationalConfig().auth.mfaChallengeTtl as any,
        },
      );
      return {
        mfaRequired: true,
        mfaToken,
        message: 'Please provide your TOTP code',
      };
    }

    await this.audit.logSecurityEvent({
      actorUserId: user.id,
      actorRole: user.role,
      actorTenantId: user.tenantId || null,
      targetType: 'User',
      targetId: user.id,
      action: 'LOGIN',
      ipAddress: ip || 'unknown',
      result: 'SUCCESS',
    });

    return this.generateTokens(user.id, user.email, user.role, user.tenantId || null, user.branchId || null);
  }

  @SystemContext('pre-auth: completing the MFA challenge')
  async verifyMfa(mfaToken: string, code: string, ip?: string) {
    // Verify the short-lived MFA challenge token — never accept a raw userId directly
    let userId: string;
    try {
      const payload = this.jwtService.verify<{ sub: string; mfaChallenge: boolean }>(
        mfaToken,
        { secret: process.env.JWT_ACCESS_SECRET! },
      );
      if (!payload.mfaChallenge) throw new Error('Not an MFA token');
      userId = payload.sub;
    } catch {
      throw new UnauthorizedException('Invalid or expired MFA session. Please log in again.');
    }

    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || !user.twoFactorSecret) throw new UnauthorizedException();

    // ── Per-user MFA lockout ─────────────────────────────────────────────────
    // Prevents TOTP brute-force within the 5-minute challenge window. Reuses the
    // same attempt counter/lock as password login (a shared account lock).
    if (user.lockedUntil && new Date() < user.lockedUntil) {
      const minutesLeft = Math.ceil((user.lockedUntil.getTime() - Date.now()) / 60000);
      await this.auditSecurityEvent(user.tenantId, user.email, 'LOGIN_ACCOUNT_LOCKED', ip, user.id);
      throw new ForbiddenException(
        `Account is temporarily locked due to too many failed attempts. Try again in ${minutesLeft} minute(s).`,
      );
    }

    const isValid = await totpCodeMatches(code, user.twoFactorSecret);

    if (!isValid) {
      const { shouldLock, maxFailedLogins, lockoutMinutes } = await this.recordFailedAttempt(user.id);
      await this.audit.logSecurityEvent({
        actorUserId: user.id,
        actorRole: user.role,
        actorTenantId: user.tenantId || null,
        targetType: 'User',
        targetId: user.id,
        action: 'LOGIN_MFA_FAILED',
        ipAddress: ip || 'unknown',
        result: 'FAILURE',
      });
      if (shouldLock) {
        throw new ForbiddenException(
          `Account locked for ${lockoutMinutes} minutes after ${maxFailedLogins} failed attempts.`,
        );
      }
      throw new UnauthorizedException('Invalid MFA code');
    }

    // Success — clear any accumulated failed attempts.
    await (this.prisma.user as any).update({
      where: { id: user.id },
      data: { loginAttempts: 0, lockedUntil: null },
    });

    await this.audit.logSecurityEvent({
      actorUserId: user.id,
      actorRole: user.role,
      actorTenantId: user.tenantId || null,
      targetType: 'User',
      targetId: user.id,
      action: 'LOGIN_MFA',
      ipAddress: ip || 'unknown',
      result: 'SUCCESS',
    });

    return this.generateTokens(user.id, user.email, user.role, user.tenantId || null, user.branchId || null, undefined, 'mfa');
  }

  async generateMfaSecret(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new UnauthorizedException();
    // Replacing the secret of an enabled factor would let anyone holding a
    // session (but not the authenticator) take the factor over.
    if (user.twoFactorEnabled) throw new ConflictException('MFA is already enabled');

    const secret = generateSecret();
    const otpauthUrl = otpauth.keyuri(user.email, operationalConfig().platformName, secret);
    const qrCodeDataUrl = await qrcode.toDataURL(otpauthUrl);

    await this.prisma.user.update({
      where: { id: userId },
      data: { twoFactorSecret: encryptField(secret) },
    });

    await this.audit.logSecurityEvent({
      actorUserId: user.id,
      actorRole: user.role,
      actorTenantId: user.tenantId || null,
      targetType: 'User',
      targetId: user.id,
      action: 'MFA_SETUP_INITIATED',
      result: 'SUCCESS',
    });

    return { secret, qrCodeDataUrl };
  }

  /** Whether the signed-in person already has an authenticator enrolled. */
  async mfaStatus(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { twoFactorEnabled: true },
    });
    if (!user) throw new UnauthorizedException();
    return { enabled: user.twoFactorEnabled };
  }

  async enableMfa(userId: string, code: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new UnauthorizedException();
    // A wrong or missing setup code is a mistake in the form, not a failed
    // session: answering 401 would sign the person out mid-setup.
    if (!user.twoFactorSecret) {
      throw new BadRequestException('Authenticator setup has not been started. Start it again.');
    }

    if (user.twoFactorEnabled) throw new ConflictException('MFA is already enabled');

    const isValid = await totpCodeMatches(code, user.twoFactorSecret);
    if (!isValid) throw new BadRequestException('Invalid verification code');

    await this.prisma.user.update({
      where: { id: userId },
      data: { twoFactorEnabled: true },
    });

    await this.audit.logSecurityEvent({
      actorUserId: user.id,
      actorRole: user.role,
      actorTenantId: user.tenantId || null,
      targetType: 'User',
      targetId: user.id,
      action: 'MFA_ENABLED',
      result: 'SUCCESS',
    });

    return { success: true };
  }

  async promoteSuperadmin(email: string) {
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user) throw new BadRequestException(`No user found with email: ${email}`);

    const updated = await this.prisma.user.update({
      where: { email },
      data: { role: Role.SUPERADMIN, tenantId: null, branchId: null },
      select: { id: true, email: true, role: true, tenantId: true },
    });

    await this.audit.logSecurityEvent({
      actorUserId: updated.id,
      actorRole: updated.role,
      actorTenantId: updated.tenantId || null,
      targetType: 'User',
      targetId: updated.id,
      action: 'PROMOTED_TO_SUPERADMIN',
      newValue: { newRole: Role.SUPERADMIN },
      result: 'SUCCESS',
    });

    return { success: true, message: `${email} has been promoted to SUPERADMIN`, user: updated };
  }

  async listSuperadmins() {
    const admins = await this.prisma.user.findMany({
      where: { role: Role.SUPERADMIN },
      select: { id: true, email: true, role: true, createdAt: true, tenant: { select: { name: true } } },
    });
    return { superadmins: admins, count: admins.length };
  }

  @SystemContext('pre-auth: redeeming a refresh token')
  async refreshToken(refreshToken: string) {
    if (!refreshToken) {
      throw new UnauthorizedException('Refresh token is required');
    }

    type RefreshPayload = {
      sub: string;
      email: string;
      role: string;
      tenantId: string | null;
      branchId?: string | null;
      jti?: string;
      typ?: string;
      amr?: string;
    };

    let payload: RefreshPayload;
    try {
      payload = this.jwtService.verify<RefreshPayload>(refreshToken, {
        secret: process.env.JWT_REFRESH_SECRET!, // startup guard guarantees this is set
      });
    } catch {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    if (!payload.jti || payload.typ !== REFRESH_TOKEN_TYPE) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    const tokenRecord = await this.prisma.refreshToken.findUnique({
      where: { id: payload.jti },
      include: {
        user: {
          include: { tenant: { select: { status: true, name: true } } },
        },
      },
    });

    if (!tokenRecord) {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    // Reuse detection: a revoked token being presented again indicates replay.
    if (tokenRecord.revokedAt) {
      await this.revokeAllUserSessions(tokenRecord.userId);
      await this.audit.logSecurityEvent({
        actorUserId: tokenRecord.userId,
        actorRole: tokenRecord.user.role,
        actorTenantId: tokenRecord.user.tenantId || null,
        targetType: 'RefreshToken',
        targetId: tokenRecord.id,
        action: 'REFRESH_TOKEN_REUSE',
        reason: 'Revoked token replayed',
        result: 'FAILURE',
      });
      throw new UnauthorizedException('Refresh token reuse detected. Please log in again.');
    }

    if (tokenRecord.expiresAt.getTime() <= Date.now()) {
      await this.prisma.refreshToken.update({
        where: { id: tokenRecord.id },
        data: { revokedAt: new Date() },
      }).catch(() => { });
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    const incomingHash = this.hashRefreshToken(refreshToken);
    if (incomingHash !== tokenRecord.hashedToken) {
      await this.revokeAllUserSessions(tokenRecord.userId);
      await this.audit.logSecurityEvent({
        actorUserId: tokenRecord.userId,
        actorRole: tokenRecord.user.role,
        actorTenantId: tokenRecord.user.tenantId || null,
        targetType: 'RefreshToken',
        targetId: tokenRecord.id,
        action: 'REFRESH_TOKEN_REUSE',
        reason: 'Token hash mismatch',
        result: 'FAILURE',
      });
      throw new UnauthorizedException('Refresh token reuse detected. Please log in again.');
    }

    if (!tokenRecord.user.isActive) {
      await this.revokeAllUserSessions(tokenRecord.userId);
      throw new UnauthorizedException('User account is suspended or no longer exists.');
    }

    if (tokenRecord.user.tenant?.status !== 'ACTIVE' && tokenRecord.user.role !== Role.SUPERADMIN) {
      await this.revokeAllUserSessions(tokenRecord.userId);
      throw new ForbiddenException(
        `Organization ${tokenRecord.user.tenant?.name || 'Unknown'} has been suspended or is pending data erasure.`
      );
    }

    return this.prisma.$transaction(async (tx) => {
      const revoke = await tx.refreshToken.updateMany({
        where: { id: tokenRecord.id, revokedAt: null },
        data: { revokedAt: new Date() },
      });

      // Concurrent replay: token was consumed by another request first.
      if (revoke.count !== 1) {
        await tx.refreshToken.updateMany({
          where: { userId: tokenRecord.userId, revokedAt: null },
          data: { revokedAt: new Date() },
        });
        await this.audit.logSecurityEvent({
          actorUserId: tokenRecord.userId,
          actorRole: tokenRecord.user.role,
          actorTenantId: tokenRecord.user.tenantId || null,
          targetType: 'RefreshToken',
          targetId: tokenRecord.id,
          action: 'REFRESH_TOKEN_REUSE',
          reason: 'Concurrent reuse detected during rotation',
          result: 'FAILURE',
        });
        throw new UnauthorizedException('Refresh token reuse detected. Please log in again.');
      }

      return this.generateTokens(
        tokenRecord.user.id,
        tokenRecord.user.email,
        tokenRecord.user.role,
        tokenRecord.user.tenantId,
        tokenRecord.user.branchId || null,
        tx,
        // Authentication strength carries over a refresh; it is never upgraded by one.
        payload.amr === 'mfa' ? 'mfa' : 'pwd',
      );
    });
  }

  /**
   * Sign-out: revoke the presented refresh token. Idempotent and quiet — an
   * unknown, expired, already-revoked or malformed token answers the same
   * success, so the endpoint reveals nothing and a double sign-out is
   * harmless. It is deliberately NOT treated as reuse: revoking a revoked
   * token cannot mint anything, and tripping reuse detection here would let
   * a stale tab's sign-out end every other session.
   */
  @SystemContext('pre-auth: revoking a refresh token at sign-out')
  async logout(refreshToken: string | undefined, ip?: string) {
    const done = { success: true };
    if (!refreshToken) return done;
    let payload: { sub?: string; jti?: string; typ?: string };
    try {
      payload = this.jwtService.verify(refreshToken, {
        secret: process.env.JWT_REFRESH_SECRET!,
        // An expired token is still worth revoking (its row may outlive the JWT).
        ignoreExpiration: true,
      });
    } catch {
      return done;
    }
    if (!payload.jti || payload.typ !== REFRESH_TOKEN_TYPE) return done;

    const revoked = await this.prisma.refreshToken.updateMany({
      where: {
        id: payload.jti,
        hashedToken: this.hashRefreshToken(refreshToken),
        revokedAt: null,
      },
      data: { revokedAt: new Date() },
    });
    if (revoked.count === 1 && payload.sub) {
      const user = await this.prisma.user.findUnique({
        where: { id: payload.sub },
        select: { id: true, role: true, tenantId: true },
      });
      if (user) {
        await this.audit.logSecurityEvent({
          actorUserId: user.id,
          actorRole: user.role,
          actorTenantId: user.tenantId || null,
          targetType: 'RefreshToken',
          targetId: payload.jti,
          action: 'LOGOUT',
          ipAddress: ip || 'unknown',
          result: 'SUCCESS',
        });
      }
    }
    return done;
  }

  /** "Sign out everywhere": revoke every refresh token the person holds. */
  async revokeAllSessions(userId: string, ip?: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, role: true, tenantId: true },
    });
    if (!user) throw new UnauthorizedException();
    const revoked = await this.prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    await this.audit.logSecurityEvent({
      actorUserId: user.id,
      actorRole: user.role,
      actorTenantId: user.tenantId || null,
      targetType: 'User',
      targetId: user.id,
      action: 'SESSIONS_REVOKED_ALL',
      newValue: { revoked: revoked.count },
      ipAddress: ip || 'unknown',
      result: 'SUCCESS',
    });
    return { success: true, revoked: revoked.count };
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  private async auditSecurityEvent(
    tenantId: string | null,
    email: string,
    event: string,
    ip?: string,
    userId?: string,
    extra?: any,
  ) {
    try {
      await this.audit.logSecurityEvent({
        actorUserId: userId || null,
        actorRole: null,
        actorTenantId: tenantId,
        targetType: 'User',
        targetId: userId || email,
        action: event,
        newValue: extra,
        ipAddress: ip || 'unknown',
        result: 'FAILURE',
      });
    } catch { /* never fail on audit */ }
  }

  private async generateTokens(
    userId: string,
    email: string,
    role: string,
    tenantId: string | null,
    branchId: string | null = null,
    tx?: Prisma.TransactionClient,
    // Authentication method reference: "mfa" only after a verified TOTP
    // challenge. Lending approvals require it (environment.assurance).
    amr: 'pwd' | 'mfa' = 'pwd',
  ) {
    const db = tx ?? this.prisma;
    const tenant = tenantId
      ? await db.tenant.findUnique({ where: { id: tenantId }, select: { name: true } })
      : null;
    const tenantName = tenant?.name || operationalConfig().platformName;
    const payload = {
      sub: userId,
      email,
      role,
      tenantId,
      branchId,
      tenantName,
      permissions: Array.from(permissionsForRole(role)),
      amr,
    };

    const refreshTokenId = randomUUID();
    const refreshTtlRaw = operationalConfig().auth.refreshTtl;
    const refreshToken = this.jwtService.sign(
      { ...payload, typ: REFRESH_TOKEN_TYPE, jti: refreshTokenId },
      {
        secret: process.env.JWT_REFRESH_SECRET,
        expiresIn: refreshTtlRaw as any,
      },
    );

    await db.refreshToken.create({
      data: {
        id: refreshTokenId,
        userId,
        hashedToken: this.hashRefreshToken(refreshToken),
        expiresAt: new Date(Date.now() + durationMs('JWT_REFRESH_TTL', refreshTtlRaw)),
      },
    });

    return {
      access_token: this.jwtService.sign(payload),
      refresh_token: refreshToken,
    };
  }

  private hashRefreshToken(token: string): string {
    const pepper = process.env.JWT_REFRESH_TOKEN_PEPPER || '';
    return createHash('sha256').update(`${token}.${pepper}`).digest('hex');
  }

  /**
   * Count a failed password or TOTP attempt in the database, atomically:
   * concurrent attempts on several API instances each add one, so parallel
   * guessing cannot slip past the threshold the way a read-then-write counter
   * would allow. Reaching the threshold locks the account.
   */
  private async recordFailedAttempt(userId: string) {
    const { maxFailedLogins, lockoutMinutes } = operationalConfig().auth;
    const counted = await this.prisma.user.update({
      where: { id: userId },
      data: { loginAttempts: { increment: 1 } },
      select: { loginAttempts: true },
    });
    const newAttempts = counted.loginAttempts;
    const shouldLock = newAttempts >= maxFailedLogins;
    if (shouldLock)
      await this.prisma.user.update({
        where: { id: userId },
        data: { lockedUntil: new Date(Date.now() + lockoutMinutes * 60_000) },
      });
    return { newAttempts, shouldLock, maxFailedLogins, lockoutMinutes };
  }

  private async revokeAllUserSessions(userId: string) {
    await this.prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    }).catch(() => { });
  }
}
