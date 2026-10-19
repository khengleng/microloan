/* eslint-disable @typescript-eslint/no-unsafe-call, @typescript-eslint/no-require-imports -- integration fixtures: fixture rows come from the untyped Prisma client, API responses are untyped, and the cron service is required after the app boots. */
/**
 * The original (legacy) loan module frozen by default (D-097) and its money
 * operations made safe for tenants that opt out (D-098 – D-102):
 *  - every money operation is refused while the book is read-only, reads
 *    still work; a tenant opts out with a rule two administrators approve;
 *  - two concurrent repayments are both applied and schedule = ledger;
 *    a double disbursement or write-off posts once;
 *  - a write-off uses the provision held and the shortfall hits P&L, the
 *    next provisioning run does not release it again, runs are serialised;
 *  - the late-penalty job's calendar, paid-instalment and cap rules;
 *  - only the latest repayment is reversed; a settlement's waived interest
 *    is owed again after its reversal.
 */
import {
  Fixture,
  TEST_DB,
  bootstrap,
  borrower,
  closeLegacyBook,
  expectOk,
  openLegacyBook,
} from './harness';
import { randomUUID } from 'node:crypto';

const d = TEST_DB ? describe : describe.skip;
const key = (p: string) => `${p}-${randomUUID()}`;
const DAY = 86_400_000;

d('Legacy loan module freeze (integration)', () => {
  let f: Fixture;

  beforeAll(async () => {
    f = await bootstrap();
  }, 60_000);
  afterAll(async () => f?.app.close());

  /** A disbursed legacy loan with instalments of 1000 principal + 30 interest. */
  async function legacyLoan(
    tenantId: string,
    branchId: string,
    dueOffsetsDays: number[],
    over: { dueDates?: Date[]; status?: string } = {},
  ) {
    return f.system(async () => {
      const b = await borrower(f, tenantId, branchId);
      const n = dueOffsetsDays.length || over.dueDates!.length;
      const loan = await f.prisma.loan.create({
        data: {
          tenantId,
          borrowerId: b.id,
          branchId,
          principal: String(1000 * n),
          annualInterestRate: '12',
          termMonths: n,
          interestMethod: 'FLAT',
          startDate: new Date(Date.now() - 40 * DAY),
          status: over.status ?? 'DISBURSED',
          createdByUserId: f.users.maker.id,
          approvedBy: f.users.checker.id,
        },
      });
      for (let i = 0; i < n; i++)
        await f.prisma.repaymentSchedule.create({
          data: {
            loanId: loan.id,
            installmentNumber: i + 1,
            dueDate:
              over.dueDates?.[i] ??
              new Date(Date.now() + dueOffsetsDays[i] * DAY),
            principalAmount: '1000',
            interestAmount: '30',
            totalAmount: '1030',
            outstandingPrincipal: String(1000 * (n - i - 1)),
          },
        });
      return loan.id as string;
    });
  }

  const schedules = (loanId: string) =>
    f.system(() =>
      f.prisma.repaymentSchedule.findMany({
        where: { loanId },
        orderBy: { installmentNumber: 'asc' },
      }),
    );
  const journal = (loanId: string, source?: string) =>
    f.system(() =>
      f.prisma.journalEntry.findMany({
        where: { loanId, ...(source ? { source } : {}) },
        include: { lines: { include: { account: true } } },
      }),
    );
  /** Debit − credit on one account of a tenant's ledger. */
  const balance = async (tenantId: string, code: string) => {
    const lines = await f.system(() =>
      f.prisma.journalLine.findMany({
        where: { entry: { tenantId }, account: { code } },
        select: { debit: true, credit: true },
      }),
    );
    return (
      Math.round(
        lines.reduce(
          (t: number, l: any) => t + Number(l.debit) - Number(l.credit),
          0,
        ) * 100,
      ) / 100
    );
  };

  describe('frozen by default', () => {
    it('reports the book read-only with what is closed', async () => {
      const s = expectOk(await f.as('admin1').get('/loans/legacy-status'));
      expect(s.readonly).toBe(true);
      expect(s.source).toBe('DEFAULT');
      expect(s.message).toMatch(/migration/);
      expect(s.frozenOperations).toEqual(
        expect.arrayContaining([
          'repayment',
          'settlement',
          'reversal',
          'write-off',
          'disburse',
          'restructure',
          'provisioning',
          'penalty',
        ]),
      );
    });

    it('refuses every legacy money operation and moves nothing; reads still work', async () => {
      const id = await legacyLoan(f.t1, f.b1, [-10, 20, 50]);
      const approved = await legacyLoan(f.t1, f.b1, [30], {
        status: 'APPROVED',
      });
      // A repayment from before the freeze, for the reversal attempt.
      const old = await f.system(() =>
        f.prisma.repayment.create({
          data: {
            tenantId: f.t1,
            loanId: id,
            amount: '30',
            interestPaid: '30',
            date: new Date(),
          },
        }),
      );
      const b = await borrower(f, f.t1, f.b1);
      const refused = async (res: any, operation: string) => {
        expect(res.status).toBe(409);
        expect(res.body.code).toBe('LEGACY_LOANS_READONLY');
        expect(res.body.operation).toBe(operation);
        expect(res.body.links.migration).toBe('/lending/migration');
        expect(res.body.message).toMatch(/read-only/);
      };
      await refused(
        await f.as('admin1').post('/loans', {
          borrowerId: b.id,
          principal: 1000,
          annualInterestRate: 12,
          termMonths: 3,
          startDate: '2026-02-10',
          interestMethod: 'FLAT',
        }),
        'create',
      );
      await refused(
        await f
          .as('admin1')
          .put(`/loans/${approved}/status`, { status: 'DISBURSED' }),
        'disburse',
      );
      await refused(
        await f.as('admin1').post('/repayments', {
          loanId: id,
          amount: 100,
          date: '2026-02-10',
          idempotencyKey: key('frozen-pay'),
        }),
        'repayment',
      );
      await refused(
        await f
          .as('admin1')
          .post('/repayments/settlements', { loanId: id, amount: 3030 }),
        'settlement',
      );
      await refused(
        await f
          .as('admin1')
          .post(`/repayments/${old.id}/reverse`, { reason: 'Keyed twice' }),
        'reversal',
      );
      await refused(
        await f
          .as('admin1')
          .post(`/loans/${id}/write-off`, { reason: 'Uncollectable' }),
        'write-off',
      );
      await refused(
        await f.as('admin1').post(`/risk/loan/${id}/restructure`, {
          newTermMonths: 6,
          reason: 'Hardship',
        }),
        'restructure',
      );
      await refused(
        await f.as('admin1').post('/provisioning/run'),
        'provisioning',
      );

      // The penalty job skips a frozen tenant.
      const {
        PenaltyCronService,
      } = require('../../src/penalty-cron/penalty-cron.service');
      await f.app.get(PenaltyCronService).applyLatePenalties();

      const after = await schedules(id);
      expect(after.every((s: any) => Number(s.penaltyAmount) === 0)).toBe(true);
      expect(after.every((s: any) => Number(s.paidPrincipal) === 0)).toBe(true);
      expect(await journal(id)).toHaveLength(0);
      expect(await journal(approved)).toHaveLength(0);
      const loans = await f.system(() =>
        f.prisma.loan.findMany({
          where: { id: { in: [id, approved] } },
          select: { id: true, status: true },
        }),
      );
      expect(
        Object.fromEntries(loans.map((l: any) => [l.id, l.status])),
      ).toEqual({ [id]: 'DISBURSED', [approved]: 'APPROVED' });
      expect(
        (
          await f.system(() =>
            f.prisma.repayment.findUnique({ where: { id: old.id } }),
          )
        ).reversedAt,
      ).toBeNull();

      // Reads, quotes, receipts and lists are open.
      expect((await f.as('admin1').get(`/loans/${id}`)).status).toBe(200);
      expect(
        (await f.as('admin1').get(`/loans/${id}/payoff-quote`)).status,
      ).toBe(200);
      expect(
        (await f.as('admin1').get(`/repayments/${old.id}/receipt`)).status,
      ).toBe(200);
      expect(
        (await f.as('admin1').get(`/repayments?loanId=${id}`)).status,
      ).toBe(200);
      expect((await f.as('admin1').get('/provisioning/runs')).status).toBe(200);
    });

    it('a tenant opts out with a rule one administrator proposes and another approves', async () => {
      const proposed = expectOk(
        await f.as('admin1').post('/lending/access/flags/rules', {
          flagKey: 'lending.legacy_loans.readonly',
          scopeType: 'TENANT',
          enabled: false,
          reason: 'Run down the legacy book in place until migration',
        }),
      );
      // Not active until a second administrator approves it.
      expect(
        expectOk(await f.as('admin1').get('/loans/legacy-status')).readonly,
      ).toBe(true);
      expect(
        (
          await f
            .as('admin1')
            .post(
              `/lending/access/flags/changes/${proposed.approval.id}/decision`,
              { approve: true },
            )
        ).status,
      ).toBe(403);
      expectOk(
        await f
          .as('admin2')
          .post(
            `/lending/access/flags/changes/${proposed.approval.id}/decision`,
            { approve: true },
          ),
      );
      const s = expectOk(await f.as('admin1').get('/loans/legacy-status'));
      expect(s.readonly).toBe(false);
      expect(s.source).toBe('TENANT_RULE');
      expect(s.frozenOperations).toEqual([]);
      // Another tenant stays frozen.
      expect(
        expectOk(await f.as('t2admin').get('/loans/legacy-status')).readonly,
      ).toBe(true);
    });
  });

  // From here on tenant 1 has opted out (previous test); tenant 2 opts out
  // only for its own tests.
  describe('money operations of a tenant that opted out', () => {
    it('two concurrent repayments are both applied and the schedule agrees with the ledger', async () => {
      const id = await legacyLoan(f.t1, f.b1, [-10, 20, 50]);
      const [a, b] = await Promise.all([
        f.as('admin1').post('/repayments', {
          loanId: id,
          amount: 600.1,
          date: '2026-02-10',
          idempotencyKey: key('race-a'),
        }),
        f.as('admin1').post('/repayments', {
          loanId: id,
          amount: 700.2,
          date: '2026-02-10',
          idempotencyKey: key('race-b'),
        }),
      ]);
      expectOk(a);
      expectOk(b);
      const rows = await schedules(id);
      const paid = (s: any) =>
        Number(s.paidPrincipal) +
        Number(s.paidInterest) +
        Number(s.paidPenalty);
      const schedulePaid =
        Math.round(rows.reduce((t: number, s: any) => t + paid(s), 0) * 100) /
        100;
      expect(schedulePaid).toBe(1300.3);
      // Allocation in order: 30 + 1000 on the first, then 30 + 240.30.
      expect(Number(rows[0].paidInterest)).toBe(30);
      expect(Number(rows[0].paidPrincipal)).toBe(1000);
      expect(rows[0].isPaid).toBe(true);
      expect(Number(rows[1].paidInterest)).toBe(30);
      expect(Number(rows[1].paidPrincipal)).toBe(240.3);
      const entries = await journal(id, 'REPAYMENT');
      expect(entries).toHaveLength(2);
      const cash = entries
        .flatMap((e: any) => e.lines)
        .filter((l: any) => l.account.code === '1000')
        .reduce((t: number, l: any) => t + Number(l.debit), 0);
      expect(Math.round(cash * 100) / 100).toBe(1300.3);
      const receivable = entries
        .flatMap((e: any) => e.lines)
        .filter((l: any) => l.account.code === '1200')
        .reduce((t: number, l: any) => t + Number(l.credit), 0);
      const schedulePrincipal = rows.reduce(
        (t: number, s: any) => t + Number(s.paidPrincipal),
        0,
      );
      expect(Math.round(receivable * 100) / 100).toBe(
        Math.round(schedulePrincipal * 100) / 100,
      );
      // Each repayment records what it did to each instalment.
      const reps = await f.system(() =>
        f.prisma.repayment.findMany({ where: { loanId: id } }),
      );
      for (const r of reps) {
        expect(r.allocation.kind).toBe('REPAYMENT');
        const sum = r.allocation.lines.reduce(
          (t: number, l: any) =>
            t + Number(l.principal) + Number(l.interest) + Number(l.penalty),
          0,
        );
        expect(Math.round(sum * 100) / 100).toBe(Number(r.amount));
      }
    });

    it('a repayment above the balance or in fractions of a cent is refused', async () => {
      const id = await legacyLoan(f.t1, f.b1, [-10]);
      const over = await f.as('admin1').post('/repayments', {
        loanId: id,
        amount: 1030.01,
        date: '2026-02-10',
      });
      expect(over.status).toBe(400);
      const fraction = await f.as('admin1').post('/repayments', {
        loanId: id,
        amount: 10.005,
        date: '2026-02-10',
      });
      expect(fraction.status).toBe(400);
      // Paying exactly the balance closes the loan.
      expectOk(
        await f.as('admin1').post('/repayments', {
          loanId: id,
          amount: 1030,
          date: '2026-02-10',
        }),
      );
      const loan = await f.system(() =>
        f.prisma.loan.findUnique({ where: { id } }),
      );
      expect(loan.status).toBe('CLOSED');
    });

    it('two concurrent disbursements post one journal', async () => {
      const id = await legacyLoan(f.t1, f.b1, [30], { status: 'APPROVED' });
      const res = await Promise.all([
        f.as('admin1').put(`/loans/${id}/status`, { status: 'DISBURSED' }),
        f.as('admin1').put(`/loans/${id}/status`, { status: 'DISBURSED' }),
      ]);
      const statuses = res.map((r) => r.status).sort();
      expect(statuses[0]).toBe(200);
      expect([400, 409]).toContain(statuses[1]);
      expect(await journal(id, 'DISBURSEMENT')).toHaveLength(1);
      // Asking again later is a no-op on the disbursed loan.
      const again = await f
        .as('admin1')
        .put(`/loans/${id}/status`, { status: 'DISBURSED' });
      expect(again.status).toBe(200);
      expect(await journal(id, 'DISBURSEMENT')).toHaveLength(1);
    });

    it('two concurrent write-offs post one journal', async () => {
      const id = await legacyLoan(f.t1, f.b1, [-100]);
      const res = await Promise.all([
        f.as('admin1').post(`/loans/${id}/write-off`, { reason: 'Absconded' }),
        f.as('admin1').post(`/loans/${id}/write-off`, { reason: 'Absconded' }),
      ]);
      const statuses = res.map((r) => r.status).sort();
      expect([200, 201]).toContain(statuses[0]);
      expect([400, 409]).toContain(statuses[1]);
      expect(await journal(id, 'WRITEOFF')).toHaveLength(1);
    });

    it('only the latest repayment can be reversed, and the schedule returns exactly to before it', async () => {
      const id = await legacyLoan(f.t1, f.b1, [-10, 20, 50]);
      const r1 = expectOk(
        await f.as('admin1').post('/repayments', {
          loanId: id,
          amount: 500,
          date: '2026-02-10',
          idempotencyKey: key('rev-1'),
        }),
      );
      const afterFirst = await schedules(id);
      const r2 = expectOk(
        await f.as('admin1').post('/repayments', {
          loanId: id,
          amount: 800,
          date: '2026-02-11',
          idempotencyKey: key('rev-2'),
        }),
      );
      const early = await f
        .as('admin1')
        .post(`/repayments/${r1.id}/reverse`, { reason: 'Wrong loan' });
      expect(early.status).toBe(409);
      expect(early.body.code).toBe('LEGACY_REVERSAL_NOT_LATEST');
      expect(early.body.latestRepaymentId).toBe(r2.id);

      expectOk(
        await f
          .as('admin1')
          .post(`/repayments/${r2.id}/reverse`, { reason: 'Bounced' }),
      );
      const afterReversal = await schedules(id);
      const pick = (rows: any[]) =>
        rows.map((s) => [
          Number(s.paidPrincipal),
          Number(s.paidInterest),
          Number(s.paidPenalty),
          s.isPaid,
        ]);
      expect(pick(afterReversal)).toEqual(pick(afterFirst));

      expectOk(
        await f
          .as('admin1')
          .post(`/repayments/${r1.id}/reverse`, { reason: 'Wrong loan' }),
      );
      const cleared = await schedules(id);
      expect(
        cleared.every(
          (s: any) =>
            Number(s.paidPrincipal) === 0 &&
            Number(s.paidInterest) === 0 &&
            !s.isPaid,
        ),
      ).toBe(true);
      // The receivable is back where it was: repayments and reversals net out.
      const lines = (await journal(id)).flatMap((e: any) => e.lines);
      const recv = lines
        .filter((l: any) => l.account.code === '1200')
        .reduce(
          (t: number, l: any) => t + Number(l.debit) - Number(l.credit),
          0,
        );
      expect(Math.round(recv * 100) / 100).toBe(0);
    });

    it('reversing a settlement makes its waived interest owed again and reopens the loan', async () => {
      const id = await legacyLoan(f.t1, f.b1, [-10, 20, 50]);
      const q = expectOk(await f.as('admin1').get(`/loans/${id}/payoff-quote`));
      expect(q.futureInterestWaived).toBe(60);
      const s = expectOk(
        await f.as('admin1').post('/repayments/settlements', {
          loanId: id,
          amount: q.payoffAmount,
          idempotencyKey: key('settle'),
        }),
      );
      const settled = await schedules(id);
      expect(settled.map((x: any) => Number(x.interestAmount))).toEqual([
        30, 0, 0,
      ]);
      const rev = expectOk(
        await f.as('admin1').post(`/repayments/${s.repayment.id}/reverse`, {
          reason: 'Cheque bounced',
        }),
      );
      expect(rev.loanReopened).toBe(true);
      expect(rev.waivedInterestRestored).toBe('60.00');
      const back = await schedules(id);
      expect(
        back.map((x: any) => [
          Number(x.interestAmount),
          Number(x.totalAmount),
          Number(x.paidPrincipal),
          Number(x.paidInterest),
          x.isPaid,
        ]),
      ).toEqual([
        [30, 1030, 0, 0, false],
        [30, 1030, 0, 0, false],
        [30, 1030, 0, 0, false],
      ]);
      const loan = await f.system(() =>
        f.prisma.loan.findUnique({ where: { id } }),
      );
      expect(loan.status).toBe('DISBURSED');
      // The quote is the same as before the settlement.
      const q2 = expectOk(
        await f.as('admin1').get(`/loans/${id}/payoff-quote`),
      );
      expect(q2.payoffAmount).toBe(q.payoffAmount);
      expect(q2.futureInterestWaived).toBe(60);
    });
  });

  describe('the late-penalty job', () => {
    const {
      PenaltyCronService,
    } = require('../../src/penalty-cron/penalty-cron.service');
    // 2026-03-11 17:00 in Phnom Penh (10:00 UTC).
    const at = new Date('2026-03-11T10:00:00.000Z');
    const utc = (s: string) => new Date(`${s}T00:00:00.000Z`);

    it('charges from the day after the due date in Phnom Penh, never on paid principal and interest, up to the cap', async () => {
      const job = f.app.get(PenaltyCronService);
      const rate = Number(
        (
          await f.system(() =>
            f.prisma.tenant.findUnique({
              where: { id: f.t1 },
              select: { penaltyRatePerDay: true },
            }),
          )
        ).penaltyRatePerDay,
      );
      // Due today (local): not late yet, although the instant has passed.
      const dueToday = await legacyLoan(f.t1, f.b1, [], {
        dueDates: [utc('2026-03-11')],
      });
      // Due yesterday: late.
      const dueYesterday = await legacyLoan(f.t1, f.b1, [], {
        dueDates: [utc('2026-03-10')],
      });
      // Principal and interest paid, a penalty still open: no penalty on it.
      const onlyPenalty = await legacyLoan(f.t1, f.b1, [], {
        dueDates: [utc('2026-02-01')],
      });
      await f.system(() =>
        f.prisma.repaymentSchedule.updateMany({
          where: { loanId: onlyPenalty },
          data: {
            paidPrincipal: '1000',
            paidInterest: '30',
            penaltyAmount: '20',
            totalAmount: '1050',
          },
        }),
      );
      // Near the cap (25% of 1030 = 257.50): only what is left is charged.
      const nearCap = await legacyLoan(f.t1, f.b1, [], {
        dueDates: [utc('2026-01-10')],
      });
      await f.system(() =>
        f.prisma.repaymentSchedule.updateMany({
          where: { loanId: nearCap },
          data: { penaltyAmount: '255', totalAmount: '1285' },
        }),
      );
      // A frozen tenant's late instalment.
      const frozen = await legacyLoan(f.t2, f.b3, [], {
        dueDates: [utc('2026-03-01')],
      });

      await job.applyLatePenalties(at);
      // Run again the same day: nothing more.
      await job.applyLatePenalties(new Date(at.getTime() + 3_600_000));

      const pen = async (loanId: string) =>
        Number((await schedules(loanId))[0].penaltyAmount);
      expect(await pen(dueToday)).toBe(0);
      expect(await pen(dueYesterday)).toBe(Math.min(rate, 257.5));
      expect(await pen(onlyPenalty)).toBe(20);
      expect(await pen(nearCap)).toBe(257.5);
      expect(await pen(frozen)).toBe(0);
      const ny = (await schedules(dueYesterday))[0];
      expect(Number(ny.totalAmount)).toBe(1030 + Math.min(rate, 257.5));

      // The next day (local) it charges again, but the capped one stays put.
      await job.applyLatePenalties(new Date(at.getTime() + DAY));
      expect(await pen(dueToday)).toBe(Math.min(rate, 257.5));
      expect(await pen(nearCap)).toBe(257.5);
      // Out of the way of tenant 2's provisioning below.
      await f.system(() =>
        f.prisma.loan.update({
          where: { id: frozen },
          data: { status: 'CLOSED' },
        }),
      );
    });
  });

  describe('write-off against the provision held', () => {
    it('uses the provision, expenses the shortfall, and the next run does not release it again; runs are serialised', async () => {
      const rule = await openLegacyBook(f, f.t2);
      try {
        // Business date 2026-01-05: due 2025-12-01 → 35 days → SUBSTANDARD 25%.
        const id = await legacyLoan(f.t2, f.b3, [], {
          dueDates: [new Date('2025-12-01T00:00:00.000Z')],
        });
        // Two runs at once: the second sees the first and moves nothing.
        const runs = await Promise.all([
          f.as('t2admin').post('/provisioning/run'),
          f.as('t2admin').post('/provisioning/run'),
        ]);
        runs.forEach((r) => expectOk(r));
        expect(await balance(f.t2, '1300')).toBe(-250);
        expect(await balance(f.t2, '5000')).toBe(250);

        const wo = expectOk(
          await f
            .as('t2admin')
            .post(`/loans/${id}/write-off`, { reason: 'Borrower absconded' }),
        );
        expect(wo.status).toBe('WRITTEN_OFF');
        const [entry] = await journal(id, 'WRITEOFF');
        const by = (code: string) =>
          entry.lines.find((l: any) => l.account.code === code);
        expect(Number(by('1300').debit)).toBe(250);
        expect(Number(by('5100').debit)).toBe(750);
        expect(Number(by('1200').credit)).toBe(1000);
        expect(await balance(f.t2, '1300')).toBe(0);

        // The next run neither releases the used provision nor goes negative.
        const after = expectOk(await f.as('t2admin').post('/provisioning/run'));
        expect(after.movements).toEqual([]);
        expect(await balance(f.t2, '1300')).toBe(0);
        // The whole loss is in P&L: provision expense + write-off expense.
        expect(
          (await balance(f.t2, '5000')) + (await balance(f.t2, '5100')),
        ).toBe(1000);
      } finally {
        await closeLegacyBook(f, rule);
      }
    });
  });
});
