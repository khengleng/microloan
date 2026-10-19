import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { learning } from '@microloan/shared';
import type { LearningProgress } from '@microloan/db';
import { LendingPrisma } from '../common/lending-prisma';
import type { LendingActor } from '../common/util';
import { PolicyService } from '../policy/policy.service';
import { tenantResource } from '../policy/resources';

export type LearningEvent =
  | { event: 'STARTED' }
  | { event: 'TOUR_COMPLETED' }
  | { event: 'QUIZ_SUBMITTED'; answers: number[] }
  | { event: 'PROMPT_DISMISSED' };

const view = (r: LearningProgress) => ({
  lessonId: r.lessonId,
  startedAt: r.startedAt,
  tourCompletedAt: r.tourCompletedAt,
  quizAttempts: r.quizAttempts,
  quizBestScore: r.quizBestScore,
  quizTotal: r.quizTotal,
  quizPassedAt: r.quizPassedAt,
  completedAt: r.completedAt,
  promptDismissedAt: r.promptDismissedAt,
  updatedAt: r.updatedAt,
});

/**
 * Learning centre progress (D-094, D-095).
 *
 * A person reads and writes only their own rows: the user id always comes
 * from the signed-in principal, never from the request. Quizzes are marked
 * here against the shared lesson content, so a pass is not the browser's
 * claim. The team report needs learning.report.read and covers the caller's
 * own organisation only.
 */
@Injectable()
export class LearningService {
  constructor(
    private readonly lp: LendingPrisma,
    private readonly policy: PolicyService,
  ) {}

  /** A tenant staff member; platform operators and borrowers keep no progress here. */
  private staff(actor: LendingActor): { tenantId: string; userId: string } {
    if (actor.type !== 'USER' || !actor.tenantId)
      throw new ForbiddenException(
        'Learning progress is kept for staff of a lending organisation.',
      );
    return { tenantId: actor.tenantId, userId: actor.id };
  }

  async mine(actor: LendingActor) {
    const { tenantId, userId } = this.staff(actor);
    const rows = await this.lp.tenantTx(tenantId, (tx) =>
      tx.learningProgress.findMany({
        where: { tenantId, userId },
        orderBy: { startedAt: 'asc' },
      }),
    );
    return { lessons: rows.map(view) };
  }

  async record(actor: LendingActor, lessonId: string, e: LearningEvent) {
    const { tenantId, userId } = this.staff(actor);
    const lesson = learning.LESSON_BY_ID[lessonId];
    if (!lesson) throw new NotFoundException(`Unknown lesson ${lessonId}`);
    if (
      e.event === 'PROMPT_DISMISSED' &&
      lessonId !== learning.ORIENTATION_LESSON_ID
    )
      throw new BadRequestException(
        'Only the orientation prompt can be dismissed.',
      );
    if (e.event === 'TOUR_COMPLETED' && !lesson.tourId)
      throw new BadRequestException(`Lesson ${lessonId} has no tour.`);
    const result =
      e.event === 'QUIZ_SUBMITTED'
        ? learning.gradeQuiz(lessonId, e.answers)
        : null;
    if (e.event === 'QUIZ_SUBMITTED' && !result)
      throw new BadRequestException(
        `Answer each of the ${lesson.quiz.questions.length} questions.`,
      );

    return this.lp.tenantTx(tenantId, async (tx) => {
      const key = { tenantId_userId_lessonId: { tenantId, userId, lessonId } };
      const row = await tx.learningProgress.upsert({
        where: key,
        create: { tenantId, userId, lessonId },
        update: {},
      });
      const now = new Date();
      let updated = row;
      if (e.event === 'TOUR_COMPLETED' && !row.tourCompletedAt)
        updated = await tx.learningProgress.update({
          where: key,
          data: { tourCompletedAt: now },
        });
      if (e.event === 'PROMPT_DISMISSED' && !row.promptDismissedAt)
        updated = await tx.learningProgress.update({
          where: key,
          data: { promptDismissedAt: now },
        });
      if (result) {
        const best =
          row.quizBestScore === null || result.score > row.quizBestScore
            ? { quizBestScore: result.score, quizTotal: result.total }
            : {};
        const pass =
          result.passed && !row.quizPassedAt
            ? { quizPassedAt: now, completedAt: row.completedAt ?? now }
            : {};
        updated = await tx.learningProgress.update({
          where: key,
          data: { quizAttempts: { increment: 1 }, ...best, ...pass },
        });
      }
      return {
        progress: view(updated),
        ...(result ? { quiz: result } : {}),
      };
    });
  }

  private async enforceReport(actor: LendingActor): Promise<string> {
    const tenantId = actor.tenantId;
    if (!tenantId)
      throw new ForbiddenException(
        'Platform administrators have no access to tenant lending data.',
      );
    await this.policy.enforce(
      actor,
      'learning.report.read',
      tenantResource(tenantId, 'TENANT', 'learning'),
    );
    return tenantId;
  }

  /** Every active staff member's progress per learning path. */
  async team(actor: LendingActor) {
    const tenantId = await this.enforceReport(actor);
    const { users, rows } = await this.lp.tenantTx(tenantId, async (tx) => ({
      users: await tx.user.findMany({
        where: { tenantId, isActive: true },
        select: {
          id: true,
          email: true,
          roleAssignments: {
            where: { tenantId, status: 'ACTIVE', revokedAt: null },
            select: { role: { select: { code: true } } },
          },
        },
        orderBy: { email: 'asc' },
      }),
      rows: await tx.learningProgress.findMany({ where: { tenantId } }),
    }));
    const byUser = new Map<string, LearningProgress[]>();
    for (const r of rows) byUser.set(r.userId, [...(byUser.get(r.userId) ?? []), r]);
    const paths = learning.LEARNING_PATHS.map((p) => ({
      id: p.id,
      title: p.title,
      roles: p.roles,
      lessonCount: p.lessonIds.length,
    }));
    const members = users.map((u) => {
      const mine = byUser.get(u.id) ?? [];
      const done = new Set(mine.filter((r) => r.completedAt).map((r) => r.lessonId));
      const roles = [...new Set(u.roleAssignments.map((a) => a.role.code))];
      const assigned = new Set(learning.pathsForRoles(roles).map((p) => p.id));
      const last = mine.reduce<Date | null>(
        (m, r) => (!m || r.updatedAt > m ? r.updatedAt : m),
        null,
      );
      return {
        userId: u.id,
        email: u.email,
        roles,
        lessonsStarted: mine.length,
        lessonsCompleted: done.size,
        lastActivityAt: last,
        paths: learning.LEARNING_PATHS.map((p) => {
          const completed = p.lessonIds.filter((id) => done.has(id)).length;
          return {
            pathId: p.id,
            suggested: roles.length > 0 && assigned.has(p.id),
            completed,
            total: p.lessonIds.length,
          };
        }),
      };
    });
    return { paths, members };
  }

  /** One staff member's lesson-by-lesson progress. */
  async member(actor: LendingActor, userId: string) {
    const tenantId = await this.enforceReport(actor);
    return this.lp.tenantTx(tenantId, async (tx) => {
      const user = await tx.user.findFirst({
        where: { id: userId, tenantId },
        select: { id: true, email: true },
      });
      if (!user) throw new NotFoundException('No such team member.');
      const rows = await tx.learningProgress.findMany({
        where: { tenantId, userId },
        orderBy: { startedAt: 'asc' },
      });
      return { user, lessons: rows.map(view) };
    });
  }
}
