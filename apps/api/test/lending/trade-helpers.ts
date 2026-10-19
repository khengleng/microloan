/* eslint-disable @typescript-eslint/no-unsafe-call -- integration fixtures: fixture rows come from the untyped Prisma client. */
/**
 * Shared steps for the trade-finance suites (factoring, forfaiting,
 * supply-chain finance, import / export loans).
 */
import { lending } from '@microloan/shared';
import { acceptKeyFacts, Fixture, borrower, expectOk, key } from './harness';
import { docs } from './setup';

/** Move the tenant's business date forward, at most 31 days a step. */
export async function setBusinessDate(f: Fixture, target: string) {
  let current = expectOk(
    await f.as('finance').get('/lending/ops/business-date'),
  ).businessDate as string;
  while (lending.compareDates(current, target) < 0) {
    const step = lending.addDays(current, 31);
    const next = lending.compareDates(step, target) > 0 ? target : step;
    expectOk(
      await f
        .as('finance')
        .post('/lending/ops/business-date', { businessDate: next }),
    );
    current = next;
  }
  return current;
}

/** Switch a feature flag on for the tenant: one administrator proposes, another approves. */
export async function enableFlag(f: Fixture, flagKey: string) {
  const r = expectOk(
    await f.as('admin1').post('/lending/access/flags/rules', {
      flagKey,
      scopeType: 'TENANT',
      enabled: true,
      reason: 'trade finance integration tests',
    }),
  );
  expectOk(
    await f
      .as('admin2')
      .post(`/lending/access/flags/changes/${r.approval.id}/decision`, {
        approve: true,
      }),
  );
}

/** Application → approval → booking of a receivables programme (a revolving facility). */
export async function bookProgramme(
  f: Fixture,
  productId: string,
  limit: string,
  disbursementDate: string,
) {
  const b = await borrower(f, f.t1, f.b1, { monthlyIncome: '40000' });
  const app = expectOk(
    await f.as('ro').post('/lending/applications', {
      borrowerId: b.id,
      productId,
      terms: {
        principal: limit,
        numberOfInstalments: 12,
        disbursementDate,
        annualRate: '0',
      },
    }),
  );
  await docs(f, app.id, ['ID_DOCUMENT']);
  expectOk(await f.as('ro').post(`/lending/applications/${app.id}/submit`));
  expectOk(
    await f.as('analyst').post(`/lending/applications/${app.id}/recommend`, {
      recommendation: 'APPROVE',
      rationale: 'Receivables reviewed',
    }),
  );
  expectOk(
    await f.as('approver').post(`/lending/applications/${app.id}/approve`, {
      rationale: 'Within authority',
    }),
  );
  await acceptKeyFacts(f, app.id);
  const booked = expectOk(
    await f.as('opsMaker').post(`/lending/applications/${app.id}/book`, {}),
  );
  return {
    facilityId: booked.facility.id as string,
    loanId: booked.account.id as string,
    borrowerId: b.id as string,
  };
}

/** Approve → request → approve → release, after any acknowledgement. */
export async function fund(f: Fixture, invoiceId: string, tag: string) {
  expectOk(
    await f.as('approver').post(`/lending/invoices/${invoiceId}/approve`),
  );
  const req = expectOk(
    await f.as('opsMaker').post(`/lending/invoices/${invoiceId}/advance`),
  );
  expectOk(
    await f
      .as('opsChecker')
      .post(`/lending/invoices/${invoiceId}/advance/approve`),
  );
  const released = expectOk(
    await f
      .as('opsChecker')
      .post(
        `/lending/invoices/${invoiceId}/advance/release`,
        { externalReference: `BANK-${tag}` },
        key(`release-${tag}`),
      ),
  );
  return { req, released };
}

export async function runBatch(f: Fixture) {
  expectOk(await f.as('opsMaker').post('/lending/loans/batch/run'));
}

/** Reconciliation breaks on these loans; the trial balance must balance. */
export async function reconciliationBreaks(f: Fixture, loanIds: string[]) {
  const r = expectOk(await f.as('finance').get('/lending/ops/reconciliation'));
  expect(r.trialBalanceBalanced).toBe(true);
  return r.breaks.filter((b: { loanAccountId: string }) =>
    loanIds.includes(b.loanAccountId),
  );
}

/** Net (debit − credit) on a ledger account for one loan. */
export async function glNet(
  f: Fixture,
  accountCode: string,
  loanAccountId: string,
) {
  const rows = await f.system(() =>
    f.prisma.lendingJournalLine.findMany({
      where: { tenantId: f.t1, accountCode, loanAccountId },
    }),
  );
  return rows
    .reduce(
      (t: any, l: any) => t.plus(l.debit.toString()).minus(l.credit.toString()),
      new lending.D(0),
    )
    .toFixed(2);
}

/** Every journal posted for these loans balances. */
export async function journalsBalance(f: Fixture, loanAccountId: string) {
  const rows = await f.system(() =>
    f.prisma.lendingJournalLine.groupBy({
      by: ['entryId'],
      where: { tenantId: f.t1, loanAccountId },
      _sum: { debit: true, credit: true },
    }),
  );
  return rows.every((r: any) =>
    new lending.D(r._sum.debit.toString()).eq(r._sum.credit.toString()),
  );
}

export const loanOf = async (f: Fixture, loanId: string) =>
  expectOk(await f.as('opsMaker').get(`/lending/loans/${loanId}`));
