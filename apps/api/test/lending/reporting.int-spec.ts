/* eslint-disable @typescript-eslint/no-unsafe-call -- integration fixtures: fixture rows come from the untyped API responses. */
/**
 * Customer and regulatory outputs: statements (OPS-4), due and overdue
 * notices (OPS-7), closure letters and the credit bureau file (UC-75), and
 * the general-ledger export (OPS-6).
 */
import { Fixture, TEST_DB, bootstrap, expectOk, key } from './harness';
import { activeProduct, originateAndDisburse, standardRoles } from './setup';

const d = TEST_DB ? describe : describe.skip;

d('Statements, notices, letters and exports (integration)', () => {
  let f: Fixture;
  let late: string;
  let good: string;
  let lateRef: string;
  let goodRef: string;

  beforeAll(async () => {
    f = await bootstrap();
    await standardRoles(f);
    const { productId } = await activeProduct(
      f,
      'PERSONAL_INSTALMENT',
      'PL-REPORTS',
      (c) => {
        c.pricing.fees = [];
      },
    );
    const terms = {
      principal: '3000',
      numberOfInstalments: 6,
      disbursementDate: '2026-01-05',
    };
    late = (await originateAndDisburse(f, productId, terms)).loanId;
    good = (await originateAndDisburse(f, productId, terms)).loanId;
    lateRef = (await loan(late)).account.reference;
    goodRef = (await loan(good)).account.reference;
  }, 90_000);
  afterAll(async () => f?.app.close());

  const loan = async (id: string) =>
    expectOk(await f.as('opsMaker').get(`/lending/loans/${id}`));
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

  it('OPS-7: reminders list instalments falling due within the window', async () => {
    await moveTo('2026-02-01');
    const r = expectOk(
      await f.as('opsMaker').get('/lending/ops/notices?kind=DUE_SOON&days=7'),
    );
    const mine = r.notices.filter((n: any) =>
      [late, good].includes(n.loanAccountId),
    );
    expect(mine).toHaveLength(2);
    expect(mine[0].dueDate).toBe('2026-02-05');
    expect(mine[0].text).toContain('is due on 2026-02-05');
  });

  it('OPS-7: overdue notices name only the unpaid loan', async () => {
    await moveTo('2026-02-05');
    const line = (await loan(good)).schedule.find(
      (x: any) => x.number === 1 && x.status !== 'SUPERSEDED',
    );
    const amount = (
      Number(line.principalDue) + Number(line.interestDue)
    ).toFixed(2);
    expectOk(
      await f
        .as('opsMaker')
        .post(
          `/lending/loans/${good}/repayments`,
          { amount, externalReference: 'CASH-1' },
          key('r1'),
        ),
    );
    await moveTo('2026-02-10');
    const r = expectOk(
      await f.as('opsMaker').get('/lending/ops/notices?kind=OVERDUE'),
    );
    const ids = r.notices.map((n: any) => n.loanAccountId);
    expect(ids).toContain(late);
    expect(ids).not.toContain(good);
    expect(r.notices.find((n: any) => n.loanAccountId === late).text).toContain(
      'is unpaid',
    );
  });

  it("OPS-4: a statement shows the period's transactions and the running principal", async () => {
    const s = expectOk(
      await f
        .as('opsMaker')
        .get(`/lending/loans/${good}/statement?from=2026-01-01&to=2026-02-10`),
    );
    expect(s.opening.principal).toBe('0');
    expect(s.transactions.map((t: any) => t.type)).toEqual([
      'DISBURSEMENT',
      'REPAYMENT',
    ]);
    expect(s.transactions[1].principalBalance).toBe(
      (await loan(good)).account.principalOutstanding,
    );
    expect(s.nextInstalment.number).toBe(2);
    expect(s.text).toContain(goodRef);
    // A later window opens on the balance the earlier events left.
    const later = expectOk(
      await f
        .as('opsMaker')
        .get(`/lending/loans/${good}/statement?from=2026-02-06&to=2026-02-10`),
    );
    expect(later.opening.principal).toBe(s.transactions[1].principalBalance);
    expect(later.transactions).toEqual([]);
  });

  it('UC-75: a closure letter only for a closed loan', async () => {
    expect(
      (await f.as('opsMaker').get(`/lending/loans/${good}/closure-letter`))
        .status,
    ).toBe(409);
    const q = expectOk(
      await f.as('opsMaker').get(`/lending/loans/${good}/settlement-quote`),
    );
    expectOk(
      await f
        .as('opsMaker')
        .post(
          `/lending/loans/${good}/settlement`,
          { amount: q.payable },
          key('st'),
        ),
    );
    const letter = expectOk(
      await f.as('opsMaker').get(`/lending/loans/${good}/closure-letter`),
    );
    expect(letter.closedOn).toBe('2026-02-10');
    expect(letter.text).toContain('repaid in full');
  });

  it('UC-75: the bureau file reports the closed loan as paid and the late one in arrears', async () => {
    const res = await f.as('finance').get('/lending/ops/bureau-export.csv');
    expect(res.status).toBe(200);
    const lines: string[] = res.text.trim().split('\n');
    expect(lines[0]).toMatch(/^asOf,loanReference,nationalId/);
    expect(lines.find((l) => l.includes(goodRef))).toContain('CLOSED_PAID');
    expect(lines.find((l) => l.includes(lateRef))).toContain('ACTIVE_ARREARS');
    expect(
      (await f.as('ro').get('/lending/ops/bureau-export.csv')).status,
    ).toBe(403);
  });

  it('OPS-6: the GL export balances and needs a period', async () => {
    expect(
      (await f.as('finance').get('/lending/ops/gl-export.csv')).status,
    ).toBe(400);
    const res = await f
      .as('finance')
      .get('/lending/ops/gl-export.csv?from=2026-01-01&to=2026-02-28');
    expect(res.status).toBe(200);
    expect(res.headers['x-total-debit']).toBe(res.headers['x-total-credit']);
    const rows: string[] = res.text.trim().split('\n');
    expect(rows[0]).toBe(
      'entryDate,entryId,eventType,loanReference,accountCode,currency,debit,credit,description,externalReference',
    );
    expect(
      rows.some((r) => r.includes(goodRef) && r.includes('SETTLEMENT')),
    ).toBe(true);
  });
});
