import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { PrismaService } from '../prisma/prisma.service';
import { borrowerJwtSecret, BorrowerJwtPayload, BorrowerSession } from './borrower-jwt';

@Injectable()
export class BorrowerJwtStrategy extends PassportStrategy(Strategy, 'borrower-jwt') {
  constructor(private prisma: PrismaService) {
    super({
      jwtFromRequest: ExtractJwt.fromExtractors([
        ExtractJwt.fromAuthHeaderAsBearerToken(),
        (req) => req?.cookies?.['borrower_token'] || null,
      ]),
      ignoreExpiration: false,
      secretOrKey: borrowerJwtSecret(),
    });
  }

  async validate(payload: BorrowerJwtPayload): Promise<BorrowerSession> {
    // Hard requirement: this token type is a borrower token, never a staff one.
    if (payload.typ !== 'borrower' || !payload.sub) {
      throw new UnauthorizedException('Invalid borrower token');
    }

    const borrower = await this.prisma.borrower.findUnique({
      where: { id: payload.sub },
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

    if (!borrower) throw new UnauthorizedException('Borrower no longer exists');
    if (borrower.tenantId !== payload.tenantId) {
      throw new UnauthorizedException('Token scope mismatch');
    }
    if (borrower.tenant?.status !== 'ACTIVE') {
      throw new UnauthorizedException('Organization is not active');
    }

    return {
      borrowerId: borrower.id,
      tenantId: borrower.tenantId,
      firstName: borrower.firstName,
      lastName: borrower.lastName,
      phone: borrower.phone,
      kycStatus: borrower.kycStatus,
    };
  }
}
