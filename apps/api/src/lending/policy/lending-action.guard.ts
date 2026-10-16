import {
  applyDecorators,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  SetMetadata,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { timingSafeEqual } from 'node:crypto';
import {
  AnyAuthenticated,
  IS_BORROWER_ROUTE_KEY,
  IS_PUBLIC_KEY,
  Public,
} from '../../auth/auth-scope.decorator';
import { PrismaService } from '../../prisma/prisma.service';
import { runAsSystem, setRequestContext } from '../../prisma/tenant-context';
import { PolicyService } from './policy.service';
import { ACTION_BY_CODE } from './actions';
import {
  LendingActor,
  actorFromBorrower,
  actorFromJwt,
  sha256,
} from '../common/util';

export const LENDING_ACTION_KEY = 'lending:action';
export const SERVICE_ROUTE_KEY = 'lending:service-route';

/**
 * Declares the lending action a route performs.
 *
 * The route-level check is coarse — "does this principal hold the permission
 * anywhere?" — and exists so an unauthorised caller is turned away before any
 * work is done. It is NOT the authorization decision: every service method
 * calls `PolicyService.enforce` on the specific resource, inside its
 * transaction, which is what applies tenant, scope, maker-checker, authority,
 * flag, product and workflow conditions.
 */
export const LendingAction = (action: string) => {
  if (!ACTION_BY_CODE[action])
    throw new Error(`Unknown lending action ${action}`);
  return applyDecorators(
    SetMetadata(LENDING_ACTION_KEY, action),
    AnyAuthenticated(),
  );
};

/** An integration route authenticated by a service-account key instead of a staff session. */
export const ServiceAccountRoute = (action: string) => {
  if (!ACTION_BY_CODE[action])
    throw new Error(`Unknown lending action ${action}`);
  return applyDecorators(
    SetMetadata(LENDING_ACTION_KEY, action),
    SetMetadata(SERVICE_ROUTE_KEY, true),
    Public(),
  );
};

export function lendingActorOf(req: {
  user?: unknown;
  serviceActor?: LendingActor;
}): LendingActor {
  if (req.serviceActor) return req.serviceActor;
  if (!req.user) throw new UnauthorizedException();
  const borrower = req.user as { borrowerId?: string; tenantId?: string };
  if (borrower.borrowerId && borrower.tenantId)
    return actorFromBorrower({
      borrowerId: borrower.borrowerId,
      tenantId: borrower.tenantId,
    });
  return actorFromJwt(req.user as Parameters<typeof actorFromJwt>[0]);
}

@Injectable()
export class LendingActionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly policy: PolicyService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()];
    const action = this.reflector.getAllAndOverride<string>(
      LENDING_ACTION_KEY,
      targets,
    );
    if (!action) return true;
    const req = context.switchToHttp().getRequest();

    if (this.reflector.getAllAndOverride<boolean>(SERVICE_ROUTE_KEY, targets)) {
      req.serviceActor = await this.authenticateServiceAccount(
        req.headers?.['x-service-key'],
      );
    } else if (
      this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, targets) ||
      this.reflector.getAllAndOverride<boolean>(IS_BORROWER_ROUTE_KEY, targets)
    ) {
      // Borrower routes authenticate in their own controller guard (after global guards);
      // the service makes the ownership-scoped decision.
      return true;
    }

    const actor = lendingActorOf(req);
    if (!(await this.policy.holdsPermission(actor, action))) {
      throw new ForbiddenException({
        message: `Your roles do not include ${ACTION_BY_CODE[action].permission}`,
        code: 'ACCESS_DENIED',
        action,
      });
    }
    return true;
  }

  /**
   * `X-Service-Key: <prefix>.<secret>`. Only a peppered SHA-256 of the secret
   * is stored. The account is bound to one tenant and carries narrow scopes.
   */
  private async authenticateServiceAccount(
    header: unknown,
  ): Promise<LendingActor> {
    if (
      typeof header !== 'string' ||
      !/^[A-Za-z0-9]{8,32}\.[A-Za-z0-9_-]{24,128}$/.test(header)
    ) {
      throw new UnauthorizedException('A valid X-Service-Key is required.');
    }
    const [prefix, secret] = header.split('.');
    const account = await runAsSystem('service-account authentication', () =>
      this.prisma.serviceAccount.findUnique({
        where: { keyPrefix: prefix },
        include: { tenant: { select: { status: true } } },
      }),
    );
    const expected = account
      ? Buffer.from(account.keyHash, 'hex')
      : Buffer.alloc(32);
    const actual = Buffer.from(serviceKeyHash(secret), 'hex');
    const match =
      expected.length === actual.length && timingSafeEqual(expected, actual);
    if (
      !account ||
      !match ||
      account.status !== 'ACTIVE' ||
      account.expiresAt <= new Date() ||
      account.tenant.status !== 'ACTIVE'
    ) {
      throw new UnauthorizedException(
        'Service key is invalid, disabled or expired.',
      );
    }
    setRequestContext({
      mode: 'tenant',
      tenantId: account.tenantId,
      actorId: `svc:${account.id}`,
    });
    void runAsSystem('service-account last use', () =>
      this.prisma.serviceAccount.update({
        where: { id: account.id },
        data: { lastUsedAt: new Date() },
      }),
    );
    return {
      id: `svc:${account.id}`,
      type: 'SERVICE',
      tenantId: account.tenantId,
      assurance: 'SERVICE_KEY',
      channel: 'API',
      scopes: account.scopes,
    };
  }
}

export function serviceKeyHash(secret: string): string {
  const pepper =
    process.env.SERVICE_KEY_PEPPER ||
    process.env.JWT_REFRESH_TOKEN_PEPPER ||
    '';
  return sha256(`${pepper}:${secret}`);
}
