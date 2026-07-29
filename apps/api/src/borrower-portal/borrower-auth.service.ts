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
   * Always returns a generic success to avoid phone-number enumeration. If a
   * borrower with this phone exists in an ACTIVE tenant, an SMS OTP is sent.
   * The OTP is bound to the most-recently-updated matching borrower.
   */
  @SystemContext('pre-auth: resolving a borrower by phone')
  async requestOtp(phoneRaw: string): Promise<{ sent: true }> {
    const phone = phoneRaw.trim();
    const phoneHash = blindIndex(phone, 'phone');
    const borrower = await this.prisma.borrower.findFirst({
      where: { phoneHash, tenant: { status: 'ACTIVE' } },
      orderBy: { updatedAt: 'desc' },
      select: { id: true, tenantId: true },
    });

    if (borrower) {
      const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
      await this.prisma.borrowerOtp.create({
        data: {
          // Store the phone blind index (not the raw number) as the lookup key.
          phone: phoneHash as string,
          borrowerId: borrower.id,
          tenantId: borrower.tenantId,
          codeHash: this.hash(code),
          expiresAt: new Date(Date.now() + OTP_TTL_MS),
        },
      });
      // Fire-and-forget SMS; never leak delivery status to the caller.
      this.notifications
        .sendSms(phone, `Your login code is ${code}. It expires in 5 minutes. Do not share it.`)
        .catch((err) => this.logger.warn(`OTP SMS send failed: ${err?.message || err}`));
    }

    return { sent: true };
  }

  @SystemContext('pre-auth: redeeming a borrower OTP')
  async verifyOtp(phoneRaw: string, code: string) {
    const phone = phoneRaw.trim();
    const phoneHash = blindIndex(phone, 'phone') as string;
    const otp = await this.prisma.borrowerOtp.findFirst({
      where: { phone: phoneHash, consumedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
    });

    if (!otp) throw new UnauthorizedException('Invalid or expired code');
    if (otp.attempts >= MAX_ATTEMPTS) {
      throw new UnauthorizedException('Too many attempts. Request a new code.');
    }

    if (otp.codeHash !== this.hash(code)) {
      await this.prisma.borrowerOtp.update({
        where: { id: otp.id },
        data: { attempts: { increment: 1 } },
      });
      throw new UnauthorizedException('Invalid or expired code');
    }

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
