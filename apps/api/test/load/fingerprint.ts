/**
 * What end of day produced, reduced to digests that two runs on the same
 * seeded book can be compared by: each loan's balances, schedule and the
 * financial events it gained; the journal totals per ledger account; and the
 * collections and restructuring work it opened. Ids, timestamps and random
 * idempotency keys are left out, since they differ by construction, and so
 * is the month-end close (its reconciliation failed outright at scale before
 * this work, see PERFORMANCE.md).
 */
import type { PrismaClient } from '@microloan/db';

export interface Fingerprint {
  digest: string;
  loans: number;
  events: { type: string; count: number; amount: string }[];
  journal: { accountCode: string; debit: string; credit: string }[];
  work: { kind: string; key: string; count: number }[];
  perLoan: Record<string, string>;
}

export async function fingerprint(
  db: PrismaClient,
  tenantId: string,
  since: string,
): Promise<Fingerprint> {
  const perLoanRows = await db.$queryRawUnsafe<{ id: string; d: string }[]>(
    `WITH bal AS (
       SELECT a.id, md5(concat_ws('|', a.status, a."principalOutstanding", a."interestReceivable",
         a."feesReceivable", a."penaltyReceivable", a."advanceBalance", a."interestInSuspense",
         a.allowance, a.classification, a."impairmentStage", a."nonAccrual", a."nonAccrualSince",
         a."daysPastDue", a."delinquencyBucket", a."collectionStage", a."lastAccrualDate",
         a.version, a."probationRemaining", a."delinquencyFloorBucket", a."instalmentAmount",
         a."isRestructured", a."restructureCount")) AS d
       FROM "LoanAccount" a WHERE a."tenantId" = $1),
     sched AS (
       SELECT s."loanAccountId" AS id, md5(string_agg(concat_ws('|', s.number, s."agreementVersion",
         s.status, s."penaltyDue", s."principalPaid", s."interestPaid", s."feePaid", s."taxPaid",
         s."penaltyPaid", s."penaltyAssessedThrough", s."interestDue", s."principalDue"),
         ';' ORDER BY s."agreementVersion", s.number, s.status)) AS d
       FROM "ScheduleInstalment" s WHERE s."tenantId" = $1 GROUP BY s."loanAccountId"),
     ev AS (
       SELECT e."loanAccountId" AS id, md5(string_agg(concat_ws('|', e.type, e.status,
         e."businessDate", e."valueDate", e.amount, e.components::text, e.narrative),
         ';' ORDER BY e."businessDate", e.type, e.amount, e.components::text)) AS d
       FROM "FinancialEvent" e
       WHERE e."tenantId" = $1 AND e."businessDate" > $2::date AND e."loanAccountId" IS NOT NULL
       GROUP BY e."loanAccountId")
     SELECT bal.id, md5(concat_ws('#', bal.d, sched.d, ev.d)) AS d
     FROM bal LEFT JOIN sched USING (id) LEFT JOIN ev USING (id)
     ORDER BY bal.id`,
    tenantId,
    since,
  );
  const events = await db.$queryRawUnsafe<
    { type: string; count: bigint; amount: string }[]
  >(
    `SELECT type, count(*) AS count, sum(amount)::text AS amount FROM "FinancialEvent"
     WHERE "tenantId" = $1 AND "businessDate" > $2::date GROUP BY type ORDER BY type`,
    tenantId,
    since,
  );
  const journal = await db.$queryRawUnsafe<
    { accountCode: string; debit: string; credit: string }[]
  >(
    `SELECT "accountCode", sum(debit)::text AS debit, sum(credit)::text AS credit
     FROM "LendingJournalLine" WHERE "tenantId" = $1 GROUP BY "accountCode" ORDER BY "accountCode"`,
    tenantId,
  );
  const work = await db.$queryRawUnsafe<
    { kind: string; key: string; count: bigint }[]
  >(
    `SELECT 'collectionTask' AS kind, concat_ws('|', stage, action, status, outcome, "daysPastDue", "amountOverdue", "dueOn") AS key, count(*) AS count
       FROM "CollectionTask" WHERE "tenantId" = $1 GROUP BY 2
     UNION ALL
     SELECT 'restructureCase', concat_ws('|', trigger, status, "initiatorId"), count(*)
       FROM "RestructureCase" WHERE "tenantId" = $1 GROUP BY 2
     UNION ALL
     SELECT 'accrualEvent', "accrualDate"::text, count(*)
       FROM "AccrualEvent" WHERE "tenantId" = $1 AND "accrualDate" > $2::date GROUP BY 2
     UNION ALL
     SELECT 'auditEvent', concat_ws('|', action, outcome), count(*)
       FROM "AuditEvent" WHERE "tenantId" = $1 AND "businessDate" > $2::date
         AND action NOT LIKE 'accounting.%' GROUP BY 2
     ORDER BY 1, 2`,
    tenantId,
    since,
  );
  const perLoan = Object.fromEntries(perLoanRows.map((r) => [r.id, r.d]));
  const { createHash } = await import('node:crypto');
  const h = createHash('sha256');
  for (const r of perLoanRows) h.update(`${r.id}:${r.d}\n`);
  const summary = {
    events: events.map((e) => ({ ...e, count: Number(e.count) })),
    journal,
    work: work.map((w) => ({ ...w, count: Number(w.count) })),
  };
  h.update(JSON.stringify(summary));
  return {
    digest: h.digest('hex'),
    loans: perLoanRows.length,
    ...summary,
    perLoan,
  };
}

/** What differs between two fingerprints, for the report. */
export function compare(a: Fingerprint, b: Fingerprint) {
  const loans = Object.keys(a.perLoan).filter(
    (id) => a.perLoan[id] !== b.perLoan[id],
  );
  const same = (x: unknown, y: unknown) =>
    JSON.stringify(x) === JSON.stringify(y);
  return {
    identical: a.digest === b.digest,
    loansDiffering: loans.length,
    sampleLoans: loans.slice(0, 5),
    eventsSame: same(a.events, b.events),
    journalSame: same(a.journal, b.journal),
    workSame: same(a.work, b.work),
  };
}
