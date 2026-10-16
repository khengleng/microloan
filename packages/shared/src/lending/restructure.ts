import { D, Dec, dec, EngineError, ZERO, sum } from './decimal.js';
import { roundMoney, parseMoney } from './money.js';
import { LocalDate, parseDate } from './dates.js';
import { ScheduleInput, ScheduleResult, RatePoint, RepaymentMethod, Frequency, buildPeriods, generateSchedule, contractContext, periodFactor, LENDING_ENGINE_VERSION } from './schedule.js';

/**
 * Restructuring calculations.
 *
 * Everything starts from an immutable balance snapshot at the proposed
 * effective date. Each unpaid component is then explicitly waived,
 * capitalized (only where the rules permit), deferred interest-free over the
 * new term, or kept payable at the effective date — nothing is silently
 * dropped and nothing already in principal is capitalized again:
 *
 *   NewPrincipal = OutstandingPrincipal + ApprovedCapitalizedAmounts
 *                  − ApprovedPrincipalForgiveness − PrincipalPaymentAppliedAtRestructure
 *
 * A proposed payment that does not cover periodic interest is rejected rather
 * than producing negative amortization.
 */

export interface BalanceSnapshot {
  asOf: LocalDate;
  currency: string;
  /** Outstanding principal, including overdue principal. */
  principal: string;
  overduePrincipal: string;
  /** Interest on instalments already due and unpaid. */
  overdueInterest: string;
  /** Interest earned but not yet due. */
  accruedInterestNotDue: string;
  fees: string;
  penalties: string;
  taxes: string;
  /** Payments received but not yet allocated (held in suspense). */
  unallocatedPayments: string;
}

export type DeferredInterestTreatment = 'PAY_SEPARATELY' | 'DEFER_NO_CAPITALIZATION' | 'CAPITALIZE' | 'WAIVE';
export type ArrearsTreatment = 'PAY_AT_EFFECTIVE_DATE' | 'SPREAD_OVER_TERM';

export interface RestructureOptions {
  effectiveDate: LocalDate;
  /** New number of instalments from the effective date. */
  numberOfInstalments?: number;
  /** Sustainable payment capacity per instalment: the term is solved from it. */
  targetInstalment?: string;
  /** Permanent new annual rate (decimal fraction). Defaults to the current contract rate. */
  annualRate?: string;
  /** Temporary rate for the first `instalments` instalments, then the permanent rate. */
  temporaryRate?: { annualRate: string; instalments: number };
  /** Temporary interest-only instalments (principal grace). */
  interestOnlyInstalments?: number;
  /** Full payment deferral: nothing is paid in these instalments. */
  paymentDeferralInstalments?: number;
  /** What happens to interest arising during a full payment deferral. */
  deferredInterestTreatment?: DeferredInterestTreatment;
  /** Capitalize these unpaid amounts into the new principal (only where permitted). */
  capitalize?: { overdueInterest?: boolean; accruedInterest?: boolean; fees?: boolean; penalties?: boolean };
  /** How remaining (non-capitalized, non-waived) arrears are repaid. */
  arrearsTreatment?: ArrearsTreatment;
  /** Amounts waived (charge concessions). */
  waive?: { interest?: string; fees?: string; penalties?: string };
  /** Partial principal forgiveness — a separately controlled concession. */
  principalForgiveness?: string;
  /** A principal payment applied at the restructure. */
  principalPaymentAtRestructure?: string;
  method?: RepaymentMethod;
  frequency?: Frequency;
  balloonAmount?: string;
  /** Due-date change: a new first due date (forces actual-interval interest). */
  firstDueDate?: LocalDate;
  /** Seasonal alignment: explicitly dated principal amounts. */
  explicitSchedule?: { dueDate: LocalDate; principal: string }[];
}

export interface RestructureRules {
  /** Jurisdiction/product: may unpaid interest be capitalized (interest on interest)? */
  allowInterestCapitalization: boolean;
  allowFeeCapitalization: boolean;
  allowPenaltyCapitalization: boolean;
  maxTotalInstalments: number;
  minAnnualRate?: string | null;
  maxAnnualRate?: string | null;
  maxBalloonFraction?: string | null;
}

export interface ExtraDue {
  interest: string;
  fees: string;
  penalties: string;
  taxes: string;
}

export interface ProposedLine {
  number: number;
  periodStart: LocalDate;
  periodEnd: LocalDate;
  dueDate: LocalDate;
  openingPrincipal: string;
  principal: string;
  interest: string;
  capitalizedInterest: string;
  annualRate: string;
  /** Pre-existing arrears repaid in this line (no interest accrues on them). */
  deferred: ExtraDue;
  total: string;
}

export interface RestructureCalculation {
  engineVersion: string;
  snapshot: BalanceSnapshot;
  newPrincipal: string;
  components: {
    waived: { interest: string; fees: string; penalties: string; futureInterest: string };
    capitalized: { interest: string; fees: string; penalties: string };
    forgiven: string;
    principalPaidAtRestructure: string;
    deferred: ExtraDue;
    payableAtEffectiveDate: ExtraDue;
  };
  scheduleInput: ScheduleInput;
  schedule: ScheduleResult;
  lines: ProposedLine[];
  /** How the term was found when solving from a payment capacity. */
  termSolution: { method: 'CLOSED_FORM' | 'NUMERICAL' | 'GIVEN'; instalments: number; detail: string } | null;
  /** Interest given up versus the current rate and treatment (concession value). */
  concessionValue: { rateReduction: string; futureInterestWaived: string; total: string };
  policyExceptions: string[];
  explanation: string[];
}

const zeroExtra = (): ExtraDue => ({ interest: '0', fees: '0', penalties: '0', taxes: '0' });

function money(v: string | undefined, currency: string, field: string): Dec {
  if (v === undefined || v === null || v === '') return ZERO;
  const d = parseMoney(v, currency, field);
  if (d.lt(0)) throw new EngineError('INVALID_AMOUNT', `${field} cannot be negative.`);
  return d;
}

/**
 * Smallest number of level instalments that a capacity C can carry:
 *   n = −ln(1 − P·i / C) / ln(1 + i),   rounded up.
 * Requires i > 0 and C > P·i; at i = 0, n = ⌈P / C⌉.
 */
export function termForCapacity(principal: string, periodicRate: string, capacity: string): { n: number; exact: string } {
  const P = dec(principal);
  const i = dec(periodicRate);
  const C = dec(capacity);
  if (C.lte(0)) throw new EngineError('NO_AMORTIZATION', 'The payment capacity must be positive.');
  if (i.isZero()) {
    const exact = P.div(C);
    return { n: exact.ceil().toNumber(), exact: exact.toString() };
  }
  if (C.lte(P.times(i))) {
    throw new EngineError('NO_AMORTIZATION', 'The proposed payment does not amortize this balance at the selected rate.');
  }
  const exact = new D(1).minus(P.times(i).div(C)).ln().negated().div(new D(1).plus(i).ln());
  return { n: exact.ceil().toNumber(), exact: exact.toDecimalPlaces(6).toString() };
}

export function calculateRestructure(contract: ScheduleInput, snapshot: BalanceSnapshot, options: RestructureOptions, rules: RestructureRules): RestructureCalculation {
  const ccy = snapshot.currency;
  const rounding = contract.rounding ?? { increment: '0.01', mode: 'HALF_UP' as const };
  const round = (x: Dec) => roundMoney(x, rounding);
  parseDate(options.effectiveDate, 'effectiveDate');
  if (options.effectiveDate !== snapshot.asOf) throw new EngineError('SNAPSHOT_MISMATCH', 'The balance snapshot must be taken at the proposed effective date.');
  const explanation: string[] = [];
  const exceptions: string[] = [];

  // ── 1. Balances, waivers, capitalization ──────────────────────────────────
  const principal = dec(snapshot.principal);
  const interestUnpaid = dec(snapshot.overdueInterest).plus(dec(snapshot.accruedInterestNotDue));
  let fees = dec(snapshot.fees);
  let penalties = dec(snapshot.penalties);
  const taxes = dec(snapshot.taxes);
  if (dec(snapshot.unallocatedPayments).gt(0)) {
    throw new EngineError('UNALLOCATED_PAYMENTS', 'Allocate pending payments before restructuring so the snapshot is complete.');
  }

  const waivedInterest = money(options.waive?.interest, ccy, 'waive.interest');
  const waivedFees = money(options.waive?.fees, ccy, 'waive.fees');
  const waivedPenalties = money(options.waive?.penalties, ccy, 'waive.penalties');
  if (waivedInterest.gt(interestUnpaid)) throw new EngineError('WAIVER_EXCEEDS_BALANCE', `Interest waiver ${waivedInterest} exceeds unpaid interest ${interestUnpaid}.`);
  if (waivedFees.gt(fees)) throw new EngineError('WAIVER_EXCEEDS_BALANCE', `Fee waiver exceeds unpaid fees ${fees}.`);
  if (waivedPenalties.gt(penalties)) throw new EngineError('WAIVER_EXCEEDS_BALANCE', `Penalty waiver exceeds unpaid penalties ${penalties}.`);
  // Waive overdue interest first, then accrued-not-due.
  let overdueInterest = dec(snapshot.overdueInterest);
  let accruedInterest = dec(snapshot.accruedInterestNotDue);
  const fromOverdue = waivedInterest.gt(overdueInterest) ? overdueInterest : waivedInterest;
  overdueInterest = overdueInterest.minus(fromOverdue);
  accruedInterest = accruedInterest.minus(waivedInterest.minus(fromOverdue));
  fees = fees.minus(waivedFees);
  penalties = penalties.minus(waivedPenalties);

  const cap = options.capitalize ?? {};
  if ((cap.overdueInterest || cap.accruedInterest) && !rules.allowInterestCapitalization) {
    throw new EngineError('PROHIBITED_CAPITALIZATION', 'Capitalizing unpaid interest (interest on interest) is not permitted for this product or jurisdiction.');
  }
  if (cap.fees && !rules.allowFeeCapitalization) throw new EngineError('PROHIBITED_CAPITALIZATION', 'Capitalizing fees is not permitted for this product.');
  if (cap.penalties && !rules.allowPenaltyCapitalization) throw new EngineError('PROHIBITED_CAPITALIZATION', 'Capitalizing penalties is not permitted for this product.');
  const capInterest = (cap.overdueInterest ? overdueInterest : ZERO).plus(cap.accruedInterest ? accruedInterest : ZERO);
  const capFees = cap.fees ? fees : ZERO;
  const capPenalties = cap.penalties ? penalties : ZERO;
  if (cap.overdueInterest) overdueInterest = ZERO;
  if (cap.accruedInterest) accruedInterest = ZERO;
  if (cap.fees) fees = ZERO;
  if (cap.penalties) penalties = ZERO;

  const forgiven = money(options.principalForgiveness, ccy, 'principalForgiveness');
  const paidNow = money(options.principalPaymentAtRestructure, ccy, 'principalPaymentAtRestructure');
  if (forgiven.plus(paidNow).gte(principal.plus(capInterest).plus(capFees).plus(capPenalties))) {
    throw new EngineError('NOTHING_TO_RESTRUCTURE', 'Forgiveness and payment would clear the balance; use settlement instead.');
  }
  // Only amounts not already in principal are capitalized: interest, fees and penalties are receivables, never principal.
  const newPrincipal = principal.plus(capInterest).plus(capFees).plus(capPenalties).minus(forgiven).minus(paidNow);
  explanation.push(
    `NewPrincipal = ${principal} principal + ${capInterest.plus(capFees).plus(capPenalties)} capitalized − ${forgiven} forgiven − ${paidNow} paid now = ${newPrincipal} ${ccy}.`,
  );

  const remaining: ExtraDue = { interest: overdueInterest.plus(accruedInterest).toString(), fees: fees.toString(), penalties: penalties.toString(), taxes: taxes.toString() };
  const arrearsTreatment = options.arrearsTreatment ?? 'PAY_AT_EFFECTIVE_DATE';
  const remainingTotal = sum(Object.values(remaining).map((v) => dec(v)));

  // ── 2. New schedule input ─────────────────────────────────────────────────
  const { rates: currentRates } = contractContext(contract);
  const currentRate = currentRates[currentRates.length - 1].annualRate;
  const permanentRate = options.annualRate ?? currentRate;
  if (rules.minAnnualRate && dec(permanentRate).lt(rules.minAnnualRate)) exceptions.push(`Rate ${permanentRate} is below the product minimum ${rules.minAnnualRate}.`);
  if (rules.maxAnnualRate && dec(permanentRate).gt(rules.maxAnnualRate)) throw new EngineError('RATE_ABOVE_MAXIMUM', `Rate ${permanentRate} exceeds the product maximum ${rules.maxAnnualRate}.`);

  const deferral = options.paymentDeferralInstalments ?? 0;
  const interestOnly = options.interestOnlyInstalments ?? 0;
  const treatment = options.deferredInterestTreatment ?? (deferral > 0 ? 'DEFER_NO_CAPITALIZATION' : 'PAY_SEPARATELY');
  if (deferral > 0 && treatment === 'CAPITALIZE' && !rules.allowInterestCapitalization) {
    throw new EngineError('PROHIBITED_CAPITALIZATION', 'Capitalizing interest during a payment deferral is not permitted for this product or jurisdiction.');
  }
  const method = options.explicitSchedule?.length ? 'EXPLICIT' : (options.method ?? (contract.method === 'EXPLICIT' ? 'EQUAL_INSTALMENT' : contract.method));
  const irregular = !!options.firstDueDate || method === 'EXPLICIT' || contract.accrualBasis === 'DAILY';
  const frequency = options.frequency ?? contract.frequency ?? 'MONTHLY';

  const baseInput = (n: number | undefined): ScheduleInput => ({
    ...contract,
    principal: newPrincipal.toString(),
    disbursementDate: options.effectiveDate,
    annualRate: permanentRate,
    rates: undefined,
    // Irregular dates are calculated over actual intervals; this is recorded on the amendment.
    accrualBasis: irregular ? 'DAILY' : contract.accrualBasis,
    method,
    frequency: method === 'EXPLICIT' ? undefined : frequency,
    customFrequency: method === 'EXPLICIT' ? undefined : contract.customFrequency,
    numberOfInstalments: method === 'EXPLICIT' ? undefined : n,
    firstDueDate: options.firstDueDate,
    principalGraceInstalments: deferral + interestOnly,
    interestGraceInstalments: deferral > 0 && treatment === 'CAPITALIZE' ? deferral : 0,
    balloonAmount: options.balloonAmount,
    explicitSchedule: options.explicitSchedule,
    interestMethod: 'REDUCING_BALANCE',
  });

  const withRates = (input: ScheduleInput): ScheduleInput => {
    if (!options.temporaryRate) return input;
    const k = options.temporaryRate.instalments;
    const periods = buildPeriods(input).periods;
    if (k < 1 || k >= periods.length) throw new EngineError('INVALID_TEMPORARY_RATE', 'A temporary rate must cover at least one instalment and end before maturity.');
    const rates: RatePoint[] = [
      { effectiveFrom: options.effectiveDate, annualRate: options.temporaryRate.annualRate, source: 'RESTRUCTURE_TEMPORARY' },
      { effectiveFrom: periods[k].start, annualRate: permanentRate, source: 'RESTRUCTURE_PERMANENT' },
    ];
    return { ...input, annualRate: undefined, rates };
  };

  // ── 3. Term: given, or solved from the payment capacity ───────────────────
  let termSolution: RestructureCalculation['termSolution'] = null;
  let n = options.numberOfInstalments;
  if (method !== 'EXPLICIT') {
    if (options.targetInstalment) {
      const C = money(options.targetInstalment, ccy, 'targetInstalment');
      const simple = !options.temporaryRate && deferral === 0 && interestOnly === 0 && !options.balloonAmount && !irregular && method === 'EQUAL_INSTALMENT';
      if (simple) {
        const ctx = contractContext({ ...baseInput(1), annualRate: permanentRate });
        const i = periodFactor(buildPeriods(baseInput(1)).periods[0], dec(permanentRate), ctx.ctx);
        const solved = termForCapacity(newPrincipal.toString(), i.toString(), C.toString());
        n = solved.n;
        termSolution = { method: 'CLOSED_FORM', instalments: n, detail: `n = −ln(1 − ${newPrincipal} × ${i} / ${C}) / ln(1 + ${i}) = ${solved.exact} → ${n}` };
      } else {
        // Numerical: smallest n whose regular instalment fits the capacity (instalments fall as n rises).
        let lo = deferral + interestOnly + 1;
        let hi = rules.maxTotalInstalments;
        const fits = (k: number) => {
          try {
            const s = generateSchedule(withRates(baseInput(k)));
            const regular = s.lines.filter((l) => l.kind === 'AMORTIZING' || l.kind === 'FINAL').slice(0, -1);
            return (regular.length ? regular : s.lines).every((l) => dec(l.total).lte(C));
          } catch (e) {
            if ((e as EngineError).code === 'NEGATIVE_AMORTIZATION') return false;
            throw e;
          }
        };
        if (!fits(hi)) throw new EngineError('NO_AMORTIZATION', 'The proposed payment does not amortize this balance at the selected rate within the maximum term.');
        while (lo < hi) {
          const mid = Math.floor((lo + hi) / 2);
          if (fits(mid)) hi = mid;
          else lo = mid + 1;
        }
        n = lo;
        termSolution = { method: 'NUMERICAL', instalments: n, detail: `Smallest term with every regular instalment ≤ ${C} found by schedule simulation: ${n}.` };
      }
    }
    if (!n) throw new EngineError('INVALID_TERM', 'Give the new number of instalments or a sustainable payment capacity.');
    if (n > rules.maxTotalInstalments) throw new EngineError('TERM_ABOVE_MAXIMUM', `${n} instalments exceeds the maximum ${rules.maxTotalInstalments}.`);
  }
  if (options.balloonAmount && rules.maxBalloonFraction && dec(options.balloonAmount).gt(newPrincipal.times(rules.maxBalloonFraction))) {
    exceptions.push(`Balloon ${options.balloonAmount} exceeds ${rules.maxBalloonFraction} of the new principal.`);
  }

  let input = withRates(baseInput(n));
  let schedule = generateSchedule(input);
  if (options.targetInstalment && termSolution?.method === 'CLOSED_FORM') {
    // Rounding can lift a level instalment a cent above capacity: extend by one.
    while (dec(schedule.instalmentAmount ?? '0').gt(options.targetInstalment) && n! < rules.maxTotalInstalments) {
      n = n! + 1;
      input = withRates(baseInput(n));
      schedule = generateSchedule(input);
      termSolution.instalments = n;
    }
  }

  // ── 4. Deferral interest treatment and remaining arrears ──────────────────
  const lines: ProposedLine[] = schedule.lines.map((l) => ({
    number: l.number,
    periodStart: l.periodStart,
    periodEnd: l.periodEnd,
    dueDate: l.dueDate,
    openingPrincipal: l.openingPrincipal,
    principal: l.principal,
    interest: l.interest,
    capitalizedInterest: l.capitalizedInterest,
    annualRate: l.annualRate,
    deferred: zeroExtra(),
    total: l.total,
  }));
  let futureInterestWaived = ZERO;
  let movedDeferralInterest = ZERO;
  if (deferral > 0 && treatment !== 'CAPITALIZE' && treatment !== 'PAY_SEPARATELY') {
    // Interest of the deferral instalments is not paid then: either waived, or
    // carried interest-free into the repayment instalments. Never silently dropped.
    for (const l of lines.slice(0, deferral)) {
      if (treatment === 'WAIVE') futureInterestWaived = futureInterestWaived.plus(l.interest);
      else movedDeferralInterest = movedDeferralInterest.plus(l.interest);
      l.interest = '0';
      l.total = l.principal;
    }
  }
  if (treatment === 'PAY_SEPARATELY' && deferral > 0) {
    explanation.push('Interest during the deferral is paid as it falls due (principal only is deferred).');
  }
  const repaying = lines.filter((_, idx) => idx >= deferral + interestOnly);
  const spread = (amount: Dec, key: keyof ExtraDue) => {
    if (amount.isZero()) return;
    const per = round(amount.div(repaying.length));
    let left = amount;
    repaying.forEach((l, idx) => {
      const part = idx === repaying.length - 1 ? left : per;
      left = left.minus(part);
      l.deferred[key] = dec(l.deferred[key]).plus(part).toString();
    });
  };
  spread(movedDeferralInterest, 'interest');
  const deferred: ExtraDue = zeroExtra();
  const payableAtEffectiveDate: ExtraDue = zeroExtra();
  if (arrearsTreatment === 'SPREAD_OVER_TERM') {
    for (const k of Object.keys(remaining) as (keyof ExtraDue)[]) {
      spread(dec(remaining[k]), k);
      deferred[k] = remaining[k];
    }
  } else {
    Object.assign(payableAtEffectiveDate, remaining);
  }
  deferred.interest = dec(deferred.interest).plus(movedDeferralInterest).toString();
  for (const l of lines) {
    l.total = dec(l.principal).plus(l.interest).plus(sum(Object.values(l.deferred).map((v) => dec(v)))).toString();
  }

  // ── 5. Concession value ────────────────────────────────────────────────────
  let rateReduction = ZERO;
  const reduced = dec(permanentRate).lt(currentRate) || (options.temporaryRate && dec(options.temporaryRate.annualRate).lt(currentRate));
  if (reduced) {
    const atCurrent = generateSchedule({ ...baseInput(n), annualRate: currentRate, rates: undefined });
    rateReduction = dec(atCurrent.totals.interest).minus(schedule.totals.interest);
    if (rateReduction.lt(0)) rateReduction = ZERO;
  }
  const concessionTotal = rateReduction.plus(futureInterestWaived).plus(waivedInterest).plus(waivedFees).plus(waivedPenalties).plus(forgiven);

  explanation.push(...schedule.explanation);
  if (remainingTotal.gt(0)) {
    explanation.push(
      arrearsTreatment === 'SPREAD_OVER_TERM'
        ? `Unpaid arrears of ${remainingTotal} ${ccy} are spread over the repayment instalments without interest; they are not waived.`
        : `Unpaid arrears of ${remainingTotal} ${ccy} stay payable on the effective date; they are not waived.`,
    );
  }
  if (method !== contract.method) explanation.push(`Repayment method changes from ${contract.method} to ${method}.`);
  if (irregular && contract.accrualBasis !== 'DAILY') explanation.push('The amended schedule uses actual-interval (daily) interest because its dates are irregular.');

  return {
    engineVersion: LENDING_ENGINE_VERSION,
    snapshot,
    newPrincipal: newPrincipal.toString(),
    components: {
      waived: { interest: waivedInterest.toString(), fees: waivedFees.toString(), penalties: waivedPenalties.toString(), futureInterest: futureInterestWaived.toString() },
      capitalized: { interest: capInterest.toString(), fees: capFees.toString(), penalties: capPenalties.toString() },
      forgiven: forgiven.toString(),
      principalPaidAtRestructure: paidNow.toString(),
      deferred,
      payableAtEffectiveDate,
    },
    scheduleInput: input,
    schedule,
    lines,
    termSolution: termSolution ?? (n ? { method: 'GIVEN', instalments: n, detail: `${n} instalments as proposed.` } : null),
    concessionValue: { rateReduction: rateReduction.toString(), futureInterestWaived: futureInterestWaived.toString(), total: concessionTotal.toString() },
    policyExceptions: exceptions,
    explanation,
  };
}

export interface OriginalRemaining {
  instalmentAmount: string | null;
  maturityDate: LocalDate | null;
  /** Unpaid amounts of every live line (overdue and future). */
  lines: { dueDate: LocalDate; principal: string; interest: string; charges: string }[];
}

export interface Comparison {
  original: { instalment: string | null; maturityDate: LocalDate | null; totalFuturePayments: string; totalFutureInterestAndCharges: string; balloon: string };
  proposed: { instalment: string | null; maturityDate: LocalDate; totalFuturePayments: string; totalFutureInterestAndCharges: string; balloon: string; payableAtEffectiveDate: string };
  capitalized: string;
  waived: string;
  forgiven: string;
  /** A lower instalment that costs more interest overall — must be shown to the customer. */
  lowerInstalmentHigherCost: boolean;
  warnings: string[];
}

export function compareRestructure(original: OriginalRemaining, calc: RestructureCalculation): Comparison {
  const origPayments = sum(original.lines.map((l) => dec(l.principal).plus(l.interest).plus(l.charges)));
  const origInterest = sum(original.lines.map((l) => dec(l.interest).plus(l.charges)));
  const payNow = sum(Object.values(calc.components.payableAtEffectiveDate).map((v) => dec(v)));
  const propPayments = sum(calc.lines.map((l) => dec(l.total))).plus(payNow);
  const proposedInterest = propPayments.minus(sum(calc.lines.map((l) => dec(l.principal))));
  const lastOrig = original.lines[original.lines.length - 1];
  const balloonOrig = lastOrig ? dec(lastOrig.principal) : ZERO;
  const lastProp = calc.lines[calc.lines.length - 1];
  const capitalized = sum(Object.values(calc.components.capitalized).map((v) => dec(v)));
  const waived = sum(Object.values(calc.components.waived).map((v) => dec(v)));
  const lowerInstalment = !!original.instalmentAmount && !!calc.schedule.instalmentAmount && dec(calc.schedule.instalmentAmount).lt(original.instalmentAmount);
  const higherCost = proposedInterest.gt(origInterest);
  const warnings: string[] = [];
  if (lowerInstalment && higherCost) warnings.push(`The lower instalment increases total future interest and charges from ${origInterest} to ${proposedInterest}.`);
  if (capitalized.gt(0)) warnings.push(`${capitalized} of unpaid amounts is added to principal and will accrue interest.`);
  return {
    original: {
      instalment: original.instalmentAmount,
      maturityDate: original.maturityDate,
      totalFuturePayments: origPayments.toString(),
      totalFutureInterestAndCharges: origInterest.toString(),
      balloon: original.lines.length > 1 && balloonOrig.gt(dec(original.lines[0].principal).times(3)) ? balloonOrig.toString() : '0',
    },
    proposed: {
      instalment: calc.schedule.instalmentAmount,
      maturityDate: lastProp.dueDate,
      totalFuturePayments: propPayments.toString(),
      totalFutureInterestAndCharges: proposedInterest.toString(),
      balloon: calc.scheduleInput.balloonAmount ?? '0',
      payableAtEffectiveDate: payNow.toString(),
    },
    capitalized: capitalized.toString(),
    waived: waived.toString(),
    forgiven: calc.components.forgiven,
    lowerInstalmentHigherCost: lowerInstalment && higherCost,
    warnings,
  };
}

/** Did the balances move between proposal and execution by more than the tolerance? */
export function snapshotDrift(a: BalanceSnapshot, b: BalanceSnapshot, tolerance: string): { material: boolean; differences: { field: string; proposed: string; actual: string }[] } {
  const fields: (keyof BalanceSnapshot)[] = ['principal', 'overdueInterest', 'accruedInterestNotDue', 'fees', 'penalties', 'taxes', 'unallocatedPayments'];
  const differences = fields.filter((f) => !dec(a[f] as string).eq(dec(b[f] as string))).map((f) => ({ field: f, proposed: a[f] as string, actual: b[f] as string }));
  const total = sum(differences.map((d) => dec(d.actual).minus(d.proposed).abs()));
  return { material: total.gt(tolerance), differences };
}

