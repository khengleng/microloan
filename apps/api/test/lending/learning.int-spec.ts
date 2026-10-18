/* eslint-disable @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-require-imports, @typescript-eslint/no-explicit-any -- integration fixtures: API responses are untyped. */
/**
 * Learning centre progress (D-092, D-093).
 *
 *  - a person reads and writes only their own progress; the user is the
 *    caller, never a parameter;
 *  - quizzes are marked by the API against the shared lesson content;
 *  - the team report needs learning.report.read and shows only the caller's
 *    organisation; row-level security holds behind it.
 */
import { learning } from '@microloan/shared';
import { Fixture, TEST_DB, bootstrap, expectOk, grant } from './harness';

const d = TEST_DB ? describe : describe.skip;

const ORIENTATION = learning.ORIENTATION_LESSON_ID;
const lesson = learning.LESSON_BY_ID[ORIENTATION];
const right = lesson.quiz.questions.map((q) => q.answer);
const wrong = lesson.quiz.questions.map(
  (q) => (q.answer + 1) % q.options.length,
);
const otherLesson = learning.LESSONS.find((l) => l.id !== ORIENTATION)!;
const put = (f: Fixture, who: string, id: string, body: unknown) =>
  f.as(who).put(`/me/learning/lessons/${id}`, body);

d('Learning centre progress (integration)', () => {
  let f: Fixture;

  beforeAll(async () => {
    f = await bootstrap();
    await grant(f, f.t1, 'ro', 'RELATIONSHIP_OFFICER', { branchIds: [f.b1] });
    await grant(f, f.t1, 'ro2', 'RELATIONSHIP_OFFICER', { branchIds: [f.b2] });
    await grant(f, f.t1, 'admin1', 'TENANT_ADMIN');
    await grant(f, f.t2, 't2admin', 'TENANT_ADMIN');
  }, 120_000);
  afterAll(async () => f?.app.close());

  it('records a lesson: started, tour completed, quiz marked by the API', async () => {
    expect(expectOk(await f.as('ro').get('/me/learning')).lessons).toEqual([]);

    const started = expectOk(
      await put(f, 'ro', ORIENTATION, { event: 'STARTED' }),
    );
    expect(started.progress).toMatchObject({
      lessonId: ORIENTATION,
      quizAttempts: 0,
      completedAt: null,
    });
    // Starting again changes nothing.
    const again = expectOk(await put(f, 'ro', ORIENTATION, { event: 'STARTED' }));
    expect(again.progress.startedAt).toBe(started.progress.startedAt);

    const toured = expectOk(
      await put(f, 'ro', ORIENTATION, { event: 'TOUR_COMPLETED' }),
    );
    expect(toured.progress.tourCompletedAt).not.toBeNull();

    const failed = expectOk(
      await put(f, 'ro', ORIENTATION, {
        event: 'QUIZ_SUBMITTED',
        answers: wrong,
      }),
    );
    expect(failed.quiz).toEqual({
      score: 0,
      total: right.length,
      passed: false,
    });
    expect(failed.progress).toMatchObject({
      quizAttempts: 1,
      quizBestScore: 0,
      quizPassedAt: null,
      completedAt: null,
    });

    const passed = expectOk(
      await put(f, 'ro', ORIENTATION, {
        event: 'QUIZ_SUBMITTED',
        answers: right,
      }),
    );
    expect(passed.quiz.passed).toBe(true);
    expect(passed.progress.quizAttempts).toBe(2);
    expect(passed.progress.quizBestScore).toBe(right.length);
    expect(passed.progress.completedAt).not.toBeNull();

    // A worse later attempt keeps the best score and the completion.
    const later = expectOk(
      await put(f, 'ro', ORIENTATION, {
        event: 'QUIZ_SUBMITTED',
        answers: wrong,
      }),
    );
    expect(later.progress.quizBestScore).toBe(right.length);
    expect(later.progress.completedAt).toBe(passed.progress.completedAt);

    const dismissed = expectOk(
      await put(f, 'ro', ORIENTATION, { event: 'PROMPT_DISMISSED' }),
    );
    expect(dismissed.progress.promptDismissedAt).not.toBeNull();
  });

  it('refuses unknown lessons, incomplete quizzes and stray fields', async () => {
    expect((await put(f, 'ro', 'no-such-lesson', { event: 'STARTED' })).status).toBe(404);
    expect((await put(f, 'ro', 'Not A Lesson!', { event: 'STARTED' })).status).toBe(404);
    expect(
      (
        await put(f, 'ro', ORIENTATION, {
          event: 'QUIZ_SUBMITTED',
          answers: right.slice(1),
        })
      ).status,
    ).toBe(400);
    expect(
      (await put(f, 'ro', otherLesson.id, { event: 'PROMPT_DISMISSED' })).status,
    ).toBe(400);
    // The user is always the caller: naming someone else is rejected.
    expect(
      (
        await put(f, 'ro', ORIENTATION, {
          event: 'STARTED',
          userId: f.users.ro2.id,
        })
      ).status,
    ).toBe(400);
  });

  it('shows each person only their own progress', async () => {
    expectOk(await put(f, 'ro2', otherLesson.id, { event: 'STARTED' }));
    const mine = expectOk(await f.as('ro2').get('/me/learning')).lessons;
    expect(mine.map((l: { lessonId: string }) => l.lessonId)).toEqual([
      otherLesson.id,
    ]);
    const ro = expectOk(await f.as('ro').get('/me/learning')).lessons;
    expect(ro.map((l: { lessonId: string }) => l.lessonId)).toEqual([
      ORIENTATION,
    ]);
    // Platform operators keep no tenant progress.
    expect((await f.as('platform').get('/me/learning')).status).toBe(403);
    expect(
      (await put(f, 'platform', ORIENTATION, { event: 'STARTED' })).status,
    ).toBe(403);
  });

  it('team report needs learning.report.read', async () => {
    expect((await f.as('ro').get('/lending/learning/team')).status).toBe(403);
    expect(
      (await f.as('ro').get(`/lending/learning/team/users/${f.users.ro2.id}`))
        .status,
    ).toBe(403);
    expect((await f.as('platform').get('/lending/learning/team')).status).toBe(
      403,
    );

    const report = expectOk(await f.as('admin1').get('/lending/learning/team'));
    expect(report.paths.length).toBe(learning.LEARNING_PATHS.length);
    const ro = report.members.find(
      (m: { userId: string }) => m.userId === f.users.ro.id,
    );
    expect(ro).toMatchObject({ lessonsCompleted: 1, lessonsStarted: 1 });
    expect(ro.roles).toEqual(['RELATIONSHIP_OFFICER']);
    const officerPath = ro.paths.find(
      (p: { pathId: string }) => p.pathId === 'loan-officer',
    );
    expect(officerPath).toMatchObject({ suggested: true, completed: 1 });

    const detail = expectOk(
      await f.as('admin1').get(`/lending/learning/team/users/${f.users.ro.id}`),
    );
    expect(detail.user.id).toBe(f.users.ro.id);
    expect(detail.lessons[0]).toMatchObject({ lessonId: ORIENTATION });
  });

  it('keeps organisations apart, in the API and in the database', async () => {
    const t2 = expectOk(await f.as('t2admin').get('/lending/learning/team'));
    const ids = t2.members.map((m: { userId: string }) => m.userId);
    expect(ids).toContain(f.users.t2admin.id);
    expect(ids).not.toContain(f.users.ro.id);
    expect(JSON.stringify(t2)).not.toContain(f.users.ro.id);
    expect(
      (
        await f
          .as('t2admin')
          .get(`/lending/learning/team/users/${f.users.ro.id}`)
      ).status,
    ).toBe(404);

    // Row-level security: with tenant 2 declared, raw SQL sees none of
    // tenant 1's rows (the API connects as the unprivileged test role).
    const { LendingPrisma } = require('../../src/lending/common/lending-prisma');
    const lp = f.app.get(LendingPrisma);
    const seen: { n: bigint }[] = await lp.tenantTx(f.t2, (tx: any) =>
      tx.$queryRawUnsafe(
        `SELECT count(*) AS n FROM "LearningProgress" WHERE "tenantId" = $1`,
        f.t1,
      ),
    );
    expect(Number(seen[0].n)).toBe(0);
    const own: { n: bigint }[] = await lp.tenantTx(f.t1, (tx: any) =>
      tx.$queryRawUnsafe(
        `SELECT count(*) AS n FROM "LearningProgress" WHERE "tenantId" = $1`,
        f.t1,
      ),
    );
    expect(Number(own[0].n)).toBeGreaterThan(0);
    // And a tenant-2 transaction cannot write a tenant-1 row.
    await expect(
      lp.tenantTx(f.t2, (tx: any) =>
        tx.$executeRawUnsafe(
          `INSERT INTO "LearningProgress" (id, "tenantId", "userId", "lessonId", "updatedAt")
           VALUES (gen_random_uuid()::text, $1, $2, 'portal-orientation', now())`,
          f.t1,
          f.users.ro2.id,
        ),
      ),
    ).rejects.toThrow();
  });
});
