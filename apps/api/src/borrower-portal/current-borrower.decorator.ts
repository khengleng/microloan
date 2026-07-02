import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { BorrowerSession } from './borrower-jwt';

export const CurrentBorrower = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): BorrowerSession => {
    const req = ctx.switchToHttp().getRequest();
    return req.user as BorrowerSession;
  },
);
