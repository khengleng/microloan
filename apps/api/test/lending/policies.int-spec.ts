/* eslint-disable @typescript-eslint/no-unsafe-call -- integration fixtures: fixture rows come from the untyped API responses. */
/**
 * Composable loan policies (docs/servicing/POLICY_MODEL.md, DECISIONS
 * D-003..D-005): a governed policy library, products offering menus, contracts
 * composed and frozen at booking, and lock-in charges on early repayment
 * (UC-32).
 */
import {
  Fixture,
  TEST_DB,
  bootstrap,
  borrower,
  expectOk,
  key,
} from './harness';
import { originateAndDisburse, standardRoles } from './setup';

const d = TEST_DB ? describe : describe.skip;

d('Composable loan policies (integration)', () => {
  let f: Fixture;
  let lockVersion: string;
  let hardVersion: string;
  let productId: string;
  let flexible: string;
  let locked: string;

  beforeAll(async () => {
    f = await bootstrap();
    await standardRoles(f);
  }, 60_000);
  afterAll(async () => f?.app.close());

  const loan = async (id: string) =>
    expectOk(await f.as('opsMaker').get(`/lending/loans/${id}`));

  it('a policy version is made by one person and approved by another', async () => {
    const p = expectOk(
      await f.as('maker').post('/lending/policies', {
        kind: 'PREPAYMENT',
        code: 'P-LOCK12',
        name: 'Lock-in: 3% of the amount repaid',
        parameters: {
          lockInMonths: { type: 'int', default: 12, min: 6, max: 24 },
        },
        body: {
          earlyRepaymentCharges: {
            basis: 'AMOUNT_REPAID',
            tiers: [
              {
                untilMonth: { $param: 'lockInMonths' },
                action: 'CHARGE',
                rate: '0.03',
              },
            ],
          },
        },
      }),
    );
    lockVersion = p.versions[0].id;
    expect(p.versions[0].status).toBe('DRAFT');
    expectOk(
      await f
        .as('maker')
        .post(`/lending/policy-versions/${lockVersion}/submit`),
    );
    // Maker-checker: the maker cannot approve their own policy.
    expect(
      (
        await f
          .as('maker')
          .post(`/lending/policy-versions/${lockVersion}/approve`)
      ).status,
    ).toBe(403);
    const approved = expectOk(
      await f
        .as('checker')
        .post(`/lending/policy-versions/${lockVersion}/approve`),
    );
    expect(approved.status).toBe('APPROVED');
  });

  it('a policy body that would make any product invalid is refused', async () => {
    const res = await f.as('maker').post('/lending/policies', {
      kind: 'PREPAYMENT',
      code: 'P-BAD',
      name: 'Charge with no amount',
      body: {
        earlyRepaymentCharges: {
          tiers: [{ untilMonth: 6, action: 'CHARGE' }],
        },
      },
    });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('POLICY_INVALID');
    // A body may only touch the part of the configuration its kind owns.
    const stray = await f.as('maker').post('/lending/policies', {
      kind: 'PREPAYMENT',
      code: 'P-STRAY',
      name: 'Touches penalties',
      body: { penalty: { type: 'NONE' } },
    });
    expect(stray.status).toBe(400);
  });

  it('a product cannot go live while its menu names an unapproved policy', async () => {
    const hard = expectOk(
      await f.as('maker').post('/lending/policies', {
        kind: 'PREPAYMENT',
        code: 'P-HARD6',
        name: 'Hard lock-in for six months',
        body: {
          earlyRepaymentCharges: {
            tiers: [{ untilMonth: 6, action: 'REFUSE' }],
          },
        },
      }),
    );
    hardVersion = hard.versions[0].id;
    const tpl = expectOk(
      await f.as('maker').get('/lending/templates/PERSONAL_INSTALMENT'),
    );
    const config = structuredClone(tpl.defaultConfig);
    config.policies = {
      PREPAYMENT: {
        defaultCode: 'P-LOCK12',
        menu: ['P-LOCK12', 'P-HARD6'],
        parameterBounds: { lockInMonths: { min: 6, max: 18 } },
      },
    };
    const created = expectOk(
      await f.as('maker').post('/lending/products', {
        templateCode: 'PERSONAL_INSTALMENT',
        code: 'PL-POL',
        name: 'PL-POL product',
        config,
      }),
    );
    const vid = created.version.id;
    expectOk(
      await f.as('maker').post(`/lending/product-versions/${vid}/submit`),
    );
    expectOk(
      await f.as('checker').post(`/lending/product-versions/${vid}/approve`),
    );
    const refused = await f
      .as('checker')
      .post(`/lending/product-versions/${vid}/activate`);
    expect(refused.status).toBe(400);
    expect(refused.body.code).toBe('POLICY_NOT_APPROVED');

    expectOk(
      await f
        .as('maker')
        .post(`/lending/policy-versions/${hardVersion}/submit`),
    );
    expectOk(
      await f
        .as('checker')
        .post(`/lending/policy-versions/${hardVersion}/approve`),
    );
    expectOk(
      await f.as('checker').post(`/lending/product-versions/${vid}/activate`),
    );
    productId = created.product.id;
  });

  it('an application choosing parameters outside the product bounds is refused', async () => {
    const res = await f.as('ro').post('/lending/applications', {
      borrowerId: (await borrower(f, f.t1, f.b1)).id,
      productId,
      terms: {
        principal: '6000',
        numberOfInstalments: 12,
        disbursementDate: '2026-01-05',
        policies: { PREPAYMENT: { parameters: { lockInMonths: 24 } } },
      },
    });
    expect(res.status).toBe(400);
  });

  it('the contract is composed at booking and the resolved policies are frozen in it', async () => {
    const terms = {
      principal: '6000',
      numberOfInstalments: 12,
      disbursementDate: '2026-01-05',
    };
    flexible = (
      await originateAndDisburse(f, productId, {
        ...terms,
        policies: { PREPAYMENT: { parameters: { lockInMonths: 18 } } },
      })
    ).loanId;
    locked = (
      await originateAndDisburse(f, productId, {
        ...terms,
        policies: { PREPAYMENT: { code: 'P-HARD6' } },
      })
    ).loanId;
    const l = await loan(flexible);
    expect(l.agreementVersions[0].policies).toEqual([
      expect.objectContaining({
        kind: 'PREPAYMENT',
        code: 'P-LOCK12',
        version: 1,
        policyVersionId: lockVersion,
        parameters: { lockInMonths: 18 },
      }),
    ]);
  });

  it('UC-32: prepaying inside the lock-in carries the lock-in charge instead of the base fee', async () => {
    expectOk(
      await f
        .as('finance')
        .post('/lending/ops/business-date', { businessDate: '2026-02-05' }),
    );
    expectOk(await f.as('finance').post('/lending/loans/batch/run'));
    const l = await loan(flexible);
    const first = l.schedule.find((x: any) => x.number === 1);
    const due = Number(first.principalDue) + Number(first.interestDue);
    const ev = expectOk(
      await f
        .as('opsMaker')
        .post(
          `/lending/loans/${flexible}/repayments`,
          { amount: (due + 1030).toFixed(2) },
          key('lock'),
        ),
    );
    // prepaid + 3% × prepaid = 1,030.00 → prepaid 1,000.00, charge 30.00.
    expect(ev.components.prepaidPrincipal).toBe('1000');
    expect(ev.components.prepaymentFee).toBe('30');
    expect(ev.components.prepaymentCharge.source.kind).toBe('TIER');
    expect(ev.components.prepaymentCharge.source.untilMonth).toBe(18);

    const q = expectOk(
      await f.as('opsMaker').get(`/lending/loans/${flexible}/settlement-quote`),
    );
    expect(q.settlementFeeExplanation).toMatch(/Lock-in charge/);
  });

  it('UC-32: a hard lock-in refuses early repayment until it ends', async () => {
    const l = await loan(locked);
    const first = l.schedule.find((x: any) => x.number === 1);
    const due = Number(first.principalDue) + Number(first.interestDue);
    const res = await f
      .as('opsMaker')
      .post(
        `/lending/loans/${locked}/repayments`,
        { amount: (due + 500).toFixed(2) },
        key('hard'),
      );
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('PREPAYMENT_LOCKED_IN');
    const quote = await f
      .as('opsMaker')
      .get(`/lending/loans/${locked}/settlement-quote`);
    expect(quote.status).toBe(400);
    expect(quote.body.code).toBe('SETTLEMENT_LOCKED_IN');
  });

  it('an approved version is immutable; a change is a new version', async () => {
    const v2 = expectOk(
      await f
        .as('maker')
        .post(
          `/lending/policies/${(await f.as('maker').get('/lending/policies?kind=PREPAYMENT')).body.find((p: any) => p.code === 'P-LOCK12').id}/versions`,
          {
            parameters: {
              lockInMonths: { type: 'int', default: 12, min: 6, max: 24 },
            },
            body: {
              earlyRepaymentCharges: {
                tiers: [
                  {
                    untilMonth: { $param: 'lockInMonths' },
                    action: 'CHARGE',
                    rate: '0.02',
                  },
                ],
              },
            },
            changeSummary: 'Cut the lock-in charge to 2%',
          },
        ),
    );
    expect(v2.version).toBe(2);
    await expect(
      f.system(() =>
        f.prisma.lendingPolicyVersion.update({
          where: { id: lockVersion },
          data: { body: {} },
        }),
      ),
    ).rejects.toThrow(/immutable/);
    // A running contract keeps the version it was booked with.
    expect(
      (await loan(flexible)).agreementVersions[0].policies[0].version,
    ).toBe(1);
  });
});
