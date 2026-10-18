import { Injectable } from '@nestjs/common';
import { lending } from '@microloan/shared';
import { Currency } from '@microloan/db';
import type { Tx } from '../common/lending-prisma';
import { D, fromLocalDate, toLocalDate } from '../common/util';
import { TenantSettingsService } from '../../tenant-settings/tenant-settings.service';
import { AlternativeDataService } from './alternative-data.service';
import {
  AltDataProvidersService,
  PROVIDER_VARIABLES,
  type ProviderSource,
} from './providers';
import { instalmentHistories } from './repayment-history';

/** One input in the snapshot: its value, where it came from and under which consent. */
export interface FeatureValue {
  value: string | number | boolean | null;
  source: lending.ScoringSource;
  /** The consent grant it was used under (alternative data only). */
  consentId?: string | null;
  /** Officer records or loans it was derived from. */
  evidence?: string[];
  /** Why it is missing, or how it was converted. */
  note?: string;
}

export interface FeatureSnapshot {
  asOf: string;
  evaluatedAt: string;
  currency: string;
  features: Record<string, FeatureValue>;
}

/**
 * Assembles a scorecard's inputs (DECISIONS D-079): bureau (none until a
 * bureau is integrated), application, the lender's own data, verified
 * officer records and provider data — each with its source and, for
 * alternative data, the consent it was used under. Nothing that needs a
 * consent is read unless one is in force now. The snapshot is stored with
 * the evaluation, so every score can be reproduced from it.
 */
@Injectable()
export class FeatureStoreService {
  constructor(
    private readonly settings: TenantSettingsService,
    private readonly altData: AlternativeDataService,
    private readonly providers: AltDataProvidersService,
  ) {}

  async assemble(
    tx: Tx,
    input: {
      tenantId: string;
      borrowerId: string;
      applicationId: string;
      currency: string;
      asOf: string;
      metrics: Record<string, string | number | null>;
      /** Average monthly instalment, in the application's currency. */
      monthlyPayment: string;
      variables: string[];
    },
  ): Promise<FeatureSnapshot> {
    const { tenantId, borrowerId, asOf } = input;
    const need = new Set(input.variables);
    const f: Record<string, FeatureValue> = {};
    const m = input.metrics;

    // Application and assessment.
    f.debtServiceRatio = {
      value: typeof m.debtServiceRatio === 'string' ? m.debtServiceRatio : null,
      source: 'APPLICATION',
      ...(typeof m.debtServiceRatio === 'string'
        ? {}
        : { note: 'Monthly income unknown.' }),
    };
    f.ageYears = {
      value: typeof m.ageYears === 'number' ? m.ageYears : null,
      source: 'APPLICATION',
    };
    f.loanToValue = {
      value: typeof m.loanToValue === 'string' ? m.loanToValue : null,
      source: 'APPLICATION',
    };
    f.guarantees = {
      value: await tx.guarantee.count({
        where: { tenantId, applicationId: input.applicationId },
      }),
      source: 'APPLICATION',
    };

    // The lender's own records: the checks every application has always had.
    const loans = await tx.loanAccount.findMany({
      where: { tenantId, borrowerId },
      select: {
        id: true,
        status: true,
        daysPastDue: true,
        disbursementDate: true,
      },
    });
    const first = loans
      .map((l) => toLocalDate(l.disbursementDate))
      .filter((d): d is string => !!d)
      .sort()[0];
    f.closedLoans = {
      value: loans.filter((l) => l.status === 'CLOSED').length,
      source: 'INTERNAL',
    };
    f.worstCurrentDpd = {
      value: Math.max(
        0,
        ...loans.filter((l) => l.status === 'ACTIVE').map((l) => l.daysPastDue),
      ),
      source: 'INTERNAL',
    };
    f.writtenOff = {
      value: loans.some((l) => ['WRITTEN_OFF', 'SOLD'].includes(l.status)),
      source: 'INTERNAL',
    };
    f.internalHistoryMonths = {
      value: lending.historyMonths(first ?? null, asOf),
      source: 'INTERNAL',
    };
    f.bureauScore = {
      value: null,
      source: 'BUREAU',
      note: 'No credit bureau is integrated yet.',
    };

    const settings = await this.settings.get(tenantId, tx);
    const events = await this.altData.consentEvents(tx, tenantId, borrowerId);
    const now = new Date().toISOString();
    const consent = (s: lending.AltDataSource) =>
      lending.consentInForce(events, s, now);
    const missing = (
      code: string,
      source: lending.ScoringSource,
      note: string,
    ) => {
      f[code] = { value: null, source, consentId: null, note };
    };

    // The lender's own behavioural data, beyond the standard checks.
    const behaviour = [
      'onTimeRepaymentRatio',
      'averageDaysLate',
      'maxDaysPastDueEver',
      'instalmentsObserved',
      'digitalRepaymentShare',
      'groupContributionMonths',
    ].filter((v) => need.has(v));
    if (behaviour.length) {
      const g = consent('INTERNAL_BEHAVIOUR');
      if (!g)
        for (const v of behaviour)
          missing(
            v,
            'INTERNAL',
            'No consent in force for internal behavioural data.',
          );
      else {
        const ids = loans.map((l) => l.id);
        const histories = await instalmentHistories(tx, tenantId, ids);
        const all = [...histories.values()].flat();
        const b = lending.repaymentBehaviour(all, asOf);
        const set = (code: string, value: string | number | null) => {
          f[code] = {
            value,
            source: 'INTERNAL',
            consentId: g.id,
            evidence: ids,
            ...(value === null
              ? { note: 'No instalment has fallen due yet.' }
              : {}),
          };
        };
        set('onTimeRepaymentRatio', b.onTimeRepaymentRatio);
        set('averageDaysLate', b.averageDaysLate);
        set('maxDaysPastDueEver', b.maxDaysPastDueEver);
        set('instalmentsObserved', b.instalmentsObserved);
        const [repayments, digital, contributions] = await Promise.all([
          tx.financialEvent.count({
            where: {
              tenantId,
              loanAccountId: { in: ids },
              type: 'REPAYMENT',
              status: 'POSTED',
            },
          }),
          tx.channelFileLine.count({
            where: {
              tenantId,
              loanAccountId: { in: ids },
              outcome: 'POSTED',
              channel: { in: settings.scoring.alternativeData.digitalChannels },
            },
          }),
          tx.groupContribution.findMany({
            where: { tenantId, borrowerId },
            select: { createdAt: true },
          }),
        ]);
        f.digitalRepaymentShare = {
          value: repayments
            ? D(Math.min(digital, repayments))
                .div(repayments)
                .toDecimalPlaces(4)
                .toString()
            : null,
          source: 'INTERNAL',
          consentId: g.id,
          note: `${digital} of ${repayments} repayment(s) through ${settings.scoring.alternativeData.digitalChannels.join('/')} channel files.`,
        };
        f.groupContributionMonths = {
          value: new Set(
            contributions.map((c) => c.createdAt.toISOString().slice(0, 7)),
          ).size,
          source: 'INTERNAL',
          consentId: g.id,
        };
      }
    }

    // Verified officer records, each kind under its own consent.
    const officerVars: Record<string, lending.AltDataSource> = {
      utilityOnTimeRatio: 'UTILITY_BILLS',
      utilityMonthsObserved: 'UTILITY_BILLS',
      mobileTopUpMonthsActive: 'TELCO_STATEMENT',
      rentOnTimeRatio: 'RENT_HISTORY',
      businessCashFlowCoverage: 'BUSINESS_CASH_FLOW',
    };
    const officerNeeded = Object.keys(officerVars).filter((v) => need.has(v));
    if (officerNeeded.length) {
      const cutoff = lending.addDays(
        asOf,
        -settings.scoring.alternativeData.maxRecordAgeDays,
      );
      const rows = await tx.altDataRecord.findMany({
        where: {
          tenantId,
          borrowerId,
          status: 'VERIFIED',
          periodTo: { gte: fromLocalDate(cutoff) },
        },
      });
      const consented = rows.filter(
        (r) =>
          !!consent(
            lending.OFFICER_DATA_CONSENT[r.kind as lending.OfficerDataKind],
          ),
      );
      const derived = lending.officerFeatures(
        consented.map((r) => ({
          id: r.id,
          kind: r.kind as lending.OfficerDataKind,
          data: r.data as Record<string, unknown>,
          periodTo: toLocalDate(r.periodTo)!,
        })),
      );
      for (const code of officerNeeded) {
        const source = officerVars[code];
        const g = consent(source);
        if (!g) {
          missing(
            code,
            'OFFICER_VERIFIED',
            `No consent in force for ${source}.`,
          );
          continue;
        }
        if (code === 'businessCashFlowCoverage') {
          const cf = derived.businessNetMonthlyCashFlow;
          if (!cf) {
            missing(
              code,
              'OFFICER_VERIFIED',
              'No verified business cash flow.',
            );
            continue;
          }
          const converted = await this.convert(
            tx,
            tenantId,
            String(cf.value),
            cf.currency,
            input.currency,
            asOf,
          );
          if (!converted) {
            f[code] = {
              value: null,
              source: 'OFFICER_VERIFIED',
              consentId: g.id,
              evidence: cf.recordIds,
              note: `No ${cf.currency}/${input.currency} rate is published; cash flow could not be compared with the instalment.`,
            };
            continue;
          }
          f[code] = {
            value: lending.cashFlowCoverage(
              converted.amount,
              input.monthlyPayment,
            ),
            source: 'OFFICER_VERIFIED',
            consentId: g.id,
            evidence: cf.recordIds,
            note: converted.note,
          };
          continue;
        }
        const d = derived[code as keyof typeof derived];
        f[code] = d
          ? {
              value: d.value,
              source: 'OFFICER_VERIFIED',
              consentId: g.id,
              evidence: d.recordIds,
            }
          : {
              value: null,
              source: 'OFFICER_VERIFIED',
              consentId: g.id,
              note: `No verified ${source.toLowerCase().replace(/_/g, ' ')} record within ${settings.scoring.alternativeData.maxRecordAgeDays} days.`,
            };
      }
    }

    // External providers: only with consent and a real, configured adapter.
    for (const [code, source] of Object.entries(PROVIDER_VARIABLES)) {
      if (!need.has(code)) continue;
      const g = consent(source);
      if (!g) {
        missing(code, 'PROVIDER', `No consent in force for ${source}.`);
        continue;
      }
      f[code] = await this.fromProvider(
        tx,
        tenantId,
        borrowerId,
        source,
        code,
        g.id,
      );
    }

    return {
      asOf,
      evaluatedAt: now,
      currency: input.currency,
      features: f,
    };
  }

  /** Scorecard inputs from a snapshot. */
  static inputs(s: FeatureSnapshot): lending.ScoringInputs {
    return Object.fromEntries(
      Object.entries(s.features).map(([k, v]) => [k, v.value]),
    );
  }

  private async fromProvider(
    tx: Tx,
    tenantId: string,
    borrowerId: string,
    source: ProviderSource,
    code: string,
    consentId: string,
  ): Promise<FeatureValue> {
    const a = await this.providers.availability(tx, tenantId, source);
    if (!a.usable)
      return { value: null, source: 'PROVIDER', consentId, note: a.message };
    const b = await tx.borrower.findFirst({
      where: { id: borrowerId, tenantId },
      select: { phone: true },
    });
    const subject = {
      tenantId,
      borrowerId,
      consentId,
      phone: b?.phone ?? null,
    };
    try {
      const adapter = a.adapter;
      if (adapter.source === 'EWALLET_DATA') {
        const r = await adapter.activity(subject);
        return {
          value: r.monthsActive,
          source: 'PROVIDER',
          consentId,
          evidence: [r.reference],
        };
      }
      const r = await adapter.score(subject);
      return {
        value: r.score,
        source: 'PROVIDER',
        consentId,
        evidence: [r.reference],
        note: `${code} scored ${r.scoredAt}`,
      };
    } catch (e) {
      return {
        value: null,
        source: 'PROVIDER',
        consentId,
        note: `${source} provider call failed: ${(e as Error).message.slice(0, 160)}`,
      };
    }
  }

  /**
   * An amount in another currency at the tenant's own published rate (the FX
   * rate table), latest on or before the date, in either direction.
   */
  private async convert(
    tx: Tx,
    tenantId: string,
    amount: string,
    from: string,
    to: string,
    onOrBefore: string,
  ): Promise<{ amount: string; note?: string } | null> {
    if (from === to) return { amount };
    const known = new Set<string>(Object.values(Currency));
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
    const useDirect =
      direct && (!inverse || direct.effectiveDate >= inverse.effectiveDate);
    const row = useDirect ? direct : inverse;
    if (!row) return null;
    const rate = D(row.rate);
    if (rate.lte(0)) return null;
    const converted = useDirect ? D(amount).times(rate) : D(amount).div(rate);
    return {
      amount: converted.toDecimalPlaces(4).toString(),
      note: `${amount} ${from} at ${useDirect ? '' : '1/'}${rate.toString()} (${toLocalDate(row.effectiveDate)}) = ${converted.toDecimalPlaces(2).toString()} ${to}`,
    };
  }
}
