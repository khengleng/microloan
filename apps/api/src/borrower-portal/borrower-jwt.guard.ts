import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

@Injectable()
export class BorrowerJwtGuard extends AuthGuard('borrower-jwt') {}
