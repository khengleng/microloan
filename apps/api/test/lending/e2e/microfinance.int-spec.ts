/* eslint-disable @typescript-eslint/no-unsafe-call -- end-to-end fixtures: API responses are untyped. */
/**
 * Microfinance and agriculture journeys, onboarding to closure
 * (docs/servicing/SCENARIOS.md):
 *
 *  S18 LT-21 solidarity group, weekly: one member misses, the leader covers
 *      part of the share, the member catches up (UC-22, UC-25, UC-57)
 *  S19 LT-21 flat-rate microloan paid off early with a Rule of 78 rebate
 *      (TV-04, TV-12, UC-10, UC-33)
 *  S20 LT-22 seasonal crop loan: the harvest fails, the loan is
 *      restructured onto the next harvests, it cures and is repaid
 *      (UC-13, UC-63, UC-47)
 *  S21 LT-21 individual microloan, fortnightly, separate fee with tax, a
 *      flat late fee and the guarantor paying the arrears (UC-01, UC-20,
 *      UC-55)
 */
import { TEST_DB } from '../harness';
import { Journey, c2, expectOk, key, lending, sum } from './journey';

const d = TEST_DB ? describe : describe.skip;

/** Split an amount into `n` shares to the cent; the first share takes the residue. */
function split(total: number, n: number): number[] {
  const cents = Math.round(total * 100);
  const each = Math.floor(cents / n);
  return [cents - each * (n - 1), ...Array(n - 1).fill(each)].map(
    (x) => x / 100,
  );
}

d(
  'S18 LT-21 solidarity group, weekly: a member misses and the leader covers (UC-22)',
  () => {
    let j: Journey;
    let loanId: string;
    let groupId: string;
    const members: string[] = [];

    beforeAll(async () => {
      j = await Journey.start({ flags: ['lending.group.joint_liability'] });
      const productId = await j.product('MICRO_GROUP', 'GRP-WEEKLY', (c) => {
        c.repayment.frequency = 'WEEKLY';
      });
      groupId = expectOk(
        await j.as('ro').post('/lending/applications/groups', {
          code: 'KRAING-YOV-1',
          name: 'Kraing Yov women traders',
          branchId: j.f.b1,
          formedOn: '2025-06-01',
        }),
      ).id;
      for (let i = 0; i < 5; i++) {
        const b = await j.onboard({
          firstName: `Member${i + 1}`,
          monthlyIncome: 900,
          occupation: 'Market vendor',
        });
        expectOk(
          await j
            .as('ro')
            .post(`/lending/applications/groups/${groupId}/members`, {
              borrowerId: b,
              role: i === 0 ? 'LEADER' : 'MEMBER',
              joinedOn: '2025-06-01',
            }),
        );
        members.push(b);
      }
      expectOk(
        await j
          .as('ro')
          .post(`/lending/applications/groups/${groupId}/status`, {
            status: 'ACTIVE',
          }),
      );
      loanId = (
        await j.originate(
          productId,
          {
            principal: '5000',
            numberOfInstalments: 10,
            disbursementDate: '2026-01-05',
          },
          { borrowerId: members[0], groupId },
        )
      ).loanId;
    }, 120_000);
    afterAll(async () => j?.close());

    const view = async () =>
      expectOk(
        await j.as('opsMaker').get(`/lending/loans/${loanId}/group-members`),
      );
    const contributed = async () =>
      Object.fromEntries(
        (await view()).members.map((m: any) => [
          m.borrowerId,
          Number(m.contributed),
        ]),
      );

    it('binds all five members jointly for the whole 5,000; weekly instalments at 15% ÷ 52', async () => {
      const v = await view();
      expect(v.liability).toBe('GROUP_JOINT');
      expect(
        v.members.every(
          (m: any) => m.shareAmount === '1000' && m.liableFor === '5000',
        ),
      ).toBe(true);
      const l = await j.checkpoint(loanId, {
        status: 'ACTIVE',
        principal: 5000,
      });
      const lines = Journey.due(l);
      expect(lines.map((x: any) => x.dueDate).slice(0, 3)).toEqual([
        '2026-01-12',
        '2026-01-19',
        '2026-01-26',
      ]);
      expect(c2(lines[0].interestDue)).toBe('14.42');
    });

    it('week 1: every member pays their fifth at the group meeting', async () => {
      const l = await j.loan(loanId);
      const line = Journey.due(l)[0];
      await j.moveTo(line.dueDate);
      const owed = Journey.owed(line);
      const shares = split(owed, 5);
      expectOk(
        await j.pay(loanId, owed, {
          payer: {
            name: 'Group leader',
            relationship: 'GROUP_MEMBER',
            reference: 'MEETING-W1',
          },
          contributions: members.map((m, i) => ({
            borrowerId: m,
            amount: shares[i].toFixed(2),
          })),
        }),
      );
      await j.checkpoint(
        loanId,
        { dpd: 0, interest: 0 },
        'loan.repayment.post',
      );
      const paid = await contributed();
      members.forEach((m, i) => expect(c2(paid[m])).toBe(c2(shares[i])));
    });

    it('week 2: member 5 misses; the leader covers half of her share and the instalment is part-paid (UC-25)', async () => {
      const l = await j.loan(loanId);
      const line = Journey.due(l)[1];
      await j.moveTo(line.dueDate);
      const owed = Journey.owed(line);
      const shares = split(owed, 5);
      const halfOfMissing = Math.round((shares[4] / 2) * 100) / 100;
      const before = await contributed();
      const contributions = [
        {
          borrowerId: members[0],
          amount: (shares[0] + halfOfMissing).toFixed(2),
        },
        ...[1, 2, 3].map((i) => ({
          borrowerId: members[i],
          amount: shares[i].toFixed(2),
        })),
      ];
      const paid = sum(contributions.map((c) => c.amount));
      expectOk(await j.pay(loanId, paid, { contributions }));
      await j.moveTo(lending.addDays(line.dueDate, 3));
      const after = await j.checkpoint(loanId, {
        dpd: 3,
        penalty: 0,
        bucket: 'DPD_1_30',
      });
      expect(c2(Journey.owed(Journey.due(after)[1]))).toBe(c2(owed - paid));
      // Joint liability: the leader paid more than her share, the defaulter
      // nothing this week (only her week-1 fifth stands to her name).
      const c = await contributed();
      expect(c2(c[members[0]] - before[members[0]])).toBe(
        c2(shares[0] + halfOfMissing),
      );
      expect(c2(c[members[4]])).toBe(c2(before[members[4]]));
      expect(
        (await view()).members.every((m: any) => m.liableFor === '5000'),
      ).toBe(true);
    });

    it('week 3: member 5 pays what she missed with her share; the arrears and the late interest clear', async () => {
      const l0 = await j.loan(loanId);
      const line = Journey.due(l0)[2];
      await j.moveTo(line.dueDate);
      const l = await j.checkpoint(loanId, { dpd: 7 });
      expect(Number(l.account.penaltyReceivable)).toBeGreaterThan(0);
      const arrears = Journey.arrears(l, line.dueDate);
      const week3 = Journey.owed(Journey.due(l)[2]);
      const shares = split(week3, 5);
      const catchUp = arrears - week3;
      const contributions = [
        ...[0, 1, 2, 3].map((i) => ({
          borrowerId: members[i],
          amount: shares[i].toFixed(2),
        })),
        { borrowerId: members[4], amount: (shares[4] + catchUp).toFixed(2) },
      ];
      expectOk(
        await j.pay(loanId, sum(contributions.map((c) => c.amount)), {
          contributions,
        }),
      );
      await j.moveTo(lending.addDays(line.dueDate, 1));
      await j.checkpoint(loanId, { dpd: 0, penalty: 0, bucket: 'CURRENT' });
    });

    it('the remaining weeks are paid on time; the loan closes and the group may disband', async () => {
      await j.payOnTime(loanId, 4, 10);
      await j.checkpoint(loanId, {
        status: 'CLOSED',
        principal: 0,
        interest: 0,
        penalty: 0,
      });
      const total = sum(Object.values(await contributed()));
      expect(total).toBeGreaterThan(0);
      expectOk(
        await j
          .as('ro')
          .post(`/lending/applications/groups/${groupId}/status`, {
            status: 'DISBANDED',
          }),
      );
    });
  },
);

d(
  'S19 LT-21 flat-rate microloan paid off early with a Rule of 78 rebate (TV-04, TV-12)',
  () => {
    let j: Journey;
    let loanId: string;
    let applicationId: string;

    beforeAll(async () => {
      j = await Journey.start();
      const productId = await j.product(
        'MICRO_INDIVIDUAL',
        'MF-FLAT78',
        (c) => {
          c.pricing.interestMethod = 'FLAT';
          c.pricing.fees = [];
          c.repayment.frequency = 'MONTHLY';
          c.repayment.prepayment.allowed = false;
          c.repayment.earlySettlement.rebateMethod = 'RULE_OF_78';
          c.limits.maxAmount = '10000';
        },
      );
      const r = await j.originate(
        productId,
        {
          principal: '10000',
          numberOfInstalments: 12,
          annualRate: '0.12',
          disbursementDate: '2026-01-05',
        },
        {
          guarantors: 1,
          borrower: { occupation: 'Tailor', monthlyIncome: 3000 },
        },
      );
      loanId = r.loanId;
      applicationId = r.applicationId;
    }, 120_000);
    afterAll(async () => j?.close());

    it('TV-04: 1,200.00 of flat interest; instalments 1–11 of 933.33 and a last of 933.37', async () => {
      const l = await j.checkpoint(loanId, {
        status: 'ACTIVE',
        principal: 10000,
      });
      const lines = Journey.due(l);
      const total = (x: any) =>
        c2(Number(x.principalDue) + Number(x.interestDue));
      expect(lines.slice(0, 11).every((x: any) => total(x) === '933.33')).toBe(
        true,
      );
      expect(total(lines[11])).toBe('933.37');
      expect(c2(sum(lines.map((x: any) => x.interestDue)))).toBe('1200.00');
      const app = await j.application(applicationId);
      expect(app.guarantees).toHaveLength(1);
    });

    it('six instalments are paid on time', async () => {
      await j.payOnTime(loanId, 1, 6);
    });

    it('TV-12: payoff after six instalments rebates 1,200 × 42/156 = 323.08 and closes the loan (UC-33)', async () => {
      const q = await j.quote(loanId);
      expect(q.interestRebate.method).toBe('RULE_OF_78');
      expect(q.interestRebate.rebate).toBe('323.08');
      expect(c2(q.interest)).toBe('276.92');
      expect(c2(q.principal)).toBe('5000.02');
      await j.settle(loanId);
      await j.checkpoint(
        loanId,
        { status: 'CLOSED', principal: 0, interest: 0 },
        'loan.settlement',
      );
    });
  },
);

d(
  'S20 LT-22 seasonal crop loan: failed harvest, restructure, cure (UC-13, UC-63)',
  () => {
    let j: Journey;
    let loanId: string;
    let caseId: string;

    beforeAll(async () => {
      j = await Journey.start();
      const productId = await j.product(
        'AGRI_CROP_SEASONAL',
        'AG-CROP',
        (c) => {
          c.restructuring.probationInstalments = 1;
        },
      );
      loanId = (
        await j.originate(
          productId,
          {
            principal: '2000',
            disbursementDate: '2026-01-05',
            explicitSchedule: [
              { dueDate: '2026-06-14', principal: '800' },
              { dueDate: '2026-11-16', principal: '1200' },
            ],
          },
          { borrower: { occupation: 'Rice farmer', monthlyIncome: 800 } },
        )
      ).loanId;
    }, 120_000);
    afterAll(async () => j?.close());

    it('UC-13: harvest dates on the KH calendar; 14 June (a Sunday) moves to 15 June; interest is daily', async () => {
      const l = await j.checkpoint(loanId, {
        status: 'ACTIVE',
        principal: 2000,
      });
      const lines = Journey.due(l);
      expect(lines.map((x: any) => x.dueDate)).toEqual([
        '2026-06-15',
        '2026-11-16',
      ]);
      // 2,000 × 14% × 160/365.
      expect(c2(lines[0].interestDue)).toBe('122.74');
    });

    it('the June harvest fails: nothing is paid and the loan goes 30 days past due with penalty interest', async () => {
      await j.moveTo('2026-07-15');
      const l = await j.checkpoint(loanId, { dpd: 30, bucket: 'DPD_1_30' });
      expect(Number(l.account.penaltyReceivable)).toBeGreaterThan(0);
    });

    it('UC-63: a restructure moves the principal onto the November and March harvests, waiving the penalties', async () => {
      const l = await j.loan(loanId);
      const c = expectOk(
        await j.as('ro').post(`/lending/restructures/loans/${loanId}`, {
          hardshipCategory: 'DELAYED_HARVEST',
          difficultyType: 'TEMPORARY',
          requestedRelief: { paymentBreakMonths: 4 },
          consentRecorded: true,
          consentReference: 'FORM-AG-2026-01',
          expectedRecoveryDate: '2026-11-30',
        }),
      );
      caseId = c.id;
      expectOk(
        await j.as('analyst').post(`/lending/restructures/${caseId}/evidence`, {
          type: 'INCOME',
          description:
            'Commune chief letter: the June harvest was lost to flooding',
          quality: 'VERIFIED',
          documentRef: 'DOC-FLOOD-2026',
        }),
      );
      const a = expectOk(
        await j
          .as('analyst')
          .post(`/lending/restructures/${caseId}/assessments`, {
            inputs: {
              template: 'INDIVIDUAL',
              verifiedNetIncome: '800',
              essentialLivingExpenses: '300',
              debts: [],
            },
            evidenceQuality: 'VERIFIED',
            assumptions: 'Dry-season crop in November, second crop in March',
            verificationDate: '2026-07-15',
          }),
      );
      expect(a.result.sustainable).toBe(true);
      const p = expectOk(
        await j
          .as('analyst')
          .post(`/lending/restructures/${caseId}/proposals`, {
            options: {
              effectiveDate: '2026-07-15',
              explicitSchedule: [
                { dueDate: '2026-11-16', principal: '1000' },
                { dueDate: '2027-03-15', principal: '1000' },
              ],
              arrearsTreatment: 'SPREAD_OVER_TERM',
              waive: { penalties: l.account.penaltyReceivable },
            },
          }),
      );
      // The committee approves: a waiver needs waiver authority, and the
      // proposal says how many independent approvals it needs.
      let approval: any;
      for (const who of ['approver2', 'approver'].slice(0, p.approvalsRequired))
        approval = expectOk(
          await j
            .as(who)
            .post(`/lending/restructures/${caseId}/proposals/${p.id}/approve`, {
              note: 'Flood is temporary; the November harvest covers the arrears',
            }),
        );
      expect(approval.status).toBe('APPROVED');
      expectOk(
        await j
          .as('ro')
          .post(
            `/lending/restructures/${caseId}/proposals/${p.id}/acceptance`,
            {
              proposalHash: p.proposalHash,
              method: 'SIGNED_FORM',
              evidence: 'Signed amendment AF-AG-01',
            },
          ),
      );
      expectOk(
        await j
          .as('opsChecker')
          .post(`/lending/restructures/${caseId}/execute`, {}, key('exec')),
      );
      const after = await j.checkpoint(loanId, { principal: 2000, penalty: 0 });
      expect(after.account.isRestructured).toBe(true);
      expect(after.agreementVersions.at(-1).reason).toBe('RESTRUCTURE');
      const live = Journey.due(after).filter((x: any) => x.status === 'DUE');
      expect(live.map((x: any) => x.dueDate)).toEqual([
        '2026-11-16',
        '2027-03-15',
      ]);
      // The arrears (June's interest) are spread over the new harvests, not lost.
      expect(c2(sum(live.map((x: any) => x.deferredInterestDue)))).toBe(
        '137.01',
      );
    });

    it('the November harvest pays on time: probation is earned and the loan is current again', async () => {
      await j.moveTo('2026-11-16');
      let l = await j.loan(loanId);
      const nov = Journey.due(l).find(
        (x: any) => x.status === 'DUE' && x.dueDate === '2026-11-16',
      );
      expectOk(await j.pay(loanId, Journey.owed(nov)));
      await j.moveTo('2026-11-17');
      l = await j.checkpoint(loanId, { dpd: 0, principal: 1000 });
      expect(l.account.probationRemaining).toBe(0);
      expect(l.account.delinquencyBucket).toBe('CURRENT');
    });

    it('the March harvest repays the rest and the loan closes', async () => {
      await j.moveTo('2027-03-15');
      const l = await j.loan(loanId);
      const mar = Journey.due(l).find((x: any) => x.status === 'DUE');
      expectOk(await j.pay(loanId, Journey.owed(mar)));
      await j.checkpoint(loanId, {
        status: 'CLOSED',
        principal: 0,
        interest: 0,
        penalty: 0,
      });
    });
  },
);

d(
  'S21 LT-21 individual microloan, fortnightly: separate fee, flat late fee, guarantor pays (UC-20)',
  () => {
    let j: Journey;
    let loanId: string;

    beforeAll(async () => {
      j = await Journey.start();
      const productId = await j.product('MICRO_INDIVIDUAL', 'MF-IND');
      loanId = (
        await j.originate(
          productId,
          {
            principal: '1500',
            numberOfInstalments: 12,
            disbursementDate: '2026-01-05',
          },
          {
            guarantors: 1,
            borrower: { occupation: 'Noodle stall', monthlyIncome: 900 },
          },
        )
      ).loanId;
    }, 120_000);
    afterAll(async () => j?.close());

    it('UC-01: the 5.00 administration fee and 0.50 tax are charged separately, due on the disbursement day', async () => {
      const l = await j.checkpoint(loanId, {
        status: 'ACTIVE',
        principal: 1500,
        fees: '5.50',
      });
      const upfront = l.schedule.find((x: any) => x.number === 0);
      expect([upfront.feeDue, upfront.taxDue, upfront.dueDate]).toEqual([
        '5',
        '0.5',
        '2026-01-05',
      ]);
      const disb = l.events.find((e: any) => e.type === 'DISBURSEMENT');
      // Paid out in full; the fee is a receivable, with its tax payable.
      expect(Journey.journal(l, disb.id)).toEqual([
        '1000:0.00:1500.00',
        '1200:1500.00:0.00',
        '1220:5.50:0.00',
        '2200:0.00:0.50',
        '4200:0.00:5.00',
      ]);
      expect(Journey.due(l)[0].dueDate).toBe('2026-01-19');
    });

    it('the borrower pays the fee at the branch on the day; the first fortnight on 19 January', async () => {
      expectOk(await j.pay(loanId, '5.50'));
      const l = await j.checkpoint(loanId, { fees: 0 }, 'loan.repayment.post');
      expect(l.schedule.find((x: any) => x.number === 0).status).toBe('PAID');
      await j.payOnTime(loanId, 1, 1);
    });

    it('UC-55: the second fortnight is missed; after 2 grace days a flat 2.00 late fee is charged once', async () => {
      await j.moveTo('2026-02-04');
      await j.checkpoint(loanId, { dpd: 2, penalty: 0 });
      await j.moveTo('2026-02-05');
      await j.checkpoint(loanId, { dpd: 3, penalty: 2 });
      await j.moveTo('2026-02-12');
      await j.checkpoint(loanId, { dpd: 10, penalty: 2 });
    });

    it('UC-20: the guarantor pays the arrears and the late fee; the loan is current again', async () => {
      const l = await j.loan(loanId);
      const owed = Journey.arrears(l, '2026-02-12');
      const ev = expectOk(
        await j.pay(loanId, owed, {
          payer: {
            name: 'Chan Sopheap 1',
            relationship: 'GUARANTOR',
            reference: 'GTR-RCPT-01',
          },
        }),
      );
      expect(ev.components.payer.relationship).toBe('GUARANTOR');
      expect(c2(ev.components.penalty)).toBe('2.00');
      await j.moveTo('2026-02-13');
      await j.checkpoint(loanId, { dpd: 0, penalty: 0 });
    });

    it('UC-18: the third fortnight is paid from a mobile wallet through the integration API', async () => {
      const sa = expectOk(
        await j.as('admin2').post('/lending/access/service-accounts', {
          name: 'Wallet settlement feed',
          scopes: ['loan.repayment.post'],
        }),
      );
      const l = await j.loan(loanId);
      const third = Journey.due(l).find((x: any) => x.number === 3);
      await j.moveTo(third.dueDate);
      const res = await j.f
        .http()
        .post(`/v1/lending/integrations/loans/${loanId}/repayments`)
        .set('X-Service-Key', sa.key)
        .set('Idempotency-Key', key('wallet'))
        .send({
          amount: Journey.owed(third).toFixed(2),
          externalReference: 'WING-TXN-88213',
        });
      expect(res.status).toBe(201);
      const after = await j.checkpoint(loanId, { dpd: 0 });
      expect(Journey.due(after).find((x: any) => x.number === 3).status).toBe(
        'PAID',
      );
    });

    it('the borrower pays the remaining fortnights on time and the loan closes', async () => {
      await j.payOnTime(loanId, 4, 12);
      await j.checkpoint(loanId, {
        status: 'CLOSED',
        principal: 0,
        interest: 0,
        fees: 0,
        penalty: 0,
      });
    });
  },
);
