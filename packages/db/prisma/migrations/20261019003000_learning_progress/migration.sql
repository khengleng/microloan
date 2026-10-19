-- CreateTable
CREATE TABLE "LearningProgress" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "lessonId" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "tourCompletedAt" TIMESTAMP(3),
    "quizAttempts" INTEGER NOT NULL DEFAULT 0,
    "quizBestScore" INTEGER,
    "quizTotal" INTEGER,
    "quizPassedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "promptDismissedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LearningProgress_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LearningProgress_tenantId_lessonId_idx" ON "LearningProgress"("tenantId", "lessonId");

-- CreateIndex
CREATE UNIQUE INDEX "LearningProgress_tenantId_userId_lessonId_key" ON "LearningProgress"("tenantId", "userId", "lessonId");

-- CreateIndex
CREATE UNIQUE INDEX "LearningProgress_tenantId_id_key" ON "LearningProgress"("tenantId", "id");

-- AddForeignKey
ALTER TABLE "LearningProgress" ADD CONSTRAINT "LearningProgress_tenantId_userId_fkey" FOREIGN KEY ("tenantId", "userId") REFERENCES "User"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;



-- ═══════════════════════════════════════════════════════════════════════════
-- Database-level invariants for Learning centre progress.
--
-- Everything below this banner is re-applied verbatim to the integration-test
-- database by scripts/lending-test-db.mjs. Keep it to constraints, triggers and
-- policies — no table or index DDL, which `prisma db push` has already created.
-- ═══════════════════════════════════════════════════════════════════════════
ALTER TABLE "LearningProgress" ADD CONSTRAINT "LearningProgress_lesson_check"
  CHECK ("lessonId" ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND length("lessonId") <= 80);
ALTER TABLE "LearningProgress" ADD CONSTRAINT "LearningProgress_quiz_check"
  CHECK ("quizAttempts" >= 0
     AND ("quizBestScore" IS NULL) = ("quizTotal" IS NULL)
     AND ("quizTotal" IS NULL OR ("quizTotal" > 0 AND "quizBestScore" BETWEEN 0 AND "quizTotal")));
-- A pass needs an attempt, and a lesson is complete only once its quiz is passed.
ALTER TABLE "LearningProgress" ADD CONSTRAINT "LearningProgress_passed_check"
  CHECK ("quizPassedAt" IS NULL OR "quizAttempts" > 0);
ALTER TABLE "LearningProgress" ADD CONSTRAINT "LearningProgress_completed_check"
  CHECK ("completedAt" IS NULL OR "quizPassedAt" IS NOT NULL);

ALTER TABLE "LearningProgress" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "LearningProgress" FORCE ROW LEVEL SECURITY;
CREATE POLICY "LearningProgress_tenant_isolation" ON "LearningProgress"
  USING (coalesce(current_setting('app.tenant_id', true), '') = '' OR "tenantId" = current_setting('app.tenant_id', true))
  WITH CHECK (coalesce(current_setting('app.tenant_id', true), '') = '' OR "tenantId" = current_setting('app.tenant_id', true));
