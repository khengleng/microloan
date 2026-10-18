import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Put,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';
import { learning } from '@microloan/shared';
import { AnyAuthenticated } from '../../auth/auth-scope.decorator';
import { LendingAction, lendingActorOf } from '../policy/lending-action.guard';
import { ZodPipe } from '../common/zod.pipe';
import { LearningService, type LearningEvent } from './learning.service';

const actor = (req: Request) => lendingActorOf(req as never);
const ID = new ParseUUIDPipe();

const event = z.discriminatedUnion('event', [
  z.object({ event: z.literal('STARTED') }).strict(),
  z.object({ event: z.literal('TOUR_COMPLETED') }).strict(),
  z
    .object({
      event: z.literal('QUIZ_SUBMITTED'),
      answers: z.array(z.number().int().min(0).max(9)).min(1).max(10),
    })
    .strict(),
  z.object({ event: z.literal('PROMPT_DISMISSED') }).strict(),
]);

const lessonId = (v: string) => {
  if (!learning.LESSON_ID_PATTERN.test(v) || v.length > 80) return '';
  return v;
};

/**
 * The signed-in person's own Learning centre progress. Open to every staff
 * member; the user is always the caller, never a parameter.
 */
@Controller('me/learning')
export class LearningMeController {
  constructor(private readonly svc: LearningService) {}

  @AnyAuthenticated()
  @Get()
  mine(@Req() req: Request) {
    return this.svc.mine(actor(req));
  }

  @AnyAuthenticated()
  @Put('lessons/:lessonId')
  record(
    @Req() req: Request,
    @Param('lessonId') id: string,
    @Body(new ZodPipe(event)) b: LearningEvent,
  ) {
    return this.svc.record(actor(req), lessonId(id), b);
  }
}

/** The team's progress, for people holding learning.report.read. */
@Controller('lending/learning')
export class LearningTeamController {
  constructor(private readonly svc: LearningService) {}

  @LendingAction('learning.report.read')
  @Get('team')
  team(@Req() req: Request) {
    return this.svc.team(actor(req));
  }

  @LendingAction('learning.report.read')
  @Get('team/users/:userId')
  member(@Req() req: Request, @Param('userId', ID) userId: string) {
    return this.svc.member(actor(req), userId);
  }
}
