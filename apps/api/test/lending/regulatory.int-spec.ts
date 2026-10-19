/* eslint-disable @typescript-eslint/no-unsafe-call, @typescript-eslint/no-require-imports -- integration fixtures: modules are required after the test environment is configured, and fixture rows come from the untyped API responses. */
/**
 * Regulatory returns (OPS-7) and the consolidation of the two loan stacks:
 * one return covering lending and legacy loans, tied to both ledgers;
 * generated only for a closed month and never changed afterwards; submitted
 * by a second person; the legacy read-only flag; and the tenant wall.
 */
import {
  Fixture,
  TEST_DB,
  bootstrap,
  borrower,
  expectOk,
  grant,
  impairmentPolicy,
  key,
} from './harness';
import { activeProduct, originateAndDisburse, standardRoles } from './setup';

const d = TEST_DB ? describe : describe.skip;

d('Regulatory returns and legacy consolidation (integration)', () => {
  let f: Fixture;
  let legacyLoanId: string;
  let v1: string;

  const total = (content: any, code: string, currency = 'USD') =>
    content.tables
      .find((t: any) => t.code === code)
      .totals.find((r: any) => r.currency === currency);

  beforeAll(async () => {
    f = await bootstrap();
    await standardRoles(f);
    await grant(f, f.t1, 'nobody', 'RISK_COMPLIANCE');
    // A month with loans outstanding closes only under an impairment policy (D-116).
    await impairmentPolicy(f, f.t1);
    const { productId } = await activeProduct(
      f,
      'PERSONAL_INSTALMENT',
      'PL-REG',
      (c) => {
        c.pricing.fees = [];
      },
    );
    await originateAndDisburse(f, productId, {
      principal: '6000',
      numberOfInstalments: 12,
      disbursementDate: '2026-01-05',
    });
    await originateAndDisburse(f, productId, {
      principal: '3000',
      numberOfInstalments: 6,
      disbursementDate: '2026-01-05',
    });

    // A legacy loan disbursed on 2 January whose first instalment fell due in
    // December and was never paid: 42 days past due at 31 January.
    const { LedgerService } = require('../../src/ledger/ledger.service');
    const ledger = f.app.get(LedgerService);
    legacyLoanId = await f.system(async () => {
      const b = await borrower(f, f.t1, f.b1, {
        firstName: 'Legacy',
        lastName: 'Borrower',
      });
      const loan = await f.prisma.loan.create({
        data: {
          tenantId: f.t1,
          borrowerId: b.id,
          branchId: f.b1,
          principal: '2000',
          annualInterestRate: '15',
          termMonths: 2,
          interestMethod: 'FLAT',
          startDate: new Date(Date.UTC(2025, 10, 20)),
          status: 'DISBURSED',
        },
      });
      for (const [n, due] of [
        [1, Date.UTC(2025, 11, 20)],
        [2, Date.UTC(2026, 1, 20)],
      ])
        await f.prisma.repaymentSchedule.create({
          data: {
            loanId: loan.id,
            installmentNumber: n,
            dueDate: new Date(due),
            principalAmount: '1000',
            interestAmount: '25',
            totalAmount: '1025',
            outstandingPrincipal: String(2000 - n * 1000),
          },
        });
      await ledger.postEntry({
        tenantId: f.t1,
        source: 'DISBURSEMENT',
        description: 'Legacy fixture disbursement',
        currency: 'USD',
        date: new Date(Date.UTC(2026, 0, 2, 3)),
        loanId: loan.id,
        lines: [
          { accountCode: '1200', debit: 2000 },
          { accountCode: '1000', credit: 2000 },
        ],
      });
      return loan.id as string;
    });
  }, 120_000);
  afterAll(async () => f?.app.close());

  const moveTo = async (businessDate: string) => {
    expectOk(
      await f
        .as('finance')
        .post('/lending/ops/business-date', { businessDate }),
    );
    expect(
      expectOk(await f.as('finance').post('/lending/loans/batch/run')).failed,
    ).toEqual([]);
  };
  const generate = (who = 'finance', month = 1) =>
    f.as(who).post('/lending/regulatory/returns', { year: 2026, month });

  it('a month that is not closed can be previewed but not generated', async () => {
    await moveTo('2026-01-31');
    const p = expectOk(
      await f
        .as('finance')
        .get('/lending/regulatory/preview?year=2026&month=1'),
    );
    expect(p.stored).toBe(false);
    expect(p.content.basis).toBe('LIVE_PREVIEW');
    const res = await generate();
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('PERIOD_NOT_CLOSED');
  });

  it('the return of a closed month covers both books and ties to both ledgers', async () => {
    expectOk(
      await f.as('finance').post('/lending/ops/periods/2026/1/prepare', {}),
    );
    expectOk(
      await f
        .as('nobody')
        .post('/lending/ops/periods/2026/1/decision', { approve: true }),
    );
    const g = expectOk(await generate());
    expect(g.status).toBe('DRAFT');
    expect(g.version).toBe(1);
    v1 = g.id;
    const r = expectOk(
      await f.as('finance').get(`/lending/regulatory/returns/${v1}`),
    );
    expect(r.hashVerified).toBe(true);
    const c = r.content;
    expect(c.basis).toBe('CLOSED_PERIOD');
    expect(c.attributesAsOf).toBe('2026-01-31');
    expect(c.checks.filter((x: any) => !x.passed)).toEqual([]);

    // Portfolio: two lending loans and the legacy loan, per book.
    const portfolio = c.tables.find((t: any) => t.code === 'PORTFOLIO');
    const legacy = portfolio.rows.find((x: any) => x.stack === 'Legacy loans');
    expect(legacy.loans).toBe(1);
    expect(legacy.principal).toBe('2000.00');
    const lendingRow = portfolio.rows.find(
      (x: any) => x.stack === 'Lending platform',
    );
    expect(lendingRow.loans).toBe(2);
    expect(lendingRow.principal).toBe('9000.00');
    expect(total(c, 'PORTFOLIO').principal).toBe('11000.00');
    // Every breakdown adds up to the same total.
    for (const code of [
      'CLASSIFICATION',
      'PAR',
      'BY_PRODUCT',
      'BY_BRANCH',
      'SIZE_BANDS',
      'INTEREST_RATES',
    ])
      expect(total(c, code).principal).toBe('11000.00');
    // The legacy loan is graded from its schedule: Substandard, in PAR 30.
    const sub = c.tables
      .find((t: any) => t.code === 'CLASSIFICATION')
      .rows.find((x: any) => x.currency === 'USD' && x.class === 'Substandard');
    expect(sub.loans).toBe(1);
    expect(sub.principal).toBe('2000.00');
    expect(total(c, 'PAR').par30).toBe('2000.00');
    // Rates are reported in percent against the tenant's cap (18% by default).
    const rates = c.tables
      .find((t: any) => t.code === 'INTEREST_RATES')
      .rows.filter((x: any) => x.currency === 'USD');
    expect(
      rates.find((x: any) => x.band === '12% – 15%').loans,
    ).toBeGreaterThanOrEqual(1);
    expect(rates.find((x: any) => x.band === 'Not recorded')).toBeUndefined();
    expect(rates.find((x: any) => x.aboveCap === 'Yes').loans).toBe(0);
    expect(
      c.tables
        .find((t: any) => t.code === 'MOVEMENTS')
        .totals.find((x: any) => x.movement === 'Disbursed').amount,
    ).toBe('11000.00');

    // Reconciliation: each book to its own journal, the lending book also to the frozen close.
    const rec = c.reconciliation.filter(
      (x: any) => x.currency === 'USD' && x.measure === 'PRINCIPAL',
    );
    expect(rec.every((x: any) => x.status === 'MATCHED')).toBe(true);
    expect(rec.find((x: any) => x.stack === 'LENDING').frozen).toBe('9000.00');
    expect(rec.find((x: any) => x.stack === 'TOTAL').ledger).toBe('11000.00');

    // …and the combined trial balance at the month end says the same.
    const tb = expectOk(
      await f
        .as('finance')
        .get('/lending/regulatory/combined-trial-balance?asOf=2026-01-31'),
    );
    const usd = tb.currencies.find((x: any) => x.currency === 'USD');
    const receivable = usd.rows.find((x: any) => x.code === '1200');
    expect(receivable.legacyBalance).toBe('2000');
    expect(receivable.lendingBalance).toBe('9000');
    expect(receivable.combinedBalance).toBe('11000');
    expect(usd.totals.balanced).toBe(true);
  });

  it('a stored return never changes: not by later activity and not in the database', async () => {
    // February activity does not touch the January return.
    await moveTo('2026-02-10');
    const before = expectOk(
      await f.as('finance').get(`/lending/regulatory/returns/${v1}`),
    );
    expectOk(
      await f
        .as('opsMaker')
        .post(
          `/lending/loans/${(await f.system(() => f.prisma.loanAccount.findFirst({ where: { tenantId: f.t1 } }))).id}/repayments`,
          { amount: '200.00' },
          key('feb'),
        ),
    );
    const again = expectOk(
      await f.as('finance').get(`/lending/regulatory/returns/${v1}`),
    );
    expect(again.contentHash).toBe(before.contentHash);
    expect(again.hashVerified).toBe(true);

    await expect(
      f.system(() =>
        f.prisma.regulatoryReturn.update({
          where: { id: v1 },
          data: { content: { tampered: true } },
        }),
      ),
    ).rejects.toThrow(/REGULATORY_RETURN_IMMUTABLE/);
    await expect(
      f.system(() => f.prisma.regulatoryReturn.delete({ where: { id: v1 } })),
    ).rejects.toThrow(/REGULATORY_RETURN_IMMUTABLE/);

    // A correction is a new version; the draft it replaces is superseded, not changed.
    const v2 = expectOk(await generate());
    expect(v2.version).toBe(2);
    const old = expectOk(
      await f.as('finance').get(`/lending/regulatory/returns/${v1}`),
    );
    expect(old.status).toBe('SUPERSEDED');
    expect(old.supersededById).toBe(v2.id);
    expect(old.contentHash).toBe(before.contentHash);
    v1 = v2.id;
  });

  it('submission needs a second person', async () => {
    expectOk(
      await f
        .as('finance')
        .post(`/lending/regulatory/returns/${v1}/request-submission`, {}),
    );
    // The preparer cannot submit it.
    expect(
      (
        await f
          .as('finance')
          .post(`/lending/regulatory/returns/${v1}/decision`, { approve: true })
      ).status,
    ).toBe(403);
    // Nor can the database be talked into a self-approved submission.
    const row = await f.system(() =>
      f.prisma.regulatoryReturn.findUnique({ where: { id: v1 } }),
    );
    await expect(
      f.system(() =>
        f.prisma.regulatoryReturn.update({
          where: { id: v1 },
          data: {
            status: 'SUBMITTED',
            submittedBy: row.submissionRequestedBy,
            submittedAt: new Date(),
          },
        }),
      ),
    ).rejects.toThrow(/RegulatoryReturn_submission_check/);
    const s = expectOk(
      await f.as('nobody').post(`/lending/regulatory/returns/${v1}/decision`, {
        approve: true,
        reference: 'NBC-2026-01-0001',
      }),
    );
    expect(s.status).toBe('SUBMITTED');
    const got = expectOk(
      await f.as('finance').get(`/lending/regulatory/returns/${v1}`),
    );
    expect(got.submittedBy).toBe(f.users.nobody.id);
    expect(got.submissionReference).toBe('NBC-2026-01-0001');
    // A submitted return is final; regenerating makes an amendment.
    await expect(
      f.system(() =>
        f.prisma.regulatoryReturn.update({
          where: { id: v1 },
          data: { status: 'DRAFT' },
        }),
      ),
    ).rejects.toThrow(/REGULATORY_RETURN_IMMUTABLE/);
    const v3 = expectOk(await generate());
    const amended = expectOk(
      await f.as('finance').get(`/lending/regulatory/returns/${v3.id}`),
    );
    expect(amended.content.amends).toEqual({ id: v1, version: 2 });
    expect(
      expectOk(await f.as('finance').get(`/lending/regulatory/returns/${v1}`))
        .status,
    ).toBe('SUBMITTED');

    const list = expectOk(
      await f.as('finance').get('/lending/regulatory/returns?year=2026'),
    );
    expect(list.months[0].periodStatus).toBe('CLOSED');
    expect(list.months[0].versions).toHaveLength(3);
    expect(list.months[0].current.id).toBe(v3.id);
  });

  it('exports the return as CSV with the reconciliation', async () => {
    const res = await f
      .as('finance')
      .get(`/lending/regulatory/returns/${v1}/export.csv`);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/csv/);
    expect(res.text).toContain('Loan classification and provisioning');
    expect(res.text).toContain('Reconciliation to the ledger');
    expect(res.text).toContain('11000.00');
    const one = await f
      .as('finance')
      .get(`/lending/regulatory/returns/${v1}/export.csv?table=PAR`);
    expect(one.text).toContain('Portfolio at risk');
    expect(one.text).not.toContain('Largest borrowers');
    const xlsx = await f
      .as('finance')
      .get(`/lending/regulatory/returns/${v1}/export.xlsx`)
      .buffer(true)
      .parse((r: any, cb: any) => {
        const chunks: Buffer[] = [];
        r.on('data', (c: Buffer) => chunks.push(c));
        r.on('end', () => cb(null, Buffer.concat(chunks)));
      });
    expect(xlsx.status).toBe(200);
    // A workbook is a zip file.
    expect((xlsx.body as Buffer).subarray(0, 2).toString()).toBe('PK');
  });

  it('nothing crosses tenants', async () => {
    await grant(f, f.t2, 't2ops', 'FINANCE_OFFICER');
    expect(
      (await f.as('t2ops').get(`/lending/regulatory/returns/${v1}`)).status,
    ).toBe(404);
    expect(
      (await f.as('t2ops').get(`/lending/regulatory/returns/${v1}/export.csv`))
        .status,
    ).toBe(404);
    expect(
      (
        await f
          .as('t2ops')
          .post(`/lending/regulatory/returns/${v1}/request-submission`, {})
      ).status,
    ).toBe(404);
    const list = expectOk(
      await f.as('t2ops').get('/lending/regulatory/returns?year=2026'),
    );
    expect(list.months.every((m: any) => m.versions.length === 0)).toBe(true);
    const p = expectOk(
      await f.as('t2ops').get('/lending/regulatory/preview?year=2026&month=1'),
    );
    expect(
      p.content.tables.find((t: any) => t.code === 'PORTFOLIO').totals,
    ).toEqual([]);
    const tb = expectOk(
      await f
        .as('t2ops')
        .get('/lending/regulatory/combined-trial-balance?asOf=2026-01-31'),
    );
    expect(tb.currencies).toEqual([]);
    // Not even the database lets another tenant's session see the rows.
    const seen = await f.prisma.$transaction(async (tx: any) => {
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${f.t2}, true)`;
      return tx.$queryRaw`SELECT count(*)::int AS n FROM "RegulatoryReturn"`;
    });
    expect(seen[0].n).toBe(0);
  });

  it('the legacy book is read-only by default (D-097): no new loans, disbursements or repayments until two administrators open it', async () => {
    const initial = expectOk(await f.as('admin1').get('/loans/legacy-status'));
    expect(initial.readonly).toBe(true);
    expect(initial.source).toBe('DEFAULT');
    expect(initial.message).toMatch(/lending platform/);

    const b = await borrower(f, f.t1, f.b1);
    const created = await f.as('admin1').post('/loans', {
      borrowerId: b.id,
      principal: 1000,
      annualInterestRate: 12,
      termMonths: 3,
      startDate: '2026-02-10',
      interestMethod: 'FLAT',
    });
    expect(created.status).toBe(409);
    expect(created.body.code).toBe('LEGACY_LOANS_READONLY');

    // An approved legacy loan cannot be disbursed either.
    const approved = await f.system(() =>
      f.prisma.loan.create({
        data: {
          tenantId: f.t1,
          borrowerId: b.id,
          branchId: f.b1,
          principal: '1000',
          annualInterestRate: '12',
          termMonths: 3,
          interestMethod: 'FLAT',
          startDate: new Date(Date.UTC(2026, 1, 10)),
          status: 'APPROVED',
          createdByUserId: f.users.maker.id,
          approvedBy: f.users.checker.id,
        },
      }),
    );
    const disb = await f
      .as('admin1')
      .put(`/loans/${approved.id}/status`, { status: 'DISBURSED' });
    expect(disb.status).toBe(409);
    expect(disb.body.code).toBe('LEGACY_LOANS_READONLY');
    expect(
      (
        await f.system(() =>
          f.prisma.loan.findUnique({ where: { id: approved.id } }),
        )
      ).status,
    ).toBe('APPROVED');

    // Existing legacy loans are not repaid here while it is read-only…
    const frozenPay = await f.as('admin1').post('/repayments', {
      loanId: legacyLoanId,
      amount: 500,
      date: '2026-02-10',
      idempotencyKey: key('legacy-pay-frozen'),
    });
    expect(frozenPay.status).toBe(409);
    expect(frozenPay.body.operation).toBe('repayment');
    // …but they are still read and quoted.
    expect(
      (await f.as('admin1').get(`/loans/${legacyLoanId}/payoff-quote`)).status,
    ).toBe(200);

    // Opening the book: one administrator proposes, another approves.
    const proposed = expectOk(
      await f.as('admin1').post('/lending/access/flags/rules', {
        flagKey: 'lending.legacy_loans.readonly',
        scopeType: 'TENANT',
        enabled: false,
        reason: 'Collect the legacy book in place until it is migrated',
      }),
    );
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
    expect(
      expectOk(await f.as('admin1').get('/loans/legacy-status')).readonly,
    ).toBe(false);
    // Another tenant is unaffected.
    expect(
      expectOk(await f.as('t2admin').get('/loans/legacy-status')).readonly,
    ).toBe(true);

    const paid = expectOk(
      await f.as('admin1').post('/repayments', {
        loanId: legacyLoanId,
        amount: 500,
        date: '2026-02-10',
        idempotencyKey: key('legacy-pay'),
      }),
    );
    expect(paid).toBeTruthy();
  });
});
