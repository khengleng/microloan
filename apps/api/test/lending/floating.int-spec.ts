/* eslint-disable @typescript-eslint/no-unsafe-call -- integration fixtures: modules are required after the test environment is configured, and fixture rows come from the untyped Prisma client. */
/**
 * Contractual floating-rate resets (Phase 2): booking a floating loan,
 * re-pricing it on its reset cycle, catching up missed resets, and the
 * audit trail that records what it was priced off.
 *
 * Evidence for: pricing.floating_rate
 */
import {
  Fixture,
  TEST_DB,
  bootstrap,
  borrower,
  expectOk,
  grant,
} from './harness';
import { activeProduct, docs, standardRoles } from './setup';
import { lending } from '@microloan/shared';

const d = TEST_DB ? describe : describe.skip;

d('Floating-rate resets (integration)', () => {
  let f: Fixture;
  let productId: string;

  beforeAll(async () => {
    f = await bootstrap();
    await standardRoles(f);
    await setBusinessDate('2026-01-05');
    await observe('2026-01-01', '0.05');
    await enableFlag('lending.pricing.floating_rate');
    // A quarterly line at NBC_BASE + 4%, floored at 7% and capped at 13%.
    ({ productId } = await activeProduct(
      f,
      'PERSONAL_INSTALMENT',
      'FL-STD',
      (c: any) => {
        c.attributes.rateType = 'FLOATING';
        c.pricing.fixed = null;
        c.pricing.floating = {
          benchmarkCode: 'NBC_BASE',
          margin: '0.04',
          resetFrequency: 'QUARTERLY',
          floor: '0.07',
          cap: '0.13',
        };
        c.limits.maxAmount = '50000';
        c.limits.maxInstalments = 24;
      },
    ));
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

  /** Two-administrator flag change, as the access model requires. */
  async function enableFlag(flagKey: string) {
    const r = expectOk(
      await f.as('admin1').post('/lending/access/flags/rules', {
        flagKey,
        scopeType: 'TENANT',
        enabled: true,
        reason: 'floating-rate integration tests',
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

  /** Record a benchmark observation. */
  async function observe(observationDate: string, rate: string) {
    return expectOk(
      await f.as('finance').post('/lending/ops/rates', {
        benchmarkCode: 'NBC_BASE',
        observationDate,
        rate,
        source: 'Central bank publication',
      }),
    );
  }

  /** Application → approval → booking → disbursement for the floating product. */
  async function bookAndDisburse(terms: Record<string, unknown>) {
    const b = await borrower(f, f.t1, f.b1, { monthlyIncome: '20000' });
    const app = expectOk(
      await f
        .as('ro')
        .post('/lending/applications', { borrowerId: b.id, productId, terms }),
    );
    await docs(f, app.id, ['ID_DOCUMENT']);
    expectOk(await f.as('ro').post(`/lending/applications/${app.id}/submit`));
    expectOk(
      await f.as('analyst').post(`/lending/applications/${app.id}/recommend`, {
        recommendation: 'APPROVE',
        rationale: 'Within policy',
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
    const loanId = booked.account.id as string;
    const appView = expectOk(
      await f.as('opsMaker').get(`/lending/applications/${app.id}`),
    );
    for (const cp of appView.conditions) {
      expectOk(
        await f
          .as('opsMaker')
          .post(`/lending/applications/${app.id}/conditions/${cp.code}`, {
            resolution: 'SATISFIED',
            evidence: `Evidence for ${cp.code}`,
          }),
      );
    }
    const task = expectOk(
      await f.as('opsMaker').post(`/lending/loans/${loanId}/disbursements`, {}),
    );
    expectOk(
      await f
        .as('opsChecker')
        .post(`/lending/loans/${loanId}/disbursements/${task.id}/decision`, {
          approve: true,
        }),
    );
    expectOk(
      await f
        .as('opsChecker')
        .post(
          `/lending/loans/${loanId}/disbursements/execute`,
          { externalReference: `BANK-${loanId.slice(0, 8)}` },
          `floating-${loanId.slice(0, 12)}`,
        ),
    );
    return loanId;
  }

  const loan = (id: string) => f.as('opsMaker').get(`/lending/loans/${id}`);
  const resets = (id: string) =>
    f.as('opsMaker').get(`/lending/loans/${id}/rate-resets`);

  describe('booking', () => {
    let loanId: string;

    beforeAll(async () => {
      loanId = await bookAndDisburse({
        principal: '12000',
        numberOfInstalments: 12,
        disbursementDate: '2026-01-05',
      });
    }, 60_000);

    it('books a floating product, which Phase 1 refused outright', async () => {
      const l = expectOk(await loan(loanId));
      expect(l.account.status).toBe('ACTIVE');
      expect(l.schedule.filter((x: any) => x.status === 'DUE')).toHaveLength(
        12,
      );
    });

    it('prices at benchmark plus margin on the booking date', async () => {
      const l = expectOk(await loan(loanId));
      // 5% + 4% = 9%, inside the 7–13% band.
      expect(l.schedule[0].annualRate).toBe('0.09');
    });

    it('marks instalments after the first reset as projected, not contractual', async () => {
      const l = expectOk(await loan(loanId));
      const due = l.schedule.filter((x: any) => x.status === 'DUE');
      expect(due[0].projected).toBe(false);
      // The first reset falls on 2026-04-05, so later lines are projections.
      expect(due[due.length - 1].projected).toBe(true);
    });

    it('publishes the reset cycle before any reset has happened', async () => {
      const r = expectOk(await resets(loanId));
      expect(r.floating).toBe(true);
      expect(r.schedule).toEqual(['2026-04-05', '2026-07-05', '2026-10-05']);
      expect(r.resets).toEqual([]);
      expect(r.due).toEqual([]);
    });
  });

  describe('applying a reset', () => {
    let loanId: string;

    beforeAll(async () => {
      loanId = await bookAndDisburse({
        principal: '12000',
        numberOfInstalments: 12,
        disbursementDate: '2026-01-05',
      });
    }, 60_000);

    it('reports a reset as due once its date passes', async () => {
      await setBusinessDate('2026-04-06');
      const r = expectOk(await resets(loanId));
      expect(r.due).toEqual(['2026-04-05']);
    });

    it('re-prices the unpaid tail at the new benchmark', async () => {
      await observe('2026-04-01', '0.07'); // 7% + 4% = 11%
      const applied = expectOk(
        await f.as('opsMaker').post(`/lending/loans/${loanId}/rate-resets`),
      );
      expect(applied.applied).toHaveLength(1);
      const reset = applied.applied[0];
      expect(reset.resetDate).toBe('2026-04-05');
      expect(reset.previousAnnualRate).toBe('0.09');
      expect(reset.newAnnualRate).toBe('0.11');
      expect(reset.bound).toBe('BENCHMARK');
      expect(reset.observedRate).toBe('0.07');
      expect(reset.indicatedRate).toBe('0.11');
    });

    it('leaves instalments before the reset untouched and re-prices the rest', async () => {
      const l = expectOk(await loan(loanId));
      const due = l.schedule.filter((x: any) => x.status === 'DUE');
      const before = due.filter((x: any) => x.periodStart < '2026-04-05');
      const after = due.filter((x: any) => x.periodStart >= '2026-04-05');
      expect(before.every((x: any) => x.annualRate === '0.09')).toBe(true);
      expect(after.length).toBeGreaterThan(0);
      expect(after.every((x: any) => x.annualRate === '0.11')).toBe(true);
    });

    it('records the reset as a new agreement version, keeping the old schedule', async () => {
      const l = expectOk(await loan(loanId));
      const versions = l.agreementVersions.map((v: any) => v.reason);
      expect(versions).toContain('RATE_RESET');
      // The superseded lines survive; nothing was overwritten.
      const superseded = l.schedule.filter(
        (x: any) => x.status === 'SUPERSEDED',
      );
      expect(superseded.length).toBeGreaterThan(0);
    });

    it('applies a reset date exactly once, however often it is run', async () => {
      const again = expectOk(
        await f.as('opsMaker').post(`/lending/loans/${loanId}/rate-resets`),
      );
      expect(again.applied).toEqual([]);
      const r = expectOk(await resets(loanId));
      expect(r.resets).toHaveLength(1);
      expect(r.due).toEqual([]);
    });

    it('still reconciles to the general ledger after re-pricing', async () => {
      const rec = expectOk(
        await f.as('finance').get('/lending/ops/reconciliation'),
      );
      expect(rec.breaks).toEqual([]);
      expect(rec.trialBalanceBalanced).toBe(true);
    });

    it('records what the reset priced off in the audit trail', async () => {
      const audit = expectOk(
        await f
          .as('admin1')
          .get(
            `/lending/ops/audit?action=loan.rate_reset.apply&resourceId=${loanId}`,
          ),
      );
      expect(audit.data.length).toBeGreaterThan(0);
      expect(audit.data[0].details.benchmark).toMatch(
        /NBC_BASE 2026-04-01 \(0.07\) \+ 0.04/,
      );
    });
  });

  describe('floor, cap and catch-up', () => {
    let loanId: string;

    beforeAll(async () => {
      loanId = await bookAndDisburse({
        principal: '12000',
        numberOfInstalments: 24,
        disbursementDate: '2026-04-06',
      });
    }, 60_000);

    it('holds the rate at the floor when the benchmark falls below it', async () => {
      await setBusinessDate('2026-07-07');
      await observe('2026-07-01', '0.01'); // 1% + 4% = 5%, under the 7% floor
      const applied = expectOk(
        await f.as('opsMaker').post(`/lending/loans/${loanId}/rate-resets`),
      );
      const reset = applied.applied[0];
      expect(reset.bound).toBe('FLOOR');
      expect(reset.indicatedRate).toBe('0.05'); // what the benchmark gave
      expect(reset.newAnnualRate).toBe('0.07'); // what the contract charges
    });

    it('holds the rate at the cap when the benchmark rises above it', async () => {
      await setBusinessDate('2026-10-07');
      await observe('2026-10-01', '0.20'); // 20% + 4% = 24%, over the 13% cap
      const applied = expectOk(
        await f.as('opsMaker').post(`/lending/loans/${loanId}/rate-resets`),
      );
      const reset = applied.applied[0];
      expect(reset.bound).toBe('CAP');
      expect(reset.indicatedRate).toBe('0.24');
      expect(reset.newAnnualRate).toBe('0.13');
    });

    it('catches missed resets up oldest first, each at the rate that applied then', async () => {
      // Skip two cycles without running anything, then catch up.
      await observe('2027-01-01', '0.03'); // → 7% (floor)
      await observe('2027-04-01', '0.06'); // → 10%
      await setBusinessDate('2027-04-30');
      const before = expectOk(await resets(loanId));
      expect(before.due).toEqual(['2027-01-06', '2027-04-06']);

      const applied = expectOk(
        await f.as('opsMaker').post(`/lending/loans/${loanId}/rate-resets`),
      );
      expect(applied.applied.map((r: any) => r.resetDate)).toEqual([
        '2027-01-06',
        '2027-04-06',
      ]);
      // Each priced off its own observation, not off today's benchmark.
      expect(applied.applied[0].newAnnualRate).toBe('0.07');
      expect(applied.applied[1].newAnnualRate).toBe('0.1');
    });

    it('refuses to book against a benchmark that has never been observed', async () => {
      // Pricing off an absent benchmark would invent a rate the contract
      // never agreed to, so origination stops rather than guessing.
      const { productId: unobserved } = await activeProduct(
        f,
        'PERSONAL_INSTALMENT',
        'FL-UNOBS',
        (c: any) => {
          c.attributes.rateType = 'FLOATING';
          c.pricing.fixed = null;
          c.pricing.floating = {
            benchmarkCode: 'NEVER_SEEN',
            margin: '0.04',
            resetFrequency: 'QUARTERLY',
            floor: null,
            cap: null,
          };
        },
      );
      const b = await borrower(f, f.t1, f.b1, { monthlyIncome: '20000' });
      // Capturing the application is fine — nothing is priced yet.
      const app = expectOk(
        await f.as('ro').post('/lending/applications', {
          borrowerId: b.id,
          productId: unobserved,
          terms: {
            principal: '3000',
            numberOfInstalments: 12,
            disbursementDate: '2027-04-30',
          },
        }),
      );
      await docs(f, app.id, ['ID_DOCUMENT']);
      // Submitting assesses affordability, which has to price the loan.
      const res = await f
        .as('ro')
        .post(`/lending/applications/${app.id}/submit`);
      expect(res.status).toBe(400);
      expect(JSON.stringify(res.body)).toMatch(/NEVER_SEEN/);
    });
  });

  describe('governance', () => {
    let loanId: string;

    beforeAll(async () => {
      loanId = await bookAndDisburse({
        principal: '6000',
        numberOfInstalments: 12,
        disbursementDate: '2027-07-07',
      });
    }, 60_000);

    it('refuses re-pricing to a user without the permission', async () => {
      expect(
        (await f.as('nobody').post(`/lending/loans/${loanId}/rate-resets`))
          .status,
      ).toBe(403);
    });

    it('is invisible to another tenant', async () => {
      await grant(f, f.t2, 't2ops', 'LOAN_OPS_MAKER');
      const res = await f
        .as('t2ops')
        .get(`/lending/loans/${loanId}/rate-resets`);
      expect([403, 404]).toContain(res.status);
    });

    it('reports a fixed-rate loan as not floating rather than failing', async () => {
      const { productId: fixedProduct } = await activeProduct(
        f,
        'PERSONAL_INSTALMENT',
        'FX-STD',
      );
      const b = await borrower(f, f.t1, f.b1, { monthlyIncome: '20000' });
      const app = expectOk(
        await f.as('ro').post('/lending/applications', {
          borrowerId: b.id,
          productId: fixedProduct,
          terms: {
            principal: '3000',
            numberOfInstalments: 12,
            disbursementDate: '2027-07-07',
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
            rationale: 'Within policy',
          }),
      );
      expectOk(
        await f.as('approver').post(`/lending/applications/${app.id}/approve`, {
          rationale: 'Within policy',
        }),
      );
      const booked = expectOk(
        await f.as('opsMaker').post(`/lending/applications/${app.id}/book`, {}),
      );
      const r = expectOk(await resets(booked.account.id));
      expect(r.floating).toBe(false);
      expect(r.resets).toEqual([]);
    });
  });
});
