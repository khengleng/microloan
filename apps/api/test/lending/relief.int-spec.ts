/* eslint-disable @typescript-eslint/no-unsafe-call -- integration fixtures: modules are required after the test environment is configured, and fixture rows come from the untyped Prisma client. */
/**
 * Payment-holiday programmes and refinancing (Phase 2).
 *
 * Evidence for: servicing.payment_holiday, servicing.refinance
 */
import {
  Fixture,
  TEST_DB,
  borrower,
  bootstrap,
  expectOk,
  grant,
} from './harness';
import {
  activeProduct,
  docs,
  originateAndDisburse,
  standardRoles,
} from './setup';
import { lending } from '@microloan/shared';

const d = TEST_DB ? describe : describe.skip;

d('Relief and refinancing (integration)', () => {
  let f: Fixture;

  beforeAll(async () => {
    f = await bootstrap();
    await standardRoles(f);
    await grant(f, f.t1, 'approver2', 'RESTRUCTURE_COMMITTEE');
    await grant(f, f.t1, 'opsMaker', 'COLLECTIONS_OFFICER');
    await setBusinessDate('2026-01-05');
  }, 60_000);
  afterAll(async () => f?.app.close());

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
    return current;
  }

  const loan = (id: string) => f.as('opsMaker').get(`/lending/loans/${id}`);

  // ── Payment holidays ──────────────────────────────────────────────────────

  describe('payment-holiday programmes', () => {
    let programmeId: string;
    let loanId: string;

    beforeAll(async () => {
      const { productId } = await activeProduct(
        f,
        'PERSONAL_INSTALMENT',
        'PH-STD',
      );
      const r = await originateAndDisburse(f, productId, {
        principal: '6000',
        numberOfInstalments: 12,
        disbursementDate: '2026-01-05',
      });
      loanId = r.loanId;
      const programme = expectOk(
        await f
          .as('approver2')
          .post('/lending/ops/payment-holiday-programmes', {
            code: 'FLOOD_2026',
            name: 'Flood relief 2026',
            maxInstalments: 3,
            interestTreatment: 'DEFER_NO_CAPITALIZATION',
            termTreatment: 'EXTEND_TERM',
            opensOn: '2026-01-01',
            closesOn: '2026-12-31',
            minInstalmentsPaid: 0,
            maxDaysPastDue: 30,
            minInstalmentsRemaining: 2,
            maxHolidaysPerLoan: 1,
          }),
      );
      programmeId = programme.id;
    }, 60_000);

    it('starts as a draft that grants nothing', async () => {
      const list = expectOk(
        await f.as('approver2').get('/lending/ops/payment-holiday-programmes'),
      );
      expect(list.find((p: any) => p.id === programmeId).status).toBe('DRAFT');
      const r = await f
        .as('opsMaker')
        .post(`/lending/loans/${loanId}/payment-holidays/${programmeId}`, {
          instalments: 2,
        });
      expect(r.status).toBe(409);
      expect(r.body.message).toMatch(
        /is draft; it is not accepting enrolments/,
      );
    });

    it('cannot be opened by the person who drafted it', async () => {
      const r = await f
        .as('approver2')
        .post(`/lending/ops/payment-holiday-programmes/${programmeId}/status`, {
          status: 'OPEN',
        });
      expect(r.status).toBe(403);
    });

    it('opens when a second person publishes it', async () => {
      expectOk(
        await f
          .as('admin1')
          .post(
            `/lending/ops/payment-holiday-programmes/${programmeId}/status`,
            {
              status: 'OPEN',
            },
          ),
      );
      const list = expectOk(
        await f.as('approver2').get('/lending/ops/payment-holiday-programmes'),
      );
      expect(list.find((p: any) => p.id === programmeId).status).toBe('OPEN');
    });

    it('reports eligibility from recorded state, not judgement', async () => {
      const e = expectOk(
        await f
          .as('opsMaker')
          .get(
            `/lending/loans/${loanId}/payment-holidays/${programmeId}/eligibility`,
          ),
      );
      expect(e.eligible).toBe(true);
      expect(e.maxInstalments).toBe(3);
      expect(e.candidate.instalmentsRemaining).toBe(12);
    });

    it('grants a holiday and extends the term by it', async () => {
      const before = expectOk(await loan(loanId));
      const dueBefore = before.schedule.filter(
        (l: any) => l.status === 'DUE',
      ).length;

      const r = expectOk(
        await f
          .as('opsMaker')
          .post(`/lending/loans/${loanId}/payment-holidays/${programmeId}`, {
            instalments: 3,
          }),
      );
      expect(r.enrolment.instalments).toBe(3);
      expect(r.enrolment.termTreatment).toBe('EXTEND_TERM');

      const after = expectOk(await loan(loanId));
      const due = after.schedule.filter((l: any) => l.status === 'DUE');
      // Three deferred instalments added to the end of the term.
      expect(due.length).toBe(dueBefore + 3);
      // The first three pay nothing at all.
      expect(
        due
          .slice(0, 3)
          .every((l: any) => Number(l.totalDue ?? l.principalDue) === 0),
      ).toBe(true);
    });

    it('says plainly that the holiday is not free', async () => {
      const history = expectOk(
        await f.as('opsMaker').get(`/lending/loans/${loanId}/payment-holidays`),
      );
      expect(history).toHaveLength(1);
      expect(history[0].interestTreatment).toBe('DEFER_NO_CAPITALIZATION');
      expect(Number(history[0].deferredInterest)).toBeGreaterThan(0);
    });

    it('records the holiday as its own agreement version', async () => {
      const l = expectOk(await loan(loanId));
      expect(l.agreementVersions.map((v: any) => v.reason)).toContain(
        'PAYMENT_HOLIDAY',
      );
    });

    it('refuses a second holiday beyond the per-loan limit', async () => {
      const r = await f
        .as('opsMaker')
        .post(`/lending/loans/${loanId}/payment-holidays/${programmeId}`, {
          instalments: 1,
        });
      expect(r.status).toBe(400);
      expect(r.body.code).toBe('HOLIDAY_NOT_ELIGIBLE');
      expect(JSON.stringify(r.body.reasons)).toMatch(/IN_PROGRESS|LIMIT/);
    });

    it('refuses a holiday longer than the programme grants', async () => {
      const { productId } = await activeProduct(
        f,
        'PERSONAL_INSTALMENT',
        'PH-OTHER',
      );
      const other = await originateAndDisburse(f, productId, {
        principal: '6000',
        numberOfInstalments: 12,
        disbursementDate: '2026-01-05',
      });
      const r = await f
        .as('opsMaker')
        .post(
          `/lending/loans/${other.loanId}/payment-holidays/${programmeId}`,
          {
            instalments: 9,
          },
        );
      expect(r.status).toBe(400);
      expect(r.body.message).toMatch(/qualifies for at most 3/);
    });

    it('reconciles after the deferral', async () => {
      const rec = expectOk(
        await f.as('finance').get('/lending/ops/reconciliation'),
      );
      expect(rec.breaks).toEqual([]);
      expect(rec.trialBalanceBalanced).toBe(true);
    });
  });

  // ── Refinancing ───────────────────────────────────────────────────────────

  describe('refinancing', () => {
    /** A product that refinances, but will not bury arrears. */
    const strict = (code: string) =>
      activeProduct(f, 'PERSONAL_INSTALMENT', code, (c: any) => {
        c.restructuring.allowRefinance = true;
        c.restructuring.refinanceMinInstalmentsPaid = 0;
        c.limits.maxAmount = '50000';
      });

    /** Originate, approve, book and disburse an application that refinances a loan. */
    async function refinanceInto(
      productId: string,
      borrowerId: string,
      previousLoanId: string,
      principal: string,
      tag: string,
    ) {
      const app = expectOk(
        await f.as('ro').post('/lending/applications', {
          borrowerId,
          productId,
          refinancesLoanId: previousLoanId,
          terms: {
            principal,
            numberOfInstalments: 12,
            disbursementDate: '2026-01-05',
          },
        }),
      );
      await docs(f, app.id, ['ID_DOCUMENT']);
      expectOk(await f.as('ro').post(`/lending/applications/${app.id}/submit`));
      expectOk(
        await f
          .as('analyst')
          .post(`/lending/applications/${app.id}/recommend`, {
            recommendation: 'APPROVE',
            rationale: 'Refinance within policy',
          }),
      );
      expectOk(
        await f.as('approver').post(`/lending/applications/${app.id}/approve`, {
          rationale: 'Approved',
        }),
      );
      const booked = expectOk(
        await f.as('opsMaker').post(`/lending/applications/${app.id}/book`, {}),
      );
      const newLoanId = booked.account.id as string;
      const appView = expectOk(
        await f.as('opsMaker').get(`/lending/applications/${app.id}`),
      );
      for (const cp of appView.conditions) {
        expectOk(
          await f
            .as('opsMaker')
            .post(`/lending/applications/${app.id}/conditions/${cp.code}`, {
              resolution: 'SATISFIED',
              evidence: 'Signed',
            }),
        );
      }
      const task = expectOk(
        await f
          .as('opsMaker')
          .post(`/lending/loans/${newLoanId}/disbursements`, {}),
      );
      expectOk(
        await f
          .as('opsChecker')
          .post(
            `/lending/loans/${newLoanId}/disbursements/${task.id}/decision`,
            {
              approve: true,
            },
          ),
      );
      const disbursed = await f
        .as('opsChecker')
        .post(
          `/lending/loans/${newLoanId}/disbursements/execute`,
          { externalReference: `BANK-${tag}` },
          `refinance-${tag}`,
        );
      return { newLoanId, disbursed, applicationId: app.id as string };
    }

    it('refuses an application to refinance on a product that does not allow it', async () => {
      const { productId } = await activeProduct(
        f,
        'PERSONAL_INSTALMENT',
        'RF-OFF',
      );
      const existing = await originateAndDisburse(f, productId, {
        principal: '3000',
        numberOfInstalments: 12,
        disbursementDate: '2026-01-05',
      });
      const r = await f.as('ro').post('/lending/applications', {
        borrowerId: existing.borrowerId,
        productId,
        refinancesLoanId: existing.loanId,
        terms: {
          principal: '4000',
          numberOfInstalments: 12,
          disbursementDate: '2026-01-05',
        },
      });
      expect(r.status).toBe(400);
      expect(r.body.message).toMatch(/does not permit refinancing/);
    });

    it('refuses refinancing another borrower loan', async () => {
      const { productId } = await strict('RF-STRICT');
      const existing = await originateAndDisburse(f, productId, {
        principal: '3000',
        numberOfInstalments: 12,
        disbursementDate: '2026-01-05',
      });
      const stranger = await borrower(f, f.t1, f.b1, { monthlyIncome: '5000' });
      const r = await f.as('ro').post('/lending/applications', {
        borrowerId: stranger.id,
        productId,
        refinancesLoanId: existing.loanId,
        terms: {
          principal: '4000',
          numberOfInstalments: 12,
          disbursementDate: '2026-01-05',
        },
      });
      expect(r.status).toBe(400);
      expect(r.body.message).toMatch(/same borrower/);
    });

    it('settles the old loan from the new one, in one transaction', async () => {
      const { productId } = await strict('RF-OK');
      const existing = await originateAndDisburse(f, productId, {
        principal: '3000',
        numberOfInstalments: 12,
        disbursementDate: '2026-01-05',
      });
      const { newLoanId, disbursed } = await refinanceInto(
        productId,
        existing.borrowerId,
        existing.loanId,
        '5000',
        'ok',
      );
      expectOk(disbursed);

      const old = expectOk(await loan(existing.loanId));
      expect(old.account.status).toBe('CLOSED');
      expect(old.account.principalOutstanding).toBe('0');
      // The settlement on the old loan and the disbursement of the new one
      // are in the same request, so neither can exist without the other.
      expect(old.events.some((e: any) => e.type === 'SETTLEMENT')).toBe(true);

      const fresh = expectOk(await loan(newLoanId));
      expect(fresh.account.status).toBe('ACTIVE');
      expect(fresh.account.principalOutstanding).toBe('5000');
    });

    it('reconciles across both loans after the refinance', async () => {
      const rec = expectOk(
        await f.as('finance').get('/lending/ops/reconciliation'),
      );
      expect(rec.breaks).toEqual([]);
      expect(rec.trialBalanceBalanced).toBe(true);
    });

    it('refuses a new loan too small to settle the old one', async () => {
      const { productId } = await strict('RF-SHORT');
      const existing = await originateAndDisburse(f, productId, {
        principal: '10000',
        numberOfInstalments: 12,
        disbursementDate: '2026-01-05',
      });
      const { disbursed } = await refinanceInto(
        productId,
        existing.borrowerId,
        existing.loanId,
        '2000',
        'short',
      );
      expect(disbursed.status).toBe(400);
      expect(JSON.stringify(disbursed.body)).toMatch(/short of the|REFINANCE/);
      // Nothing was half-done: the old loan is untouched.
      const old = expectOk(await loan(existing.loanId));
      expect(old.account.status).toBe('ACTIVE');
    });

    it('records what the refinance did, including the evergreening verdict', async () => {
      const audit = expectOk(
        await f
          .as('admin1')
          .get('/lending/ops/audit?action=loan.refinance.execute'),
      );
      expect(audit.data.length).toBeGreaterThan(0);
      const details = audit.data[0].details;
      expect(details).toHaveProperty('evergreening');
      expect(details).toHaveProperty('arrearsRolledIn');
      expect(details.evergreening).toBe(false);
    });
  });
});
