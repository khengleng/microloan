import { z } from 'zod';
import { dec } from './decimal.js';
import {
  NBC_LONG_TERM_CLASSES,
  NBC_SHORT_TERM_CLASSES,
  NBC_SHORT_TERM_MAX_DAYS,
  RegulatoryBands,
} from './impairment.js';
import { MAX_FILE_LINES } from './channels.js';
import { PAYMENT_CHANNEL_CODES } from './aml.js';

/**
 * A lender's own operating parameters (TenantLendingSettings).
 *
 * These were constants in services. Each default below is the value the code
 * used before, so a tenant with no settings in force behaves exactly as
 * before; a tenant changes them through a maker-checker proposal. Per-product
 * terms stay in the product configuration (config.ts) — this is for what
 * applies to the lender as a whole: its regulatory return bands, the ledger
 * accounts its tenant-level postings use, payment-file limits, delegation
 * limits and the legacy servicing jobs' thresholds.
 *
 * Every object is `.strict()`: an unknown key is a validation error.
 */

const decimalString = z.string().regex(/^\d+(\.\d+)?$/, 'must be a non-negative decimal string');
const rateFraction = decimalString.refine((v) => dec(v).lte(1), 'rates are decimal fractions (0.25 = 25%)');
const accountCode = z.string().regex(/^[0-9A-Z][0-9A-Z._-]{0,31}$/, 'ledger account codes are 1–32 chars: 0-9, A-Z, . _ -');

/** The regulator's loan classes, in order; their codes are fixed (legacy loans store them). */
export const REGULATORY_CLASS_CODES = ['STANDARD', 'SPECIAL_MENTION', 'SUBSTANDARD', 'DOUBTFUL', 'LOSS'] as const;

const regulatoryClass = z
  .object({
    code: z.enum(REGULATORY_CLASS_CODES),
    label: z.string().trim().min(1).max(60),
    /** Inclusive lower bound of days past due. */
    minDpd: z.number().int().min(0).max(3650),
    /** Required provision on outstanding principal, as a fraction. */
    rate: rateFraction,
  })
  .strict();

export const tenantLendingSettingsSchema = z
  .object({
    /** The monthly regulatory return and the legacy provisioning run. */
    regulatory: z
      .object({
        /**
         * SHORT-TERM loan classes (original term up to `shortTermMaxDays`) by
         * days past due with their provision rates (default: the NBC
         * short-term classes; D-114, assumed — needs compliance sign-off).
         */
        classes: z
          .array(regulatoryClass)
          .length(REGULATORY_CLASS_CODES.length)
          .default(NBC_SHORT_TERM_CLASSES.map((c) => ({ ...c })) as never),
        /** LONG-TERM loan classes (original term over `shortTermMaxDays`); default: the NBC long-term classes. */
        longTermClasses: z
          .array(regulatoryClass)
          .length(REGULATORY_CLASS_CODES.length)
          .default(NBC_LONG_TERM_CLASSES.map((c) => ({ ...c })) as never),
        /** Original term in days (disbursement to original maturity) up to which a loan is short-term. */
        shortTermMaxDays: z.number().int().min(28).max(3650).default(NBC_SHORT_TERM_MAX_DAYS),
        /** Restructured loans (D-113, assumed — needs compliance sign-off). */
        restructured: z
          .object({
            /** Graded at least this class while on probation; null: no minimum class. */
            minClass: z.enum(REGULATORY_CLASS_CODES).nullable().default('SUBSTANDARD'),
            /**
             * Consecutive on-time revised instalments that cure a restructure,
             * at the least: a product asking for fewer (even 0) is raised to this.
             */
            minProbationInstalments: z.number().int().min(1).max(60).default(3),
          })
          .strict()
          .default({}),
        /**
         * Fewest days past due a loan may be written off at, per term (D-117).
         * Null: the first day of the Loss class of that term's bands. A
         * product's own minimum can only raise it.
         */
        writeOffMinDpd: z
          .object({
            shortTerm: z.number().int().min(0).max(3650).nullable().default(null),
            longTerm: z.number().int().min(0).max(3650).nullable().default(null),
          })
          .strict()
          .default({}),
        /** Upper edges of the loan-size bands, in USD; KHR edges are these × khrPerUsd. */
        sizeBandEdgesUsd: z.array(z.number().int().positive()).min(1).max(12).default([500, 1_000, 5_000, 10_000, 50_000]),
        /** The fixed conversion the size bands use for KHR loans (not a market rate). */
        sizeBandKhrPerUsd: decimalString.default('4000'),
        /** Interest-rate band edges below the cap, in percent per year. */
        rateBandEdgesPct: z.array(decimalString).max(10).default(['12', '15']),
      })
      .strict()
      .default({}),
    /**
     * Ledger accounts for postings that belong to the lender rather than to a
     * product (product postings use the product's `accounting` mapping).
     * Every code must exist in the tenant's chart of accounts.
     */
    accounting: z
      .object({
        /** Cash / bank: funds unidentified receipts and converted foreign-currency receipts. */
        cash: accountCode.default('1000'),
        /** Year-end close carries the year's income and expense here. */
        retainedEarnings: accountCode.default('3100'),
        /**
         * Equity reserve for the regulator's provision above the ECL allowance
         * (D-115): appropriated from retained earnings at month end.
         */
        regulatoryReserve: accountCode.default('3200'),
        /** Opening balances of loans taken over from another system. */
        migrationClearing: accountCode.default('3900'),
        /** Money received in a currency other than the loan's (UC-21). */
        fxPosition: accountCode.default('1050'),
        fxGainLoss: accountCode.default('4410'),
        /** Receipts not yet matched to a loan. */
        unidentifiedSuspense: accountCode.default('2500'),
        /** The original (legacy) loan book's accounts. */
        legacy: z
          .object({
            loansReceivable: accountCode.default('1200'),
            interestIncome: accountCode.default('4000'),
            penaltyIncome: accountCode.default('4100'),
            feeIncome: accountCode.default('4200'),
            loanLossAllowance: accountCode.default('1300'),
            provisionExpense: accountCode.default('5000'),
            writeOffExpense: accountCode.default('5100'),
          })
          .strict()
          .default({}),
      })
      .strict()
      .default({}),
    payments: z
      .object({
        /** Most payment lines one settlement or payroll file may carry. */
        maxFileLines: z.number().int().min(1).max(100_000).default(MAX_FILE_LINES),
        /** How far before the business date an unidentified receipt or a payment file line may be value-dated. */
        maxBackdateDays: z.number().int().min(0).max(366).default(30),
      })
      .strict()
      .default({}),
    access: z
      .object({
        /** The longest a delegation of authority may run. */
        maxDelegationDays: z.number().int().min(1).max(366).default(30),
      })
      .strict()
      .default({}),
    /** Scorecard monitoring, consent and alternative data (DECISIONS D-078…D-080). */
    scoring: z
      .object({
        monitoring: z
          .object({
            /** A booked loan is "bad" once any instalment is this many days late… */
            badDaysPastDue: z.number().int().min(1).max(365).default(30),
            /** …within this many months of disbursement; younger loans that have not gone bad are immature. */
            performanceMonths: z.number().int().min(1).max(60).default(12),
            /** Population stability compares the recent window with the baseline window before it. */
            baselineWindowDays: z.number().int().min(7).max(1095).default(180),
            recentWindowDays: z.number().int().min(7).max(1095).default(90),
            /** Proportion an empty bin takes in the stability index, so its logarithm stays finite. */
            psiEpsilon: decimalString.default('0.0001'),
          })
          .strict()
          .default({}),
        consent: z
          .object({
            /** The longest a borrower's consent to an alternative data source may run before it must be renewed. */
            maxValidityDays: z.number().int().min(1).max(3650).default(730),
          })
          .strict()
          .default({}),
        alternativeData: z
          .object({
            /** A verified record whose observed period ended longer ago than this no longer counts. */
            maxRecordAgeDays: z.number().int().min(1).max(3650).default(365),
            /** Payment channels counted as digital repayments (KHQR, wallets, mobile banking). */
            digitalChannels: z
              .array(z.enum(['MOBILE', 'QR', 'WALLET', 'AGENT', 'PAYROLL']))
              .max(5)
              .default(['MOBILE', 'QR', 'WALLET']),
          })
          .strict()
          .default({}),
      })
      .strict()
      .default({}),
    /**
     * How the interest-rate cap is applied (NBC Prakas B7-017-109; DECISIONS
     * D-108, D-109 — assumed, needs compliance sign-off). The cap itself is the
     * lowest of the regulatory ceiling, the lender's cap and the product's cap.
     */
    rateCap: z
      .object({
        /** The effective rate including upfront fees must also fit under the cap. */
        includeFeesInEffectiveRate: z.boolean().default(true),
        /** Penalty interest on overdue amounts may not be priced above the cap. */
        penaltyRateMustFitCap: z.boolean().default(true),
      })
      .strict()
      .default({}),
    /** Sign-in requirements for the lender's own staff (D-128). */
    security: z
      .object({
        /**
         * Tenant administrators must enrol an authenticator and sign in with
         * it before anything but enrolment answers (assumed default: on).
         */
        requireMfaForAdmins: z.boolean().default(true),
      })
      .strict()
      .default({}),
    /** The Telegram customer bot (D-132). */
    telegramBot: z
      .object({
        /**
         * Let a linked customer apply for a loan from the chat. Off by default:
         * the application is recorded by the system principal "Telegram bot"
         * and must fit the product's principal and term limits.
         */
        allowLoanApplications: z.boolean().default(false),
      })
      .strict()
      .default({}),
    /**
     * Consumer disclosure (DECISIONS D-123, D-124 — assumed, needs compliance
     * sign-off): who the key facts statement names as the lender and where a
     * customer complains. Unset contacts print as "not configured" and the
     * statement carries a warning for staff; set them before go-live.
     */
    consumerProtection: z
      .object({
        /** The lender's legal name on the statement; null: the organisation's name. */
        lenderLegalName: z.string().trim().min(2).max(160).nullable().default(null),
        /** The NBC licence number printed on the statement. */
        licenceNumber: z.string().trim().min(1).max(80).nullable().default(null),
        complaints: z
          .object({
            phone: z.string().trim().min(3).max(40).nullable().default(null),
            email: z.string().trim().email().max(160).nullable().default(null),
            address: z.string().trim().min(3).max(300).nullable().default(null),
          })
          .strict()
          .default({}),
        /** The regulator's consumer-protection contact customers may escalate to. */
        regulatorContact: z
          .string()
          .trim()
          .min(3)
          .max(300)
          .default('National Bank of Cambodia — consumer protection (financial consumer complaints)'),
        /**
         * Cooling-off (D-125): days after disbursement in which the customer may
         * cancel by repaying what they received; 0 switches the right off.
         */
        coolingOffDays: z.number().int().min(0).max(30).default(7),
        /** Interest accrued to the cancellation date is payable on a cooling-off cancellation. */
        coolingOffChargesAccruedInterest: z.boolean().default(true),
        /** Upfront fees the lender earned are refunded on a cooling-off cancellation (insurer premiums are not). */
        coolingOffRefundsLenderFees: z.boolean().default(true),
      })
      .strict()
      .default({}),
    /** Affordability across the borrower's obligations (D-126). */
    affordability: z
      .object({
        /** Most lenders a borrower may owe, counting this lender; null: no limit. */
        maxLendersPerBorrower: z.number().int().min(1).max(20).nullable().default(null),
        /** Count the instalments of the borrower's other live loans with this lender in the debt-service ratio. */
        includeOwnLoans: z.boolean().default(true),
        /** Count the latest minimum payment of the borrower's open credit lines and cards. */
        includeFacilityMinimumPayments: z.boolean().default(true),
      })
      .strict()
      .default({}),
    /**
     * AML/CFT controls (2020 Law on AML/CFT; DECISIONS D-118…D-122 — the
     * defaults are assumed and need compliance sign-off).
     */
    aml: z
      .object({
        screening: z
          .object({
            /** Name similarity (0…1) at or above which a watch-list entry is a hit to disposition. */
            matchThreshold: rateFraction.default('0.88'),
            /** Two name tokens below this Jaro-Winkler similarity are not paired. */
            tokenFloor: rateFraction.default('0.80'),
            /** Multiplier for a one-word name matched inside a longer one. */
            singleTokenPenalty: rateFraction.default('0.80'),
            /** Titles and honorifics ignored when names are compared. */
            ignoredTitles: z
              .array(z.string().trim().min(1).max(40))
              .max(100)
              .default(['mr', 'mrs', 'ms', 'miss', 'dr', 'h e', 'his excellency', 'her excellency', 'oknha', 'neak oknha', 'lok', 'lok chumteav', 'samdech']),
            /** Customers re-screened per step of a re-screening job after a list is activated. */
            rescreenBatchSize: z.number().int().min(10).max(5000).default(200),
          })
          .strict()
          .default({}),
        watchList: z
          .object({
            /** Most entries one uploaded list version may hold. */
            maxEntries: z.number().int().min(1).max(200_000).default(50_000),
          })
          .strict()
          .default({}),
        risk: z
          .object({
            weights: z
              .object({
                pep: z.number().int().min(0).max(100).default(10),
                highRiskCountry: z.number().int().min(0).max(100).default(6),
                highRiskOccupation: z.number().int().min(0).max(100).default(3),
                highRiskProduct: z.number().int().min(0).max(100).default(2),
                cashIntensive: z.number().int().min(0).max(100).default(3),
              })
              .strict()
              .default({}),
            mediumAt: z.number().int().min(1).max(1000).default(3),
            highAt: z.number().int().min(1).max(1000).default(6),
            pepAlwaysHigh: z.boolean().default(true),
            /** Nationalities rated higher risk (ISO 3166 alpha-2; default: the FATF call-for-action list). */
            highRiskCountries: z.array(z.string().regex(/^[A-Z]{2}$/, 'ISO 3166 alpha-2 codes')).max(250).default(['KP', 'IR', 'MM']),
            /** Occupations or business types rated higher risk (whole words, case-insensitive). */
            highRiskOccupations: z
              .array(z.string().trim().min(2).max(60))
              .max(200)
              .default(['money changer', 'casino', 'gambling', 'precious metals', 'gold dealer', 'jewellery', 'real estate agent', 'arms dealer']),
            /** Occupations that handle mostly cash. */
            cashIntensiveOccupations: z
              .array(z.string().trim().min(2).max(60))
              .max(200)
              .default(['market vendor', 'trader', 'restaurant', 'taxi', 'tuk tuk', 'construction contractor']),
            /** Product family codes rated higher risk. */
            highRiskProductFamilies: z.array(z.string().regex(/^[A-Z0-9_]{2,40}$/)).max(100).default([]),
            /** Share of repayments by value made in cash (0…1) from which a customer is cash intensive. */
            cashShareThreshold: rateFraction.default('0.5'),
            /** Repayments looked at for the cash share. */
            cashLookbackDays: z.number().int().min(30).max(1825).default(365),
            /** Months until a rating is next reviewed. */
            reviewMonths: z
              .object({
                LOW: z.number().int().min(1).max(120).default(36),
                MEDIUM: z.number().int().min(1).max(120).default(24),
                HIGH: z.number().int().min(1).max(120).default(12),
              })
              .strict()
              .default({}),
          })
          .strict()
          .default({}),
        ctr: z
          .object({
            /** Cash transaction reporting threshold per currency (CAFIU). */
            thresholds: z
              .record(z.string().regex(/^[A-Z]{3}$/), decimalString)
              .default({ USD: '10000', KHR: '40000000' }),
            /** Payment channels that are cash. */
            cashChannels: z
              .array(z.enum(PAYMENT_CHANNEL_CODES))
              .min(1)
              .max(8)
              .default(['BRANCH_CASH']),
          })
          .strict()
          .default({}),
        /** Customer due diligence and AML records are kept this long after the relationship ends. */
        retentionYearsAfterRelationship: z.number().int().min(5).max(30).default(5),
      })
      .strict()
      .default({}),
    /**
     * The lender's operations contacts (D-151): besides the platform operator
     * (ALERT_EMAIL_TO), these addresses are e-mailed when one of this
     * lender's operational alerts opens, is still open (reminder) or resolves —
     * end of day behind or failing, month end not closed, outbox or webhook
     * backlog, reconciliation breaks, failed scheduled jobs. Empty: the
     * lender is not e-mailed; the alerts still show on the operations page.
     */
    operations: z
      .object({
        alertEmails: z.array(z.string().trim().toLowerCase().email().max(160)).max(10).default([]),
      })
      .strict()
      .default({}),
    /** The original (legacy) loan book's daily jobs. */
    legacyServicing: z
      .object({
        /** A loan with an instalment overdue more than this many days is marked DEFAULTED. */
        defaultAfterDaysOverdue: z.number().int().min(1).max(3650).default(30),
        /**
         * Most late penalty one instalment can carry, as a fraction of its
         * principal + interest (0.25 = 25%; D-102). The daily charge stops there.
         */
        penaltyCapRate: rateFraction.default('0.25'),
      })
      .strict()
      .default({}),
  })
  .strict();

export type TenantLendingSettings = z.infer<typeof tenantLendingSettingsSchema>;

/** The settings in force when a tenant has approved none: every default. */
export function defaultTenantLendingSettings(): TenantLendingSettings {
  return tenantLendingSettingsSchema.parse({});
}

/** Cross-field checks the schema cannot express. Empty when valid. */
export function validateTenantLendingSettings(s: TenantLendingSettings): string[] {
  const issues: string[] = [];
  for (const key of ['classes', 'longTermClasses'] as const) {
    const classes = s.regulatory[key];
    classes.forEach((c, i) => {
      if (c.code !== REGULATORY_CLASS_CODES[i])
        issues.push(`regulatory.${key}[${i}] must be ${REGULATORY_CLASS_CODES[i]} (the classes are fixed and ordered).`);
      if (i === 0 && c.minDpd !== 0) issues.push(`regulatory.${key}: the first class must start at 0 days past due.`);
      if (i > 0 && c.minDpd <= classes[i - 1].minDpd)
        issues.push(`regulatory.${key}: ${c.code} must start after ${classes[i - 1].code}.`);
    });
  }
  const edges = s.regulatory.sizeBandEdgesUsd;
  edges.forEach((e, i) => {
    if (i > 0 && e <= edges[i - 1]) issues.push('regulatory.sizeBandEdgesUsd must increase.');
  });
  if (dec(s.regulatory.sizeBandKhrPerUsd).lte(0)) issues.push('regulatory.sizeBandKhrPerUsd must be greater than zero.');
  const rates = s.regulatory.rateBandEdgesPct.map((r) => dec(r));
  rates.forEach((r, i) => {
    if (r.lte(0)) issues.push('regulatory.rateBandEdgesPct must be greater than zero.');
    if (i > 0 && r.lte(rates[i - 1])) issues.push('regulatory.rateBandEdgesPct must increase.');
  });
  if (dec(s.scoring.monitoring.psiEpsilon).lte(0) || dec(s.scoring.monitoring.psiEpsilon).gte('0.1'))
    issues.push('scoring.monitoring.psiEpsilon must be greater than 0 and below 0.1.');
  const aml = s.aml;
  if (aml.risk.mediumAt >= aml.risk.highAt) issues.push('aml.risk.mediumAt must be below aml.risk.highAt.');
  if (dec(aml.screening.matchThreshold).lt('0.5')) issues.push('aml.screening.matchThreshold below 0.5 would match almost every name.');
  if (aml.risk.reviewMonths.HIGH > aml.risk.reviewMonths.MEDIUM || aml.risk.reviewMonths.MEDIUM > aml.risk.reviewMonths.LOW)
    issues.push('aml.risk.reviewMonths: a higher rating must be reviewed at least as often as a lower one.');
  for (const [currency, threshold] of Object.entries(aml.ctr.thresholds))
    if (dec(threshold).lte(0)) issues.push(`aml.ctr.thresholds.${currency} must be greater than zero.`);
  return [...new Set(issues)];
}

/** The regulator's classification as these settings set it, for the impairment engine. */
export function regulatoryBands(s: TenantLendingSettings): RegulatoryBands {
  return {
    shortTerm: s.regulatory.classes,
    longTerm: s.regulatory.longTermClasses,
    shortTermMaxDays: s.regulatory.shortTermMaxDays,
    restructuredMinClass: s.regulatory.restructured.minClass,
  };
}

/** Every ledger account code the settings name, for checking against the chart. */
export function settingsAccountCodes(s: TenantLendingSettings): string[] {
  const { legacy, ...tenantLevel } = s.accounting;
  return [...new Set([...Object.values(tenantLevel), ...Object.values(legacy)])];
}
