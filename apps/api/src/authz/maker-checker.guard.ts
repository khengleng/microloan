import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';

@Injectable()
export class MakerCheckerGuard implements CanActivate {
  canActivate(_context: ExecutionContext): boolean {
    // Maker/checker is resource-state dependent and is enforced in service layer.
    return true;
  }
}

