/* eslint-disable @typescript-eslint/no-unsafe-call -- integration fixtures: fixture rows come from the untyped API responses. */
/**
 * Recovery workflows end to end: repossession with a surplus and with a
 * deficiency (UC-65), pawn custody, forfeiture, auction and return (UC-66,
 * LT-09), credit insurance from a financed premium to a claim that pays the
 * loan off (UC-68, UC-06), and the sale of a loan to a collection agency
 * (UC-71). Every journal balances and the book reconciles afterwards.
 */
import { lending } from '@microloan/shared';
import {
  Fixture,
  TEST_DB,
  bootstrap,
  expectOk,
  grant,
  key,
} from './harness';
import { activeProduct, originateAndDisburse, standardRoles } from './setup';

const d = TEST_DB ? describe : describe.skip;

const D = (v: string | number) => new lending.D(String(v));

d('Recovery workflows (integration)', () => {
  let f: Fixture;
  const loans: Record<string, string> = {};
  let vehicleA: string;
  let vehicleB: string;

  const loan = async (id: string) =>
    expectOk(await f.as('opsMaker').get(`/lending/loans/${id}`));
  const recovery = async (id: string) =>
    expectOk(await f.as('opsMaker').get(`/lending/loans/${id}/recovery`));
  const owed = (a: any) =>
    D(a.principalOutstanding)
      .plus(a.interestReceivable)
      .plus(a.feesReceivable)
      .plus(a.penaltyReceivable);
  /** Journal lines of the latest event of a type, as "code:debit:credit". */
  const journal = async (id: string, type: string) => {
    const l = await loan(id);
    const e = [...l.events].reverse().find((x: any) => x.type === type);
    expect(e).toBeDefined();
    return {
      event: e,
      lines: e.journal.lines
        .map(
          (x: any) =>
            `${x.accountCode}:${D(x.debit).toString()}:${D(x.credit).toString()}`,
        )
        .sort() as string[],
    };
  };
  const decide = (
    who: string,
    id: string,
    taskId: string,
    approve = true,
    k = key('dec'),
  ) =>
    f
      .as(who)
      .post(
        `/lending/loans/${id}/recovery-tasks/${taskId}/decision`,
        { approve },
        k,
      );
  const reconciles = async () => {
    const rec = expectOk(
      await f.as('finance').get('/lending/ops/reconciliation'),
    );
    expect(rec.breaks).toEqual([]);
    expect(rec.trialBalanceBalanced).toBe(true);
  };

  beforeAll(async () => {
    f = await bootstrap();
    await standardRoles(f);
    await grant(f, f.t1, 'opsMaker', 'COLLECTIONS_OFFICER');
    // Everything is originated on the first business day, then the book ages.
    const secured = await activeProduct(
      f,
      'PERSONAL_INSTALMENT',
      'REC-SEC',
      (c: any) => {
        c.pricing.fees = [];
        c.operations.writeOffMinDpd = 0;
        c.recovery = {
          repossessionMinDpd: 30,
          debtSaleMinDpd: 30,
          pawnForfeitureGraceDays: 0,
        };
      },
    );
    const insured = await activeProduct(
      f,
      'PERSONAL_INSTALMENT',
      'REC-INS',
      (c: any) => {
        c.pricing.fees = [
          {
            code: 'CREDIT_LIFE',
            name: 'Credit life premium',
            calculation: 'FIXED',
            amount: '60',
            treatment: 'FINANCED',
            waivable: false,
            payee: 'INSURER',
          },
        ];
      },
    );
    const terms = {
      principal: '3000',
      numberOfInstalments: 12,
      disbursementDate: '2026-01-05',
    };
    const vehicle = (value: string) => ({
      type: 'VEHICLE',
      description: 'Toyota Corolla 2019',
      marketValue: value,
      valuationDate: '2026-01-02',
      valuer: 'Auto Valuers',
      method: 'MARKET',
    });
    loans.A = (
      await originateAndDisburse(f, secured.productId, terms, {
        collateral: vehicle('9000'),
      })
    ).loanId;
    loans.B = (
      await originateAndDisburse(f, secured.productId, terms, {
        collateral: vehicle('4000'),
      })
    ).loanId;
    for (const k of ['C', 'D', 'G', 'H'])
      loans[k] = (
        await originateAndDisburse(f, secured.productId, terms)
      ).loanId;
    for (const k of ['E', 'F'])
      loans[k] = (
        await originateAndDisburse(f, insured.productId, terms)
      ).loanId;
    vehicleA = (await recovery(loans.A)).pledges[0].collateralId;
    vehicleB = (await recovery(loans.B)).pledges[0].collateralId;
  }, 180_000);
  afterAll(async () => f?.app.close());

  async function ageBookTo(target: string) {
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
    expectOk(await f.as('finance').post('/lending/loans/batch/run'));
  }

  describe('before the loans are delinquent', () => {
    it('UC-65: a performing loan cannot be repossessed', async () => {
      const r = await f
        .as('opsMaker')
        .post(`/lending/loans/${loans.A}/repossessions`, {
          collateralId: vehicleA,
          location: 'Phnom Penh yard',
          seizedOn: '2026-01-05',
          reason: 'Arrears',
        });
      expect(r.status).toBe(400);
      expect(r.body.message).toMatch(/at least 30 days past due/);
    });

    it('LT-09: pawned gold is taken into custody, valued by weight × purity × price', async () => {
      const r = expectOk(
        await f.as('opsMaker').post(`/lending/loans/${loans.C}/pawn-items`, {
          description: 'Gold necklace',
          itemType: 'GOLD',
          weightGrams: '50',
          karat: 18,
          pricePerGram: '60',
          custodyLocation: 'Branch vault PNH, box 12',
          sealNumber: 'SEAL-0012',
          receivedOn: '2026-01-05',
          redemptionDeadline: '2026-02-15',
        }),
      );
      expect(r.valuation.value).toBe('2250');
      expect(r.item.purity).toBe('0.75');
      expect(r.item.status).toBe('IN_CUSTODY');
      expectOk(
        await f.as('opsMaker').post(`/lending/loans/${loans.D}/pawn-items`, {
          description: 'Gold ring',
          itemType: 'GOLD',
          weightGrams: '10',
          purity: '0.9999',
          pricePerGram: '60',
          custodyLocation: 'Branch vault PNH, box 13',
          receivedOn: '2026-01-05',
          redemptionDeadline: '2026-02-15',
        }),
      );
    });

    it('UC-66: an item cannot be forfeited before its redemption deadline', async () => {
      const item = (await recovery(loans.C)).pawnItems[0];
      const r = await f
        .as('opsMaker')
        .post(`/lending/loans/${loans.C}/pawn-items/${item.id}/forfeiture`, {
          reason: 'Not redeemed',
        });
      expect(r.status).toBe(409);
      expect(r.body.message).toMatch(/after its redemption deadline/);
    });

    it('UC-06: a financed insurance premium is in the principal and owed to the insurer, not fee income', async () => {
      const l = await loan(loans.E);
      expect(l.account.principalOutstanding).toBe('3060');
      const { lines } = await journal(loans.E, 'DISBURSEMENT');
      expect(lines).toContain('2610:0:60');
      expect(lines.some((x) => x.startsWith('4200:'))).toBe(false);
    });

    it('UC-68: the policy is recorded against the financed premium, and remitted under maker-checker', async () => {
      const policy = expectOk(
        await f
          .as('opsMaker')
          .post(`/lending/loans/${loans.E}/insurance-policies`, {
            insurer: 'Forte Insurance',
            policyNumber: 'CL-0001',
            coverType: 'DEATH_AND_DISABILITY',
            premiumTreatment: 'FINANCED',
            startDate: '2026-01-05',
          }),
      );
      expect(policy.premium).toBe('60');
      // Nothing more was financed for an insurer.
      const again = await f
        .as('opsMaker')
        .post(`/lending/loans/${loans.E}/insurance-policies`, {
          insurer: 'Forte Insurance',
          policyNumber: 'CL-0002',
          coverType: 'DEATH',
          premiumTreatment: 'FINANCED',
          startDate: '2026-01-05',
        });
      expect(again.status).toBe(400);
      const task = expectOk(
        await f
          .as('opsMaker')
          .post(
            `/lending/loans/${loans.E}/insurance-policies/${policy.id}/remittances`,
            { reference: 'FORTE-JAN' },
          ),
      );
      // The maker cannot pay the insurer themselves.
      expect((await decide('opsMaker', loans.E, task.id)).status).toBe(403);
      expectOk(await decide('opsChecker', loans.E, task.id));
      const { lines } = await journal(loans.E, 'INSURANCE_PREMIUM_REMITTANCE');
      expect(lines).toEqual(['1000:0:60', '2610:60:0']);
      const view = await recovery(loans.E);
      expect(view.insurancePolicies[0].premiumToRemit).toBe('0');
    });

    it('UC-68: a premium paid in cash is received for the insurer', async () => {
      expectOk(
        await f.as('opsMaker').post(
          `/lending/loans/${loans.F}/insurance-policies`,
          {
            insurer: 'Forte Insurance',
            policyNumber: 'CL-0100',
            coverType: 'DEATH',
            premium: '45',
            premiumTreatment: 'PAID',
            startDate: '2026-01-05',
          },
          key('prem'),
        ),
      );
      const { lines } = await journal(loans.F, 'INSURANCE_PREMIUM');
      expect(lines).toEqual(['1000:45:0', '2610:0:45']);
    });
  });

  describe('after the book has aged', () => {
    beforeAll(async () => {
      await ageBookTo('2026-03-15');
    }, 180_000);

    it('the loans are now delinquent', async () => {
      expect((await loan(loans.A)).account.daysPastDue).toBeGreaterThanOrEqual(
        30,
      );
    });

    describe('UC-65 repossession with a surplus', () => {
      let repoId: string;
      const saleKey = key('sale');
      const saleBody = {
        salePrice: '5000',
        costs: '300',
        buyer: 'Phnom Penh Auctions',
        saleDate: '2026-03-15',
        externalReference: 'AUCT-77',
      };

      it('seizure is proposed by one user and approved by another', async () => {
        const repo = expectOk(
          await f.as('opsMaker').post(`/lending/loans/${loans.A}/repossessions`, {
            collateralId: vehicleA,
            location: 'Phnom Penh yard',
            seizedOn: '2026-03-14',
            reason: 'Two instalments in arrears; borrower unreachable',
          }),
        );
        repoId = repo.id;
        expect(repo.status).toBe('PROPOSED');
        const dup = await f
          .as('opsMaker')
          .post(`/lending/loans/${loans.A}/repossessions`, {
            collateralId: vehicleA,
            location: 'Again',
            seizedOn: '2026-03-14',
            reason: 'Duplicate',
          });
        expect(dup.status).toBe(409);
        // Selling before valuation, or valuing before approval, is refused.
        const early = await f
          .as('opsMaker')
          .post(
            `/lending/loans/${loans.A}/repossessions/${repoId}/valuation`,
            {
              marketValue: '6000',
              valuer: 'Auto Valuers',
              valuationDate: '2026-03-15',
            },
          );
        expect(early.status).toBe(409);
        expect((await decide('opsMaker', loans.A, repo.taskId)).status).toBe(
          403,
        );
        expectOk(await decide('opsChecker', loans.A, repo.taskId));
        expect((await recovery(loans.A)).repossessions[0].status).toBe(
          'SEIZED',
        );
      });

      it('the seized asset is valued, then sold; costs come first, the loan is paid, the surplus is held for the borrower', async () => {
        expectOk(
          await f
            .as('opsMaker')
            .post(
              `/lending/loans/${loans.A}/repossessions/${repoId}/valuation`,
              {
                marketValue: '6000',
                valuer: 'Auto Valuers',
                valuationDate: '2026-03-15',
              },
            ),
        );
        const before = (await loan(loans.A)).account;
        const due = owed(before);
        const sale = expectOk(
          await f.as('opsMaker').post(
            `/lending/loans/${loans.A}/repossessions/${repoId}/sale`,
            saleBody,
            saleKey,
          ),
        );
        expect(sale.proceeds.costsRecovered).toBe('300');
        expect(sale.proceeds.settlesLoan).toBe(true);
        expect(sale.proceeds.applied[0].component).toBe('INTEREST');
        expect(sale.proceeds.applied[1].component).toBe('PRINCIPAL');
        expect(D(sale.proceeds.totalApplied).eq(due)).toBe(true);
        expect(
          D(sale.proceeds.surplus).eq(D(4700).minus(due)),
        ).toBe(true);
        const after = (await loan(loans.A)).account;
        expect(after.status).toBe('CLOSED');
        expect(after.principalOutstanding).toBe('0');
        const { lines } = await journal(loans.A, 'REPOSSESSION_SALE');
        expect(lines).toContain('1000:5000:0');
        expect(lines).toContain('1000:0:300');
        expect(lines).toContain(`2710:0:${sale.proceeds.surplus}`);
        const view = await recovery(loans.A);
        expect(view.pledges[0].status).toBe('SOLD');
        expect(view.repossessions[0].status).toBe('SOLD');
        expect(view.refunds[0].status).toBe('PAYABLE');
        expect(view.refunds[0].amount).toBe(sale.proceeds.surplus);
      });

      it('the surplus is paid out to the borrower only by a second user', async () => {
        const view = await recovery(loans.A);
        const taskId = view.refunds[0].taskId;
        expect((await decide('opsMaker', loans.A, taskId)).status).toBe(403);
        expectOk(await decide('opsChecker', loans.A, taskId));
        const { lines } = await journal(loans.A, 'RECOVERY_REFUND');
        const s = view.refunds[0].amount;
        expect(lines).toEqual([`1000:0:${s}`, `2710:${s}:0`]);
        expect((await recovery(loans.A)).refunds[0].status).toBe('PAID');
      });

      it('replays the sale on the same idempotency key rather than selling twice', async () => {
        const again = expectOk(
          await f
            .as('opsMaker')
            .post(
              `/lending/loans/${loans.A}/repossessions/${repoId}/sale`,
              saleBody,
              saleKey,
            ),
        );
        expect(again.replayed).toBe(true);
        const sales = (await loan(loans.A)).events.filter(
          (e: any) => e.type === 'REPOSSESSION_SALE',
        );
        expect(sales).toHaveLength(1);
        // A new key is a new request, refused because the loan is closed.
        const fresh = await f
          .as('opsMaker')
          .post(
            `/lending/loans/${loans.A}/repossessions/${repoId}/sale`,
            saleBody,
            key('resale'),
          );
        expect([403, 409]).toContain(fresh.status);
      });
    });

    describe('UC-65 repossession with a deficiency, then write-off and recovery', () => {
      it('a sale that does not cover the loan leaves the deficiency owed on an open loan', async () => {
        const repo = expectOk(
          await f.as('opsMaker').post(`/lending/loans/${loans.B}/repossessions`, {
            collateralId: vehicleB,
            location: 'Siem Reap yard',
            seizedOn: '2026-03-15',
            reason: 'Arrears',
          }),
        );
        expectOk(await decide('opsChecker', loans.B, repo.taskId));
        expectOk(
          await f
            .as('opsMaker')
            .post(
              `/lending/loans/${loans.B}/repossessions/${repo.id}/valuation`,
              {
                marketValue: '1800',
                valuer: 'Auto Valuers',
                valuationDate: '2026-03-15',
              },
            ),
        );
        const due = owed((await loan(loans.B)).account);
        const sale = expectOk(
          await f.as('opsMaker').post(
            `/lending/loans/${loans.B}/repossessions/${repo.id}/sale`,
            {
              salePrice: '1500',
              costs: '200',
              buyer: 'Siem Reap Motors',
              saleDate: '2026-03-15',
            },
            key('saleB'),
          ),
        );
        expect(sale.proceeds.surplus).toBe('0');
        expect(sale.proceeds.settlesLoan).toBe(false);
        expect(D(sale.proceeds.deficiencyTotal).eq(due.minus(1300))).toBe(true);
        expect(sale.refund).toBeNull();
        const after = (await loan(loans.B)).account;
        expect(after.status).toBe('ACTIVE');
        expect(owed(after).eq(D(sale.proceeds.deficiencyTotal))).toBe(true);
        expect((await recovery(loans.B)).pledges[0].status).toBe('SOLD');
        await reconciles();
      });

      it('the deficiency is written off, and a later recovery still posts to income', async () => {
        const task = expectOk(
          await f.as('opsMaker').post(`/lending/loans/${loans.B}/write-offs`, {
            reason: 'Deficiency after repossession sale',
          }),
        );
        expectOk(
          await f
            .as('opsChecker')
            .post(
              `/lending/loans/${loans.B}/write-offs/${task.id}/decision`,
              { approve: true },
              key('wo'),
            ),
        );
        expect((await loan(loans.B)).account.status).toBe('WRITTEN_OFF');
        const r = expectOk(
          await f
            .as('opsMaker')
            .post(
              `/lending/loans/${loans.B}/recoveries`,
              { amount: '100' },
              key('rec'),
            ),
        );
        expect(r.recovery.allocations[0]).toEqual({
          component: 'PRINCIPAL',
          amount: '100',
        });
        const { lines } = await journal(loans.B, 'RECOVERY');
        expect(lines).toEqual(['1000:100:0', '4300:0:100']);
        await reconciles();
      });
    });

    describe('UC-66 pawn forfeiture and auction; return on redemption', () => {
      it('after the deadline the item is forfeited under maker-checker and auctioned', async () => {
        const item = (await recovery(loans.C)).pawnItems[0];
        expect(item.forfeitable).toBe(true);
        const sellEarly = await f.as('opsMaker').post(
          `/lending/loans/${loans.C}/pawn-items/${item.id}/sale`,
          { salePrice: '2300', buyer: 'Gold Market', saleDate: '2026-03-15' },
          key('ps'),
        );
        expect(sellEarly.status).toBe(409);
        const task = expectOk(
          await f
            .as('opsMaker')
            .post(
              `/lending/loans/${loans.C}/pawn-items/${item.id}/forfeiture`,
              { reason: 'Not redeemed by the deadline' },
            ),
        );
        expect((await decide('opsMaker', loans.C, task.id)).status).toBe(403);
        expectOk(await decide('opsChecker', loans.C, task.id));
        expect((await recovery(loans.C)).pawnItems[0].status).toBe('FORFEITED');
        const due = owed((await loan(loans.C)).account);
        const sale = expectOk(
          await f.as('opsMaker').post(
            `/lending/loans/${loans.C}/pawn-items/${item.id}/sale`,
            {
              salePrice: '2300',
              costs: '50',
              buyer: 'Gold Market',
              saleDate: '2026-03-15',
            },
            key('ps2'),
          ),
        );
        expect(sale.proceeds.netProceeds).toBe('2250');
        expect(D(sale.proceeds.deficiencyTotal).eq(due.minus(2250))).toBe(true);
        expect((await recovery(loans.C)).pawnItems[0].status).toBe('SOLD');
        expect((await loan(loans.C)).account.status).toBe('ACTIVE');
      });

      it('a redeemed item is returned once the loan is closed', async () => {
        const item = (await recovery(loans.D)).pawnItems[0];
        const early = await f
          .as('opsMaker')
          .post(`/lending/loans/${loans.D}/pawn-items/${item.id}/return`, {
            reference: 'RET-1',
          });
        expect([403, 409]).toContain(early.status);
        const q = expectOk(
          await f.as('opsMaker').get(`/lending/loans/${loans.D}/settlement-quote`),
        );
        expectOk(
          await f
            .as('opsMaker')
            .post(
              `/lending/loans/${loans.D}/settlement`,
              { amount: q.payable },
              key('settleD'),
            ),
        );
        const r = expectOk(
          await f
            .as('opsMaker')
            .post(`/lending/loans/${loans.D}/pawn-items/${item.id}/return`, {
              reference: 'RET-1',
            }),
        );
        expect(r.status).toBe('RETURNED');
        expect(r.returnedOn).toBe('2026-03-15');
      });
    });

    describe('UC-68 credit insurance claim', () => {
      it('a death claim approved by a second user pays the loan off from the insurer and closes it', async () => {
        const policy = (await recovery(loans.E)).insurancePolicies[0];
        const claim = expectOk(
          await f
            .as('opsMaker')
            .post(
              `/lending/loans/${loans.E}/insurance-policies/${policy.id}/claims`,
              {
                eventType: 'DEATH',
                eventDate: '2026-03-10',
                evidenceReference: 'Death certificate DC-2026-118',
              },
            ),
        );
        expect((await decide('opsMaker', loans.E, claim.taskId)).status).toBe(
          403,
        );
        const due = owed((await loan(loans.E)).account);
        const res = expectOk(await decide('opsChecker', loans.E, claim.taskId));
        expect(res.proceeds.settlesLoan).toBe(true);
        expect(D(res.proceeds.grossProceeds).gte(due)).toBe(true);
        expect(res.proceeds.surplus).toBe('0');
        expect((await loan(loans.E)).account.status).toBe('CLOSED');
        const { lines } = await journal(loans.E, 'INSURANCE_CLAIM_SETTLEMENT');
        expect(lines).toContain(`1410:${res.proceeds.grossProceeds}:0`);
        // The insurer pays: the receivable is cleared against cash.
        const settled = (await recovery(loans.E)).insurancePolicies[0]
          .claims[0];
        expect(settled.status).toBe('SETTLED');
        expectOk(
          await f.as('opsMaker').post(
            `/lending/loans/${loans.E}/insurance-claims/${settled.id}/receipts`,
            {
              amount: settled.amountClaimed,
              externalReference: 'FORTE-PAY-1',
            },
            key('cr'),
          ),
        );
        const receipt = await journal(loans.E, 'INSURANCE_CLAIM_RECEIPT');
        expect(receipt.lines).toEqual([
          `1000:${settled.amountClaimed}:0`,
          `1410:0:${settled.amountClaimed}`,
        ]);
      });

      it('a claim larger than the balance leaves the excess to the estate', async () => {
        const policy = (await recovery(loans.F)).insurancePolicies[0];
        const claim = expectOk(
          await f
            .as('opsMaker')
            .post(
              `/lending/loans/${loans.F}/insurance-policies/${policy.id}/claims`,
              {
                eventType: 'DEATH',
                eventDate: '2026-03-12',
                evidenceReference: 'Death certificate DC-2026-120',
                amountClaimed: '4000',
              },
            ),
        );
        // Disability is not covered by this death-only policy.
        const due = owed((await loan(loans.F)).account);
        const res = expectOk(await decide('opsChecker', loans.F, claim.taskId));
        expect(D(res.proceeds.surplus).eq(D(4000).minus(due))).toBe(true);
        expect(res.refund.payee).toBe('Estate of the borrower');
        expect((await loan(loans.F)).account.status).toBe('CLOSED');
        await reconciles();
      });
    });

    describe('UC-71 debt sale', () => {
      it('a delinquent loan is sold under maker-checker; the loss net of allowance is booked and the loan leaves the book', async () => {
        const sale = expectOk(
          await f.as('opsMaker').post(`/lending/loans/${loans.G}/debt-sales`, {
            buyer: 'Mekong Collections Ltd',
            price: '1000',
            saleDate: '2026-03-15',
            reason: 'Portfolio clean-up',
          }),
        );
        expect(D(sale.preview.loss).gt(0)).toBe(true);
        expect((await decide('opsMaker', loans.G, sale.taskId)).status).toBe(
          403,
        );
        const res = expectOk(await decide('opsChecker', loans.G, sale.taskId));
        const l = await loan(loans.G);
        expect(l.account.status).toBe('SOLD');
        expect(l.account.principalOutstanding).toBe('0');
        const { lines } = await journal(loans.G, 'DEBT_SALE');
        expect(lines).toContain('1000:1000:0');
        expect(lines).toContain(`5400:${res.sale.loss}:0`);
        // No further servicing.
        const pay = await f
          .as('opsMaker')
          .post(
            `/lending/loans/${loans.G}/repayments`,
            { amount: '10.00' },
            key('afterSale'),
          );
        expect([400, 403, 409]).toContain(pay.status);
        const again = await f
          .as('opsMaker')
          .post(`/lending/loans/${loans.G}/debt-sales`, {
            buyer: 'Another agency',
            price: '10',
            saleDate: '2026-03-15',
            reason: 'Again',
          });
        expect([403, 409]).toContain(again.status);
      });

      it('a written-off loan sells at a gain (it is carried at nothing)', async () => {
        const wo = expectOk(
          await f.as('opsMaker').post(`/lending/loans/${loans.H}/write-offs`, {
            reason: 'Unrecoverable',
          }),
        );
        expectOk(
          await f
            .as('opsChecker')
            .post(
              `/lending/loans/${loans.H}/write-offs/${wo.id}/decision`,
              { approve: true },
              key('woH'),
            ),
        );
        const sale = expectOk(
          await f.as('opsMaker').post(`/lending/loans/${loans.H}/debt-sales`, {
            buyer: 'Mekong Collections Ltd',
            price: '300',
            saleDate: '2026-03-15',
            reason: 'Sale of written-off book',
          }),
        );
        expectOk(await decide('opsChecker', loans.H, sale.taskId));
        const { lines } = await journal(loans.H, 'DEBT_SALE');
        expect(lines).toEqual(['1000:300:0', '4400:0:300']);
        expect((await loan(loans.H)).account.status).toBe('SOLD');
      });
    });

    it('the recovery desk lists open work across loans', async () => {
      const desk = expectOk(await f.as('opsMaker').get('/lending/recovery'));
      expect(Array.isArray(desk.refunds)).toBe(true);
      // The estate's refund on loan F is still payable.
      expect(desk.refunds.some((r: any) => r.loanAccountId === loans.F)).toBe(
        true,
      );
    });

    it('the whole book reconciles and every journal balances', async () => {
      await reconciles();
    });

    it('records recovery decisions in the audit trail', async () => {
      const audit = expectOk(
        await f
          .as('admin1')
          .get(
            `/lending/ops/audit?action=loan.repossession&resourceId=${loans.A}`,
          ),
      );
      expect(audit.data.length).toBeGreaterThanOrEqual(3);
    });
  });
});
