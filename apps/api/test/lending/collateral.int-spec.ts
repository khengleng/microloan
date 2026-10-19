/* eslint-disable @typescript-eslint/no-unsafe-call -- integration fixtures: fixture rows come from the untyped API responses. */
/**
 * Collateral through the life of a loan: combined LTV behind a prior lien
 * (LT-04, TV-17), revaluation and margin calls (UC-51, TV-18), and release
 * of the collateral once the loan is closed (UC-73).
 */
import {
  Fixture,
  TEST_DB,
  bootstrap,
  borrower,
  expectOk,
  key,
} from './harness';
import {
  activeProduct,
  docs,
  originateAndDisburse,
  standardRoles,
} from './setup';

const d = TEST_DB ? describe : describe.skip;

d('Collateral servicing (integration)', () => {
  let f: Fixture;
  let productId: string;

  beforeAll(async () => {
    f = await bootstrap();
    await standardRoles(f);
    ({ productId } = await activeProduct(
      f,
      'HOME_EQUITY_TERM',
      'HE-CLTV',
      (c) => {
        c.pricing.fees = [];
        c.security.maxLtv = '0.80';
        c.security.acceptedCollateralTypes = ['RESIDENTIAL_PROPERTY', 'GOLD'];
        c.security.valuationMaxAgeDays = null;
        c.security.marginCallCureDays = 5;
        c.operations.requiredDocuments = [
          {
            code: 'ID_DOCUMENT',
            label: 'Identity document',
            stage: 'APPLICATION',
            mandatory: true,
          },
        ];
      },
    ));
  }, 60_000);
  afterAll(async () => f?.app.close());

  const property = (marketValue: string, priorLienAmount?: string) => ({
    type: 'RESIDENTIAL_PROPERTY',
    description: 'Family home',
    marketValue,
    valuationDate: '2025-12-20',
    valuer: 'Valuer Co',
    method: 'MARKET',
    ...(priorLienAmount ? { priorLienAmount } : {}),
  });

  it('LT-04 / TV-17: a line behind a 120,000 mortgage on a 200,000 home lends at most 40,000', async () => {
    const apply = async (principal: string) => {
      const b = await borrower(f, f.t1, f.b1, { monthlyIncome: '20000' });
      const app = expectOk(
        await f.as('ro').post('/lending/applications', {
          borrowerId: b.id,
          productId,
          terms: {
            principal,
            numberOfInstalments: 120,
            disbursementDate: '2026-01-05',
          },
        }),
      );
      await docs(f, app.id, ['ID_DOCUMENT']);
      expectOk(
        await f
          .as('ro')
          .post(
            `/lending/applications/${app.id}/collateral`,
            property('200000', '120000'),
          ),
      );
      expectOk(await f.as('ro').post(`/lending/applications/${app.id}/submit`));
      expectOk(
        await f
          .as('analyst')
          .post(`/lending/applications/${app.id}/recommend`, {
            recommendation: 'APPROVE',
            rationale: 'Within policy',
          }),
      );
      // Security (LTV) is assessed at approval.
      return f.as('approver').post(`/lending/applications/${app.id}/approve`, {
        rationale: 'Approved',
      });
    };
    const over = await apply('40001');
    expect(over.status).toBe(400);
    const ltv = over.body.issues.find((i: any) => i.code === 'LTV');
    expect(ltv.message).toMatch(/Combined loan-to-value/);
    expect(ltv.message).toMatch(/40000/);
    expectOk(await apply('40000'));
  });

  describe('a loan against gold', () => {
    let loanId: string;
    let goldId: string;

    beforeAll(async () => {
      loanId = (
        await originateAndDisburse(
          f,
          productId,
          {
            principal: '7000',
            numberOfInstalments: 12,
            disbursementDate: '2026-01-05',
          },
          {
            borrowerOver: { monthlyIncome: '20000' },
            collateral: {
              type: 'GOLD',
              description: '100 g gold',
              marketValue: '10000',
              valuationDate: '2025-12-20',
              valuer: 'Assay Co',
              method: 'MARKET',
            },
          },
        )
      ).loanId;
      goldId = expectOk(
        await f.as('opsMaker').get(`/lending/loans/${loanId}/collateral`),
      ).pledges[0].collateralId;
    }, 60_000);

    const view = async () =>
      expectOk(
        await f.as('opsMaker').get(`/lending/loans/${loanId}/collateral`),
      );

    it('UC-51 / TV-18: a fall in value above max LTV opens a margin call', async () => {
      const r = expectOk(
        await f
          .as('ro')
          .post(`/lending/loans/${loanId}/collateral/${goldId}/valuations`, {
            marketValue: '8000',
            valuationDate: '2026-01-05',
            valuer: 'Assay Co',
            method: 'MARKET',
          }),
      );
      // 7,000 owed against 8,000 at 80% → repay 600 or add 750 of collateral.
      expect(Number(r.marginCall.ltv)).toBeCloseTo(0.875, 3);
      expect(r.marginCall.requiredRepayment).toBe('600');
      expect(r.marginCall.requiredCollateral).toBe('750');
      expect((await view()).marginCalls[0].status).toBe('OPEN');
    });

    it('UC-51: more collateral cures it', async () => {
      expectOk(
        await f.as('ro').post(`/lending/loans/${loanId}/collateral`, {
          type: 'GOLD',
          description: '10 g gold',
          marketValue: '1000',
          valuationDate: '2026-01-05',
          valuer: 'Assay Co',
          method: 'MARKET',
        }),
      );
      expect((await view()).marginCalls[0].status).toBe('CURED');
    });

    it('UC-73: collateral is released only after closure, signed off by someone else', async () => {
      const early = await f
        .as('ro')
        .post(`/lending/loans/${loanId}/collateral/${goldId}/release`, {
          reference: 'RET-001',
        });
      expect(early.status).toBe(409);
      const q = expectOk(
        await f.as('opsMaker').get(`/lending/loans/${loanId}/settlement-quote`),
      );
      expectOk(
        await f
          .as('opsMaker')
          .post(
            `/lending/loans/${loanId}/settlement`,
            { amount: q.payable },
            key('cl'),
          ),
      );
      const task = expectOk(
        await f
          .as('ro')
          .post(`/lending/loans/${loanId}/collateral/${goldId}/release`, {
            reference: 'RET-001',
            note: 'Returned at branch',
          }),
      );
      expect(
        (
          await f
            .as('ro')
            .post(
              `/lending/loans/${loanId}/collateral-releases/${task.id}/decision`,
              { approve: true },
            )
        ).status,
      ).toBe(403);
      expectOk(
        await f
          .as('opsChecker')
          .post(
            `/lending/loans/${loanId}/collateral-releases/${task.id}/decision`,
            { approve: true },
          ),
      );
      const gold = (await view()).pledges.find(
        (p: any) => p.collateralId === goldId,
      );
      expect(gold.status).toBe('RELEASED');
      expect(gold.releaseReference).toBe('RET-001');
    });
  });
});
