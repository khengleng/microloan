/* eslint-disable @typescript-eslint/no-unsafe-call -- integration fixtures: responses and rows are untyped by nature here. */
/**
 * Inventory-backed lending (INVENTORY_BACKED, LT-14): a revolving line drawn
 * against a borrowing base. Certificates of inventory and receivables are
 * entered by one person and accepted by another; drawings are limited to the
 * lower of the limit and the base, refused without a current certificate,
 * and the line is serviced to closure with the books reconciling.
 */
import {
  acceptKeyFacts,
  Fixture,
  TEST_DB,
  authority,
  bootstrap,
  borrower,
  expectOk,
  grant,
  key,
} from './harness';
import { activeProduct, docs, standardRoles } from './setup';
import { lending } from '@microloan/shared';

const d = TEST_DB ? describe : describe.skip;
const D = (v: string | number) => new lending.D(v);

d('Inventory-backed borrowing base (integration)', () => {
  let f: Fixture;
  let facilityId: string;
  let loanId: string;

  async function setBusinessDate(target: string) {
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
  }

  async function enableFlag(flagKey: string) {
    const r = expectOk(
      await f.as('admin1').post('/lending/access/flags/rules', {
        flagKey,
        scopeType: 'TENANT',
        enabled: true,
        reason: 'borrowing base integration tests',
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

  const lines = [
    {
      classCode: 'RAW_MATERIALS',
      description: 'Paddy rice, warehouse A',
      grossValue: '100000',
      ineligibleAmount: '10000',
      ineligibleReason: 'Water damage',
      ageDays: 30,
    },
    {
      classCode: 'RAW_MATERIALS',
      description: 'Old stock, warehouse B',
      grossValue: '20000',
      ageDays: 200,
    },
    {
      classCode: 'FINISHED_GOODS',
      description: 'Milled rice, bagged',
      grossValue: '50000',
      ageDays: 20,
    },
    {
      classCode: 'RECEIVABLES',
      description: 'INV-1001',
      counterparty: 'Big Buyer Co',
      grossValue: '60000',
      ageDays: 25,
    },
    {
      classCode: 'RECEIVABLES',
      description: 'INV-1002',
      counterparty: 'Small Trader',
      grossValue: '20000',
      ageDays: 40,
    },
    {
      classCode: 'RECEIVABLES',
      description: 'INV-0950',
      counterparty: 'Late Payer',
      grossValue: '5000',
      ageDays: 120,
    },
  ];
  // Raw 90,000 × 0.5 = 45,000; finished 50,000 × 0.6 = 30,000; receivables
  // 80,000 eligible before concentration, Big Buyer capped at 25% (20,000):
  // 40,000 × 0.8 = 32,000. Base 107,000.
  const BASE = '107000';

  const facility = async () =>
    expectOk(await f.as('opsMaker').get(`/lending/facilities/${facilityId}`));
  const overview = async () =>
    expectOk(
      await f
        .as('opsMaker')
        .get(`/lending/facilities/${facilityId}/borrowing-base`),
    );
  const requestDrawdown = (amount: string) =>
    f
      .as('opsMaker')
      .post(`/lending/facilities/${facilityId}/drawdowns`, { amount });

  async function drawdown(amount: string, tag: string) {
    const dd = expectOk(await requestDrawdown(amount));
    expectOk(
      await f
        .as('opsChecker')
        .post(`/lending/facilities/${facilityId}/drawdowns/${dd.id}/approve`),
    );
    return expectOk(
      await f
        .as('opsChecker')
        .post(
          `/lending/facilities/${facilityId}/drawdowns/${dd.id}/release`,
          { externalReference: `BANK-${tag}` },
          key(`bb-${tag}`),
        ),
    );
  }

  beforeAll(async () => {
    f = await bootstrap();
    await standardRoles(f);
    await authority(
      f,
      f.t1,
      'opsChecker',
      'facility.drawdown.approve',
      'USD',
      '1000000',
    );
    for (const flagKey of [
      'lending.revolving.drawdown',
      'lending.collateral.borrowing_base',
    ])
      await enableFlag(flagKey);
    await setBusinessDate('2026-01-05');
    const { productId } = await activeProduct(
      f,
      'INVENTORY_BACKED',
      'ABL-RICE',
    );
    const b = await borrower(f, f.t1, f.b1, {
      firstName: 'Battambang',
      lastName: 'Rice Mill',
      monthlyIncome: '60000',
    });
    const app = expectOk(
      await f.as('ro').post('/lending/applications', {
        borrowerId: b.id,
        productId,
        terms: {
          principal: '200000',
          numberOfInstalments: 12,
          disbursementDate: '2026-01-05',
          annualRate: '0.12',
        },
      }),
    );
    await docs(f, app.id, ['ID_DOCUMENT']);
    expectOk(
      await f.as('ro').post(`/lending/applications/${app.id}/collateral`, {
        type: 'INVENTORY',
        description: 'Pledged stock and receivables of the mill',
        marketValue: '400000',
        valuationDate: '2025-12-20',
        valuer: 'Field examiner',
        method: 'MARKET',
      }),
    );
    expectOk(await f.as('ro').post(`/lending/applications/${app.id}/submit`));
    expectOk(
      await f.as('analyst').post(`/lending/applications/${app.id}/recommend`, {
        recommendation: 'APPROVE',
        rationale: 'Asset-based line within policy',
      }),
    );
    expectOk(
      await f.as('approver').post(`/lending/applications/${app.id}/approve`, {
        rationale: 'Approved within authority',
      }),
    );
    await acceptKeyFacts(f, app.id);
    const booked = expectOk(
      await f.as('opsMaker').post(`/lending/applications/${app.id}/book`, {}),
    );
    facilityId = booked.facility.id;
    loanId = booked.account.id;
  }, 120_000);
  afterAll(async () => f?.app.close());

  it('LT-14: without an accepted certificate nothing can be drawn', async () => {
    const v = await facility();
    expect(v.borrowingBase.available).toBe('0');
    expect(v.borrowingBase.stale).toBe(true);
    const r = await requestDrawdown('1000');
    expect(r.status).toBe(400);
    expect(r.body.code).toBe('BORROWING_BASE_STALE');
  });

  it('LT-14: the preview works out eligibility, ineligibles, concentration and advance rates by class', async () => {
    const p = expectOk(
      await f
        .as('opsMaker')
        .post(`/lending/facilities/${facilityId}/borrowing-base/preview`, {
          lines,
        }),
    );
    expect(p.borrowingBase).toBe(BASE);
    const rec = p.classes.find((c: any) => c.code === 'RECEIVABLES');
    expect(rec.concentrationExcess).toBe('40000');
    expect(rec.agedOut).toBe('5000');
    expect(p.classes.find((c: any) => c.code === 'RAW_MATERIALS').agedOut).toBe(
      '20000',
    );
    const bad = await f
      .as('opsMaker')
      .post(`/lending/facilities/${facilityId}/borrowing-base/preview`, {
        lines: [{ classCode: 'GOLD', description: 'Bars', grossValue: '1' }],
      });
    expect(bad.status).toBe(400);
  });

  let certId: string;
  it('LT-14: a certificate is submitted by one person and cannot be accepted by the same person (maker-checker)', async () => {
    const future = await f
      .as('opsMaker')
      .post(`/lending/facilities/${facilityId}/borrowing-base/certificates`, {
        asOfDate: '2026-02-01',
        lines,
      });
    expect(future.status).toBe(400);
    const cert = expectOk(
      await f
        .as('opsMaker')
        .post(`/lending/facilities/${facilityId}/borrowing-base/certificates`, {
          asOfDate: '2026-01-05',
          lines,
          notes: 'December stock count',
        }),
    );
    certId = cert.id;
    expect(cert.status).toBe('SUBMITTED');
    expect(cert.borrowingBase).toBe(BASE);
    // One pending certificate at a time.
    expect(
      (
        await f
          .as('opsMaker')
          .post(
            `/lending/facilities/${facilityId}/borrowing-base/certificates`,
            { asOfDate: '2026-01-05', lines },
          )
      ).status,
    ).toBe(409);
    // A submitted certificate supports nothing yet.
    expect((await requestDrawdown('1000')).body.code).toBe(
      'BORROWING_BASE_STALE',
    );
    // The maker now also holds the approving role, so the refusal below is
    // the maker-checker rule, not a missing permission.
    await grant(f, f.t1, 'opsMaker', 'LOAN_OPS_CHECKER');
    const self = await f
      .as('opsMaker')
      .post(
        `/lending/facilities/${facilityId}/borrowing-base/certificates/${certId}/decision`,
        { outcome: 'ACCEPT' },
      );
    expect(self.status).toBe(403);
    expect(JSON.stringify(self.body)).toMatch(/action you created or proposed/);
    const noReason = await f
      .as('opsChecker')
      .post(
        `/lending/facilities/${facilityId}/borrowing-base/certificates/${certId}/decision`,
        { outcome: 'REJECT' },
      );
    expect(noReason.status).toBe(400);
  });

  it('LT-14: accepted by a second person, the base limits drawings to the lower of limit and base', async () => {
    const r = expectOk(
      await f
        .as('opsChecker')
        .post(
          `/lending/facilities/${facilityId}/borrowing-base/certificates/${certId}/decision`,
          { outcome: 'ACCEPT' },
        ),
    );
    expect(r.status).toBe('ACCEPTED');
    const o = await overview();
    expect(o.current.id).toBe(certId);
    expect(o.availability.drawingCap).toBe(BASE);
    expect(o.availability.available).toBe(BASE);
    const over = await requestDrawdown('107000.01');
    expect(over.status).toBe(400);
    expect(over.body.code).toBe('BORROWING_BASE_EXCEEDED');
    await drawdown('80000', 'd1');
    expect((await overview()).availability.available).toBe('27000');
    expect((await requestDrawdown('27000.01')).body.code).toBe(
      'BORROWING_BASE_EXCEEDED',
    );
  });

  it('LT-14: a certificate goes stale after its maximum age and blocks drawdowns until a new one is accepted', async () => {
    await setBusinessDate('2026-02-06');
    const stale = await requestDrawdown('1000');
    expect(stale.status).toBe(400);
    expect(stale.body.code).toBe('BORROWING_BASE_STALE');
    expect((await facility()).borrowingBase.stale).toBe(true);
    // A smaller base than what is drawn: accepted, and the shortfall is reported.
    const smaller = expectOk(
      await f
        .as('opsMaker')
        .post(`/lending/facilities/${facilityId}/borrowing-base/certificates`, {
          asOfDate: '2026-02-05',
          lines: [
            {
              classCode: 'FINISHED_GOODS',
              description: 'Milled rice, bagged',
              grossValue: '100000',
              ageDays: 10,
            },
          ],
        }),
    );
    const decided = expectOk(
      await f
        .as('opsChecker')
        .post(
          `/lending/facilities/${facilityId}/borrowing-base/certificates/${smaller.id}/decision`,
          { outcome: 'ACCEPT' },
        ),
    );
    expect(decided.overAdvance).toBe('20000');
    const o = await overview();
    expect(o.availability.available).toBe('0');
    expect(o.certificates[0].status).toBe('ACCEPTED');
    expect(o.certificates.find((c: any) => c.id === certId).status).toBe(
      'SUPERSEDED',
    );
    const shortfall = await f.system(() =>
      f.prisma.outboxMessage.findFirst({
        where: { tenantId: f.t1, topic: 'lending.borrowing_base.shortfall' },
      }),
    );
    expect(shortfall).toBeTruthy();
  });

  it('LT-14: the figures of a decided certificate cannot be changed in the database', async () => {
    await expect(
      f.system(() =>
        f.prisma.borrowingBaseCertificate.update({
          where: { id: certId },
          data: { borrowingBase: '999999' },
        }),
      ),
    ).rejects.toThrow(/BORROWING_BASE_IMMUTABLE/);
  });

  it('repaying under the base restores availability; the line is repaid to zero and reconciles', async () => {
    const stated = expectOk(
      await f
        .as('opsMaker')
        .post(
          `/lending/facilities/${facilityId}/statements`,
          { periodEnd: '2026-02-06' },
          key('bb-st1'),
        ),
    );
    const charges = D(stated.statement.chargesRaised);
    expect(charges.gt(0)).toBe(true);
    expectOk(
      await f
        .as('opsMaker')
        .post(
          `/lending/facilities/${facilityId}/repayments`,
          { amount: charges.plus('30000').toString() },
          key('bb-r1'),
        ),
    );
    expect((await overview()).availability.available).toBe('10000');
    await drawdown('10000', 'd2');
    expect((await overview()).availability.available).toBe('0');
    await setBusinessDate('2026-03-01');
    const st2 = expectOk(
      await f
        .as('opsMaker')
        .post(
          `/lending/facilities/${facilityId}/statements`,
          { periodEnd: '2026-03-01' },
          key('bb-st2'),
        ),
    );
    const loan = expectOk(
      await f.as('opsMaker').get(`/lending/loans/${loanId}`),
    );
    const owed = D(loan.account.principalOutstanding)
      .plus(loan.account.interestReceivable)
      .plus(loan.account.feesReceivable)
      .plus(loan.account.penaltyReceivable);
    expect(
      D(st2.statement.closingBalance).eq(loan.account.principalOutstanding),
    ).toBe(true);
    expectOk(
      await f
        .as('opsMaker')
        .post(
          `/lending/facilities/${facilityId}/repayments`,
          { amount: owed.toString() },
          key('bb-r2'),
        ),
    );
    const after = expectOk(
      await f.as('opsMaker').get(`/lending/loans/${loanId}`),
    );
    expect(after.account.principalOutstanding).toBe('0');
    // The current certificate supports 60,000 (100,000 finished goods × 0.6).
    expect((await overview()).availability.available).toBe('60000');
    const r = expectOk(
      await f.as('finance').get('/lending/ops/reconciliation'),
    );
    expect(r.trialBalanceBalanced).toBe(true);
    expect(r.breaks).toEqual([]);
  });
});
