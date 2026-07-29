import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { PrismaService } from '../prisma/prisma.service';
import { borrowerJwtSecret } from './borrower-jwt';
// `import type` is required here: @SystemContext on validate() makes this a
// decorated signature, and emitDecoratorMetadata would otherwise try to emit
// a runtime reference to these interfaces.
import type { BorrowerJwtPayload, BorrowerSession } from './borrower-jwt';
import { SystemContext, setRequestContext } from '../prisma/tenant-context';

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

  // Same rationale as the staff strategy: the borrower row must be read before
  // a principal exists, then the resolved tenant is published for the request.
  @SystemContext('validating a borrower access token')
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

    // Borrowers are tenant principals too — the wall applies to the portal
    // exactly as it does to staff routes.
    setRequestContext({
      mode: 'tenant',
      tenantId: borrower.tenantId,
      actorId: borrower.id,
    });

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
