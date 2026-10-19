export type InterestTreatment = 'WAIVE' | 'DEFER_NO_CAPITALIZATION' | 'CAPITALIZE' | 'PAY_SEPARATELY';
export type TermTreatment = 'EXTEND_TERM' | 'KEEP_MATURITY';
export type ProgrammeStatus = 'DRAFT' | 'OPEN' | 'CLOSED';

/** `GET /lending/ops/payment-holiday-programmes` row. */
export interface HolidayProgramme {
    id: string;
    code: string;
    name: string;
    status: ProgrammeStatus | string;
    maxInstalments: number;
    interestTreatment: InterestTreatment;
    termTreatment: TermTreatment;
    opensOn: string;
    closesOn: string;
    minInstalmentsPaid: number;
    maxDaysPastDue: number;
    minInstalmentsRemaining: number;
    maxHolidaysPerLoan: number;
    allowRestructured: boolean;
}

export interface HolidayCandidate {
    status: string;
    instalmentsPaid: number;
    instalmentsRemaining: number;
    daysPastDue: number;
    priorHolidays: number;
    isRestructured: boolean;
    holidayInProgress: boolean;
}

/** `GET /lending/loans/:id/payment-holidays/:programmeId/eligibility`. */
export interface HolidayEligibility {
    programme: HolidayProgramme;
    candidate: HolidayCandidate;
    eligible: boolean;
    reasons: { code: string; message: string }[];
    maxInstalments: number;
    /** describeHolidayCost summary (amount shown as 0 before enrolment). */
    cost: string;
}

/** `GET /lending/loans/:id/payment-holidays` row (holidays granted on the loan). */
export interface HolidayEnrolment {
    id: string;
    programmeId: string;
    loanAccountId: string;
    instalments: number;
    effectiveDate: string;
    resumesOn: string;
    deferredInterest: string;
    interestTreatment: InterestTreatment;
    termTreatment: TermTreatment;
    agreementVersion: number;
}

export interface HolidayEnrolResult {
    enrolment: HolidayEnrolment;
    cost: { costsBorrower: boolean; summary: string };
    calculation?: unknown;
}

export interface FloatingTerms {
    benchmarkCode: string;
    margin: string;
    resetFrequency: string;
    floor: string | null;
    cap: string | null;
}

export interface RateReset {
    id: string;
    resetDate: string;
    effectiveFrom: string;
    observationDate: string;
    benchmarkCode: string;
    observedRate: string;
    margin: string;
    indicatedRate: string;
    bound: 'BENCHMARK' | 'FLOOR' | 'CAP' | 'REGULATORY_CAP' | string;
    previousAnnualRate: string;
    newAnnualRate: string;
    agreementVersion: number;
    instalmentAmount: string | null;
    explanation?: string[];
}

/** `GET /lending/loans/:id/rate-resets`. */
export interface RateResetHistory {
    floating: boolean;
    terms?: FloatingTerms;
    schedule: string[];
    resets: RateReset[];
    due: string[];
}

/** `POST /lending/loans/:id/rate-resets`. */
export interface RateResetApplyResult {
    applied: RateReset[];
    message?: string;
}
