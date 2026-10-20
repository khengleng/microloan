/* eslint-disable @typescript-eslint/no-unsafe-call -- integration fixtures: fixture rows come from the untyped API responses. */
/**
 * Taking over a loan book from another system (OPS-1): load and check a
 * migration file, control totals, maker-checker posting, opening balances
 * that reconcile, and servicing continuing from cut-over.
 */
import { Fixture, TEST_DB, bootstrap, expectOk, grant, key } from './harness';
import { activeProduct, standardRoles } from './setup';

const d = TEST_DB ? describe : describe.skip;

const HEADER =
  'external_loan_id,customer_id,first_name,last_name,id_number,branch_code,product_code,currency,original_principal,disbursement_date,annual_rate_pct,principal_outstanding,next_due_date,remaining_instalments,interest_accrued,overdue_principal,overdue_interest,overdue_penalties,oldest_overdue_date';
const ROWS = [
  'OLD-A,C-1,Sokha,Chan,MIG-010203040,PNH,PL-MIG,USD,5000,2025-06-20,18,3120.40,2026-01-20,12,,,,,',
  'OLD-B,C-2,Dara,Kim,MIG-020304050,PNH,PL-MIG,USD,3000,2025-03-20,18,2100.00,2026-01-20,10,30.00,200,45.10,5,2025-12-01',
  'OLD-C,C-1,Sokha,Chan,MIG-010203040,PNH,PL-MIG,USD,1200,2025-09-20,18,900.00,2026-01-20,8,,,,,',
];

d('Loan-book migration (integration)', () => {
  let f: Fixture;

  beforeAll(async () => {
    f = await bootstrap();
    await standardRoles(f);
    await grant(f, f.t1, 'nobody', 'RISK_COMPLIANCE');
    await activeProduct(f, 'PERSONAL_INSTALMENT', 'PL-MIG', (c) => {
      c.pricing.fees = [];
      c.pricing.fixed = {
        defaultAnnualRate: '0.18',
        minAnnualRate: '0.05',
        maxAnnualRate: '0.18',
      };
    });
  }, 90_000);
  afterAll(async () => f?.app.close());

  const upload = (rows: string[], extra: Record<string, unknown> = {}) =>
    f.as('finance').post('/lending/migrations', {
      fileName: 'book.csv',
      content: [HEADER, ...rows].join('\n') + '\n',
      cutOverDate: '2026-01-05',
      ...extra,
    });
  const loan = async (id: string) =>
    expectOk(await f.as('opsMaker').get(`/lending/loans/${id}`));
  const reconcile = async () => {
    const rec = expectOk(
      await f.as('finance').get('/lending/ops/reconciliation'),
    );
    expect(rec.breaks).toEqual([]);
    expect(rec.trialBalanceBalanced).toBe(true);
  };
  let posted: any;
  let legacyLoanId: string;

  it('the template downloads with every column', async () => {
    const res = await f.as('finance').get('/lending/migrations/template.csv');
    expect(res.status).toBe(200);
    expect(res.text.split('\n')[0]).toContain('principal_outstanding');
  });

  it('a row with a problem is reported with its line and field, and the file cannot be posted', async () => {
    const b = expectOk(
      await upload([
        ...ROWS.slice(0, 1),
        'OLD-X,C-9,Bad,Row,,PNH,NOPE,USD,100,2025-01-01,18,1,2026-01-20,1,,,,,',
      ]),
    );
    expect(b.errorCount).toBe(1);
    expect(b.ready).toBe(false);
    const bad = b.rows.find((r: any) => r.externalLoanId === 'OLD-X');
    expect(bad.issues[0]).toMatchObject({ field: 'product_code' });
    const csv = await f
      .as('finance')
      .get(`/lending/migrations/${b.id}/issues.csv`);
    expect(csv.text).toContain('OLD-X');
    const res = await f
      .as('nobody')
      .post(`/lending/migrations/${b.id}/decision`, { approve: true });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('MIGRATION_NOT_READY');
    expectOk(await f.as('finance').post(`/lending/migrations/${b.id}/cancel`));
  });

  it('control totals that disagree with the file block posting', async () => {
    const b = expectOk(
      await upload(ROWS, {
        controlTotals: [{ currency: 'USD', loans: 3, principal: '6000.00' }],
      }),
    );
    expect(b.errorCount).toBe(0);
    expect(b.ready).toBe(false);
    expect(b.fileIssues.join(' ')).toMatch(
      /Control totals for USD do not match/,
    );
    expectOk(await f.as('finance').post(`/lending/migrations/${b.id}/cancel`));
  });

  it('a clean file shows totals, a preview per loan, and the old accrual compared', async () => {
    posted = expectOk(
      await upload(ROWS, {
        controlTotals: [{ currency: 'USD', loans: 3, principal: '6120.40' }],
      }),
    );
    expect(posted.ready).toBe(true);
    expect(posted.totals[0]).toMatchObject({
      currency: 'USD',
      loans: 3,
      principal: '6120.4',
      inArrears: 1,
    });
    const b = posted.rows.find((r: any) => r.externalLoanId === 'OLD-B');
    expect(b.preview.daysPastDue).toBe(35);
    expect(b.status).toBe('WARNING');
    expect(b.warnings.join(' ')).toMatch(/Accrued interest per the old system/);
  });

  it('the person who loaded it cannot approve; another person posts every loan', async () => {
    expect(
      (
        await f
          .as('finance')
          .post(`/lending/migrations/${posted.id}/decision`, { approve: true })
      ).status,
    ).toBe(403);
    const done = expectOk(
      await f
        .as('nobody')
        .post(`/lending/migrations/${posted.id}/decision`, { approve: true }),
    );
    expect(done.status).toBe('POSTED');
    expect(done.postedCount).toBe(3);
    posted = done;
  });

  it('migrated loans carry their position: balances, arrears line, days past due, one customer for two loans', async () => {
    const id = (ext: string) =>
      posted.rows.find((r: any) => r.externalLoanId === ext).loanAccountId;
    const a = await loan(id('OLD-A'));
    expect(a.account.status).toBe('ACTIVE');
    expect(a.account.principalOutstanding).toBe('3120.4');
    expect(Number(a.account.interestReceivable)).toBeGreaterThan(0);
    const c = await loan(id('OLD-C'));
    expect(c.account.borrowerId).toBe(a.account.borrowerId);
    const b = await loan(id('OLD-B'));
    expect(b.account.daysPastDue).toBe(35);
    const arrears = b.schedule.find((l: any) => l.number === 0);
    expect(arrears).toMatchObject({
      dueDate: '2025-12-01',
      principalDue: '200',
      deferredInterestDue: '45.1',
      penaltyDue: '5',
    });
    const opening = b.events.find((e: any) => e.type === 'MIGRATION');
    expect(
      opening.journal.lines.some((l: any) => l.accountCode === '3900'),
    ).toBe(true);
    await reconcile();
  });

  it('the same loans cannot be migrated twice', async () => {
    const again = expectOk(await upload(ROWS));
    expect(again.errorCount).toBe(3);
    expect(again.rows[0].issues[0].message).toMatch(/already migrated/);
  });

  it('loans in the legacy module export as a migration file that loads cleanly', async () => {
    await f.system(async () => {
      const b = await f.prisma.borrower.create({
        data: {
          tenantId: f.t1,
          branchId: f.b1,
          firstName: 'Vanna',
          lastName: 'Legacy',
          idNumber: 'MIG-LEGACY-1',
        },
      });
      const loanRow = await f.prisma.loan.create({
        data: {
          tenantId: f.t1,
          branchId: f.b1,
          borrowerId: b.id,
          status: 'DISBURSED',
          principal: '1200',
          annualInterestRate: '18',
          termMonths: 12,
          interestMethod: 'REDUCING_BALANCE',
          currency: 'USD',
          startDate: new Date(Date.UTC(2025, 9, 5)),
        },
      });
      // The legacy book carries the 1,000 still owed.
      const { LedgerService } = require('../../src/ledger/ledger.service');
      await f.app.get(LedgerService).postEntry({
        tenantId: f.t1,
        source: 'DISBURSEMENT',
        description: 'Legacy disbursement net of repayments',
        loanId: loanRow.id,
        lines: [
          { accountCode: '1200', debit: 1000 },
          { accountCode: '1000', credit: 1000 },
        ],
      });
      legacyLoanId = loanRow.id;
      for (let k = 1; k <= 12; k++) {
        const paid = k <= 2;
        await f.prisma.repaymentSchedule.create({
          data: {
            loanId: loanRow.id,
            installmentNumber: k,
            dueDate: new Date(Date.UTC(2025, 9 + k, 5)),
            principalAmount: '100',
            interestAmount: '10',
            totalAmount: '110',
            outstandingPrincipal: String(1200 - 100 * k),
            paidPrincipal: paid ? '100' : '0',
            paidInterest: paid ? '10' : '0',
            isPaid: paid,
          },
        });
      }
    });
    const res = await f
      .as('finance')
      .get('/lending/migrations/legacy-export.csv?productCode=PL-MIG');
    expect(res.status).toBe(200);
    const lines: string[] = res.text.trim().split('\n');
    const legacy = lines.find((l) => l.includes('Vanna'))!;
    expect(legacy).toContain('1000');
    const b = expectOk(
      await f.as('finance').post('/lending/migrations', {
        fileName: 'legacy.csv',
        content: [lines[0], legacy].join('\n') + '\n',
        cutOverDate: '2026-01-05',
      }),
    );
    expect(b.errorCount).toBe(0);
    const row = b.rows[0];
    expect(row.values.overdue_principal).toBe('100');
    expect(row.values.next_due_date).toBe('2026-02-05');
    const done = expectOk(
      await f
        .as('nobody')
        .post(`/lending/migrations/${b.id}/decision`, { approve: true }),
    );
    expect(done.postedCount).toBe(1);
    // The loan has left the legacy book: closed there, its principal cleared against migration clearing.
    const after = await f.system(() =>
      f.prisma.loan.findFirst({
        where: { id: legacyLoanId },
        include: {
          journalEntries: {
            include: { lines: { include: { account: true } } },
          },
        },
      }),
    );
    expect(after.status).toBe('CLOSED');
    const receivable = after.journalEntries
      .flatMap((e: any) => e.lines)
      .filter((l: any) => l.account.code === '1200')
      .reduce((t: number, l: any) => t + Number(l.debit) - Number(l.credit), 0);
    expect(receivable).toBe(0);
    // The legacy loan archive (D-154) shows where it went.
    const archived = expectOk(
      await f.as('finance').get(`/lending/legacy-archive/loans/${legacyLoanId}`),
    );
    expect(archived.status).toBe('CLOSED');
    const account = expectOk(
      await f
        .as('finance')
        .get(`/lending/loans/${archived.migratedTo.loanAccountId}`),
    );
    expect(archived.migratedTo.reference).toBe(account.account.reference);
    expect(archived.migratable).toBe(false);
    await reconcile();
  });

  it('servicing continues from cut-over: the next instalments are paid and the arrears cured', async () => {
    expectOk(
      await f
        .as('finance')
        .post('/lending/ops/business-date', { businessDate: '2026-01-20' }),
    );
    expect(
      expectOk(await f.as('finance').post('/lending/loans/batch/run')).failed,
    ).toEqual([]);
    for (const ext of ['OLD-A', 'OLD-B', 'OLD-C']) {
      const id = posted.rows.find(
        (r: any) => r.externalLoanId === ext,
      ).loanAccountId;
      const l = await loan(id);
      const due = l.schedule
        .filter((x: any) => x.status === 'DUE' && x.dueDate <= '2026-01-20')
        .reduce(
          (s: number, x: any) =>
            s +
            Number(x.principalDue) +
            Number(x.interestDue) +
            Number(x.deferredInterestDue) +
            Number(x.feeDue) +
            Number(x.penaltyDue) -
            Number(x.principalPaid) -
            Number(x.interestPaid) -
            Number(x.feePaid) -
            Number(x.penaltyPaid),
          0,
        );
      expectOk(
        await f
          .as('opsMaker')
          .post(
            `/lending/loans/${id}/repayments`,
            { amount: due.toFixed(2) },
            key(`mig-${ext}`),
          ),
      );
    }
    expect(
      expectOk(await f.as('finance').post('/lending/loans/batch/run')).failed,
    ).toEqual([]);
    for (const ext of ['OLD-A', 'OLD-B', 'OLD-C']) {
      const id = posted.rows.find(
        (r: any) => r.externalLoanId === ext,
      ).loanAccountId;
      expect((await loan(id)).account.daysPastDue).toBe(0);
    }
    await reconcile();
  });
});
