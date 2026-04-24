import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import type { JwtPayload } from './jwt.strategy';

@Injectable()
export class PlatformGuard implements CanActivate {
    canActivate(context: ExecutionContext): boolean {
        const request = context.switchToHttp().getRequest();
        const user = request.user as JwtPayload;

        if (!user || !user.isPlatform || user.role !== 'SUPERADMIN' || user.tenantId !== null) {
            throw new ForbiddenException('This endpoint is restricted to SaaS Platform Operations staff.');
        }

        return true;
    }
}
