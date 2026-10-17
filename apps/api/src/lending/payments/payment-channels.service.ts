import {
  BadRequestException,
  ConflictException,
  HttpException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { lending } from '@microloan/shared';
import { Currency, type Prisma } from '@microloan/db';
import { LendingPrisma, Tx } from '../common/lending-prisma';
import { AuditEventService } from '../common/audit-event.service';
import { BusinessDateService } from '../common/business-date.service';
import {
  D,
  LendingActor,
  engineCall,
  fromLocalDate,
  requestHash,
  requireTenant,
  toLocalDate,
} from '../common/util';
import { PolicyService } from '../policy/policy.service';
import { tenantResource } from '../policy/resources';
import { PostingService } from '../accounting/posting.service';
import { ServicingService } from '../servicing/servicing.service';
import {
  loadLoanState,
  outstanding,
  resourceOf,
} from '../servicing/loan-state';
import {
  AdapterRegistry,
  BankDebitAdapter,
  FxRateAdapter,
} from '../integrations/adapters';
import { ACCOUNT_CODES } from '../../ledger/chart-of-accounts';
import { SuspenseService } from './suspense.service';
import type {
  FxRepaymentBody,
  MandateBody,
  SettingsBody,
} from './payment-channels.schemas';

type Json = Prisma.InputJsonValue;

export const DEFAULT_CHANNEL_SETTINGS: SettingsBody = {
  fxSpreadBps: 0,
  fxMaxRateAgeDays: 0,
  autoDebitMaxAttempts: 3,
  autoDebitRetryDays: 1,
};

/**
 * Who posts what an auto-debit collects. A system principal with exactly the
 * scopes posting needs: the batch may be started by an officer, but the money
 * is applied under the borrower's mandate, not the officer's authority.
 */
export function autoDebitActor(tenantId: string): LendingActor {
  return {
    id: 'system:auto-debit',
    type: 'SERVICE',
    tenantId,
    assurance: 'SERVICE_KEY',
    channel: 'SYSTEM',
    scopes: ['loan.read', 'loan.repayment.post'],
  };
}

function maskAccount(n: string): string {
  return n.length <= 4
    ? n
    : `${'•'.repeat(Math.min(8, n.length - 4))}${n.slice(-4)}`;
}

/**
 * Payment channels on running loans:
 *
 *  - UC-16 direct-debit mandates and the end-of-day collection under them,
 *    with a configurable retry policy and a failure notice through the outbox;
 *  - UC-21 payments in another currency, converted at the bank's rate (mid
 *    less a configurable spread) with the rate stored on the event and the
 *    difference to mid posted as FX gain or loss.
 *
 * Settlement and payroll files (UC-18, UC-19) are in ChannelFilesService.
 */
@Injectable()
export class PaymentChannelsService {
  private readonly logger = new Logger(PaymentChannelsService.name);

  constructor(
    private readonly lp: LendingPrisma,
    private readonly policy: PolicyService,
    private readonly audit: AuditEventService,
    private readonly businessDate: BusinessDateService,
    private readonly posting: PostingService,
    private readonly servicing: ServicingService,
    private readonly suspense: SuspenseService,
    private readonly adapters: AdapterRegistry,
  ) {
    // Collect what falls due today before the batch accrues, charges
    // penalties and ages arrears, so a collected instalment is never late.
    // A collection problem is logged, never allowed to stop the rest of end of day.
    this.servicing.registerTenantBatchHook(
      async (tenantId, businessDate, _a, scope) => {
        try {
          await this.collectDue(tenantId, businessDate, scope);
        } catch (e) {
          this.logger.error(
            `Auto-debit run failed for tenant ${tenantId} on ${businessDate}: ${(e as Error).message}`,
          );
        }
      },
    );
  }

  // ── Settings ──────────────────────────────────────────────────────────────

  static async settingsIn(tx: Tx, tenantId: string): Promise<SettingsBody> {
    const row = await tx.paymentChannelSettings.findFirst({
      where: { tenantId },
    });
    return row
      ? {
          fxSpreadBps: row.fxSpreadBps,
          fxMaxRateAgeDays: row.fxMaxRateAgeDays,
          autoDebitMaxAttempts: row.autoDebitMaxAttempts,
          autoDebitRetryDays: row.autoDebitRetryDays,
        }
      : { ...DEFAULT_CHANNEL_SETTINGS };
  }

  async settings(actor: LendingActor) {
    const tenantId = requireTenant(actor);
    return this.lp.tenantTx(tenantId, async (tx) => {
      await this.policy.enforce(
        actor,
        'payment.channel.read',
        tenantResource(tenantId),
        tx,
      );
      return {
        settings: await PaymentChannelsService.settingsIn(tx, tenantId),
        adapters: {
          bankDebit: this.adapters.status().bankDebit,
          fxRates: this.adapters.status().fxRates,
        },
      };
    });
  }

  async updateSettings(actor: LendingActor, body: SettingsBody) {
    const tenantId = requireTenant(actor);
    return this.lp.tenantTx(tenantId, async (tx) => {
      await this.policy.enforce(
        actor,
        'payment.channel.configure',
        tenantResource(tenantId),
        tx,
      );
      const before = await PaymentChannelsService.settingsIn(tx, tenantId);
      const existing = await tx.paymentChannelSettings.findFirst({
        where: { tenantId },
        select: { id: true },
      });
      if (existing)
        await tx.paymentChannelSettings.updateMany({
          where: { id: existing.id, tenantId },
          data: { ...body, updatedBy: actor.id },
        });
      else
        await tx.paymentChannelSettings.create({
          data: { tenantId, ...body, updatedBy: actor.id },
        });
      await this.audit.write(
        {
          actor,
          action: 'payment.channel.configure',
          resourceType: 'PaymentChannelSettings',
          resourceId: tenantId,
          outcome: 'SUCCESS',
          details: { before, after: body } as never,
        },
        tx,
      );
      return { settings: body };
    });
  }

  // ── Direct-debit mandates (UC-16) ─────────────────────────────────────────

  async mandates(actor: LendingActor, loanId: string) {
    const tenantId = requireTenant(actor);
    return this.lp.tenantTx(tenantId, async (tx) => {
      const state = await loadLoanState(tx, tenantId, loanId, { lock: false });
      await this.policy.enforce(actor, 'loan.read', resourceOf(state), tx);
      const rows = await tx.directDebitMandate.findMany({
        where: { tenantId, loanAccountId: loanId },
        orderBy: { createdAt: 'desc' },
      });
      const attempts = await tx.autoDebitAttempt.findMany({
        where: { tenantId, loanAccountId: loanId },
        orderBy: [{ createdAt: 'desc' }],
        take: 50,
      });
      return {
        mandates: rows.map((m) => this.mandateView(m)),
        attempts: attempts.map((a) => this.attemptView(a)),
      };
    });
  }

  async createMandate(actor: LendingActor, loanId: string, body: MandateBody) {
    const tenantId = requireTenant(actor);
    return this.lp.tenantTx(tenantId, async (tx) => {
      const state = await loadLoanState(tx, tenantId, loanId);
      await this.policy.enforce(
        actor,
        'loan.mandate.manage',
        resourceOf(state),
        tx,
      );
      if (!['BOOKED', 'ACTIVE'].includes(state.account.status))
        throw new ConflictException(
          `A mandate can only be set up on a live loan; this one is ${state.account.status.toLowerCase()}.`,
        );
      const businessDate = await this.businessDate.get(tenantId, tx);
      lending.parseDate(body.consentDate, 'consentDate');
      if (lending.compareDates(body.consentDate, businessDate) > 0)
        throw new BadRequestException(
          'The borrower cannot have consented after today.',
        );
      const active = await tx.directDebitMandate.findFirst({
        where: { tenantId, loanAccountId: loanId, status: 'ACTIVE' },
      });
      if (active)
        throw new ConflictException(
          `Mandate ${active.mandateReference} is already active on this loan; revoke it first.`,
        );
      const taken = await tx.directDebitMandate.findFirst({
        where: { tenantId, mandateReference: body.mandateReference },
        select: { id: true },
      });
      if (taken)
        throw new ConflictException(
          `Mandate reference ${body.mandateReference} is already in use.`,
        );
      const m = await tx.directDebitMandate.create({
        data: {
          tenantId,
          loanAccountId: loanId,
          mandateReference: body.mandateReference,
          bankCode: body.bankCode,
          accountNumber: body.accountNumber,
          accountName: body.accountName,
          consentDate: fromLocalDate(body.consentDate),
          createdBy: actor.id,
        },
      });
      await this.audit.write(
        {
          actor,
          action: 'loan.mandate.manage',
          resourceType: 'DirectDebitMandate',
          resourceId: m.id,
          outcome: 'SUCCESS',
          details: {
            loanId,
            mandateReference: m.mandateReference,
            operation: 'CREATE',
          },
          businessDate: fromLocalDate(businessDate),
        },
        tx,
      );
      return this.mandateView(m);
    });
  }

  async revokeMandate(
    actor: LendingActor,
    loanId: string,
    mandateId: string,
    body: { reason: string },
  ) {
    const tenantId = requireTenant(actor);
    return this.lp.tenantTx(tenantId, async (tx) => {
      const state = await loadLoanState(tx, tenantId, loanId);
      await this.policy.enforce(
        actor,
        'loan.mandate.manage',
        resourceOf(state),
        tx,
      );
      const m = await tx.directDebitMandate.findFirst({
        where: { id: mandateId, tenantId, loanAccountId: loanId },
      });
      if (!m) throw new NotFoundException('Mandate not found');
      const res = await tx.directDebitMandate.updateMany({
        where: { id: mandateId, tenantId, status: 'ACTIVE' },
        data: {
          status: 'REVOKED',
          revokedAt: new Date(),
          revokedBy: actor.id,
          revokeReason: body.reason.slice(0, 500),
        },
      });
      if (res.count !== 1)
        throw new ConflictException('This mandate is already revoked.');
      // A revoked mandate is never retried.
      await tx.autoDebitAttempt.updateMany({
        where: { tenantId, mandateId, status: 'FAILED' },
        data: { nextRetryDate: null },
      });
      await this.audit.write(
        {
          actor,
          action: 'loan.mandate.manage',
          resourceType: 'DirectDebitMandate',
          resourceId: mandateId,
          outcome: 'SUCCESS',
          details: { loanId, operation: 'REVOKE', reason: body.reason },
        },
        tx,
      );
      return this.mandateView({
        ...m,
        status: 'REVOKED',
        revokedAt: new Date(),
        revokedBy: actor.id,
        revokeReason: body.reason,
      });
    });
  }

  /** Recent collection attempts across the tenant, newest first. */
  async attempts(actor: LendingActor, status?: string) {
    const tenantId = requireTenant(actor);
    return this.lp.tenantTx(tenantId, async (tx) => {
      await this.policy.enforce(
        actor,
        'payment.channel.read',
        tenantResource(tenantId),
        tx,
      );
      const rows = await tx.autoDebitAttempt.findMany({
        where: { tenantId, ...(status ? { status } : {}) },
        orderBy: { createdAt: 'desc' },
        take: 200,
        include: { mandate: { select: { mandateReference: true } } },
      });
      const loans = await tx.loanAccount.findMany({
        where: {
          tenantId,
          id: { in: [...new Set(rows.map((r) => r.loanAccountId))] },
        },
        select: { id: true, reference: true },
      });
      const ref = new Map(loans.map((l) => [l.id, l.reference]));
      return rows.map((r) => ({
        ...this.attemptView(r),
        mandateReference: r.mandate.mandateReference,
        loanReference: ref.get(r.loanAccountId) ?? null,
      }));
    });
  }

  /**
   * End of day (UC-16): for every active mandate on a loan in the batch's
   * scope, collect what has fallen due when an instalment is due today or a
   * failed attempt is due for retry. Each attempt is recorded before the bank
   * is called, so a crash between the two leaves a PENDING attempt to chase
   * rather than an untraceable debit; the bank sees the attempt id and refuses
   * a repeat.
   */
  async collectDue(
    tenantId: string,
    businessDate: string,
    scope: Prisma.LoanAccountWhereInput,
  ) {
    const actor = autoDebitActor(tenantId);
    const plan = await this.lp.tenantTx(tenantId, async (tx) => {
      const mandates = await tx.directDebitMandate.findMany({
        where: { tenantId, status: 'ACTIVE' },
      });
      if (!mandates.length) return [];
      const loans = await tx.loanAccount.findMany({
        where: {
          AND: [
            { tenantId, status: 'ACTIVE' },
            { id: { in: mandates.map((m) => m.loanAccountId) } },
            scope,
          ],
        },
        select: { id: true },
      });
      const live = new Set(loans.map((l) => l.id));
      const settings = await PaymentChannelsService.settingsIn(tx, tenantId);
      const today = fromLocalDate(businessDate);
      const out: {
        mandate: (typeof mandates)[number];
        dueDate: string;
        attemptNo: number;
        retryOf: string | null;
        policy: lending.AutoDebitRetryPolicy;
      }[] = [];
      for (const m of mandates) {
        if (!live.has(m.loanAccountId)) continue;
        const policy = {
          maxAttempts: settings.autoDebitMaxAttempts,
          retryIntervalDays: settings.autoDebitRetryDays,
        };
        const retry = await tx.autoDebitAttempt.findFirst({
          where: {
            tenantId,
            mandateId: m.id,
            status: 'FAILED',
            nextRetryDate: { lte: today },
          },
          orderBy: [{ dueDate: 'desc' }, { attemptNo: 'desc' }],
        });
        if (retry) {
          out.push({
            mandate: m,
            dueDate: toLocalDate(retry.dueDate)!,
            attemptNo: retry.attemptNo + 1,
            retryOf: retry.id,
            policy,
          });
          continue;
        }
        const dueToday = await tx.scheduleInstalment.findFirst({
          where: {
            tenantId,
            loanAccountId: m.loanAccountId,
            status: 'DUE',
            number: { gt: 0 },
            dueDate: today,
          },
          select: { id: true },
        });
        if (!dueToday) continue;
        // Not before the borrower consented.
        if (lending.compareDates(toLocalDate(m.consentDate)!, businessDate) > 0)
          continue;
        // A batch re-run on the same day does not debit twice.
        const tried = await tx.autoDebitAttempt.findFirst({
          where: { tenantId, mandateId: m.id, dueDate: today },
          select: { id: true },
        });
        if (tried) continue;
        out.push({
          mandate: m,
          dueDate: businessDate,
          attemptNo: 1,
          retryOf: null,
          policy,
        });
      }
      return out;
    });
    if (!plan.length) return;
    let bank: BankDebitAdapter;
    try {
      bank = this.adapters.bankDebit();
    } catch (e) {
      // No real bank integration here (mock refused in production): nothing is
      // attempted, so nothing needs undoing; due instalments simply stay due.
      this.logger.error(
        `Auto-debit skipped for tenant ${tenantId}: ${(e as Error).message}`,
      );
      return;
    }
    for (const p of plan) {
      try {
        await this.attempt(tenantId, businessDate, actor, bank, p);
      } catch (e) {
        this.logger.error(
          `Auto-debit of mandate ${p.mandate.mandateReference} failed: ${(e as Error).message}`,
        );
      }
    }
  }

  private async attempt(
    tenantId: string,
    businessDate: string,
    actor: LendingActor,
    bank: BankDebitAdapter,
    p: {
      mandate: {
        id: string;
        loanAccountId: string;
        mandateReference: string;
        bankCode: string;
        accountNumber: string;
      };
      dueDate: string;
      attemptNo: number;
      retryOf: string | null;
      policy: lending.AutoDebitRetryPolicy;
    },
  ) {
    const m = p.mandate;
    // 1. Decide the amount and record the attempt.
    const attempt = await this.lp.tenantTx(tenantId, async (tx) => {
      const state = await loadLoanState(tx, tenantId, m.loanAccountId, {
        lock: false,
      });
      const amount = lending.amountToCollect(
        state.lines
          .filter((l) => l.status === 'DUE' && l.number > 0)
          .map((l) => ({
            dueDate: toLocalDate(l.dueDate)!,
            outstanding: Object.values(outstanding(l))
              .reduce((s, v) => s.plus(v), D(0))
              .toString(),
          })),
        businessDate,
        D(state.account.advanceBalance).toString(),
      );
      if (D(amount).lte(0)) {
        // Paid some other way since the last attempt: stop retrying.
        if (p.retryOf)
          await tx.autoDebitAttempt.updateMany({
            where: { id: p.retryOf, tenantId },
            data: {
              nextRetryDate: null,
              detail: 'Paid by other means; no retry needed.',
            },
          });
        return null;
      }
      if (p.retryOf)
        await tx.autoDebitAttempt.updateMany({
          where: { id: p.retryOf, tenantId },
          data: { nextRetryDate: null },
        });
      return tx.autoDebitAttempt.create({
        data: {
          tenantId,
          mandateId: m.id,
          loanAccountId: m.loanAccountId,
          dueDate: fromLocalDate(p.dueDate),
          attemptNo: p.attemptNo,
          businessDate: fromLocalDate(businessDate),
          amount,
          currency: state.account.currency,
          adapter: bank.name,
        },
      });
    });
    if (!attempt) return;
    const amount = D(attempt.amount).toString();

    // 2. Ask the bank — outside any database transaction.
    let result: Awaited<ReturnType<BankDebitAdapter['debit']>>;
    try {
      result = await bank.debit({
        tenantId,
        mandateReference: m.mandateReference,
        bankCode: m.bankCode,
        accountNumber: m.accountNumber,
        amount,
        currency: attempt.currency,
        reference: attempt.id,
      });
    } catch (e) {
      result = {
        status: 'FAILED',
        failureCode: 'BANK_UNAVAILABLE',
        bankReference: null,
      };
      this.logger.warn(`Bank debit call failed: ${(e as Error).message}`);
    }

    // 3a. Refused: record it, schedule the retry and tell the borrower.
    if (result.status === 'FAILED') {
      const failure = result;
      const next = lending.nextDebitAttempt(
        p.policy,
        p.attemptNo,
        businessDate,
        failure.failureCode,
      );
      await this.lp.tenantTx(tenantId, async (tx) => {
        await tx.autoDebitAttempt.updateMany({
          where: { id: attempt.id, tenantId, status: 'PENDING' },
          data: {
            status: 'FAILED',
            failureCode: failure.failureCode,
            bankReference: failure.bankReference,
            nextRetryDate: next ? fromLocalDate(next) : null,
            completedAt: new Date(),
            detail: next
              ? `Retry ${p.attemptNo + 1} of ${p.policy.maxAttempts} on ${next}.`
              : 'No further attempts for this due date.',
          },
        });
        await this.servicing.outbox(tx, tenantId, 'lending.auto_debit.failed', {
          loanAccountId: m.loanAccountId,
          mandateReference: m.mandateReference,
          attemptId: attempt.id,
          attemptNo: p.attemptNo,
          dueDate: p.dueDate,
          amount,
          currency: attempt.currency,
          failureCode: failure.failureCode,
          nextRetryDate: next,
          final: !next,
        });
        await this.audit.write(
          {
            actor,
            action: 'payment.auto_debit.attempt',
            resourceType: 'AutoDebitAttempt',
            resourceId: attempt.id,
            outcome: 'FAILURE',
            details: { failureCode: failure.failureCode, nextRetryDate: next },
            businessDate: fromLocalDate(businessDate),
          },
          tx,
        );
      });
      return;
    }

    // 3b. Collected: apply it as a repayment, the same one a teller posts.
    const bankReference = result.bankReference;
    const external = `DD ${m.mandateReference} ${bankReference}`.slice(0, 120);
    try {
      await this.lp.tenantTx(tenantId, async (tx) => {
        const event = await this.servicing.repayInTx(
          tx,
          actor,
          m.loanAccountId,
          { amount, valueDate: businessDate, externalReference: external },
          `sys:autodebit:${attempt.id}`,
          'auto-debit',
          {
            components: {
              channel: {
                type: 'AUTO_DEBIT',
                mandateReference: m.mandateReference,
                attemptId: attempt.id,
                attemptNo: p.attemptNo,
              },
            },
          },
        );
        await tx.autoDebitAttempt.updateMany({
          where: { id: attempt.id, tenantId, status: 'PENDING' },
          data: {
            status: 'SUCCEEDED',
            bankReference,
            financialEventId: event.id,
            completedAt: new Date(),
          },
        });
      });
    } catch (e) {
      if (!(e instanceof HttpException)) throw e;
      // The bank has the money but the loan refused it (closed, changed…):
      // it goes to suspense, never back into the void (UC-28).
      const reason = e.message;
      await this.lp.tenantTx(tenantId, async (tx) => {
        const held = await this.suspense.receiveInTx(
          tx,
          actor,
          {
            amount,
            currency: attempt.currency,
            valueDate: businessDate,
            channel: 'BANK_TRANSFER',
            externalReference: external,
            narrative: `Auto-debit collected but not applied: ${reason}`.slice(
              0,
              500,
            ),
          },
          `sys:autodebit-suspense:${attempt.id}`,
          'auto-debit',
        );
        await tx.autoDebitAttempt.updateMany({
          where: { id: attempt.id, tenantId, status: 'PENDING' },
          data: {
            status: 'SUSPENSE',
            bankReference,
            unidentifiedPaymentId: held.id,
            completedAt: new Date(),
            detail: reason.slice(0, 500),
          },
        });
      });
    }
  }

  private mandateView(m: {
    id: string;
    loanAccountId: string;
    mandateReference: string;
    bankCode: string;
    accountNumber: string;
    accountName: string;
    consentDate: Date;
    status: string;
    revokedAt: Date | null;
    revokedBy: string | null;
    revokeReason: string;
    createdBy: string;
    createdAt: Date;
  }) {
    return {
      id: m.id,
      loanAccountId: m.loanAccountId,
      mandateReference: m.mandateReference,
      bankCode: m.bankCode,
      // The full account number stays in the database for the bank call.
      accountNumber: maskAccount(m.accountNumber),
      accountName: m.accountName,
      consentDate: toLocalDate(m.consentDate),
      status: m.status,
      revokedAt: m.revokedAt,
      revokedBy: m.revokedBy,
      revokeReason: m.revokeReason,
      createdBy: m.createdBy,
      createdAt: m.createdAt,
    };
  }

  private attemptView(a: {
    id: string;
    mandateId: string;
    loanAccountId: string;
    dueDate: Date;
    attemptNo: number;
    businessDate: Date;
    amount: Prisma.Decimal;
    currency: string;
    adapter: string;
    status: string;
    failureCode: string | null;
    bankReference: string | null;
    financialEventId: string | null;
    unidentifiedPaymentId: string | null;
    nextRetryDate: Date | null;
    detail: string;
    createdAt: Date;
  }) {
    return {
      id: a.id,
      mandateId: a.mandateId,
      loanAccountId: a.loanAccountId,
      dueDate: toLocalDate(a.dueDate),
      attemptNo: a.attemptNo,
      businessDate: toLocalDate(a.businessDate),
      amount: a.amount.toString(),
      currency: a.currency,
      adapter: a.adapter,
      status: a.status,
      failureCode: a.failureCode,
      bankReference: a.bankReference,
      financialEventId: a.financialEventId,
      unidentifiedPaymentId: a.unidentifiedPaymentId,
      nextRetryDate: toLocalDate(a.nextRetryDate),
      detail: a.detail,
      createdAt: a.createdAt,
    };
  }

  // ── Cross-currency payments (UC-21) ───────────────────────────────────────

  /**
   * The tenant's own published rates (the legacy FX rate table, maintained
   * under FX_MANAGE): the latest rate for the pair, in either direction,
   * effective on or before the date.
   */
  private rateTable(tx: Tx, tenantId: string): FxRateAdapter {
    const known = new Set<string>(Object.values(Currency));
    return {
      name: 'TENANT_RATE_TABLE',
      isMock: false,
      rate: async ({ from, to, onOrBefore }) => {
        if (!known.has(from) || !known.has(to)) return null;
        const before = fromLocalDate(lending.addDays(onOrBefore, 1));
        const pick = (f: string, t: string) =>
          tx.exchangeRate.findFirst({
            where: {
              tenantId,
              fromCurrency: f as Currency,
              toCurrency: t as Currency,
              effectiveDate: { lt: before },
            },
            orderBy: [{ effectiveDate: 'desc' }, { createdAt: 'desc' }],
          });
        const [direct, inverse] = await Promise.all([
          pick(from, to),
          pick(to, from),
        ]);
        const row =
          direct && inverse
            ? direct.effectiveDate >= inverse.effectiveDate
              ? direct
              : inverse
            : (direct ?? inverse);
        if (!row) return null;
        return {
          base: row.fromCurrency,
          quote: row.toCurrency,
          rate: D(row.rate).toString(),
          rateDate: row.effectiveDate.toISOString().slice(0, 10),
          source: `TENANT_RATE_TABLE:${row.id}`,
        };
      },
    };
  }

  private async convert(
    tx: Tx,
    tenantId: string,
    loanCurrency: string,
    body: { amount: string; currency: string; valueDate?: string },
  ) {
    const businessDate = await this.businessDate.get(tenantId, tx);
    const valueDate = body.valueDate ?? businessDate;
    lending.parseDate(valueDate, 'valueDate');
    const from = engineCall(() => lending.getCurrency(body.currency).code);
    if (from === loanCurrency)
      throw new BadRequestException(
        `The loan is in ${loanCurrency}; post an ordinary repayment.`,
      );
    const settings = await PaymentChannelsService.settingsIn(tx, tenantId);
    const source = this.adapters.fxRates(this.rateTable(tx, tenantId));
    const quote = await source.rate({
      tenantId,
      from,
      to: loanCurrency,
      onOrBefore: valueDate,
    });
    if (
      !quote ||
      !lending.rateUsable(quote.rateDate, valueDate, settings.fxMaxRateAgeDays)
    )
      throw new BadRequestException({
        message: `No ${from}/${loanCurrency} rate is published for ${valueDate}${settings.fxMaxRateAgeDays ? ` or the ${settings.fxMaxRateAgeDays} day(s) before` : ''}; the payment cannot be converted.`,
        code: 'FX_RATE_MISSING',
      });
    const conversion = engineCall(() =>
      lending.convertPayment({
        amount: body.amount,
        from,
        to: loanCurrency,
        quote,
        spreadBps: settings.fxSpreadBps,
      }),
    );
    return {
      businessDate,
      valueDate,
      conversion,
      rate: {
        source: quote.source,
        rateDate: quote.rateDate,
        base: quote.base,
        quote: quote.quote,
        rate: quote.rate,
      },
    };
  }

  /** What a payment in another currency would credit to the loan, without posting. */
  async fxQuote(
    actor: LendingActor,
    loanId: string,
    q: { amount?: string; currency?: string; valueDate?: string },
  ) {
    const tenantId = requireTenant(actor);
    if (!q.amount || !/^\d+(\.\d{1,4})?$/.test(q.amount) || !q.currency)
      throw new BadRequestException(
        'Give the amount and currency of the payment.',
      );
    if (q.valueDate && !/^\d{4}-\d{2}-\d{2}$/.test(q.valueDate))
      throw new BadRequestException('valueDate must be YYYY-MM-DD.');
    return this.lp.tenantTx(tenantId, async (tx) => {
      const state = await loadLoanState(tx, tenantId, loanId, { lock: false });
      await this.policy.enforce(actor, 'loan.read', resourceOf(state), tx);
      const r = await this.convert(tx, tenantId, state.account.currency, {
        amount: q.amount!,
        currency: q.currency!.toUpperCase(),
        valueDate: q.valueDate,
      });
      return { valueDate: r.valueDate, conversion: r.conversion, rate: r.rate };
    });
  }

  /**
   * Post a payment made in another currency. Two journals, each balanced in
   * its own currency:
   *
   *   payment currency  Dr cash                 amount
   *                     Cr FX position          amount
   *   loan currency     Dr FX position          value at mid
   *                     Cr loan receivables     converted (the ordinary repayment)
   *                     Cr FX gain / loss       value at mid − converted
   *
   * The repayment is the ordinary one (allocation, advances, prepayment
   * rules) for the converted amount; its event carries the conversion and
   * the rate it used. Refused when no rate is published for the value date.
   */
  async fxRepayment(
    actor: LendingActor,
    loanId: string,
    body: FxRepaymentBody,
    idempotencyKey: string,
  ) {
    const tenantId = requireTenant(actor);
    const hash = requestHash({ op: 'fx-repay', id: loanId, body });
    return this.servicing.money(tenantId, idempotencyKey, hash, async (tx) => {
      const loan = await tx.loanAccount.findFirst({
        where: { id: loanId, tenantId },
        select: { currency: true },
      });
      if (!loan) throw new NotFoundException('Loan account not found');
      const { businessDate, valueDate, conversion, rate } = await this.convert(
        tx,
        tenantId,
        loan.currency,
        body,
      );
      const gain = D(conversion.gainLoss);
      const event = await this.servicing.repayInTx(
        tx,
        actor,
        loanId,
        {
          amount: conversion.converted,
          valueDate,
          externalReference: body.externalReference,
          prepaymentStrategy: body.prepaymentStrategy,
          applyExcessAs: body.applyExcessAs,
          payer: body.payer,
        },
        idempotencyKey,
        hash,
        {
          fundingAccount: ACCOUNT_CODES.FX_POSITION,
          components: { fx: { ...conversion, rate } },
          extraLines: gain.isZero()
            ? []
            : gain.gt(0)
              ? [
                  {
                    accountCode: ACCOUNT_CODES.FX_POSITION,
                    debit: gain.toString(),
                  },
                  {
                    accountCode: ACCOUNT_CODES.FX_GAIN_LOSS,
                    credit: gain.toString(),
                  },
                ]
              : [
                  {
                    accountCode: ACCOUNT_CODES.FX_GAIN_LOSS,
                    debit: gain.abs().toString(),
                  },
                  {
                    accountCode: ACCOUNT_CODES.FX_POSITION,
                    credit: gain.abs().toString(),
                  },
                ],
        },
      );
      const narrative = `Received ${conversion.amount} ${conversion.from} for ${conversion.converted} ${conversion.to} at ${conversion.bankRate}`;
      const receipt = await tx.financialEvent.create({
        data: {
          tenantId,
          loanAccountId: loanId,
          type: 'FX_RECEIPT',
          businessDate: fromLocalDate(businessDate),
          valueDate: fromLocalDate(valueDate),
          amount: conversion.amount,
          currency: conversion.from,
          components: {
            fx: { ...conversion, rate },
            repaymentEventId: event.id,
          } as unknown as Json,
          idempotencyKey: `${idempotencyKey}:fx-receipt`,
          requestHash: hash,
          productVersionId: event.productVersionId,
          agreementVersion: event.agreementVersion,
          engineVersion: lending.LENDING_ENGINE_VERSION,
          actorId: actor.id,
          actorType: actor.type,
          externalReference: body.externalReference?.slice(0, 120) ?? null,
          narrative,
        },
      });
      await this.posting.post(tx, {
        tenantId,
        financialEventId: receipt.id,
        loanAccountId: loanId,
        entryDate: fromLocalDate(businessDate),
        currency: conversion.from,
        description: narrative,
        lines: [
          { accountCode: ACCOUNT_CODES.CASH, debit: conversion.amount },
          { accountCode: ACCOUNT_CODES.FX_POSITION, credit: conversion.amount },
        ],
      });
      await this.audit.write(
        {
          actor,
          action: 'loan.repayment.post',
          resourceType: 'LoanAccount',
          resourceId: loanId,
          outcome: 'SUCCESS',
          details: {
            fx: true,
            event: event.id,
            receipt: receipt.id,
            paid: `${conversion.amount} ${conversion.from}`,
            credited: `${conversion.converted} ${conversion.to}`,
            bankRate: conversion.bankRate,
            gainLoss: conversion.gainLoss,
          },
          businessDate: fromLocalDate(businessDate),
        },
        tx,
      );
      return { ...event, fxReceiptEventId: receipt.id, conversion };
    });
  }
}
