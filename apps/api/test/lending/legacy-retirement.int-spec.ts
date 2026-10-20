/* eslint-disable @typescript-eslint/no-unsafe-call, @typescript-eslint/no-require-imports -- integration fixtures: rows come from the untyped API and Prisma client. */
/**
 * Retiring the original (legacy) loan module, phase 1 (D-153 – D-159):
 *  - its write routes, crons and screens are gone; the API answers 404;
 *  - the legacy loan archive lists, shows and exports its loans read-only,
 *    within the reader's branch scope, and says which can be migrated;
 *  - reports, performance and exports read the lending book;
 *  - the borrower portal lists the customer's lending loans;
 *  - the regulatory return stops reading the legacy ledger once the
 *    legacy book is empty.
 */
import { JwtService } from '@nestjs/jwt';
import {
  Fixture,
  TEST_DB,
  bootstrap,
  borrower,
  expectOk,
  key,
} from './harness';
import { activeProduct, originateAndDisburse, standardRoles } from './setup';

const d = TEST_DB ? describe : describe.skip;
const day = (y: number, m: number, dd: number) => new Date(Date.UTC(y, m, dd));

d('Legacy loan module retirement (integration)', () => {
  let f: Fixture;
  let lendingLoan: { loanId: string; borrowerId: string };
  let paid = 0;
  const legacy: Record<string, string> = {};

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

  /** A legacy loan written straight to the original tables (it has no write API any more). */
  async function legacyLoan(
    name: string,
    branchId: string,
    status: string,
    dues: Date[],
  ) {
    return f.system(async () => {
      const b = await borrower(f, f.t1, branchId, {
        firstName: name,
        lastName: 'Legacy',
      });
      const loan = await f.prisma.loan.create({
        data: {
          tenantId: f.t1,
          borrowerId: b.id,
          branchId,
          principal: String(100 * dues.length),
          annualInterestRate: '12',
          termMonths: dues.length,
          interestMethod: 'FLAT',
          startDate: day(2025, 11, 10),
          status,
        },
      });
      for (const [i, due] of dues.entries())
        await f.prisma.repaymentSchedule.create({
          data: {
            loanId: loan.id,
            installmentNumber: i + 1,
            dueDate: due,
            principalAmount: '100',
            interestAmount: '5',
            totalAmount: '105',
            outstandingPrincipal: String(100 * (dues.length - i - 1)),
          },
        });
      return loan.id as string;
    });
  }

  beforeAll(async () => {
    f = await bootstrap();
    await standardRoles(f);
    const { productId } = await activeProduct(
      f,
      'PERSONAL_INSTALMENT',
      'PL-RETIRE',
      (c) => {
        c.pricing.fees = [];
      },
    );
    lendingLoan = await originateAndDisburse(f, productId, {
      principal: '2400',
      numberOfInstalments: 6,
      disbursementDate: '2026-01-05',
    });
    await moveTo('2026-02-05');
    const line = expectOk(
      await f.as('opsMaker').get(`/lending/loans/${lendingLoan.loanId}`),
    ).schedule.find((x: any) => x.number === 1 && x.status !== 'SUPERSEDED');
    paid = Number(line.principalDue) + Number(line.interestDue);
    expectOk(
      await f
        .as('opsMaker')
        .post(
          `/lending/loans/${lendingLoan.loanId}/repayments`,
          { amount: paid.toFixed(2), externalReference: '=CASH-RET-1' },
          key('ret'),
        ),
    );
    await moveTo('2026-02-28');

    // Running, with an instalment still to come: can be migrated.
    legacy.running = await legacyLoan('Running', f.b1, 'DISBURSED', [
      day(2026, 1, 10),
      day(2026, 3, 10),
    ]);
    // Past maturity in branch 2: nothing left to schedule, cannot be migrated by file.
    legacy.matured = await legacyLoan('Matured', f.b2, 'DEFAULTED', [
      day(2026, 0, 10),
    ]);
    legacy.pending = await legacyLoan('Pending', f.b1, 'PENDING', [
      day(2026, 5, 10),
    ]);
    legacy.closed = await legacyLoan('Closed', f.b1, 'CLOSED', [
      day(2025, 11, 30),
    ]);
  }, 180_000);
  afterAll(async () => f?.app.close());

  it('the original module has no routes any more', async () => {
    const gone: [string, string][] = [
      ['post', '/loans'],
      ['get', '/loans'],
      ['get', `/loans/${legacy.running}`],
      ['post', '/repayments'],
      ['post', '/repayments/settlements'],
      ['get', '/reports/dashboard'],
      ['get', '/reports/loan-portfolio/export'],
      ['get', '/kpi/overview'],
      ['post', '/provisioning/run'],
      ['get', '/exports/loans/excel'],
      ['get', '/loan-products'],
      ['get', '/collections/queue'],
      ['get', '/ledger/journal'],
      ['get', `/agreements/loan/${legacy.running}/key-facts`],
      ['post', `/risk/loan/${legacy.running}/score`],
      ['get', `/documents/loan/${legacy.running}`],
    ];
    for (const [method, url] of gone) {
      const res = await (f.as('admin1') as any)[method](url, {});
      expect([url, res.status]).toEqual([url, 404]);
    }
  });

  it('the archive counts, lists and shows legacy loans read-only, and says which can be migrated', async () => {
    const s = expectOk(
      await f.as('finance').get('/lending/legacy-archive/summary'),
    );
    expect(s.total).toBe(4);
    expect(s.open).toBe(2);
    expect(s.unfunded).toBe(1);
    expect(s.openPrincipal).toEqual([{ currency: 'USD', amount: '300.00' }]);

    const open = expectOk(
      await f.as('finance').get('/lending/legacy-archive/loans?status=OPEN'),
    );
    expect(open.total).toBe(2);
    const byId = new Map(open.data.map((r: any) => [r.id, r]));
    const running: any = byId.get(legacy.running);
    expect(running).toMatchObject({
      borrowerName: 'Running Legacy',
      branch: 'PNH',
      status: 'DISBURSED',
      principalOutstanding: '200.00',
      overdueAmount: '105.00',
      daysPastDue: 18,
      migratable: true,
      migrationBlock: null,
      migratedTo: null,
    });
    expect(byId.get(legacy.matured)).toMatchObject({
      migratable: false,
      migrationBlock: 'NO_FUTURE_INSTALMENT',
    });

    const one = expectOk(
      await f
        .as('finance')
        .get(`/lending/legacy-archive/loans/${legacy.running}`),
    );
    expect(one.schedule.map((x: any) => x.dueDate)).toEqual([
      '2026-02-10',
      '2026-04-10',
    ]);
    expect(one.repayments).toEqual([]);
  });

  it('the archive is confined to the reader: permission, branch and tenant', async () => {
    // Branch 2 only.
    const b2 = expectOk(
      await f.as('financeB2').get('/lending/legacy-archive/loans'),
    );
    expect(b2.data.map((r: any) => r.id)).toEqual([legacy.matured]);
    expect(
      (
        await f
          .as('financeB2')
          .get(`/lending/legacy-archive/loans/${legacy.running}`)
      ).status,
    ).toBe(404);
    // No archive permission.
    expect(
      (await f.as('ro').get('/lending/legacy-archive/summary')).status,
    ).toBe(403);
    // Another tenant's administrator.
    expect(
      (
        await f
          .as('t2admin')
          .get(`/lending/legacy-archive/loans/${legacy.running}`)
      ).status,
    ).toBeGreaterThanOrEqual(403);
  });

  it('the archive exports as CSV, formula-safe, and the export is audited', async () => {
    const res = await f.as('finance').get('/lending/legacy-archive/export.csv');
    expect(res.status).toBe(200);
    const lines = res.text.trim().split('\n');
    expect(lines[0]).toBe(
      'legacy_loan_id,borrower,branch,product,status,currency,principal,principal_outstanding,overdue_amount,days_past_due,start_date,term_months,migrated_to,migration',
    );
    expect(lines).toHaveLength(5);
    expect(lines.find((l: string) => l.startsWith(legacy.matured))).toContain(
      'NO_FUTURE_INSTALMENT',
    );
    const audit = await f.system(() =>
      f.prisma.auditEvent.findFirst({
        where: { tenantId: f.t1, action: 'legacy_loan.read' },
        orderBy: { eventTime: 'desc' },
      }),
    );
    expect(audit?.details).toMatchObject({ rows: 4 });
  });

  it('reports read the lending book: portfolio, money received and performance', async () => {
    const p = expectOk(await f.as('finance').get('/lending/reports/portfolio'));
    expect(p.businessDate).toBe('2026-02-28');
    expect(p.totals.loans).toBe(1);
    expect(p.data[0].id).toBe(lendingLoan.loanId);
    expect(p.filters.currencies).toEqual(['USD']);

    const r = expectOk(
      await f
        .as('finance')
        .get('/lending/reports/receipts?from=2026-02-01&to=2026-02-28'),
    );
    expect(r.total).toBe(1);
    expect(Number(r.data[0].amount)).toBeCloseTo(paid, 2);
    expect(
      Number(r.data[0].principal) + Number(r.data[0].interest),
    ).toBeCloseTo(paid, 2);
    // Nothing received in January.
    expect(
      expectOk(
        await f
          .as('finance')
          .get('/lending/reports/receipts?from=2026-01-01&to=2026-01-31'),
      ).total,
    ).toBe(0);

    const perf = expectOk(
      await f.as('finance').get('/lending/reports/performance'),
    );
    expect(perf.totals.activeLoans).toBe(1);
    expect(perf.totals.disbursed).toBe('2400.00');
    expect(Number(perf.totals.collected)).toBeCloseTo(paid, 2);
    expect(perf.totals.ageing.map((a: any) => a.band)).toEqual([
      'CURRENT',
      'D1_30',
      'D31_60',
      'D61_90',
      'D90_PLUS',
    ]);
    // Finance reads the lending accounts: income for the year to date.
    expect(perf.income.from).toBe('2026-01-01');
    expect(perf.income.byCurrency[0].currency).toBe('USD');
    expect(Number(perf.income.byCurrency[0].totalIncome)).toBeGreaterThan(0);
    // A relationship officer sees the book of their branch but not the ledger.
    const ro = expectOk(await f.as('ro').get('/lending/reports/performance'));
    expect(ro.totals.activeLoans).toBe(1);
    expect(ro.income).toBeNull();
    expect(
      expectOk(await f.as('ro2').get('/lending/reports/portfolio')).totals
        .loans,
    ).toBe(0);
  });

  it('report exports need loan_data.export, are formula-safe and audited', async () => {
    expect(
      (await f.as('ro').get('/lending/reports/portfolio.csv')).status,
    ).toBe(403);
    const res = await f
      .as('finance')
      .get('/lending/reports/receipts.csv?from=2026-02-01');
    expect(res.status).toBe(200);
    const [header, row] = res.text.trim().split('\n');
    expect(header.split(',')[0]).toBe('value_date');
    expect(row).toContain("'=CASH-RET-1");
    const pf = await f.as('finance').get('/lending/reports/portfolio.csv');
    expect(pf.status).toBe(200);
    expect(pf.text.trim().split('\n')).toHaveLength(2);
  });

  it('the borrower portal lists the customer’s lending loans', async () => {
    const token = new JwtService({
      secret:
        require('../../src/borrower-portal/borrower-jwt').borrowerJwtSecret(),
    }).sign(
      { sub: lendingLoan.borrowerId, typ: 'borrower', tenantId: f.t1 },
      { expiresIn: '1h' },
    );
    const get = (url: string) =>
      f.http().get(`/v1${url}`).set('Authorization', `Bearer ${token}`);
    const loans = expectOk(await get('/borrower/loans'));
    expect(loans).toHaveLength(1);
    expect(loans[0].id).toBe(lendingLoan.loanId);
    expect(loans[0].reference).toBeTruthy();
    const one = expectOk(await get(`/borrower/loans/${lendingLoan.loanId}`));
    expect(one.repayments).toHaveLength(1);
    expect(one.schedules[0].isPaid).toBe(true);
    const pdf = await get(`/borrower/loans/${lendingLoan.loanId}/statement`);
    expect(pdf.status).toBe(200);
    expect(pdf.headers['content-type']).toBe('application/pdf');
    // Another customer's loan is not theirs; the legacy key-facts route is gone.
    expect((await get(`/borrower/loans/${legacy.running}`)).status).toBe(404);
    expect(
      (await get(`/borrower/loans/${lendingLoan.loanId}/key-facts`)).status,
    ).toBe(404);
  });

  it('the regulatory return reads the legacy ledger only while the legacy book is not empty', async () => {
    const { LedgerService } = require('../../src/ledger/ledger.service');
    const ledger = f.app.get(LedgerService);
    const post = (date: Date, debit: string, credit: string) =>
      f.system(() =>
        ledger.postEntry({
          tenantId: f.t1,
          source: 'MANUAL',
          description: 'Legacy fixture',
          currency: 'USD',
          date,
          loanId: legacy.running,
          lines: [
            { accountCode: debit, debit: 200 },
            { accountCode: credit, credit: 200 },
          ],
        }),
      );
    await post(day(2025, 11, 10), '1200', '1000');
    const legacyRow = (p: any) =>
      p.content.tables
        .find((t: any) => t.code === 'PORTFOLIO')
        .rows.find(
          (r: any) => r.currency === 'USD' && r.stack === 'Legacy loans',
        );
    const preview = async () =>
      expectOk(
        await f
          .as('finance')
          .get('/lending/regulatory/preview?year=2026&month=2'),
      );
    expect(legacyRow(await preview()).loans).toBe(1);
    // The legacy book empties before the month (as the migration closes a
    // loan and clears it against migration clearing).
    await post(day(2026, 0, 20), '3900', '1200');
    await f.system(() =>
      f.prisma.loan.updateMany({
        where: { tenantId: f.t1, status: { in: ['DISBURSED', 'DEFAULTED'] } },
        data: { status: 'CLOSED' },
      }),
    );
    const after = await preview();
    expect(legacyRow(after).loans).toBe(0);
    expect(
      after.content.reconciliation.filter(
        (r: any) => r.stack === 'LEGACY' && Number(r.ledger) !== 0,
      ),
    ).toEqual([]);
    expect(after.content.warnings.join(' ')).not.toMatch(/legacy/i);
  });
});
