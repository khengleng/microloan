import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { createHash, randomInt } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { borrowerJwtSecret, BORROWER_TOKEN_TTL } from './borrower-jwt';
import { blindIndex } from '../common/field-crypto';
import { SystemContext } from '../prisma/tenant-context';

const OTP_TTL_MS = 5 * 60 * 1000;
const MAX_ATTEMPTS = 5;
/** Codes a phone may be sent per window, so the attempt limit cannot be reset by re-requesting. */
const MAX_ISSUES_PER_WINDOW = 3;
const ISSUE_WINDOW_MS = 15 * 60 * 1000;

@Injectable()
export class BorrowerAuthService {
  private readonly logger = new Logger(BorrowerAuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly jwt: JwtService,
  ) {}

  private hash(code: string): string {
    const pepper = process.env.JWT_REFRESH_TOKEN_PEPPER || '';
    return createHash('sha256').update(`${code}:${pepper}`).digest('hex');
  }

  /**
   * Always returns a generic success to avoid phone-number enumeration.
   *
   * The same phone can belong to borrowers of several organisations. Each
   * gets its own code, named in one SMS, and the code the borrower enters
   * decides which organisation they sign in to — so one organisation can
   * never capture another's customer by touching a record with the same
   * number (tenant wall), and the reply never says how many there were.
   *
   * Issuance is capped per phone, so codes cannot be re-rolled to reset the
   * attempt limit.
   */
  @SystemContext('pre-auth: resolving a borrower by phone')
  async requestOtp(phoneRaw: string): Promise<{ sent: true }> {
    const phone = phoneRaw.trim();
    const phoneHash = blindIndex(phone, 'phone') as string;
    const recent = await this.prisma.borrowerOtp.count({
      where: {
        phone: phoneHash,
        createdAt: { gt: new Date(Date.now() - ISSUE_WINDOW_MS) },
      },
    });
    if (recent >= MAX_ISSUES_PER_WINDOW) return { sent: true };

    const borrowers = await this.prisma.borrower.findMany({
      where: { phoneHash, tenant: { status: 'ACTIVE' } },
      orderBy: { createdAt: 'asc' },
      select: { id: true, tenantId: true, tenant: { select: { name: true } } },
      take: 5,
    });
    if (!borrowers.length) return { sent: true };

    const lines: string[] = [];
    for (const b of borrowers) {
      const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
      await this.prisma.borrowerOtp.create({
        data: {
          // Store the phone blind index (not the raw number) as the lookup key.
          phone: phoneHash,
          borrowerId: b.id,
          tenantId: b.tenantId,
          codeHash: this.hash(code),
          expiresAt: new Date(Date.now() + OTP_TTL_MS),
        },
      });
      lines.push(borrowers.length > 1 ? `${b.tenant.name}: ${code}` : code);
    }
    const message =
      borrowers.length > 1
        ? `Your login codes (enter the one for the lender you want): ${lines.join('; ')}. They expire in 5 minutes. Do not share them.`
        : `Your login code is ${lines[0]}. It expires in 5 minutes. Do not share it.`;
    // Fire-and-forget SMS; never leak delivery status to the caller.
    this.notifications
      .sendSms(phone, message)
      .catch((err) =>
        this.logger.warn(`OTP SMS send failed: ${err?.message || err}`),
      );
    return { sent: true };
  }

  @SystemContext('pre-auth: redeeming a borrower OTP')
  async verifyOtp(phoneRaw: string, code: string) {
    const phone = phoneRaw.trim();
    const phoneHash = blindIndex(phone, 'phone') as string;
    const live = await this.prisma.borrowerOtp.findMany({
      where: {
        phone: phoneHash,
        consumedAt: null,
        expiresAt: { gt: new Date() },
        attempts: { lt: MAX_ATTEMPTS },
      },
    });
    if (!live.length)
      throw new UnauthorizedException('Invalid or expired code');

    // Spend an attempt before comparing, atomically: parallel guesses each
    // pay, so no code can be tried more than MAX_ATTEMPTS times.
    const spent = await this.prisma.borrowerOtp.updateMany({
      where: {
        id: { in: live.map((o) => o.id) },
        attempts: { lt: MAX_ATTEMPTS },
      },
      data: { attempts: { increment: 1 } },
    });
    if (spent.count === 0) {
      throw new UnauthorizedException('Too many attempts. Request a new code.');
    }
    const otp = live.find((o) => o.codeHash === this.hash(code));
    if (!otp) throw new UnauthorizedException('Invalid or expired code');

    // Consume the code (single-use) and invalidate any other outstanding codes.
    await this.prisma.borrowerOtp.updateMany({
      where: { phone: phoneHash, consumedAt: null },
      data: { consumedAt: new Date() },
    });

    const borrower = await this.prisma.borrower.findUnique({
      where: { id: otp.borrowerId },
      select: {
        id: true,
        tenantId: true,
        firstName: true,
        lastName: true,
        phone: true,
        kycStatus: true,
        tenant: { select: { status: true } },
      },
    });
    if (!borrower || borrower.tenant?.status !== 'ACTIVE') {
      throw new UnauthorizedException('Account is not available');
    }

    const token = await this.jwt.signAsync(
      { sub: borrower.id, typ: 'borrower', tenantId: borrower.tenantId },
      { secret: borrowerJwtSecret(), expiresIn: BORROWER_TOKEN_TTL },
    );

    return {
      borrower_token: token,
      borrower: {
        id: borrower.id,
        firstName: borrower.firstName,
        lastName: borrower.lastName,
        kycStatus: borrower.kycStatus,
      },
    };
  }
}
