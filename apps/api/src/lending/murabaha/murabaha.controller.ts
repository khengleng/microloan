import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { LendingAction, lendingActorOf } from '../policy/lending-action.guard';
import { S, ZodPipe } from '../common/zod.pipe';
import { MurabahaService } from './murabaha.service';

const ID = new ParseUUIDPipe();
const actor = (req: Request) => lendingActorOf(req as never);

/**
 * Murabaha: the asset the financier buys and resells, and the contract's
 * disclosure of cost, profit and sale price with its profit recognition.
 */
@Controller('lending/loans/:loanId')
export class MurabahaController {
  constructor(private readonly svc: MurabahaService) {}

  @LendingAction('loan.read')
  @Get('murabaha')
  get(@Req() req: Request, @Param('loanId', ID) loanId: string) {
    return this.svc.get(actor(req), loanId);
  }

  @LendingAction('loan.murabaha.register')
  @Post('murabaha')
  register(
    @Req() req: Request,
    @Param('loanId', ID) loanId: string,
    @Body(new ZodPipe(S.murabahaAsset)) b: never,
  ) {
    return this.svc.registerAsset(actor(req), loanId, b);
  }
}
