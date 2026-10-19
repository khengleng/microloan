import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { z } from 'zod';
import type { Request } from 'express';
import { BorrowerRoute } from '../../auth/auth-scope.decorator';
import { BorrowerJwtGuard } from '../../borrower-portal/borrower-jwt.guard';
import { LendingAction, lendingActorOf } from '../policy/lending-action.guard';
import { ZodPipe } from '../common/zod.pipe';
import { KeyFactsService } from './key-facts.service';

const actor = (req: Request) => lendingActorOf(req as never);
const ID = new ParseUUIDPipe();

/**
 * The customer's side of the key facts statement (D-123) in the borrower
 * portal: read the statements issued to them and accept the one in force.
 * Accepting binds the exact terms version shown (its hash).
 */
@BorrowerRoute()
@UseGuards(BorrowerJwtGuard)
@Controller('lending/portal')
export class KeyFactsPortalController {
  constructor(private readonly keyFacts: KeyFactsService) {}

  @LendingAction('key_facts.read_own')
  @Get('key-facts')
  list(@Req() req: Request) {
    return this.keyFacts.portalList(actor(req));
  }

  @LendingAction('key_facts.accept_own')
  @Post('key-facts/:statementId/accept')
  accept(
    @Req() req: Request,
    @Param('statementId', ID) statementId: string,
    @Body(new ZodPipe(z.object({ termsHash: z.string().length(64) }).strict()))
    b: { termsHash: string },
  ) {
    return this.keyFacts.acceptOwn(actor(req), statementId, b);
  }
}
