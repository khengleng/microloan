import {
  Controller,
  Post,
  Body,
  HttpCode,
  HttpStatus,
  Get,
  Param,
  Req,
  Query,
} from '@nestjs/common';
import { Throttle, SkipThrottle } from '@nestjs/throttler';
import { AuthService } from './auth.service';
import { LoginDto, RefreshDto } from './dto/login.dto';
import { RegisterTenantDto } from './dto/register-tenant.dto';
import { Roles } from './roles.decorator';
import { CurrentUser } from './current-user.decorator';
import type { JwtPayload } from './jwt.strategy';
import { AnyAuthenticated, MfaEnrolmentRoute, Public } from './auth-scope.decorator';
import { SuperadminGrantService } from '../platform-approvals/superadmin-grant.service';
import { GoogleLoginDto, GoogleRegisterTenantDto } from './dto/google-auth.dto';
import { SignupPaymentService } from '../billing/signup-payment.service';
import { webOrigin } from '../config/operational-config';
import { clientIp } from '../common/client-ip';
import { ThrottleIdentity } from '../common/user-aware-throttler.guard';

/**
 * The browser's IP: the address the web server states (X-Client-IP, believed
 * only with a valid X-Web-Proxy-Secret), else req.ip. See common/client-ip.ts.
 */
function getIp(req: any): string {
  return clientIp(req);
}
@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly signupPayments: SignupPaymentService,
    private readonly superadminGrants: SuperadminGrantService,
  ) { }

  /**
   * Lets the sign-in page decide whether to render the Google button, without
   * shipping the client id in the web bundle for a deployment that has none.
   */
  /** Plan catalogue for the signup page. */
  @Public()
  @SkipThrottle()
  @Get('plans')
  plans() {
    return this.authService.plans();
  }

  @Public()
  @SkipThrottle()
  @Get('providers')
  providers() {
    return this.authService.googleAvailable();
  }

  /** Same 10-per-15-min budget as password login. */
  @Throttle({ default: { limit: 10, ttl: 15 * 60_000 } })
  @Public()
  @HttpCode(HttpStatus.OK)
  @Post('google')
  googleLogin(@Body() dto: GoogleLoginDto, @Req() req: any) {
    return this.authService.loginWithGoogle(dto.idToken, getIp(req));
  }

  /** Same 5-per-hour budget as password registration. */
  @Throttle({ default: { limit: 5, ttl: 60 * 60_000 } })
  @Public()
  @Post('google/register-tenant')
  googleRegister(@Body() dto: GoogleRegisterTenantDto, @Req() req: any) {
    return this.authService.registerTenantWithGoogle(dto, getIp(req));
  }

  /**
   * Re-open a signup payment QR. Public by necessity: the applicant cannot
   * authenticate until the workspace is activated, so the unguessable
   * reference is the only credential they hold. Throttled hard because that
   * reference is the sole thing standing between a guess and a lookup.
   */
  @Throttle({ default: { limit: 20, ttl: 15 * 60_000 } })
  @Public()
  @Get('signup/payment/:reference')
  signupPayment(@Param('reference') reference: string) {
    return this.signupPayments.findByReference(reference);
  }

  /** 5 registrations / IP / hr */
  @Throttle({ default: { limit: 5, ttl: 60 * 60_000 } })
  @Public()
  @Post('register-tenant')
  register(@Body() registerDto: RegisterTenantDto, @Req() req: any) {
    return this.authService.registerTenant(registerDto, getIp(req));
  }

  /** 10 login attempts / client IP / 15 min, and 10 / email / 15 min. */
  @Throttle({ default: { limit: 10, ttl: 15 * 60_000 } })
  @ThrottleIdentity('email')
  @HttpCode(HttpStatus.OK)
  @Public()
  @Post('login')
  login(@Body() loginDto: LoginDto, @Req() req: any) {
    return this.authService.login(loginDto, getIp(req));
  }

  /**
   * Refresh tokens. The web client now refreshes silently whenever the
   * short-lived access token lapses, so every signed-in person refreshes about
   * once per access-token lifetime; staff in one branch share one public IP.
   * The login budget (10 / 15 min) would lock a busy branch out, and a
   * refresh token is a signed JWT checked against a stored hash, not
   * something a caller can guess the way it can guess a password.
   */
  @Throttle({ default: { limit: 120, ttl: 15 * 60_000 } })
  @HttpCode(HttpStatus.OK)
  @Public()
  @Post('refresh')
  refresh(@Body() refreshDto: RefreshDto) {
    return this.authService.refreshToken(refreshDto.refreshToken);
  }

  /**
   * Sign-out: revoke the refresh token the browser held. Public because the
   * access token may already have lapsed; the refresh token itself is the
   * credential. Idempotent: always answers success.
   */
  @Throttle({ default: { limit: 120, ttl: 15 * 60_000 } })
  @HttpCode(HttpStatus.OK)
  @Public()
  @Post('logout')
  logout(@Body() body: { refreshToken?: string }, @Req() req: any) {
    const token = typeof body?.refreshToken === 'string' ? body.refreshToken : undefined;
    return this.authService.logout(token, getIp(req));
  }

  /** Sign out of every device: revokes all of the caller's refresh tokens. */
  @Throttle({ default: { limit: 10, ttl: 15 * 60_000 } })
  @HttpCode(HttpStatus.OK)
  @AnyAuthenticated()
  @MfaEnrolmentRoute()
  @Post('sessions/revoke-all')
  revokeAllSessions(@CurrentUser() user: JwtPayload, @Req() req: any) {
    return this.authService.revokeAllSessions(user.sub, getIp(req));
  }

  /** Change one's own password (current password required; signs out every session). */
  @Throttle({ default: { limit: 10, ttl: 15 * 60_000 } })
  @HttpCode(HttpStatus.OK)
  @AnyAuthenticated()
  @MfaEnrolmentRoute()
  @Post('change-password')
  changePassword(
    @CurrentUser() user: JwtPayload,
    @Body() dto: { currentPassword: string; newPassword: string },
    @Req() req: any,
  ) {
    return this.authService.changePassword(user, dto?.currentPassword, dto?.newPassword, getIp(req));
  }

  /** Self-service forgot-password — generic response, throttled. */
  @Throttle({ default: { limit: 5, ttl: 15 * 60_000 } })
  @ThrottleIdentity('email')
  @HttpCode(HttpStatus.OK)
  @Public()
  @Post('forgot-password')
  forgotPassword(@Body() dto: { email: string }) {
    return this.authService.forgotPassword(dto?.email, `${webOrigin()}/en`);
  }

  /** Complete a self-service reset with the emailed token. */
  @Throttle({ default: { limit: 10, ttl: 15 * 60_000 } })
  @HttpCode(HttpStatus.OK)
  @Public()
  @Post('reset-password')
  resetPassword(@Body() dto: { token: string; newPassword: string }) {
    return this.authService.resetPassword(dto?.token, dto?.newPassword);
  }

  @SkipThrottle()
  @AnyAuthenticated()
  @MfaEnrolmentRoute()
  @Get('me')
  getProfile(@CurrentUser() user: JwtPayload) {
    // `mfaEnrolmentRequired` tells the web to send the person to My account
    // until their role's authenticator requirement is met (D-128).
    return {
      ...user,
      mfaEnrolmentRequired: !!user.mfaRequired && !(user.mfaEnrolled && user.amr === 'mfa'),
    };
  }

  /**
   * Step 2 of the MFA login flow.
   * Accepts the short-lived mfaToken issued by POST /auth/login (not a raw userId),
   * so attackers cannot brute-force TOTP codes for arbitrary user IDs.
   */
  @Throttle({ default: { limit: 10, ttl: 15 * 60_000 } })
  @ThrottleIdentity('mfa')
  @Public()
  @Post('mfa/authenticate')
  @HttpCode(HttpStatus.OK)
  verifyMfa(@Body() dto: { mfaToken: string; code: string }, @Req() req: any) {
    return this.authService.verifyMfa(dto.mfaToken, dto.code, getIp(req));
  }

  /** Whether the caller already has an authenticator enrolled. */
  @SkipThrottle()
  @AnyAuthenticated()
  @MfaEnrolmentRoute()
  @Get('mfa/status')
  mfaStatus(@CurrentUser() user: JwtPayload) {
    return this.authService.mfaStatus(user.sub);
  }

  @Throttle({ default: { limit: 10, ttl: 15 * 60_000 } })
  @AnyAuthenticated()
  @MfaEnrolmentRoute()
  @Post('mfa/generate')
  generateMfaSecret(@CurrentUser() user: JwtPayload) {
    return this.authService.generateMfaSecret(user.sub);
  }

  /**
   * Turn the authenticator on. Answers a fresh MFA session (tokens); the web
   * calls it through its own /api/auth/mfa/enable route, which stores them as
   * HttpOnly cookies and passes the refresh token it held for revocation.
   */
  @Throttle({ default: { limit: 10, ttl: 15 * 60_000 } })
  @AnyAuthenticated()
  @MfaEnrolmentRoute()
  @HttpCode(HttpStatus.OK)
  @Post('mfa/enable')
  enableMfa(@CurrentUser() user: JwtPayload, @Body() dto: { code: string; refreshToken?: string }) {
    return this.authService.enableMfa(
      user.sub,
      dto?.code,
      typeof dto?.refreshToken === 'string' ? dto.refreshToken : undefined,
    );
  }

  /**
   * Step-up (D-129): a fresh authenticator code inside the current session
   * renews `mfaAt`. Answers new tokens; the web's /api/auth/step-up route
   * stores them as cookies. Same budget as the MFA sign-in step.
   */
  @Throttle({ default: { limit: 10, ttl: 15 * 60_000 } })
  @AnyAuthenticated()
  @MfaEnrolmentRoute()
  @HttpCode(HttpStatus.OK)
  @Post('mfa/step-up')
  stepUp(
    @CurrentUser() user: JwtPayload,
    @Body() dto: { code: string; refreshToken?: string },
    @Req() req: any,
  ) {
    return this.authService.stepUp(
      user.sub,
      dto?.code,
      typeof dto?.refreshToken === 'string' ? dto.refreshToken : undefined,
      getIp(req),
    );
  }

  /**
   * Ask for a user to become SUPERADMIN (D-130). Needs a recent authenticator
   * code; a second super-administrator approves it before it takes effect
   * (unless the caller is the only one, which is logged loudly).
   */
  @SkipThrottle()
  @Roles('SUPERADMIN')
  @HttpCode(HttpStatus.OK)
  @Post('promote-superadmin')
  async promoteSuperadmin(@CurrentUser() user: JwtPayload, @Body() body: { email: string }) {
    return this.superadminGrants.requestPromotion(user, body?.email);
  }

  @SkipThrottle()
  @Roles('SUPERADMIN')
  @Get('superadmin-grants')
  superadminGrantRequests(@CurrentUser() user: JwtPayload, @Query('status') status?: string) {
    return this.superadminGrants.list(user, status || undefined);
  }

  @SkipThrottle()
  @Roles('SUPERADMIN')
  @HttpCode(HttpStatus.OK)
  @Post('superadmin-grants/:approvalId/approve')
  approveSuperadminGrant(
    @CurrentUser() user: JwtPayload,
    @Param('approvalId') approvalId: string,
    @Body() body: { comment?: string },
  ) {
    return this.superadminGrants.approve(user, approvalId, body?.comment);
  }

  @SkipThrottle()
  @Roles('SUPERADMIN')
  @HttpCode(HttpStatus.OK)
  @Post('superadmin-grants/:approvalId/reject')
  rejectSuperadminGrant(
    @CurrentUser() user: JwtPayload,
    @Param('approvalId') approvalId: string,
    @Body() body: { reason?: string },
  ) {
    return this.superadminGrants.reject(user, approvalId, body?.reason ?? '');
  }

  /**
   * List all superadmins — SUPERADMIN-only, authenticated endpoint.
   */
  @SkipThrottle()
  @Roles('SUPERADMIN')
  @HttpCode(HttpStatus.OK)
  @Post('list-superadmins')
  async listSuperadmins() {
    return this.authService.listSuperadmins();
  }
}
