/* eslint-disable @typescript-eslint/no-unsafe-call -- end-to-end fixtures: API responses and fixture rows are untyped. */
/**
 * End-to-end journey harness (docs/servicing/SCENARIOS.md).
 *
 * A journey takes one customer from onboarding to closure over the real HTTP
 * API: borrower created through the legacy borrower API, KYC verified and AML-cleared,
 * lending application, assessment, approval, booking, conditions precedent,
 * disbursement under maker-checker, end of day in at most 31-day steps, and
 * whatever servicing events the scenario needs. After every step a
 * checkpoint asserts the loan's status and balances, that every journal
 * entry on it balances, that reconciliation has no breaks and a balanced
 * trial balance, and that the step is in the audit trail.
 *
 * Every journey runs in its own tenant (one `bootstrap()` per describe), so
 * it owns its business date.
 */
import { lending } from '@microloan/shared';
import {
  Fixture,
  acceptKeyFacts,
  authority,
  bootstrap,
  expectOk,
  grant,
  key,
} from '../harness';
import { PDF, standardRoles } from '../setup';

export { expectOk, key, lending };

/** Cents, as a string with two decimals: compares API decimals exactly. */
export const c2 = (x: unknown) => Number(x ?? 0).toFixed(2);
export const sum = (xs: unknown[]): number =>
  xs.reduce<number>((t, x) => t + Number(x ?? 0), 0);

export interface Balances {
  status?: string;
  principal?: string | number;
  interest?: string | number;
  fees?: string | number;
  penalty?: string | number;
  advance?: string | number;
  suspense?: string | number;
  dpd?: number;
  bucket?: string;
  nonAccrual?: boolean;
  allowance?: string | number;
}

export interface OriginateOptions {
  docs?: string[];
  collateral?: Record<string, unknown>[];
  guarantors?: number;
  approvers?: string[];
  borrower?: Record<string, unknown>;
  borrowerId?: string;
  groupId?: string;
  refinancesLoanId?: string;
  /** Leave the loan booked but undisbursed (facilities draw instead). */
  noDisbursement?: boolean;
  disbursementReference?: string;
}

export class Journey {
  private constructor(public readonly f: Fixture) {}

  /** A fresh tenant with the standard role layout and the extra grants journeys use. */
  static async start(
    opts: { flags?: string[]; businessDate?: string } = {},
  ): Promise<Journey> {
    const f = await bootstrap();
    await standardRoles(f);
    const t = f.t1;
    await grant(f, t, 'approver2', 'RESTRUCTURE_COMMITTEE');
    await grant(f, t, 'approver', 'RESTRUCTURE_COMMITTEE');
    await grant(f, t, 'opsMaker', 'COLLECTIONS_OFFICER');
    await grant(f, t, 'nobody', 'RISK_COMPLIANCE');
    for (const p of [
      'restructure.approve',
      'restructure.waive_charges',
      'restructure.forgive_principal',
      'loan.settlement.negotiate',
      'loan.settlement.negotiate_principal',
    ])
      await authority(f, t, 'approver2', p, 'USD', '1000000');
    await authority(f, t, 'approver', 'restructure.approve', 'USD', '100000');
    await authority(
      f,
      t,
      'approver',
      'restructure.waive_charges',
      'USD',
      '5000',
    );
    await authority(
      f,
      t,
      'opsChecker',
      'facility.drawdown.approve',
      'USD',
      '1000000',
    );
    await authority(
      f,
      t,
      'approver',
      'facility.limit.approve',
      'USD',
      '1000000',
    );
    const j = new Journey(f);
    for (const flag of opts.flags ?? []) await j.enableFlag(flag);
    if (opts.businessDate) await j.moveTo(opts.businessDate, { batch: false });
    return j;
  }

  close() {
    return this.f.app.close();
  }

  as(user: string) {
    return this.f.as(user);
  }

  /** Two-administrator flag change, as the access model requires. */
  async enableFlag(flagKey: string) {
    const r = expectOk(
      await this.as('admin1').post('/lending/access/flags/rules', {
        flagKey,
        scopeType: 'TENANT',
        enabled: true,
        reason: 'end-to-end journey',
      }),
    );
    expectOk(
      await this.as('admin2').post(
        `/lending/access/flags/changes/${r.approval.id}/decision`,
        { approve: true },
      ),
    );
  }

  // ── Products ────────────────────────────────────────────────────────────

  /** Maker drafts and submits; a different checker approves and activates. */
  async product(
    templateCode: string,
    code: string,
    mutate?: (config: any) => void,
  ) {
    const tpl = expectOk(
      await this.as('maker').get(`/lending/templates/${templateCode}`),
    );
    const config = structuredClone(tpl.defaultConfig);
    if (mutate) mutate(config);
    const created = expectOk(
      await this.as('maker').post('/lending/products', {
        templateCode,
        code,
        name: `${code} product`,
        config,
      }),
    );
    const vid = created.version.id;
    expectOk(
      await this.as('maker').post(`/lending/product-versions/${vid}/submit`),
    );
    // Maker-checker: the maker cannot approve their own product.
    expect(
      (await this.as('maker').post(`/lending/product-versions/${vid}/approve`))
        .status,
    ).toBe(403);
    expectOk(
      await this.as('checker').post(`/lending/product-versions/${vid}/approve`),
    );
    expectOk(
      await this.as('checker').post(
        `/lending/product-versions/${vid}/activate`,
      ),
    );
    return created.product.id as string;
  }

  // ── Business date and end of day ────────────────────────────────────────

  async today(): Promise<string> {
    return expectOk(await this.as('finance').get('/lending/ops/business-date'))
      .businessDate as string;
  }

  /**
   * Move the business date forward to `target` in steps of at most 31 days,
   * running the end-of-day batch after each step (unless `batch: false`).
   * The batch must process every account without a failure.
   */
  async moveTo(target: string, opts: { batch?: boolean } = {}) {
    let current = await this.today();
    expect(lending.compareDates(current, target)).toBeLessThanOrEqual(0);
    while (lending.compareDates(current, target) < 0) {
      const step = lending.addDays(current, 31);
      const next = lending.compareDates(step, target) > 0 ? target : step;
      expectOk(
        await this.as('finance').post('/lending/ops/business-date', {
          businessDate: next,
        }),
      );
      current = next;
      if (opts.batch !== false) await this.eod();
    }
    return current;
  }

  /** Run the end-of-day batch; nothing may fail. */
  async eod() {
    const run = expectOk(
      await this.as('finance').post('/lending/loans/batch/run'),
    );
    expect(run.failed).toEqual([]);
    return run;
  }

  // ── Onboarding ──────────────────────────────────────────────────────────

  private seq = 0;

  /**
   * A borrower created through the legacy borrower API by a branch officer,
   * with the KYC fields captured, then KYC-verified by an administrator.
   */
  async onboard(over: Record<string, unknown> = {}, verify = true) {
    const n = ++this.seq;
    const b = expectOk(
      await this.as('ro').post('/borrowers', {
        firstName: 'Sok',
        lastName: `Dara${n}`,
        phone: `+85512${String(100000 + n).padStart(6, '0')}`,
        idNumber: `KH-${Date.now()}-${n}`,
        idType: 'NATIONAL_ID',
        dateOfBirth: '1985-04-12',
        occupation: 'Shop owner',
        address: 'Street 271, Phnom Penh',
        monthlyIncome: 3000,
        monthlyExpenses: 800,
        ...over,
      }),
    );
    expect(b.branchId).toBe(this.f.b1);
    expect(b.kycStatus).toBe('PENDING');
    if (verify) {
      await this.verifyKyc(b.id);
      await this.clearAml(b.id);
    }
    return b.id as string;
  }

  /**
   * AML clearance (D-118), two people: a credit analyst records it after a
   * fresh watch-list screening, a compliance reviewer approves it.
   */
  async clearAml(borrowerId: string) {
    const proposed = expectOk(
      await this.as('analyst').post(
        `/lending/aml/customers/${borrowerId}/status`,
        {
          status: 'CLEAR',
          reason: 'Screened against the watch lists in force: no match',
        },
      ),
    );
    expect(proposed.pendingClearance.taskId).toEqual(expect.any(String));
    const cleared = expectOk(
      await this.as('nobody').post(
        `/lending/aml/customers/${borrowerId}/clearance/decision`,
        { approve: true },
      ),
    );
    expect(cleared.amlStatus).toBe('CLEAR');
  }

  async verifyKyc(borrowerId: string) {
    // Two people: one records the verification, another confirms it.
    const recorded = expectOk(
      await this.as('admin1').post(`/kyc/${borrowerId}/verify`, {
        status: 'VERIFIED',
        reason: 'Identity document checked against the original',
      }),
    );
    expect(recorded.kycStatus).toBe('PENDING');
    const v = expectOk(
      await this.as('admin2').post(`/kyc/${borrowerId}/verify`, {
        status: 'VERIFIED',
        reason: 'Second check of the identity document',
      }),
    );
    expect(v.kycStatus).toBe('VERIFIED');
    const logs = expectOk(
      await this.as('admin1').get(
        '/audit-logs?entity=Borrower&action=KYC_VERIFIED&limit=100',
      ),
    );
    const rows = logs.data ?? logs.items ?? logs;
    expect(
      (rows as any[]).some((r) => (r.entityId ?? r.resourceId) === borrowerId),
    ).toBe(true);
  }

  // ── Origination ─────────────────────────────────────────────────────────

  async uploadDocs(appId: string, codes: string[]) {
    for (const code of codes)
      expectOk(
        await this.as('ro').post(`/lending/applications/${appId}/documents`, {
          code,
          fileName: `${code}.pdf`,
          mimeType: 'application/pdf',
          contentBase64: PDF,
        }),
      );
  }

  async application(id: string) {
    return expectOk(
      await this.as('opsMaker').get(`/lending/applications/${id}`),
    );
  }

  /**
   * Application → documents/collateral/guarantors → submit (assessment) →
   * recommend → approve (one or two approvers) → book → conditions precedent
   * → disbursement prepare / approve / execute. Asserts the application and
   * loan status after each step and reconciles once the money has moved.
   */
  async originate(
    productId: string,
    terms: Record<string, unknown>,
    opts: OriginateOptions = {},
  ) {
    const borrowerId = opts.borrowerId ?? (await this.onboard(opts.borrower));
    const app = expectOk(
      await this.as('ro').post('/lending/applications', {
        borrowerId,
        productId,
        terms,
        ...(opts.groupId ? { groupId: opts.groupId } : {}),
        ...(opts.refinancesLoanId
          ? { refinancesLoanId: opts.refinancesLoanId }
          : {}),
      }),
    );
    expect(app.status).toBe('DRAFT');
    await this.uploadDocs(app.id, opts.docs ?? ['ID_DOCUMENT']);
    for (const c of opts.collateral ?? [])
      expectOk(
        await this.as('ro').post(
          `/lending/applications/${app.id}/collateral`,
          c,
        ),
      );
    for (let i = 0; i < (opts.guarantors ?? 0); i++)
      expectOk(
        await this.as('ro').post(`/lending/applications/${app.id}/guarantees`, {
          guarantorName: `Chan Sopheap ${i + 1}`,
          type: 'PERSONAL',
          amount: '1000',
        }),
      );
    const submitted = expectOk(
      await this.as('ro').post(`/lending/applications/${app.id}/submit`),
    );
    expect(submitted.status).toBe('SUBMITTED');
    expect(submitted.assessment.blocking).toEqual([]);
    const rec = expectOk(
      await this.as('analyst').post(
        `/lending/applications/${app.id}/recommend`,
        {
          recommendation: 'APPROVE',
          rationale: 'Affordable and within policy',
        },
      ),
    );
    expect((rec.application ?? rec).status).toBe('RECOMMENDED');
    // Approve within authority; a second, independent approver where the
    // workflow requires two.
    let approved: any;
    for (const approver of opts.approvers ?? ['approver', 'approver2']) {
      approved = expectOk(
        await this.as(approver).post(
          `/lending/applications/${app.id}/approve`,
          {
            rationale: 'Approved within authority',
          },
        ),
      );
      if ((approved.application ?? approved).status === 'APPROVED') break;
    }
    expect((approved.application ?? approved).status).toBe('APPROVED');
    // D-123: the customer accepts the key facts statement before the contract.
    await acceptKeyFacts(this, app.id);
    const booked = expectOk(
      await this.as('opsMaker').post(
        `/lending/applications/${app.id}/book`,
        {},
      ),
    );
    const loanId = booked.account.id as string;
    const facilityId = booked.facility?.id as string | undefined;
    expect(booked.account.status).toBe('BOOKED');
    const view = await this.application(app.id);
    for (const cp of view.conditions) {
      // Money cannot move while a condition precedent is open.
      expectOk(
        await this.as('opsMaker').post(
          `/lending/applications/${app.id}/conditions/${cp.code}`,
          { resolution: 'SATISFIED', evidence: `Evidence for ${cp.code}` },
        ),
      );
    }
    if (!opts.noDisbursement && !facilityId)
      await this.disburse(loanId, opts.disbursementReference);
    return {
      loanId,
      facilityId,
      applicationId: app.id as string,
      borrowerId,
      booked,
    };
  }

  /** Prepare (maker) → approve (checker) → execute with an idempotency key. */
  async disburse(loanId: string, reference?: string): Promise<any> {
    const task = expectOk(
      await this.as('opsMaker').post(
        `/lending/loans/${loanId}/disbursements`,
        {},
      ),
    );
    // The maker cannot approve their own disbursement.
    expect(
      (
        await this.as('opsMaker').post(
          `/lending/loans/${loanId}/disbursements/${task.id}/decision`,
          { approve: true },
        )
      ).status,
    ).toBe(403);
    expectOk(
      await this.as('opsChecker').post(
        `/lending/loans/${loanId}/disbursements/${task.id}/decision`,
        { approve: true },
      ),
    );
    return this.as('opsChecker').post(
      `/lending/loans/${loanId}/disbursements/execute`,
      { externalReference: reference ?? `BANK-${loanId.slice(0, 8)}` },
      `disb-${loanId}`,
    );
  }

  // ── Servicing ───────────────────────────────────────────────────────────

  async loan(id: string) {
    return expectOk(await this.as('opsMaker').get(`/lending/loans/${id}`));
  }

  /**
   * The live schedule: every instalment line of any agreement version that a
   * later version has not superseded or restructured (a rate reset or a
   * prepayment keeps the lines before it on the earlier version).
   */
  static due(l: any) {
    return l.schedule
      .filter(
        (x: any) =>
          x.number > 0 &&
          x.status !== 'SUPERSEDED' &&
          x.status !== 'RESTRUCTURED',
      )
      .sort(
        (a: any, b: any) =>
          a.dueDate.localeCompare(b.dueDate) || a.number - b.number,
      );
  }

  /** What is still owed on an instalment line, all components. */
  static owed(x: any) {
    return (
      Number(x.principalDue) -
      Number(x.principalPaid) +
      Number(x.interestDue) -
      Number(x.interestPaid) +
      Number(x.deferredInterestDue ?? 0) -
      Number(x.deferredInterestPaid ?? 0) +
      Number(x.feeDue) -
      Number(x.feePaid) +
      Number(x.taxDue) -
      Number(x.taxPaid) +
      Number(x.penaltyDue) -
      Number(x.penaltyPaid)
    );
  }

  /** Everything due on or before `asOf` and still unpaid. */
  static arrears(l: any, asOf: string) {
    return l.schedule
      .filter((x: any) => x.status === 'DUE' && x.dueDate <= asOf)
      .reduce((t: number, x: any) => t + Journey.owed(x), 0);
  }

  pay(
    loanId: string,
    amount: string | number,
    extra: Record<string, unknown> = {},
  ): any {
    return this.as('opsMaker').post(
      `/lending/loans/${loanId}/repayments`,
      {
        amount: typeof amount === 'number' ? amount.toFixed(2) : amount,
        ...extra,
      },
      key('e2e-pay'),
    );
  }

  /** Pay what is owed on instalment `n` (all components). */
  async payInstalment(
    loanId: string,
    n: number,
    extra: Record<string, unknown> = {},
  ) {
    const l = await this.loan(loanId);
    const line = Journey.due(l).find((x: any) => x.number === n);
    return expectOk(await this.pay(loanId, Journey.owed(line), extra));
  }

  /**
   * Pay instalments `from`..`to` on their due dates: move the business date
   * to each due date (end of day runs), check the instalment fell due with
   * nothing late, pay exactly what it owes and check the balances it leaves.
   */
  async payOnTime(loanId: string, from = 1, to?: number) {
    let l = await this.loan(loanId);
    const last = to ?? Journey.due(l).at(-1).number;
    for (let n = from; n <= last; n++) {
      const line = Journey.due(l).find((x: any) => x.number === n);
      await this.moveTo(line.dueDate);
      const before = await this.checkpoint(loanId, { dpd: 0, penalty: 0 });
      const owed = Journey.owed(
        Journey.due(before).find((x: any) => x.number === n),
      );
      expectOk(await this.pay(loanId, owed));
      l = await this.checkpoint(
        loanId,
        {
          principal:
            Number(before.account.principalOutstanding) -
            Number(line.principalDue),
          dpd: 0,
        },
        'loan.repayment.post',
      );
      expect(Journey.due(l).find((x: any) => x.number === n).status).toBe(
        'PAID',
      );
    }
    return l;
  }

  async quote(loanId: string) {
    return expectOk(
      await this.as('opsMaker').get(
        `/lending/loans/${loanId}/settlement-quote`,
      ),
    );
  }

  async settle(loanId: string, amount?: string) {
    const q = amount ? null : await this.quote(loanId);
    return expectOk(
      await this.as('opsMaker').post(
        `/lending/loans/${loanId}/settlement`,
        { amount: amount ?? q.payable },
        key('e2e-settle'),
      ),
    );
  }

  reverse(loanId: string, eventId: string, body: Record<string, unknown>): any {
    return this.as('opsChecker').post(
      `/lending/loans/${loanId}/events/${eventId}/reverse`,
      body,
      key('e2e-rev'),
    );
  }

  async writeOff(loanId: string, reason = 'Unrecoverable after collection') {
    const task = expectOk(
      await this.as('opsMaker').post(`/lending/loans/${loanId}/write-offs`, {
        reason,
      }),
    );
    return expectOk(
      await this.as('opsChecker').post(
        `/lending/loans/${loanId}/write-offs/${task.id}/decision`,
        { approve: true },
        key('e2e-wo'),
      ),
    );
  }

  // ── Facilities ──────────────────────────────────────────────────────────

  async facility(id: string) {
    return expectOk(await this.as('opsMaker').get(`/lending/facilities/${id}`));
  }

  /** Request (maker) → approve (checker) → release with an idempotency key. */
  async draw(facilityId: string, body: Record<string, unknown>) {
    const dd = expectOk(
      await this.as('opsMaker').post(
        `/lending/facilities/${facilityId}/drawdowns`,
        body,
      ),
    );
    expect(
      (
        await this.as('opsMaker').post(
          `/lending/facilities/${facilityId}/drawdowns/${dd.id}/approve`,
        )
      ).status,
    ).toBe(403);
    expectOk(
      await this.as('opsChecker').post(
        `/lending/facilities/${facilityId}/drawdowns/${dd.id}/approve`,
      ),
    );
    return expectOk(
      await this.as('opsChecker').post(
        `/lending/facilities/${facilityId}/drawdowns/${dd.id}/release`,
        { externalReference: `BANK-DD-${dd.id.slice(0, 8)}` },
        key('e2e-dd'),
      ),
    );
  }

  async statement(facilityId: string, periodEnd: string) {
    return expectOk(
      await this.as('opsMaker').post(
        `/lending/facilities/${facilityId}/statements`,
        { periodEnd },
        key('e2e-stmt'),
      ),
    );
  }

  async repayFacility(facilityId: string, amount: string | number) {
    return expectOk(
      await this.as('opsMaker').post(
        `/lending/facilities/${facilityId}/repayments`,
        { amount: typeof amount === 'number' ? amount.toFixed(2) : amount },
        key('e2e-frepay'),
      ),
    );
  }

  // ── Collateral ──────────────────────────────────────────────────────────

  async collateralView(loanId: string) {
    return expectOk(
      await this.as('opsMaker').get(`/lending/loans/${loanId}/collateral`),
    );
  }

  /** Release every pledge after closure: officer requests, a second person signs off (UC-73). */
  async releaseCollateral(loanId: string) {
    const v = await this.collateralView(loanId);
    for (const p of v.pledges.filter((x: any) => x.status !== 'RELEASED')) {
      const task = expectOk(
        await this.as('ro').post(
          `/lending/loans/${loanId}/collateral/${p.collateralId}/release`,
          {
            reference: `REL-${p.collateralId.slice(0, 6)}`,
            note: 'Title returned',
          },
        ),
      );
      expect(
        (
          await this.as('ro').post(
            `/lending/loans/${loanId}/collateral-releases/${task.id}/decision`,
            { approve: true },
          )
        ).status,
      ).toBe(403);
      expectOk(
        await this.as('opsChecker').post(
          `/lending/loans/${loanId}/collateral-releases/${task.id}/decision`,
          { approve: true },
        ),
      );
    }
    const after = await this.collateralView(loanId);
    expect(after.pledges.every((x: any) => x.status === 'RELEASED')).toBe(true);
    return after;
  }

  // ── Checkpoints ─────────────────────────────────────────────────────────

  async reconcile() {
    const rec = expectOk(
      await this.as('finance').get('/lending/ops/reconciliation'),
    );
    expect(rec.breaks).toEqual([]);
    expect(rec.trialBalanceBalanced).toBe(true);
    const tb = expectOk(
      await this.as('finance').get('/lending/ops/trial-balance'),
    );
    expect(tb.every((c: any) => c.totals.balanced)).toBe(true);
    return rec;
  }

  async audited(resourceId: string, action: string) {
    const audit = expectOk(
      await this.as('admin1').get(
        `/lending/ops/audit?resourceId=${resourceId}&action=${encodeURIComponent(action)}`,
      ),
    );
    expect(audit.data.map((e: any) => e.action)).toContain(action);
  }

  /**
   * The checkpoint run after every step: balances as expected, every journal
   * on the loan balanced, reconciliation clean, and (when given) the step's
   * action in the audit trail. Returns the loan view.
   */
  async checkpoint(loanId: string, expected: Balances = {}, action?: string) {
    const l = await this.loan(loanId);
    const a = l.account;
    if (expected.status !== undefined) expect(a.status).toBe(expected.status);
    const money: [keyof Balances, string][] = [
      ['principal', 'principalOutstanding'],
      ['interest', 'interestReceivable'],
      ['fees', 'feesReceivable'],
      ['penalty', 'penaltyReceivable'],
      ['advance', 'advanceBalance'],
      ['suspense', 'interestInSuspense'],
      ['allowance', 'allowance'],
    ];
    for (const [k, field] of money)
      if (expected[k] !== undefined)
        expect(`${k}=${c2(a[field])}`).toBe(`${k}=${c2(expected[k])}`);
    if (expected.dpd !== undefined) expect(a.daysPastDue).toBe(expected.dpd);
    if (expected.bucket !== undefined)
      expect(a.delinquencyBucket).toBe(expected.bucket);
    if (expected.nonAccrual !== undefined)
      expect(a.nonAccrual).toBe(expected.nonAccrual);
    // Every journal entry on the loan is balanced.
    for (const e of l.events) {
      if (!e.journal) continue;
      const dr = sum(e.journal.lines.map((x: any) => x.debit));
      const cr = sum(e.journal.lines.map((x: any) => x.credit));
      expect(`${e.type}:${c2(dr)}`).toBe(`${e.type}:${c2(cr)}`);
    }
    await this.reconcile();
    if (action) await this.audited(loanId, action);
    return l;
  }

  /** Lines of one event's journal as `code:debit:credit`, sorted. */
  static journal(l: any, eventId: string) {
    const e = l.events.find((x: any) => x.id === eventId);
    return e.journal.lines
      .map((x: any) => `${x.accountCode}:${c2(x.debit)}:${c2(x.credit)}`)
      .sort();
  }
}

/** Collateral bodies used by the journeys. */
export const collateral = {
  home: (marketValue: string, priorLienAmount?: string) => ({
    type: 'RESIDENTIAL_PROPERTY',
    description: 'Family home, Borey Peng Huoth',
    marketValue,
    valuationDate: '2025-12-20',
    valuer: 'Valuer Co',
    method: 'MARKET',
    ...(priorLienAmount ? { priorLienAmount } : {}),
  }),
  commercial: (marketValue: string) => ({
    type: 'COMMERCIAL_PROPERTY',
    description: 'Shophouse, Street 63',
    marketValue,
    valuationDate: '2025-12-20',
    valuer: 'Valuer Co',
    method: 'MARKET',
  }),
  vehicle: (marketValue: string) => ({
    type: 'VEHICLE',
    description: 'Toyota Prius 2022, plate 2AB-1234',
    marketValue,
    valuationDate: '2025-12-20',
    valuer: 'Dealer appraisal',
    method: 'MARKET',
  }),
  equipment: (marketValue: string) => ({
    type: 'EQUIPMENT',
    description: 'CNC milling machine',
    marketValue,
    valuationDate: '2025-12-20',
    valuer: 'Valuer Co',
    method: 'MARKET',
  }),
  gold: (marketValue: string, grams = 100) => ({
    type: 'GOLD',
    description: `${grams} g gold, 99.9%`,
    marketValue,
    valuationDate: '2025-12-20',
    valuer: 'Assay Co',
    method: 'MARKET',
  }),
};
