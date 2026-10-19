/* eslint-disable @typescript-eslint/no-unsafe-call -- integration fixtures: fixture rows come from the untyped API responses. */
/**
 * Classification and impairment for lending loans (OPS-5, DECISIONS D-010):
 * a tenant policy approved under maker-checker; end of day posts only the
 * change in each loan's allowance; write-off uses it; closure releases it.
 */
import {
  Fixture,
  TEST_DB,
  bootstrap,
  expectOk,
  grant,
  key,
  lendingSettings,
} from './harness';
import { activeProduct, originateAndDisburse, standardRoles } from './setup';

const d = TEST_DB ? describe : describe.skip;

d('Impairment (integration)', () => {
  let f: Fixture;
  let loanA: string;
  let loanB: string;

  beforeAll(async () => {
    f = await bootstrap();
    await standardRoles(f);
    await grant(f, f.t1, 'nobody', 'RISK_COMPLIANCE');
    const { productId } = await activeProduct(
      f,
      'PERSONAL_INSTALMENT',
      'PL-IMP',
      (c) => {
        c.pricing.fees = [];
        c.pricing.penalty = {
          type: 'NONE',
          flatAmount: null,
          annualRate: null,
          graceDays: 0,
          capPerInstalment: null,
        };
        c.operations.writeOffMinDpd = 30;
      },
    );
    const terms = {
      principal: '10000',
      numberOfInstalments: 12,
      disbursementDate: '2026-01-05',
    };
    loanA = (await originateAndDisburse(f, productId, terms)).loanId;
    loanB = (await originateAndDisburse(f, productId, terms)).loanId;
  }, 90_000);
  afterAll(async () => f?.app.close());

  const batch = async (businessDate: string) => {
    expectOk(
      await f
        .as('finance')
        .post('/lending/ops/business-date', { businessDate }),
    );
    expect(
      expectOk(await f.as('finance').post('/lending/loans/batch/run')).failed,
    ).toEqual([]);
  };
  const loan = async (id: string) =>
    expectOk(await f.as('opsMaker').get(`/lending/loans/${id}`));
  const reconcile = async () => {
    const rec = expectOk(
      await f.as('finance').get('/lending/ops/reconciliation'),
    );
    expect(rec.breaks).toEqual([]);
    expect(rec.trialBalanceBalanced).toBe(true);
  };
  const approve = async (settings: unknown) => {
    const p = expectOk(
      await f
        .as('finance')
        .post('/lending/ops/impairment-policy', { settings }),
    );
    expect(
      (
        await f
          .as('finance')
          .post(`/lending/ops/impairment-policy/${p.id}/decision`, {
            approve: true,
          })
      ).status,
    ).toBe(403);
    return expectOk(
      await f
        .as('nobody')
        .post(`/lending/ops/impairment-policy/${p.id}/decision`, {
          approve: true,
        }),
    );
  };

  it('posts nothing until a policy is approved (D-010)', async () => {
    await batch('2026-01-06');
    const l = await loan(loanA);
    expect(l.account.allowance).toBe('0');
    expect(l.events.some((e: any) => e.type === 'PROVISION')).toBe(false);
  });

  it('REGULATORY: a current loan carries the Standard rate; a late one moves class, posting only the change', async () => {
    const list = expectOk(
      await f.as('finance').get('/lending/ops/impairment-policy'),
    );
    const p = await approve(list.template);
    expect(p.status).toBe('ACTIVE');

    await batch('2026-01-07');
    let l = await loan(loanA);
    expect(l.account.classification).toBe('STANDARD');
    expect(l.account.allowance).toBe('100');

    // Instalment 1 falls due 5 Feb and stays unpaid: 20 days past due on 25 Feb.
    await batch('2026-02-05');
    await batch('2026-02-25');
    l = await loan(loanA);
    expect(l.account.daysPastDue).toBe(20);
    expect(l.account.classification).toBe('SPECIAL_MENTION');
    const provisions = l.events.filter((e: any) => e.type === 'PROVISION');
    expect(provisions).toHaveLength(2);
    // The second posting is only the increase from 1% to 3% of the principal.
    expect(Number(provisions[1].amount)).toBeCloseTo(
      Number(l.account.allowance) - 100,
      2,
    );
    await reconcile();
  });

  it('ECL: a new policy replaces the old; allowance = PD × LGD × EAD by stage', async () => {
    await approve({
      mode: 'ECL',
      classes: [
        { code: 'PERFORMING', label: 'Performing', minDpd: 0, rate: '0' },
        {
          code: 'UNDERPERFORMING',
          label: 'Underperforming',
          minDpd: 15,
          rate: '0',
        },
        {
          code: 'NON_PERFORMING',
          label: 'Non-performing',
          minDpd: 60,
          rate: '0',
        },
      ],
      ecl: {
        stage2FromDpd: 15,
        stage3FromDpd: 60,
        restructuredMinStage: 2,
        nonAccrualIsStage3: true,
        pd: { stage1: '0.05', stage2: '0.25', stage3: '1' },
        lgd: '0.40',
      },
    });
    const all = expectOk(
      await f.as('finance').get('/lending/ops/impairment-policy'),
    );
    expect(all.versions.filter((v: any) => v.status === 'ACTIVE')).toHaveLength(
      1,
    );
    expect(all.versions.some((v: any) => v.status === 'RETIRED')).toBe(true);

    await batch('2026-02-26');
    const a = await loan(loanA);
    expect(a.account.impairmentStage).toBe(2);
    const ead =
      Number(a.account.principalOutstanding) +
      Number(a.account.interestReceivable) -
      Number(a.account.interestInSuspense);
    expect(Number(a.account.allowance)).toBeCloseTo(0.25 * 0.4 * ead, 1);
    await reconcile();
  });

  it('write-off uses the allowance before expense', async () => {
    await batch('2026-03-10');
    const before = await loan(loanA);
    const held = Number(before.account.allowance);
    expect(held).toBeGreaterThan(0);
    // D-117: the product allows 30 days, but the lender's floor is the Loss
    // class of the short-term bands (91 days) until it approves another.
    const early = await f
      .as('opsMaker')
      .post(`/lending/loans/${loanA}/write-offs`, { reason: 'Too early' });
    expect(early.status).toBe(400);
    expect(early.body).toMatchObject({
      code: 'WRITE_OFF_TOO_EARLY',
      productMinimumDpd: 30,
      lenderFloorDpd: 91,
    });
    await lendingSettings(f, f.t1, {
      regulatory: { writeOffMinDpd: { shortTerm: 30, longTerm: 30 } },
    });
    const task = expectOk(
      await f.as('opsMaker').post(`/lending/loans/${loanA}/write-offs`, {
        reason: 'Borrower absconded',
      }),
    );
    const ev = expectOk(
      await f
        .as('opsChecker')
        .post(
          `/lending/loans/${loanA}/write-offs/${task.id}/decision`,
          { approve: true },
          key('wo'),
        ),
    );
    const lines = (await loan(loanA)).events.find((e: any) => e.id === ev.id)
      .journal.lines;
    const allowanceDebit = lines
      .filter((x: any) => x.accountCode === '1300')
      .reduce((s: number, x: any) => s + Number(x.debit), 0);
    expect(allowanceDebit).toBeCloseTo(held, 2);
    expect((await loan(loanA)).account.allowance).toBe('0');
    await reconcile();
  });

  it('settling a loan releases its allowance', async () => {
    const q = expectOk(
      await f.as('opsMaker').get(`/lending/loans/${loanB}/settlement-quote`),
    );
    expect(Number((await loan(loanB)).account.allowance)).toBeGreaterThan(0);
    expectOk(
      await f
        .as('opsMaker')
        .post(
          `/lending/loans/${loanB}/settlement`,
          { amount: q.payable },
          key('st'),
        ),
    );
    const b = await loan(loanB);
    expect(b.account.status).toBe('CLOSED');
    expect(b.account.allowance).toBe('0');
    await reconcile();
  });
});
