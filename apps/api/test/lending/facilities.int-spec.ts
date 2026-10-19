/* eslint-disable @typescript-eslint/no-unsafe-call -- integration fixtures: modules are required after the test environment is configured, and fixture rows come from the untyped Prisma client. */
/**
 * Facilities (Phase 2): revolving lines, overdrafts and staged drawdowns
 * through configuration, booking, drawdown governance, charges, statements
 * and the general ledger — over the real HTTP API, guards and database.
 *
 * What these tests are evidence for:
 *  • facility.revolving      — a limit that reinstates on repayment
 *  • facility.overdraft      — a debit balance with a minimum payment
 *  • facility.staged_drawdown— tranches gated by date and conditions
 */
import {
  Fixture,
  TEST_DB,
  authority,
  borrower,
  bootstrap,
  expectOk,
  grant,
  raiseRateCap,
} from './harness';
import { activeProduct, docs, standardRoles } from './setup';
import { lending } from '@microloan/shared';

const d = TEST_DB ? describe : describe.skip;

d('Lending facilities (integration)', () => {
  let f: Fixture;

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
    await authority(
      f,
      f.t1,
      'approver',
      'facility.limit.approve',
      'USD',
      '1000000',
    );
    // Facility behaviour is flag-gated and off by default.
    for (const flagKey of [
      'lending.revolving.drawdown',
      'lending.facility.overdraft',
      'lending.facility.staged_drawdown',
    ]) {
      await enableFlag(flagKey);
    }
  }, 60_000);
  afterAll(async () => f?.app.close());

  /**
   * Move the tenant business date to `target`.
   *
   * Products allow no backdating (`maxBackdateDays: 0`), so every value date
   * is the business date, and the suites below share one forward-only
   * timeline. The date advances at most 31 days per step, so a longer jump is
   * walked; a target already reached is a no-op, which keeps the suites
   * independent of each other's ordering.
   */
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
        reason: 'facility integration tests',
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

  /** Application → approval → booking, for a facility product. */
  async function bookFacility(
    productId: string,
    terms: Record<string, unknown>,
    opts: {
      collateral?: Record<string, unknown>;
      borrowerOver?: Record<string, unknown>;
    } = {},
  ) {
    // Business cash flow for the DSR check: these are commercial and property
    // facilities, assessed on the limit amortized over its term-out tenor.
    const b = await borrower(f, f.t1, f.b1, {
      monthlyIncome: '40000',
      ...opts.borrowerOver,
    });
    const app = expectOk(
      await f
        .as('ro')
        .post('/lending/applications', { borrowerId: b.id, productId, terms }),
    );
    await docs(f, app.id, ['ID_DOCUMENT']);
    if (opts.collateral) {
      expectOk(
        await f
          .as('ro')
          .post(`/lending/applications/${app.id}/collateral`, opts.collateral),
      );
    }
    expectOk(await f.as('ro').post(`/lending/applications/${app.id}/submit`));
    expectOk(
      await f.as('analyst').post(`/lending/applications/${app.id}/recommend`, {
        recommendation: 'APPROVE',
        rationale: 'Within policy',
      }),
    );
    expectOk(
      await f.as('approver').post(`/lending/applications/${app.id}/approve`, {
        rationale: 'Approved within authority',
      }),
    );
    const booked = expectOk(
      await f.as('opsMaker').post(`/lending/applications/${app.id}/book`, {}),
    );
    return {
      facilityId: booked.facility.id as string,
      loanId: booked.account.id as string,
      borrowerId: b.id as string,
    };
  }

  /** Request → approve → release, returning the released drawdown. */
  async function drawdown(
    facilityId: string,
    body: Record<string, unknown>,
    tag: string,
  ) {
    const dd = expectOk(
      await f
        .as('opsMaker')
        .post(`/lending/facilities/${facilityId}/drawdowns`, body),
    );
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
          `facility-${tag}`,
        ),
    );
  }

  const facility = (id: string, user = 'opsMaker') =>
    f.as(user).get(`/lending/facilities/${id}`);

  // ── Revolving ─────────────────────────────────────────────────────────────

  describe('revolving credit facility', () => {
    let productId: string;
    let facilityId: string;
    let loanId: string;

    beforeAll(async () => {
      await setBusinessDate('2026-01-05');
      ({ productId } = await activeProduct(f, 'REVOLVING_CREDIT', 'RC-STD'));
      ({ facilityId, loanId } = await bookFacility(productId, {
        principal: '100000',
        numberOfInstalments: 60,
        disbursementDate: '2026-01-05',
        annualRate: '0.12',
      }));
    }, 60_000);

    it('books a facility, not a schedule, with the limit as the exposure', async () => {
      const v = expectOk(await facility(facilityId));
      expect(v.facility.facilityType).toBe('REVOLVING');
      expect(v.facility.limitAmount).toBe('100000');
      expect(v.facility.status).toBe('ACTIVE');
      expect(v.position.available).toBe('100000');
      expect(v.position.outstanding).toBe('0');
      // No instalments exist until it terms out.
      const loan = expectOk(
        await f.as('opsMaker').get(`/lending/loans/${loanId}`),
      );
      expect(loan.schedule).toHaveLength(0);
      expect(loan.account.status).toBe('BOOKED');
    });

    it('releases a drawdown as a disbursement with a balanced journal', async () => {
      await drawdown(facilityId, { amount: '40000' }, 'rc1');
      const v = expectOk(await facility(facilityId));
      expect(v.position.outstanding).toBe('40000');
      expect(v.position.available).toBe('60000');
      expect(v.facility.totalDrawn).toBe('40000');

      const loan = expectOk(
        await f.as('opsMaker').get(`/lending/loans/${loanId}`),
      );
      expect(loan.account.status).toBe('ACTIVE');
      expect(loan.account.principalOutstanding).toBe('40000');
      const disb = loan.events.find((e: any) => e.type === 'DISBURSEMENT');
      const lines = disb.journal.lines
        .map(
          (l: any) => `${l.accountCode}:${Number(l.debit)}:${Number(l.credit)}`,
        )
        .sort();
      expect(lines).toEqual(['1000:0:40000', '1200:40000:0']);
    });

    it('refuses a drawdown that would exceed the available limit', async () => {
      const r = await f
        .as('opsMaker')
        .post(`/lending/facilities/${facilityId}/drawdowns`, {
          amount: '70000',
        });
      expect(r.status).toBe(400);
      expect(r.body.code).toBe('DRAWDOWN_REFUSED');
      expect(JSON.stringify(r.body.issues)).toMatch(/available limit of 60000/);
    });

    it('allows only one drawdown in flight at a time', async () => {
      const first = expectOk(
        await f
          .as('opsMaker')
          .post(`/lending/facilities/${facilityId}/drawdowns`, {
            amount: '1000',
          }),
      );
      const second = await f
        .as('opsMaker')
        .post(`/lending/facilities/${facilityId}/drawdowns`, {
          amount: '1000',
        });
      expect(second.status).toBe(409);
      expectOk(
        await f
          .as('opsMaker')
          .post(
            `/lending/facilities/${facilityId}/drawdowns/${first.id}/cancel`,
          ),
      );
    });

    it('requires a second person to approve a drawdown', async () => {
      const dd = expectOk(
        await f
          .as('opsMaker')
          .post(`/lending/facilities/${facilityId}/drawdowns`, {
            amount: '5000',
          }),
      );
      // The maker cannot approve their own request.
      const self = await f
        .as('opsMaker')
        .post(`/lending/facilities/${facilityId}/drawdowns/${dd.id}/approve`);
      expect(self.status).toBe(403);
      expectOk(
        await f
          .as('opsChecker')
          .post(`/lending/facilities/${facilityId}/drawdowns/${dd.id}/approve`),
      );
      expectOk(
        await f
          .as('opsChecker')
          .post(
            `/lending/facilities/${facilityId}/drawdowns/${dd.id}/release`,
            { externalReference: 'BANK-RC2' },
            'facility-rc2',
          ),
      );
      const v = expectOk(await facility(facilityId));
      expect(v.position.outstanding).toBe('45000');
    });

    it('reinstates the limit when the borrower repays', async () => {
      await setBusinessDate('2026-02-01');
      expectOk(
        await f
          .as('opsMaker')
          .post(
            `/lending/facilities/${facilityId}/repayments`,
            { amount: '15000' },
            'fac-rc-repay',
          ),
      );
      const v = expectOk(await facility(facilityId));
      expect(v.position.outstanding).toBe('30000');
      expect(v.position.available).toBe('70000'); // repayment freed the limit
      expect(v.facility.totalDrawn).toBe('45000'); // but the money advanced stands
    });

    it('raises interest and the commitment fee on a statement, and posts them', async () => {
      const r = expectOk(
        await f
          .as('opsMaker')
          .post(
            `/lending/facilities/${facilityId}/statements`,
            { periodEnd: '2026-02-01' },
            'fac-rc-stmt',
          ),
      );
      expect(Number(r.statement.interest)).toBeGreaterThan(0);
      expect(Number(r.statement.commitmentFee)).toBeGreaterThan(0);
      expect(r.statement.minimumPayment).toBeNull(); // not an overdraft

      const loan = expectOk(
        await f.as('opsMaker').get(`/lending/loans/${loanId}`),
      );
      const accrual = loan.events.find((e: any) => e.type === 'ACCRUAL');
      const debits = accrual.journal.lines
        .filter((l: any) => Number(l.debit) > 0)
        .map((l: any) => l.accountCode)
        .sort();
      expect(debits).toEqual(['1210', '1220']); // interest and fees receivable
    });

    it('refuses a second statement over the same period', async () => {
      const again = await f
        .as('opsMaker')
        .post(
          `/lending/facilities/${facilityId}/statements`,
          { periodEnd: '2026-01-20' },
          'fac-rc-stmt-2',
        );
      expect(again.status).toBe(409);
    });

    it('replays a released drawdown on the same idempotency key', async () => {
      const dd = expectOk(
        await f
          .as('opsMaker')
          .post(`/lending/facilities/${facilityId}/drawdowns`, {
            amount: '2000',
          }),
      );
      expectOk(
        await f
          .as('opsChecker')
          .post(`/lending/facilities/${facilityId}/drawdowns/${dd.id}/approve`),
      );
      const body = { externalReference: 'BANK-IDEM' };
      const first = expectOk(
        await f
          .as('opsChecker')
          .post(
            `/lending/facilities/${facilityId}/drawdowns/${dd.id}/release`,
            body,
            'fac-rc-idem',
          ),
      );
      const replay = expectOk(
        await f
          .as('opsChecker')
          .post(
            `/lending/facilities/${facilityId}/drawdowns/${dd.id}/release`,
            body,
            'fac-rc-idem',
          ),
      );
      expect(replay.replayed).toBe(true);
      expect(first.status).toBe('RELEASED');
      const v = expectOk(await facility(facilityId));
      expect(v.position.outstanding).toBe('32000'); // drawn once, not twice
    });

    it('raises and approves a limit change, and refuses one below what is drawn', async () => {
      const tooLow = await f
        .as('opsMaker')
        .post(`/lending/facilities/${facilityId}/limit-changes`, {
          newLimit: '1000',
          changeType: 'DECREASE',
          reason: 'Risk appetite',
        });
      expect(tooLow.status).toBe(400);
      expect(tooLow.body.message).toMatch(/already drawn/);

      const change = expectOk(
        await f
          .as('opsMaker')
          .post(`/lending/facilities/${facilityId}/limit-changes`, {
            newLimit: '150000',
            changeType: 'INCREASE',
            reason: 'Reviewed turnover',
          }),
      );
      expectOk(
        await f
          .as('approver')
          .post(
            `/lending/facilities/${facilityId}/limit-changes/${change.id}/decide`,
            { outcome: 'APPROVE' },
          ),
      );
      const v = expectOk(await facility(facilityId));
      expect(v.facility.limitAmount).toBe('150000');
      expect(v.position.available).toBe('118000');
    });

    it('suspends and reinstates a facility, blocking drawdowns while suspended', async () => {
      expectOk(
        await f
          .as('opsChecker')
          .post(`/lending/facilities/${facilityId}/status`, {
            action: 'SUSPEND',
            reason: 'Covenant breach under review',
          }),
      );
      const blocked = await f
        .as('opsMaker')
        .post(`/lending/facilities/${facilityId}/drawdowns`, {
          amount: '1000',
        });
      expect(blocked.status).toBe(403);
      expectOk(
        await f
          .as('opsChecker')
          .post(`/lending/facilities/${facilityId}/status`, {
            action: 'REINSTATE',
          }),
      );
      expect(expectOk(await facility(facilityId)).facility.status).toBe(
        'ACTIVE',
      );
    });

    it('reconciles the sub-ledger to the general ledger', async () => {
      const rec = expectOk(
        await f.as('finance').get('/lending/ops/reconciliation'),
      );
      expect(rec.breaks).toEqual([]);
      expect(rec.trialBalanceBalanced).toBe(true);
    });
  });

  // ── Overdraft ─────────────────────────────────────────────────────────────

  describe('overdraft', () => {
    let facilityId: string;
    let loanId: string;

    beforeAll(async () => {
      await setBusinessDate('2026-02-01');
      const { productId } = await activeProduct(f, 'OVERDRAFT', 'OD-STD');
      ({ facilityId, loanId } = await bookFacility(productId, {
        principal: '20000',
        numberOfInstalments: 12,
        disbursementDate: '2026-02-01',
        annualRate: '0.18',
      }));
    }, 60_000);

    it('carries a minimum payment on its statement', async () => {
      await drawdown(facilityId, { amount: '8000' }, 'od1');
      await setBusinessDate('2026-03-01');
      const r = expectOk(
        await f
          .as('opsMaker')
          .post(
            `/lending/facilities/${facilityId}/statements`,
            { periodEnd: '2026-03-01' },
            'fac-od-stmt',
          ),
      );
      // 8,000 × 5% = 400, plus the period's charges.
      expect(Number(r.statement.minimumPayment)).toBeGreaterThan(400);
      expect(r.detail.minimumPayment.basis).toBe('RATE');
      expect(r.statement.minimumPaymentDue).toBe('2026-03-22');
    });

    it('does not term out: an overdraft is repayable on demand', async () => {
      const r = await f
        .as('opsChecker')
        .post(`/lending/facilities/${facilityId}/term-out`);
      expect(r.status).toBe(400);
      expect(r.body.message).toMatch(/repayable on demand/);
    });

    it('keeps its loan account consistent with the facility position', async () => {
      const v = expectOk(await facility(facilityId));
      const loan = expectOk(
        await f.as('opsMaker').get(`/lending/loans/${loanId}`),
      );
      expect(loan.account.principalOutstanding).toBe(v.position.outstanding);
    });
  });

  // ── Staged drawdown ───────────────────────────────────────────────────────

  describe('staged construction drawdown', () => {
    let facilityId: string;

    beforeAll(async () => {
      await setBusinessDate('2026-03-01');
      const { productId } = await activeProduct(f, 'CONSTRUCTION', 'CON-STD');
      ({ facilityId } = await bookFacility(
        productId,
        {
          principal: '100000',
          numberOfInstalments: 240,
          disbursementDate: '2026-03-01',
          annualRate: '0.12',
        },
        {
          collateral: {
            type: 'RESIDENTIAL_PROPERTY',
            description: 'Building plot 42',
            marketValue: '250000',
            valuationDate: '2026-02-01',
            valuer: 'Valuer Co',
            method: 'MARKET',
          },
        },
      ));
    }, 60_000);

    it('creates the tranche conditions from the product configuration', async () => {
      const v = expectOk(await facility(facilityId));
      expect(v.facility.facilityType).toBe('STAGED_DRAWDOWN');
      const byTranche = v.conditions.reduce((acc: any, c: any) => {
        (acc[c.trancheCode] ??= []).push(c.code);
        return acc;
      }, {});
      expect(byTranche.STRUCTURE).toEqual(['SURVEYOR_REPORT']);
      expect(byTranche.COMPLETION.sort()).toEqual([
        'OCCUPANCY_CERTIFICATE',
        'SURVEYOR_REPORT',
      ]);
      expect(v.conditions.every((c: any) => c.status === 'PENDING')).toBe(true);
    });

    it('releases the unconditional first tranche in full', async () => {
      await drawdown(
        facilityId,
        { amount: '30000', trancheCode: 'FOUNDATION' },
        'con1',
      );
      const v = expectOk(await facility(facilityId));
      expect(v.position.outstanding).toBe('30000');
      expect(v.position.releasedTranches).toEqual(['FOUNDATION']);
    });

    it('refuses a partial tranche release', async () => {
      await setBusinessDate('2026-09-01');
      const r = await f
        .as('opsMaker')
        .post(`/lending/facilities/${facilityId}/drawdowns`, {
          amount: '20000',
          trancheCode: 'STRUCTURE',
        });
      expect(r.status).toBe(400);
      expect(JSON.stringify(r.body.issues)).toMatch(/releases exactly 40000/);
    });

    it('blocks a tranche whose conditions are outstanding, and names them', async () => {
      const r = await f
        .as('opsMaker')
        .post(`/lending/facilities/${facilityId}/drawdowns`, {
          amount: '40000',
          trancheCode: 'STRUCTURE',
        });
      expect(r.status).toBe(400);
      expect(JSON.stringify(r.body.issues)).toMatch(
        /unsatisfied conditions: SURVEYOR_REPORT/,
      );
    });

    it('releases the tranche once its condition is satisfied with evidence', async () => {
      const v = expectOk(await facility(facilityId));
      const cond = v.conditions.find(
        (c: any) =>
          c.trancheCode === 'STRUCTURE' && c.code === 'SURVEYOR_REPORT',
      );
      expectOk(
        await f
          .as('opsMaker')
          .post(
            `/lending/facilities/${facilityId}/conditions/${cond.id}/satisfy`,
            { evidence: 'Surveyor report 2026-09-01, ref SR-114' },
          ),
      );
      await drawdown(
        facilityId,
        { amount: '40000', trancheCode: 'STRUCTURE' },
        'con2',
      );
      const after = expectOk(await facility(facilityId));
      expect(after.position.outstanding).toBe('70000');
    });

    it('does not reinstate the limit when the borrower repays', async () => {
      expectOk(
        await f
          .as('opsMaker')
          .post(
            `/lending/facilities/${facilityId}/repayments`,
            { amount: '10000' },
            'fac-con-repay',
          ),
      );
      const v = expectOk(await facility(facilityId));
      expect(v.position.outstanding).toBe('60000');
      // Only the untouched COMPLETION tranche remains drawable: the repaid
      // 10,000 is not available to draw a second time.
      expect(v.position.available).toBe('30000');
    });

    it('refuses to release the same tranche twice', async () => {
      const r = await f
        .as('opsMaker')
        .post(`/lending/facilities/${facilityId}/drawdowns`, {
          amount: '30000',
          trancheCode: 'FOUNDATION',
        });
      expect(r.status).toBe(400);
      expect(JSON.stringify(r.body.issues)).toMatch(/already been released/);
    });

    it('records a waiver as a credit concession, with a reason', async () => {
      const v = expectOk(await facility(facilityId));
      const cond = v.conditions.find(
        (c: any) =>
          c.trancheCode === 'COMPLETION' && c.code === 'OCCUPANCY_CERTIFICATE',
      );
      const noReason = await f
        .as('approver')
        .post(
          `/lending/facilities/${facilityId}/conditions/${cond.id}/waive`,
          {},
        );
      expect(noReason.status).toBe(400);
      // Operations cannot waive; waiving is a credit decision.
      const wrongRole = await f
        .as('opsMaker')
        .post(`/lending/facilities/${facilityId}/conditions/${cond.id}/waive`, {
          reason: 'Certificate delayed by the municipality',
        });
      expect(wrongRole.status).toBe(403);
      expectOk(
        await f
          .as('approver')
          .post(
            `/lending/facilities/${facilityId}/conditions/${cond.id}/waive`,
            { reason: 'Certificate delayed by the municipality' },
          ),
      );
      const after = expectOk(await facility(facilityId));
      expect(after.conditions.find((c: any) => c.id === cond.id).status).toBe(
        'WAIVED',
      );
    });
  });

  // ── Isolation and governance ──────────────────────────────────────────────

  describe('isolation and governance', () => {
    let facilityId: string;

    beforeAll(async () => {
      const { productId } = await activeProduct(
        f,
        'REVOLVING_CREDIT',
        'RC-ISO',
      );
      ({ facilityId } = await bookFacility(productId, {
        principal: '50000',
        numberOfInstalments: 60,
        disbursementDate: '2026-01-05',
        annualRate: '0.12',
      }));
    }, 60_000);

    it('is invisible to another tenant', async () => {
      // t2ops holds the facility permissions in its own tenant, so a refusal
      // here is isolation, not an absent role. Phase 1 accepts either status.
      await grant(f, f.t2, 't2ops', 'LOAN_OPS_MAKER');
      const res = await f.as('t2ops').get(`/lending/facilities/${facilityId}`);
      expect([403, 404]).toContain(res.status);
      const list = expectOk(await f.as('t2ops').get('/lending/facilities'));
      expect(list.data).toEqual([]);
    });

    it('is invisible outside the actor branch scope', async () => {
      await grant(f, f.t1, 'financeB2', 'LOAN_OPS_MAKER', {
        branchIds: [f.b2],
      });
      expect(
        (await f.as('financeB2').get(`/lending/facilities/${facilityId}`))
          .status,
      ).toBe(403);
    });

    it('refuses a drawdown to a user without the permission', async () => {
      expect(
        (
          await f
            .as('nobody')
            .post(`/lending/facilities/${facilityId}/drawdowns`, {
              amount: '1000',
            })
        ).status,
      ).toBe(403);
    });

    it('requires an idempotency key to release money', async () => {
      const dd = expectOk(
        await f
          .as('opsMaker')
          .post(`/lending/facilities/${facilityId}/drawdowns`, {
            amount: '1000',
          }),
      );
      expectOk(
        await f
          .as('opsChecker')
          .post(`/lending/facilities/${facilityId}/drawdowns/${dd.id}/approve`),
      );
      const r = await f
        .as('opsChecker')
        .post(`/lending/facilities/${facilityId}/drawdowns/${dd.id}/release`, {
          externalReference: 'BANK-NOKEY',
        });
      expect(r.status).toBe(400);
    });

    it('records every facility action in the audit trail', async () => {
      const audit = expectOk(
        await f
          .as('admin1')
          .get(
            `/lending/ops/audit?resourceType=Facility&resourceId=${facilityId}`,
          ),
      );
      const actions = audit.data.map((a: any) => a.action);
      expect(actions).toContain('facility.drawdown.request');
      expect(actions).toContain('facility.drawdown.approve');
    });
  });

  // ── Term-out (UC-43) ──────────────────────────────────────────────────────

  describe('revolving facility terming out into an instalment loan (UC-43)', () => {
    let facilityId: string;
    let loanId: string;

    beforeAll(async () => {
      const today = expectOk(
        await f.as('finance').get('/lending/ops/business-date'),
      ).businessDate as string;
      const { productId } = await activeProduct(
        f,
        'REVOLVING_CREDIT',
        'RC-TERMOUT',
        (c) => {
          c.facility.availabilityMonths = 1;
          c.facility.termOutOnExpiry = true;
        },
      );
      ({ facilityId, loanId } = await bookFacility(productId, {
        principal: '20000',
        numberOfInstalments: 12,
        disbursementDate: today,
        annualRate: '0.12',
      }));
      await drawdown(facilityId, { amount: '12000' }, 'to1');
    }, 60_000);

    it('refuses to term out before availability ends, or before charges are stated', async () => {
      const early = await f
        .as('opsChecker')
        .post(`/lending/facilities/${facilityId}/term-out`);
      expect(early.status).toBe(409);
      const v = expectOk(await facility(facilityId));
      await setBusinessDate(v.facility.availabilityTo.slice(0, 10));
      const unstated = await f
        .as('opsChecker')
        .post(`/lending/facilities/${facilityId}/term-out`);
      expect(unstated.status).toBe(409);
      expect(unstated.body.code).toBe('STATEMENT_REQUIRED');
    });

    it('books an amortizing schedule on the same loan, with stated charges due first', async () => {
      const v = expectOk(await facility(facilityId));
      const end = v.facility.availabilityTo.slice(0, 10);
      expectOk(
        await f
          .as('opsMaker')
          .post(
            `/lending/facilities/${facilityId}/statements`,
            { periodEnd: end },
            'fac-to-stmt',
          ),
      );
      const before = expectOk(
        await f.as('opsMaker').get(`/lending/loans/${loanId}`),
      );
      const plan = expectOk(
        await f
          .as('opsChecker')
          .post(`/lending/facilities/${facilityId}/term-out`),
      );
      expect(plan.principal).toBe('12000');
      expect(plan.months).toBeGreaterThanOrEqual(1);
      const loan = expectOk(
        await f.as('opsMaker').get(`/lending/loans/${loanId}`),
      );
      const lines = loan.schedule.filter((l: any) => l.status === 'DUE');
      expect(lines).toHaveLength(plan.months);
      const principal = lines.reduce(
        (t: number, l: any) => t + Number(l.principalDue),
        0,
      );
      expect(principal).toBeCloseTo(12000, 2);
      // Interest charged by the statement falls due with instalment 1.
      expect(Number(lines[0].deferredInterestDue)).toBeCloseTo(
        Number(before.account.interestReceivable),
        2,
      );
      expect(loan.agreementVersions.at(-1).reason).toBe('TERM_OUT');
      expect((await facility(facilityId)).body.facility.status).toBe(
        'TERMED_OUT',
      );
    });

    it('is repaid as a loan from then on, and an unpaid instalment goes past due', async () => {
      const facilityRepay = await f
        .as('opsMaker')
        .post(
          `/lending/facilities/${facilityId}/repayments`,
          { amount: '100.00' },
          'fac-to-repay',
        );
      expect(facilityRepay.status).toBe(400);
      expect(facilityRepay.body.code).toBe('FACILITY_TERMED_OUT');

      const loan = expectOk(
        await f.as('opsMaker').get(`/lending/loans/${loanId}`),
      );
      const first = loan.schedule.find(
        (l: any) => l.status === 'DUE' && l.number === 1,
      );
      await setBusinessDate(lending.addDays(first.dueDate, 10));
      expectOk(await f.as('finance').post('/lending/loans/batch/run'));
      const late = expectOk(
        await f.as('opsMaker').get(`/lending/loans/${loanId}`),
      );
      expect(late.account.daysPastDue).toBe(10);
      expect(Number(late.account.interestReceivable)).toBeGreaterThan(0);
      const rec = expectOk(
        await f.as('finance').get('/lending/ops/reconciliation'),
      );
      expect(rec.breaks).toEqual([]);
    });
  });

  // ── Minimum-payment arrears (UC-38) ───────────────────────────────────────

  describe('overdraft minimum payment arrears (UC-38)', () => {
    let facilityId: string;
    let loanId: string;
    let minimum: { amount: string; due: string };

    beforeAll(async () => {
      const today = expectOk(
        await f.as('finance').get('/lending/ops/business-date'),
      ).businessDate as string;
      const { productId } = await activeProduct(f, 'OVERDRAFT', 'OD-ARREARS');
      ({ facilityId, loanId } = await bookFacility(productId, {
        principal: '20000',
        numberOfInstalments: 12,
        disbursementDate: today,
        annualRate: '0.18',
      }));
      await drawdown(facilityId, { amount: '6000' }, 'oda1');
      const periodEnd = lending.addDays(today, 30);
      await setBusinessDate(periodEnd);
      const r = expectOk(
        await f
          .as('opsMaker')
          .post(
            `/lending/facilities/${facilityId}/statements`,
            { periodEnd },
            'fac-oda-stmt',
          ),
      );
      minimum = {
        amount: r.statement.minimumPayment,
        due: r.statement.minimumPaymentDue,
      };
    }, 60_000);

    const dpd = async () =>
      expectOk(await f.as('opsMaker').get(`/lending/loans/${loanId}`)).account
        .daysPastDue as number;

    it('an unpaid minimum payment goes past due after its due date', async () => {
      await setBusinessDate(lending.addDays(minimum.due, 7));
      expectOk(await f.as('finance').post('/lending/loans/batch/run'));
      expect(await dpd()).toBe(7);
    });

    it('a part payment does not cure it; paying the minimum does', async () => {
      const part = (Number(minimum.amount) / 2).toFixed(2);
      expectOk(
        await f
          .as('opsMaker')
          .post(
            `/lending/facilities/${facilityId}/repayments`,
            { amount: part },
            'fac-oda-part',
          ),
      );
      expectOk(await f.as('finance').post('/lending/loans/batch/run'));
      expect(await dpd()).toBe(7);
      expectOk(
        await f
          .as('opsMaker')
          .post(
            `/lending/facilities/${facilityId}/repayments`,
            { amount: (Number(minimum.amount) - Number(part)).toFixed(2) },
            'fac-oda-rest',
          ),
      );
      expectOk(await f.as('finance').post('/lending/loans/batch/run'));
      expect(await dpd()).toBe(0);
    });
  });

  // ── Over-limit and renewal (UC-41, UC-42) ─────────────────────────────────

  describe('over-limit allowance and annual renewal', () => {
    let facilityId: string;
    let start: string;
    let restoreCap: () => Promise<void>;

    beforeAll(async () => {
      // The 30% over-limit rate is above the NBC cap, which counts it with
      // penalty interest by default (D-109).
      restoreCap = await raiseRateCap(f, '30');
      start = expectOk(await f.as('finance').get('/lending/ops/business-date'))
        .businessDate as string;
      const { productId } = await activeProduct(
        f,
        'REVOLVING_CREDIT',
        'RC-OVERLIMIT',
        (c) => {
          c.facility.overlimitRate = '0.30';
          c.pricing.regulatoryCapAnnualRate = null;
          c.facility.overlimitTolerance = '0.10';
          c.facility.overlimitFee = '25';
          c.facility.availabilityMonths = 12;
        },
      );
      ({ facilityId } = await bookFacility(productId, {
        principal: '10000',
        numberOfInstalments: 12,
        disbursementDate: start,
        annualRate: '0.12',
      }));
    }, 60_000);
    afterAll(async () => restoreCap?.());

    it('UC-41: a drawdown may run over the limit only within the allowance', async () => {
      const over = await f
        .as('opsMaker')
        .post(`/lending/facilities/${facilityId}/drawdowns`, {
          amount: '11500',
        });
      expect(over.status).toBe(400);
      expect(JSON.stringify(over.body)).toMatch(/over-limit allowance/);
      await drawdown(facilityId, { amount: '10800' }, 'ovl1');
      expect(expectOk(await facility(facilityId)).position.outstanding).toBe(
        '10800',
      );
    });

    it('UC-41: the statement charges over-limit interest and the flat over-limit fee', async () => {
      const periodEnd = lending.addDays(start, 30);
      await setBusinessDate(periodEnd);
      const r = expectOk(
        await f
          .as('opsMaker')
          .post(
            `/lending/facilities/${facilityId}/statements`,
            { periodEnd },
            'fac-ovl-stmt',
          ),
      );
      expect(Number(r.detail.overlimitInterest)).toBeGreaterThan(0);
      expect(r.detail.overlimitFee).toBe('25');
    });

    it('UC-42: a renewal extends availability and maturity once approved by another person', async () => {
      const before = expectOk(await facility(facilityId)).facility;
      expect(
        (
          await f
            .as('opsMaker')
            .post(`/lending/facilities/${facilityId}/limit-changes`, {
              newLimit: '12000',
              changeType: 'RENEWAL',
              reason: 'Annual review',
            })
        ).status,
      ).toBe(400);
      const change = expectOk(
        await f
          .as('opsMaker')
          .post(`/lending/facilities/${facilityId}/limit-changes`, {
            newLimit: '12000',
            changeType: 'RENEWAL',
            renewalMonths: 12,
            reason: 'Annual review: turnover up, conduct good',
          }),
      );
      expectOk(
        await f
          .as('approver')
          .post(
            `/lending/facilities/${facilityId}/limit-changes/${change.id}/decide`,
            { outcome: 'APPROVE' },
          ),
      );
      const after = expectOk(await facility(facilityId)).facility;
      expect(after.limitAmount).toBe('12000');
      expect(after.availabilityTo).toBe(
        lending.addMonths(before.availabilityTo, 12),
      );
      expect(after.maturityDate).toBe(
        lending.addMonths(before.maturityDate, 12),
      );
    });
  });

  // ── Repaying stated interest (regression) ─────────────────────────────────

  describe('a repayment that also pays stated interest', () => {
    let facilityId: string;
    let loanId: string;

    beforeAll(async () => {
      const today = expectOk(
        await f.as('finance').get('/lending/ops/business-date'),
      ).businessDate as string;
      const { productId } = await activeProduct(
        f,
        'REVOLVING_CREDIT',
        'RC-INTPAY',
        (c) => {
          c.facility.commitmentFeeRate = null;
        },
      );
      ({ facilityId, loanId } = await bookFacility(productId, {
        principal: '20000',
        numberOfInstalments: 12,
        disbursementDate: today,
        annualRate: '0.12',
      }));
      await drawdown(facilityId, { amount: '10000' }, 'ip1');
      const periodEnd = lending.addDays(today, 30);
      await setBusinessDate(periodEnd);
      expectOk(
        await f
          .as('opsMaker')
          .post(
            `/lending/facilities/${facilityId}/statements`,
            { periodEnd },
            'fac-ip-stmt',
          ),
      );
    }, 60_000);

    it('reinstates only the principal it repaid, and reconciles', async () => {
      const loan = expectOk(
        await f.as('opsMaker').get(`/lending/loans/${loanId}`),
      );
      const interest = Number(loan.account.interestReceivable);
      expect(interest).toBeGreaterThan(0);
      expectOk(
        await f
          .as('opsMaker')
          .post(
            `/lending/facilities/${facilityId}/repayments`,
            { amount: (interest + 4000).toFixed(2) },
            'fac-ip-repay',
          ),
      );
      const after = expectOk(
        await f.as('opsMaker').get(`/lending/loans/${loanId}`),
      );
      expect(after.account.principalOutstanding).toBe('6000');
      const v = expectOk(await facility(facilityId));
      // Regression: the whole payment, interest included, was counted as
      // principal repaid, overstating the headroom by the interest paid.
      expect(v.position.outstanding).toBe('6000');
      expect(v.position.available).toBe('14000');
      expect(v.position.totalRepaid).toBe('4000');
      const rec = expectOk(
        await f.as('finance').get('/lending/ops/reconciliation'),
      );
      expect(rec.breaks).toEqual([]);
    });
  });
});
