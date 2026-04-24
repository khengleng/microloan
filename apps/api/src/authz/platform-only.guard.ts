import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { AuthzService } from './authz.service';

@Injectable()
export class PlatformOnlyGuard implements CanActivate {
  constructor(private readonly authz: AuthzService) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest();
    this.authz.assertPlatformOnly(req.user);
    return true;
  }
}

