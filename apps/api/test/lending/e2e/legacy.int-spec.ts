/* eslint-disable @typescript-eslint/no-unsafe-call -- end-to-end fixtures: API responses and fixture rows are untyped. */
/**
 * S32 the legacy (core-app) loan, borrower creation to early settlement
 * (docs/servicing/SCENARIOS.md): POST /borrowers, KYC verification,
 * POST /loans, approval and disbursement by different people, a repayment,
 * a promise to pay followed up automatically (UC-59), the payoff quote and
 * POST /repayments/settlements (UC-31, UC-72).
 *
 * The legacy stack runs on the wall clock, not the lending business date,
 * so the loan is started 40 days before today: its first instalment is
 * already due when the journey begins.
 */
import { CollectionsService } from '../../../src/collections/collections.service';
import { TEST_DB, openLegacyBook } from '../harness';
import { Journey, c2, expectOk } from './journey';

const d = TEST_DB ? describe : describe.skip;
const DAY = 86_400_000;
const isoDay = (t: number) => new Date(t).toISOString().slice(0, 10);

d('S32 legacy loan: borrower creation to POST /repayments/settlements', () => {
  let j: Journey;
  let borrowerId: string;
  let loanId: string;

  beforeAll(async () => {
    j = await Journey.start();
    // The legacy book is read-only by default (D-097); this tenant opted out.
    await openLegacyBook(j.f, j.f.t1);
  }, 120_000);
  afterAll(async () => j?.close());

  const legacy = async () =>
    expectOk(await j.as('admin1').get(`/loans/${loanId}`));
  const journalsBalance = async () => {
    const entries = await j.f.system(() =>
      j.f.prisma.journalEntry.findMany({
        where: { loanId },
        include: { lines: true },
      }),
    );
    for (const e of entries) {
      const dr = e.lines.reduce((t: number, l: any) => t + Number(l.debit), 0);
      const cr = e.lines.reduce((t: number, l: any) => t + Number(l.credit), 0);
      expect(c2(dr)).toBe(c2(cr));
    }
    return entries;
  };

  it('onboarding: the borrower is created and KYC-verified through the API', async () => {
    borrowerId = await j.onboard({ firstName: 'Chea', monthlyIncome: 1500 });
    const b = expectOk(await j.as('ro').get(`/borrowers/${borrowerId}`));
    expect(b.kycStatus).toBe('VERIFIED');
  });

  it('a 3,000 flat-rate loan over 3 months is created by the officer, approved and disbursed by two others', async () => {
    const res = await j.as('ro').post('/loans', {
      borrowerId,
      principal: 3000,
      annualInterestRate: 12,
      termMonths: 3,
      startDate: isoDay(Date.now() - 40 * DAY),
      interestMethod: 'FLAT',
      collaterals: [
        { type: 'MOTORBIKE', description: 'Honda Dream 2022', value: 1200 },
      ],
      guarantors: [
        { name: 'Chea Sophal', phone: '+85512000111', relation: 'Brother' },
      ],
    });
    expect(res.status).toBe(201);
    loanId = res.body.id;
    expect(res.body.status).toBe('PENDING');
    // The officer who created it holds no approval permission (and could
    // not approve their own loan anyway).
    expect(
      (await j.as('ro').put(`/loans/${loanId}/status`, { status: 'APPROVED' }))
        .status,
    ).toBe(403);
    expect(
      expectOk(
        await j
          .as('admin1')
          .put(`/loans/${loanId}/status`, { status: 'APPROVED' }),
      ).status,
    ).toBe('APPROVED');
    // The approver cannot also disburse it.
    expect(
      (
        await j
          .as('admin1')
          .put(`/loans/${loanId}/status`, { status: 'DISBURSED' })
      ).status,
    ).toBe(400);
    expect(
      expectOk(
        await j
          .as('admin2')
          .put(`/loans/${loanId}/status`, { status: 'DISBURSED' }),
      ).status,
    ).toBe('DISBURSED');
    const l = await legacy();
    expect(l.schedules.map((s: any) => Number(s.totalAmount))).toEqual([
      1030, 1030, 1030,
    ]);
    expect(l.collaterals).toHaveLength(1);
    expect(l.guarantors).toHaveLength(1);
    const entries = await journalsBalance();
    expect(entries.length).toBeGreaterThan(0);
  });

  it('UC-59: the overdue first instalment is promised for today and paid; the promise is reviewed as kept', async () => {
    const today = isoDay(Date.now());
    const ptp = expectOk(
      await j.as('admin1').post(`/collections/loans/${loanId}/promises`, {
        amount: 1030,
        promisedDate: today,
        notes: 'Will pay at the branch today',
      }),
    );
    const r = expectOk(
      await j.as('admin1').post('/repayments', {
        loanId,
        amount: 1030,
        date: today,
        idempotencyKey: `legacy-${loanId}-1`,
      }),
    );
    expect(Number(r.principalPaid)).toBe(1000);
    expect(Number(r.interestPaid)).toBe(30);
    const l = await legacy();
    expect(l.schedules.find((s: any) => s.installmentNumber === 1).isPaid).toBe(
      true,
    );
    await j.f.system(() =>
      j.f.app
        .get(CollectionsService)
        .reviewPromises(new Date(Date.now() + DAY)),
    );
    const promises = expectOk(
      await j.as('admin1').get(`/collections/loans/${loanId}/promises`),
    );
    expect(promises.find((p: any) => p.id === ptp.id).status).toBe('KEPT');
    await journalsBalance();
  });

  it('UC-31: the payoff quote charges only interest that is due and waives the future interest', async () => {
    const q = expectOk(
      await j.as('admin1').get(`/loans/${loanId}/payoff-quote`),
    );
    expect(q.outstandingPrincipal).toBe(2000);
    expect(q.futureInterestWaived).toBe(60);
    expect(q.payoffAmount).toBe(
      2000 + q.accruedInterestDue + q.outstandingPenalty,
    );
    // Anything but the quote is refused.
    expect(
      (
        await j.as('admin1').post('/repayments/settlements', {
          loanId,
          amount: q.payoffAmount - 1,
        })
      ).status,
    ).toBe(400);
  });

  it('UC-72: paying the quote through POST /repayments/settlements closes the loan, once', async () => {
    const q = expectOk(
      await j.as('admin1').get(`/loans/${loanId}/payoff-quote`),
    );
    const body = {
      loanId,
      amount: q.payoffAmount,
      idempotencyKey: `legacy-settle-${loanId}`,
    };
    const r = expectOk(
      await j.as('admin1').post('/repayments/settlements', body),
    );
    expect(r.status).toBe('CLOSED');
    const again = expectOk(
      await j.as('admin1').post('/repayments/settlements', body),
    );
    expect(again.id).toBe(r.repayment.id);
    const l = await legacy();
    expect(l.status).toBe('CLOSED');
    expect(l.schedules.every((s: any) => s.isPaid)).toBe(true);
    await journalsBalance();
    const logs = expectOk(
      await j.as('admin1').get('/audit-logs?entity=Loan&limit=100'),
    );
    expect(logs.data.some((x: any) => x.entityId === loanId)).toBe(true);
  });
});
