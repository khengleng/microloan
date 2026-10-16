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
} from './harness';
import { activeProduct, docs, standardRoles } from './setup';

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
    opts: { collateral?: Record<string, unknown> } = {},
  ) {
    const b = await borrower(f, f.t1, f.b1);
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
          `fac-${tag}`,
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
      ({ productId } = await activeProduct(f, 'REVOLVING_CREDIT', 'RC-STD'));
      ({ facilityId, loanId } = await bookFacility(productId, {
        principal: '100000',
        numberOfInstalments: 12,
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
      await drawdown(
        facilityId,
        { amount: '40000', valueDate: '2026-01-05' },
        'rc1',
      );
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
          valueDate: '2026-01-05',
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
            valueDate: '2026-01-05',
          }),
      );
      const second = await f
        .as('opsMaker')
        .post(`/lending/facilities/${facilityId}/drawdowns`, {
          amount: '1000',
          valueDate: '2026-01-05',
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
            valueDate: '2026-01-05',
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
            'fac-rc2',
          ),
      );
      const v = expectOk(await facility(facilityId));
      expect(v.position.outstanding).toBe('45000');
    });

    it('reinstates the limit when the borrower repays', async () => {
      expectOk(
        await f
          .as('opsMaker')
          .post(
            `/lending/loans/${loanId}/repayments`,
            { amount: '15000', valueDate: '2026-02-01', method: 'CASH' },
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
            valueDate: '2026-02-01',
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
          valueDate: '2026-02-01',
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
      const { productId } = await activeProduct(f, 'OVERDRAFT', 'OD-STD');
      ({ facilityId, loanId } = await bookFacility(productId, {
        principal: '20000',
        numberOfInstalments: 12,
        disbursementDate: '2026-01-05',
        annualRate: '0.18',
      }));
    }, 60_000);

    it('carries a minimum payment on its statement', async () => {
      await drawdown(
        facilityId,
        { amount: '8000', valueDate: '2026-01-05' },
        'od1',
      );
      const r = expectOk(
        await f
          .as('opsMaker')
          .post(
            `/lending/facilities/${facilityId}/statements`,
            { periodEnd: '2026-02-01' },
            'fac-od-stmt',
          ),
      );
      // 8,000 × 5% = 400, plus the period's charges.
      expect(Number(r.statement.minimumPayment)).toBeGreaterThan(400);
      expect(r.detail.minimumPayment.basis).toBe('RATE');
      expect(r.statement.minimumPaymentDue).toBe('2026-02-22');
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
      const { productId } = await activeProduct(f, 'CONSTRUCTION', 'CON-STD');
      ({ facilityId } = await bookFacility(
        productId,
        {
          principal: '100000',
          numberOfInstalments: 240,
          disbursementDate: '2026-01-05',
          annualRate: '0.09',
        },
        {
          collateral: {
            assetType: 'RESIDENTIAL_PROPERTY',
            description: 'Plot 42',
            value: '250000',
            valuationDate: '2026-01-02',
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
        { amount: '30000', valueDate: '2026-01-05', trancheCode: 'FOUNDATION' },
        'con1',
      );
      const v = expectOk(await facility(facilityId));
      expect(v.position.outstanding).toBe('30000');
      expect(v.position.releasedTranches).toEqual(['FOUNDATION']);
    });

    it('refuses a partial tranche release', async () => {
      const r = await f
        .as('opsMaker')
        .post(`/lending/facilities/${facilityId}/drawdowns`, {
          amount: '20000',
          valueDate: '2026-07-05',
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
          valueDate: '2026-07-05',
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
          .post(`/lending/facilities/${facilityId}/conditions/${cond.id}`, {
            outcome: 'SATISFY',
            evidence: 'Surveyor report 2026-07-01, ref SR-114',
          }),
      );
      await drawdown(
        facilityId,
        { amount: '40000', valueDate: '2026-07-05', trancheCode: 'STRUCTURE' },
        'con2',
      );
      const after = expectOk(await facility(facilityId));
      expect(after.position.outstanding).toBe('70000');
    });

    it('does not reinstate the limit when the borrower repays', async () => {
      const v0 = expectOk(await facility(facilityId));
      const loanId = v0.loanAccountId;
      expectOk(
        await f
          .as('opsMaker')
          .post(
            `/lending/loans/${loanId}/repayments`,
            { amount: '10000', valueDate: '2026-08-01', method: 'CASH' },
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
          valueDate: '2026-08-05',
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
        .post(`/lending/facilities/${facilityId}/conditions/${cond.id}`, {
          outcome: 'WAIVE',
        });
      expect(noReason.status).toBe(400);
      // Operations cannot waive; waiving is a credit decision.
      const wrongRole = await f
        .as('opsMaker')
        .post(`/lending/facilities/${facilityId}/conditions/${cond.id}`, {
          outcome: 'WAIVE',
          reason: 'Certificate delayed by the municipality',
        });
      expect(wrongRole.status).toBe(403);
      expectOk(
        await f
          .as('approver')
          .post(`/lending/facilities/${facilityId}/conditions/${cond.id}`, {
            outcome: 'WAIVE',
            reason: 'Certificate delayed by the municipality',
          }),
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
        numberOfInstalments: 12,
        disbursementDate: '2026-01-05',
        annualRate: '0.12',
      }));
    }, 60_000);

    it('is invisible to another tenant', async () => {
      expect(
        (await f.as('t2ops').get(`/lending/facilities/${facilityId}`)).status,
      ).toBe(404);
      const list = expectOk(await f.as('t2admin').get('/lending/facilities'));
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
              valueDate: '2026-01-05',
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
            valueDate: '2026-01-05',
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
});
