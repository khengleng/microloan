/**
 * Payment holidays as a programme.
 *
 * The schedule arithmetic already exists: a holiday is a full payment
 * deferral, which `calculateRestructure` handles through
 * `paymentDeferralInstalments` and `deferredInterestTreatment`. What a
 * *programme* adds is everything around it — who qualifies, for how long, how
 * many times, and over what window — so that relief can be offered at scale
 * without each loan going through a hardship case.
 *
 * The distinction matters: a hardship restructure is an assessment of one
 * borrower's circumstances, while a programme is a published offer the lender
 * must apply consistently. Consistency is the point, so eligibility is
 * evaluated from recorded loan state rather than an officer's judgement, and
 * every refusal names its reason.
 *
 * What a holiday is *not*: free. Interest normally continues to accrue, and
 * the treatment the programme chooses decides who ends up paying it. A
 * programme that defers payments while capitalizing interest leaves the
 * borrower owing more than when they started, which is why the treatment is
 * stated on the programme rather than defaulted.
 */
import { dec, EngineError, ZERO } from './decimal.js';
import { LocalDate, compareDates, parseDate } from './dates.js';
import type {
  DeferredInterestTreatment,
  RestructureCalculation,
  RestructureOptions,
} from './restructure.js';

export interface HolidayProgramme {
  code: string;
  name: string;
  /** Longest holiday the programme grants, in instalments. */
  maxInstalments: number;
  /** What happens to interest arising during the holiday. */
  interestTreatment: DeferredInterestTreatment;
  /**
   * What the deferred payments do to the term.
   *
   * `EXTEND_TERM` adds the holiday to the end, so the borrower skips N
   * payments and the loan matures N periods later — the usual meaning of a
   * payment holiday. `KEEP_MATURITY` holds the maturity date and absorbs the
   * skipped payments into higher instalments afterwards, which is relief now
   * paid for by a heavier burden later.
   */
  termTreatment: 'EXTEND_TERM' | 'KEEP_MATURITY';
  /** First date the programme accepts enrolments. */
  opensOn: LocalDate;
  /** Last date it accepts enrolments. */
  closesOn: LocalDate;
  /** Instalments the loan must have paid before it qualifies. */
  minInstalmentsPaid: number;
  /** Days past due beyond which the loan does not qualify. */
  maxDaysPastDue: number;
  /** Instalments that must remain after the holiday, so there is a loan left to serve. */
  minInstalmentsRemaining: number;
  /** How many holidays one loan may take under this programme. */
  maxHolidaysPerLoan: number;
  /** Whether an already-restructured loan qualifies. */
  allowRestructured: boolean;
}

export interface HolidayCandidate {
  /** BOOKED, ACTIVE, CLOSED, WRITTEN_OFF. */
  status: string;
  instalmentsPaid: number;
  instalmentsRemaining: number;
  daysPastDue: number;
  priorHolidays: number;
  isRestructured: boolean;
  /** A holiday already running on this loan. */
  holidayInProgress: boolean;
}

export interface HolidayEligibility {
  eligible: boolean;
  /** Every reason it does not qualify, so a borrower is told once. */
  reasons: { code: string; message: string }[];
  /** The longest holiday this loan could take, when it qualifies at all. */
  maxInstalments: number;
}

/**
 * Whether a loan qualifies, and for how long.
 *
 * All reasons are collected rather than returned one at a time: a borrower
 * asking "why not?" should get the whole answer, and a lender running a
 * programme over a book needs to see the distribution of refusals.
 */
export function checkHolidayEligibility(
  programme: HolidayProgramme,
  loan: HolidayCandidate,
  asOf: LocalDate,
): HolidayEligibility {
  const reasons: { code: string; message: string }[] = [];
  const add = (code: string, message: string) => reasons.push({ code, message });
  parseDate(asOf, 'asOf');
  if (programme.maxInstalments < 1) {
    throw new EngineError('INVALID_PROGRAMME', 'A payment holiday must defer at least one instalment.');
  }
  if (compareDates(programme.closesOn, programme.opensOn) < 0) {
    throw new EngineError('INVALID_PROGRAMME', `The programme closes (${programme.closesOn}) before it opens (${programme.opensOn}).`);
  }

  if (compareDates(asOf, programme.opensOn) < 0) {
    add('NOT_OPEN', `The ${programme.code} programme opens on ${programme.opensOn}.`);
  }
  if (compareDates(asOf, programme.closesOn) > 0) {
    add('CLOSED', `The ${programme.code} programme closed on ${programme.closesOn}.`);
  }
  if (loan.status !== 'ACTIVE') {
    add('STATUS', `A payment holiday applies to an active loan; this one is ${loan.status.toLowerCase()}.`);
  }
  if (loan.holidayInProgress) {
    add('IN_PROGRESS', 'This loan is already on a payment holiday.');
  }
  if (loan.instalmentsPaid < programme.minInstalmentsPaid) {
    add(
      'SEASONING',
      `${loan.instalmentsPaid} instalment(s) have been paid; the programme requires ${programme.minInstalmentsPaid}.`,
    );
  }
  if (loan.daysPastDue > programme.maxDaysPastDue) {
    add(
      'DPD',
      `The loan is ${loan.daysPastDue} day(s) past due; the programme allows at most ${programme.maxDaysPastDue}.`,
    );
  }
  if (loan.priorHolidays >= programme.maxHolidaysPerLoan) {
    add(
      'LIMIT',
      `This loan has taken ${loan.priorHolidays} holiday(s); the programme allows ${programme.maxHolidaysPerLoan}.`,
    );
  }
  if (!programme.allowRestructured && loan.isRestructured) {
    add('RESTRUCTURED', 'This loan has been restructured, which the programme excludes.');
  }

  // A holiday must leave instalments behind to serve it: deferring the last
  // payments of a loan just moves the maturity, which is a term extension and
  // should be assessed as one.
  const deferrable = loan.instalmentsRemaining - programme.minInstalmentsRemaining;
  const maxInstalments = Math.min(programme.maxInstalments, Math.max(0, deferrable));
  if (maxInstalments < 1) {
    add(
      'TOO_LATE',
      `${loan.instalmentsRemaining} instalment(s) remain; a holiday must leave ${programme.minInstalmentsRemaining} behind, so there is no room for one.`,
    );
  }

  return { eligible: reasons.length === 0, reasons, maxInstalments };
}

/**
 * The restructure the holiday amounts to.
 *
 * A holiday is expressed as an ordinary restructure so it goes through the
 * same schedule engine, the same agreement versioning and the same
 * accounting as any other amendment. The programme decides only how many
 * instalments are deferred and what happens to the interest.
 */
export function holidayRestructureOptions(
  programme: HolidayProgramme,
  instalments: number,
  effectiveDate: LocalDate,
  remainingInstalments: number,
): RestructureOptions {
  if (instalments < 1) {
    throw new EngineError('INVALID_HOLIDAY', 'A payment holiday must defer at least one instalment.');
  }
  if (instalments > programme.maxInstalments) {
    throw new EngineError(
      'HOLIDAY_TOO_LONG',
      `The ${programme.code} programme grants at most ${programme.maxInstalments} instalment(s); ${instalments} were requested.`,
    );
  }
  if (remainingInstalments < 1) {
    throw new EngineError('NOTHING_REMAINS', 'The loan has no remaining instalments to reschedule.');
  }
  if (instalments >= remainingInstalments) {
    throw new EngineError(
      'HOLIDAY_COVERS_WHOLE_LOAN',
      `Deferring ${instalments} of ${remainingInstalments} remaining instalment(s) leaves nothing to serve the holiday; that is a term extension, not a holiday.`,
    );
  }
  return {
    effectiveDate,
    // A holiday must state the term it leaves behind, because the deferred
    // instalments either push the maturity out or make the later ones bigger.
    numberOfInstalments:
      programme.termTreatment === 'EXTEND_TERM'
        ? remainingInstalments + instalments
        : remainingInstalments,
    paymentDeferralInstalments: instalments,
    deferredInterestTreatment: programme.interestTreatment,
  };
}

/**
 * The interest a holiday actually defers.
 *
 * This cannot be read off the deferred instalments: when interest is waived
 * or carried forward, the engine sets those lines' interest to zero and moves
 * the amount into the calculation's components. Summing the lines therefore
 * always yields zero, which would report every holiday as free — the opposite
 * of what `describeHolidayCost` is for. Each treatment keeps the figure in a
 * different place, so each is read from where it lives.
 */
export function holidayDeferredInterest(
  calc: RestructureCalculation,
  treatment: DeferredInterestTreatment,
  instalments: number,
): string {
  switch (treatment) {
    case 'WAIVE':
      return calc.concessionValue.futureInterestWaived;
    case 'DEFER_NO_CAPITALIZATION':
      return calc.components.deferred.interest;
    case 'CAPITALIZE':
      // Capitalized, the interest is added to the principal at the end of
      // each deferred period; the deferred lines carry it as such.
      return calc.lines
        .slice(0, instalments)
        .reduce((total, l) => total.plus(dec(l.capitalizedInterest, 'capitalizedInterest')), ZERO)
        .toString();
    case 'PAY_SEPARATELY':
      // The interest stays on the instalments themselves.
      return calc.lines
        .slice(0, instalments)
        .reduce((total, l) => total.plus(dec(l.interest, 'interest')), ZERO)
        .toString();
    default:
      throw new EngineError('INVALID_TREATMENT', `Unknown deferred interest treatment ${String(treatment)}.`);
  }
}

/**
 * What the holiday costs the borrower, stated plainly.
 *
 * A deferral is not forgiveness unless the programme says so. Capitalizing
 * the interest adds it to the principal and charges interest on it
 * thereafter; deferring it without capitalizing leaves it payable later
 * without compounding; waiving it is the only treatment that costs the
 * borrower nothing. Lenders publish holidays as relief, so the engine makes
 * the difference explicit rather than leaving it in a config field.
 */
export function describeHolidayCost(
  treatment: DeferredInterestTreatment,
  deferredInterest: string,
): { costsBorrower: boolean; summary: string } {
  const amount = dec(deferredInterest, 'deferredInterest');
  switch (treatment) {
    case 'WAIVE':
      return {
        costsBorrower: false,
        summary: `${amount.toString()} of interest arising during the holiday is waived; the borrower pays nothing for it.`,
      };
    case 'CAPITALIZE':
      return {
        costsBorrower: true,
        summary: `${amount.toString()} of interest is added to the principal and bears interest from then on, so the holiday increases what is owed.`,
      };
    case 'DEFER_NO_CAPITALIZATION':
      return {
        costsBorrower: true,
        summary: `${amount.toString()} of interest becomes payable later without bearing further interest.`,
      };
    case 'PAY_SEPARATELY':
      return {
        costsBorrower: true,
        summary: `${amount.toString()} of interest remains payable during the holiday; only principal is deferred.`,
      };
    default:
      throw new EngineError('INVALID_TREATMENT', `Unknown deferred interest treatment ${String(treatment)}.`);
  }
}
