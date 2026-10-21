import { lending } from '@microloan/shared';
import { esc } from './document-rules';

/**
 * The key facts statement as a customer reads it (D-123), in English or
 * Khmer. The figures come from `lending.buildKeyFacts`; this module only
 * words them. Self-contained HTML (no scripts, no external assets), filed in
 * the customer's library.
 */
export type KeyFactsLanguage = 'en' | 'km';
export const KEY_FACTS_LANGUAGES: KeyFactsLanguage[] = ['en', 'km'];

export interface KeyFactsDocument {
  facts: lending.KeyFacts;
  version: number;
  /** The business date the statement was issued on. */
  issuedOn: string;
  lender: { name: string; licenceNumber: string | null };
  borrower: { name: string };
  application: { reference: string };
  product: { name: string };
  security: {
    collateral: {
      type: string;
      description: string;
      value: string | null;
      currency: string;
    }[];
    guarantees: {
      name: string;
      type: string;
      amount: string;
      currency: string;
    }[];
  };
  coolingOff: {
    days: number;
    chargesAccruedInterest: boolean;
    refundsLenderFees: boolean;
  };
  complaints: {
    phone: string | null;
    email: string | null;
    address: string | null;
    regulator: string;
  };
  /**
   * How the loan is repaid: the lender's static KHQR code for the loan's
   * branch and currency (D-160). Absent on statements issued before codes
   * existed; null when the lender has none in force.
   */
  repayment?: {
    merchantName: string;
    bakongAccountId: string;
    bankName: string | null;
    accountNumber: string | null;
    currency: string;
    /** The code as a data: URI image. */
    qrImage: string;
  } | null;
}

type Row = [string, string];
interface Section {
  heading: string;
  rows?: Row[];
  text?: string[];
  /** A data: URI image (the KHQR code). */
  image?: string;
}

/** Money at the currency's minor units, with the currency code. */
export function money(v: string | null | undefined, currency: string): string {
  if (v === null || v === undefined || v === '') return '—';
  const units = lending.CURRENCY_DEFINITIONS[currency]?.minorUnits ?? 2;
  const [i, f] = new lending.D(v).toFixed(units).split('.');
  return `${i.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}${f ? `.${f}` : ''} ${currency}`;
}

const pct = (v: string | null | undefined) => (v ? `${v}%` : '—');

const FREQ: Record<KeyFactsLanguage, Record<string, string>> = {
  en: {
    WEEKLY: 'Weekly',
    FORTNIGHTLY: 'Every two weeks',
    MONTHLY: 'Monthly',
    QUARTERLY: 'Quarterly',
    SEMI_ANNUAL: 'Every six months',
    ANNUAL: 'Yearly',
    CUSTOM: 'As scheduled',
  },
  km: {
    WEEKLY: 'ប្រចាំសប្តាហ៍',
    FORTNIGHTLY: 'រៀងរាល់ពីរសប្តាហ៍',
    MONTHLY: 'ប្រចាំខែ',
    QUARTERLY: 'ប្រចាំត្រីមាស',
    SEMI_ANNUAL: 'ប្រចាំឆមាស',
    ANNUAL: 'ប្រចាំឆ្នាំ',
    CUSTOM: 'តាមកាលវិភាគ',
  },
};

/** Every word on the statement, by language. */
const T = {
  en: {
    title: 'Key facts statement',
    intro:
      'Read this statement before you sign. It sets out the main terms and the full cost of the loan you have been offered. You will be asked to confirm that you accept it before the loan agreement is made.',
    about: 'About this statement',
    lender: 'Lender',
    licence: 'Licence number',
    borrower: 'Borrower',
    application: 'Application reference',
    product: 'Product',
    version: 'Statement version',
    issued: 'Date issued',
    yourLoan: 'Your loan',
    principal: 'Amount borrowed',
    limit: 'Credit limit',
    commitmentFee: 'Commitment fee on the unused limit (a year)',
    overlimitRate: 'Interest rate above the limit (a year)',
    minimumPayment: 'Minimum payment (share of balance / least amount)',
    cash: 'Cash paid to you (after fees deducted)',
    booked: 'Principal you repay (including financed fees)',
    disbursement: 'Assumed disbursement date',
    instalments: 'Number of instalments',
    frequency: 'Repayment frequency',
    term: 'Final repayment date',
    rates: 'Interest rate and cost of credit',
    nominal: 'Nominal annual interest rate',
    effective: 'Effective annual rate (APR, including fees)',
    method: 'How interest is charged',
    reducing: 'On the reducing balance',
    flat: 'Flat, on the original principal',
    floatingRate: (b: string, m: string, f: string) =>
      `Variable: benchmark ${b} plus ${m}, reset ${f.toLowerCase().replace('_', '-')}. Your instalments may change when the rate resets.`,
    fees: 'Fees and charges at the start',
    noFees: 'No upfront fees.',
    fee: (name: string, how: string, payee: string) =>
      `${name} (${how}${payee})`,
    deducted: 'deducted from the loan',
    financed: 'added to the loan',
    separate: 'paid separately at disbursement',
    insurer: ', collected for the insurer',
    waived: 'waived',
    incTax: (tax: string) => ` including tax ${tax}`,
    totals: 'What the loan costs you',
    totalFees: 'Total fees',
    totalInterest: 'Total interest',
    costOfCredit: 'Total cost of credit (interest and all fees)',
    repayable: 'Total amount you will pay',
    schedule: 'Repayment schedule summary',
    firstPayment: 'First payment',
    regular: 'Regular instalment',
    lastPayment: 'Last payment',
    projected:
      'Amounts after the first rate reset are projections from today’s benchmark and may change.',
    facilityNote:
      'This is a credit line: you pay interest only on what you draw, and the payments depend on how much you use. There is no fixed repayment schedule.',
    latePayment: 'If you pay late',
    howToRepay: 'How to repay',
    payTo: 'Pay to (KHQR)',
    bakong: 'Bakong account',
    bankAccount: 'Bank account',
    repaySteps: [
      'Scan the code with any bank or wallet app that pays KHQR, type the amount and write your loan reference in the payment remark. The loan reference is on your loan agreement and in the borrower portal.',
      'Keep the receipt and tell the lender in the borrower portal ("I have paid") with the transaction reference, or show it to your loan officer. A payment is credited once the lender has checked it with its bank.',
      'Only pay to this code; staff will never ask you to pay into a personal account.',
    ],
    repayNoCode: 'The lender will tell you how to repay before your first instalment is due.',
    noPenalty: 'No late-payment charge.',
    penaltyFlat: (a: string, g: number) =>
      `A late fee of ${a} for each instalment paid late${g ? `, after ${g} days of grace` : ''}.`,
    penaltyPercent: (p: string, g: number) =>
      `A late charge of ${p} of the overdue amount for each instalment paid late${g ? `, after ${g} days of grace` : ''}.`,
    penaltyRate: (p: string, g: number) =>
      `Penalty interest at ${p} a year on the overdue amount, for each day it is overdue${g ? `, after ${g} days of grace` : ''}.`,
    capInstalment: (a: string) => `At most ${a} per instalment.`,
    capLoan: (a: string) => `At most ${a} over the life of the loan.`,
    returnedFee: (a: string) => `A returned or bounced payment costs ${a}.`,
    arrearsWarning:
      'Paying late can harm your credit record and make it harder to borrow. If you cannot pay, contact us early.',
    prepayment: 'Paying early',
    partialYes: (min: string | null, fee: string | null) =>
      `You may repay part of the loan early${min ? ` (at least ${min})` : ''}${fee ? `; a charge of ${fee} of the amount repaid applies` : ', with no charge'}.`,
    partialNo: 'Partial early repayments are not allowed.',
    settleYes: (fee: string | null, fixed: string | null) =>
      `You may repay the whole loan early by paying the principal outstanding, interest to the payment date and anything overdue${fee || fixed ? `, plus a settlement charge of ${[fee, fixed].filter(Boolean).join(' + ')}` : ', with no settlement charge'}.`,
    settleNo: 'Early settlement of the whole loan is not allowed.',
    rebate: (m: string) =>
      m === 'ACCRUED'
        ? 'Interest is charged only to the date you settle.'
        : `Interest not yet earned is rebated by the ${m === 'RULE_OF_78' ? 'Rule of 78' : 'actuarial'} method.`,
    lockIn: 'Lock-in period',
    noLockIn: 'There is no lock-in period.',
    tier: (
      until: number,
      action: string,
      rate: string | null,
      fixed: string | null,
      applies: string,
    ) =>
      action === 'REFUSE'
        ? `Until month ${until}: early repayment is not allowed (${applies}).`
        : `Until month ${until}: early repayment charge of ${[rate, fixed].filter(Boolean).join(' + ') || '0'} (${applies}).`,
    appliesPartial: 'part repayments',
    appliesSettle: 'full settlement',
    security: 'Security and guarantors',
    noSecurity: 'No collateral or guarantor is required.',
    collateral: (t: string, d: string, v: string) =>
      `Collateral: ${t} — ${d}${v ? ` (valued at ${v})` : ''}. If you do not repay, the lender may enforce its security over this asset.`,
    guarantor: (n: string, a: string) =>
      `Guarantor: ${n}, for up to ${a}. If you do not repay, the guarantor can be asked to pay.`,
    coolingOff: 'Your right to cancel (cooling-off)',
    coolingOffYes: (days: number, interest: boolean, fees: boolean) =>
      `You may cancel this loan within ${days} days after the money is paid out by telling us and repaying the cash you received${interest ? ' plus interest for the days you had it' : ''}. No penalty or settlement charge applies${fees ? ' and the lender’s upfront fees are refunded' : ''}.`,
    coolingOffNo: 'This loan has no cooling-off period.',
    complaints: 'Questions and complaints',
    complaintsIntro:
      'If you have a question or complaint, contact us first. If you are not satisfied with our answer, you may contact the regulator.',
    phone: 'Phone',
    email: 'Email',
    address: 'Address',
    regulator: 'Regulator',
    notConfigured: 'not configured — ask at any branch',
    acceptance: 'Your acceptance',
    acceptanceText:
      'By accepting, you confirm that you received this statement in a language you understand, that you read it, and that you had the chance to ask questions. Accepting this statement does not oblige you to take the loan.',
    datesNote:
      'Dates and amounts assume the money is paid out on the disbursement date shown; if it is paid out on another day, the dates move and the first interest amount may differ slightly.',
  },
  km: {
    title: 'សេចក្តីថ្លែងការណ៍ព័ត៌មានសំខាន់ៗអំពីឥណទាន',
    intro:
      'សូមអានសេចក្តីថ្លែងការណ៍នេះមុនពេលចុះហត្ថលេខា។ វាបង្ហាញលក្ខខណ្ឌសំខាន់ៗ និងថ្លៃដើមពេញលេញនៃឥណទានដែលបានផ្តល់ជូនអ្នក។ អ្នកនឹងត្រូវបញ្ជាក់ថាអ្នកយល់ព្រមមុនពេលធ្វើកិច្ចសន្យាខ្ចីប្រាក់។',
    about: 'អំពីសេចក្តីថ្លែងការណ៍នេះ',
    lender: 'អ្នកផ្តល់ឥណទាន',
    licence: 'លេខអាជ្ញាប័ណ្ណ',
    borrower: 'អ្នកខ្ចី',
    application: 'លេខយោងពាក្យស្នើសុំ',
    product: 'ផលិតផល',
    version: 'កំណែសេចក្តីថ្លែងការណ៍',
    issued: 'កាលបរិច្ឆេទចេញ',
    yourLoan: 'ឥណទានរបស់អ្នក',
    principal: 'ចំនួនប្រាក់ខ្ចី',
    limit: 'កម្រិតឥណទាន',
    commitmentFee: 'កម្រៃលើកម្រិតឥណទានមិនទាន់ប្រើ (ក្នុងមួយឆ្នាំ)',
    overlimitRate: 'អត្រាការប្រាក់លើចំនួនលើសកម្រិត (ក្នុងមួយឆ្នាំ)',
    minimumPayment: 'ការបង់អប្បបរមា (ភាគរយនៃសមតុល្យ / ចំនួនតិចបំផុត)',
    cash: 'ប្រាក់ដែលអ្នកទទួលបាន (ក្រោយកាត់កម្រៃ)',
    booked: 'ប្រាក់ដើមដែលអ្នកត្រូវសង (រួមទាំងកម្រៃដែលបញ្ចូលក្នុងប្រាក់កម្ចី)',
    disbursement: 'កាលបរិច្ឆេទបើកប្រាក់ (សន្មត)',
    instalments: 'ចំនួនដងនៃការបង់',
    frequency: 'ភាពញឹកញាប់នៃការបង់ប្រាក់',
    term: 'កាលបរិច្ឆេទបង់ចុងក្រោយ',
    rates: 'អត្រាការប្រាក់ និងថ្លៃដើមឥណទាន',
    nominal: 'អត្រាការប្រាក់ប្រចាំឆ្នាំ (នាមករណ៍)',
    effective: 'អត្រាការប្រាក់ប្រសិទ្ធភាពប្រចាំឆ្នាំ (APR រួមទាំងកម្រៃ)',
    method: 'វិធីគណនាការប្រាក់',
    reducing: 'គណនាលើសមតុល្យប្រាក់ដើមនៅសល់',
    flat: 'គណនាថេរលើប្រាក់ដើមដំបូង',
    floatingRate: (b: string, m: string, f: string) =>
      `អត្រាប្រែប្រួល៖ អត្រាគោល ${b} បូក ${m} កែតម្រូវ${FREQ.km[f] ?? f}។ ចំនួនបង់របស់អ្នកអាចប្រែប្រួលនៅពេលកែតម្រូវអត្រា។`,
    fees: 'កម្រៃ និងថ្លៃសេវានៅពេលចាប់ផ្តើម',
    noFees: 'គ្មានកម្រៃបង់មុនទេ។',
    fee: (name: string, how: string, payee: string) =>
      `${name} (${how}${payee})`,
    deducted: 'កាត់ចេញពីប្រាក់កម្ចី',
    financed: 'បញ្ចូលទៅក្នុងប្រាក់កម្ចី',
    separate: 'បង់ដាច់ដោយឡែកនៅពេលបើកប្រាក់',
    insurer: ' ប្រមូលជំនួសក្រុមហ៊ុនធានារ៉ាប់រង',
    waived: 'បានលើកលែង',
    incTax: (tax: string) => ` រួមទាំងពន្ធ ${tax}`,
    totals: 'ថ្លៃដើមនៃឥណទានរបស់អ្នក',
    totalFees: 'កម្រៃសរុប',
    totalInterest: 'ការប្រាក់សរុប',
    costOfCredit: 'ថ្លៃដើមឥណទានសរុប (ការប្រាក់ និងកម្រៃទាំងអស់)',
    repayable: 'ចំនួនទឹកប្រាក់សរុបដែលអ្នកត្រូវបង់',
    schedule: 'សង្ខេបកាលវិភាគសងប្រាក់',
    firstPayment: 'ការបង់លើកដំបូង',
    regular: 'ចំនួនបង់ធម្មតា',
    lastPayment: 'ការបង់លើកចុងក្រោយ',
    projected:
      'ចំនួនក្រោយការកែតម្រូវអត្រាលើកដំបូង គឺជាការប៉ាន់ស្មានផ្អែកលើអត្រាគោលថ្ងៃនេះ ហើយអាចប្រែប្រួល។',
    facilityNote:
      'នេះជាខ្សែឥណទាន៖ អ្នកបង់ការប្រាក់តែលើចំនួនដែលអ្នកដកប្រើប៉ុណ្ណោះ ហើយចំនួនបង់អាស្រ័យលើការប្រើប្រាស់របស់អ្នក។ គ្មានកាលវិភាគសងប្រាក់ថេរទេ។',
    latePayment: 'ប្រសិនបើអ្នកបង់យឺត',
    howToRepay: 'របៀបសងប្រាក់',
    payTo: 'បង់ទៅ (KHQR)',
    bakong: 'គណនីបាគង',
    bankAccount: 'គណនីធនាគារ',
    repaySteps: [
      'ស្កេនកូដនេះដោយកម្មវិធីធនាគារ ឬកាបូបអេឡិចត្រូនិក ដែលអាចបង់តាម KHQR បញ្ចូលចំនួនទឹកប្រាក់ ហើយសរសេរលេខយោងកម្ចីរបស់អ្នកនៅក្នុងចំណាំនៃការបង់ប្រាក់។ លេខយោងកម្ចីមាននៅលើកិច្ចសន្យាកម្ចី និងនៅក្នុងវិបផតថលអ្នកខ្ចី។',
      'រក្សាទុកបង្កាន់ដៃ ហើយប្រាប់អ្នកផ្តល់កម្ចីនៅក្នុងវិបផតថលអ្នកខ្ចី ("ខ្ញុំបានបង់ហើយ") ជាមួយលេខយោងប្រតិបត្តិការ ឬបង្ហាញវាទៅមន្ត្រីឥណទានរបស់អ្នក។ ការបង់ប្រាក់នឹងត្រូវបានកត់ត្រា បន្ទាប់ពីអ្នកផ្តល់កម្ចីបានផ្ទៀងផ្ទាត់ជាមួយធនាគាររបស់ខ្លួន។',
      'សូមបង់តែតាមកូដនេះប៉ុណ្ណោះ។ បុគ្គលិកនឹងមិនសុំឱ្យអ្នកបង់ចូលគណនីផ្ទាល់ខ្លួនឡើយ។',
    ],
    repayNoCode: 'អ្នកផ្តល់កម្ចីនឹងប្រាប់អ្នកពីរបៀបសងប្រាក់ មុនពេលដល់កាលកំណត់បង់លើកដំបូង។',
    noPenalty: 'គ្មានការពិន័យលើការបង់យឺតទេ។',
    penaltyFlat: (a: string, g: number) =>
      `ប្រាក់ពិន័យ ${a} សម្រាប់ការបង់យឺតនីមួយៗ${g ? ` បន្ទាប់ពីរយៈពេលអនុគ្រោះ ${g} ថ្ងៃ` : ''}។`,
    penaltyPercent: (p: string, g: number) =>
      `ប្រាក់ពិន័យ ${p} នៃចំនួនហួសកាលកំណត់ សម្រាប់ការបង់យឺតនីមួយៗ${g ? ` បន្ទាប់ពីរយៈពេលអនុគ្រោះ ${g} ថ្ងៃ` : ''}។`,
    penaltyRate: (p: string, g: number) =>
      `ការប្រាក់ពិន័យ ${p} ក្នុងមួយឆ្នាំ លើចំនួនហួសកាលកំណត់ សម្រាប់ថ្ងៃនីមួយៗដែលហួសកាលកំណត់${g ? ` បន្ទាប់ពីរយៈពេលអនុគ្រោះ ${g} ថ្ងៃ` : ''}។`,
    capInstalment: (a: string) => `យ៉ាងច្រើន ${a} ក្នុងមួយដំណាក់កាល។`,
    capLoan: (a: string) => `យ៉ាងច្រើន ${a} ពេញមួយអាយុកាលឥណទាន។`,
    returnedFee: (a: string) =>
      `ការបង់ប្រាក់ដែលត្រូវបានបដិសេធ ឬបង្វិលត្រឡប់ មានថ្លៃ ${a}។`,
    arrearsWarning:
      'ការបង់យឺតអាចប៉ះពាល់ដល់ប្រវត្តិឥណទានរបស់អ្នក និងធ្វើឱ្យពិបាកខ្ចីប្រាក់នៅពេលក្រោយ។ ប្រសិនបើអ្នកមិនអាចបង់បាន សូមទាក់ទងមកយើងឱ្យបានឆាប់។',
    prepayment: 'ការបង់មុនកាលកំណត់',
    partialYes: (min: string | null, fee: string | null) =>
      `អ្នកអាចសងប្រាក់មួយផ្នែកមុនកាលកំណត់${min ? ` (យ៉ាងតិច ${min})` : ''}${fee ? ` ដោយមានថ្លៃ ${fee} នៃចំនួនដែលបានសង` : ' ដោយគ្មានថ្លៃ'}។`,
    partialNo: 'មិនអនុញ្ញាតឱ្យសងប្រាក់មួយផ្នែកមុនកាលកំណត់ទេ។',
    settleYes: (fee: string | null, fixed: string | null) =>
      `អ្នកអាចសងឥណទានទាំងស្រុងមុនកាលកំណត់ ដោយបង់ប្រាក់ដើមនៅសល់ ការប្រាក់រហូតដល់ថ្ងៃបង់ និងចំនួនហួសកាលកំណត់${fee || fixed ? ` បូកថ្លៃបិទឥណទានមុនកាលកំណត់ ${[fee, fixed].filter(Boolean).join(' + ')}` : ' ដោយគ្មានថ្លៃបិទឥណទានមុនកាលកំណត់'}។`,
    settleNo: 'មិនអនុញ្ញាតឱ្យបិទឥណទានទាំងស្រុងមុនកាលកំណត់ទេ។',
    rebate: (m: string) =>
      m === 'ACCRUED'
        ? 'ការប្រាក់គិតតែរហូតដល់ថ្ងៃដែលអ្នកបិទឥណទានប៉ុណ្ណោះ។'
        : `ការប្រាក់ដែលមិនទាន់កើតឡើងត្រូវបានបង្វិលជូនតាមវិធី${m === 'RULE_OF_78' ? ' Rule of 78' : 'គណនាអាក់ទ្យូរីយ៉ែល'}។`,
    lockIn: 'រយៈពេលហាមបង់មុន (Lock-in)',
    noLockIn: 'គ្មានរយៈពេលហាមបង់មុនទេ។',
    tier: (
      until: number,
      action: string,
      rate: string | null,
      fixed: string | null,
      applies: string,
    ) =>
      action === 'REFUSE'
        ? `រហូតដល់ខែទី ${until}៖ មិនអនុញ្ញាតឱ្យសងមុនកាលកំណត់ (${applies})។`
        : `រហូតដល់ខែទី ${until}៖ ថ្លៃសងមុនកាលកំណត់ ${[rate, fixed].filter(Boolean).join(' + ') || '0'} (${applies})។`,
    appliesPartial: 'ការសងមួយផ្នែក',
    appliesSettle: 'ការបិទឥណទានទាំងស្រុង',
    security: 'ទ្រព្យធានា និងអ្នកធានា',
    noSecurity: 'មិនតម្រូវឱ្យមានទ្រព្យធានា ឬអ្នកធានាទេ។',
    collateral: (t: string, d: string, v: string) =>
      `ទ្រព្យធានា៖ ${t} — ${d}${v ? ` (តម្លៃវាយតម្លៃ ${v})` : ''}។ ប្រសិនបើអ្នកមិនសង អ្នកផ្តល់ឥណទានអាចអនុវត្តសិទ្ធិលើទ្រព្យធានានេះ។`,
    guarantor: (n: string, a: string) =>
      `អ្នកធានា៖ ${n} រហូតដល់ ${a}។ ប្រសិនបើអ្នកមិនសង អ្នកធានាអាចត្រូវបានស្នើឱ្យបង់ជំនួស។`,
    coolingOff: 'សិទ្ធិលុបចោលកិច្ចសន្យា (រយៈពេលពិចារណា)',
    coolingOffYes: (days: number, interest: boolean, fees: boolean) =>
      `អ្នកអាចលុបចោលឥណទាននេះក្នុងរយៈពេល ${days} ថ្ងៃ បន្ទាប់ពីបើកប្រាក់ ដោយជូនដំណឹងមកយើង និងសងប្រាក់ដែលអ្នកបានទទួល${interest ? ' បូកការប្រាក់សម្រាប់ចំនួនថ្ងៃដែលអ្នកបានកាន់ប្រាក់' : ''}។ គ្មានការពិន័យ ឬថ្លៃបិទឥណទានទេ${fees ? ' ហើយកម្រៃបង់មុនរបស់អ្នកផ្តល់ឥណទាននឹងត្រូវបង្វិលជូនវិញ' : ''}។`,
    coolingOffNo: 'ឥណទាននេះគ្មានរយៈពេលពិចារណាសម្រាប់លុបចោលទេ។',
    complaints: 'សំណួរ និងបណ្តឹងតវ៉ា',
    complaintsIntro:
      'ប្រសិនបើអ្នកមានសំណួរ ឬបណ្តឹង សូមទាក់ទងមកយើងជាមុនសិន។ ប្រសិនបើអ្នកមិនពេញចិត្តនឹងចម្លើយរបស់យើង អ្នកអាចទាក់ទងទៅនិយ័តករ។',
    phone: 'ទូរស័ព្ទ',
    email: 'អ៊ីមែល',
    address: 'អាសយដ្ឋាន',
    regulator: 'និយ័តករ',
    notConfigured: 'មិនទាន់កំណត់ — សូមសាកសួរនៅសាខាណាមួយ',
    acceptance: 'ការយល់ព្រមរបស់អ្នក',
    acceptanceText:
      'តាមរយៈការយល់ព្រម អ្នកបញ្ជាក់ថាអ្នកបានទទួលសេចក្តីថ្លែងការណ៍នេះជាភាសាដែលអ្នកយល់ បានអានវា និងមានឱកាសសួរសំណួរ។ ការយល់ព្រមលើសេចក្តីថ្លែងការណ៍នេះ មិនបង្ខំឱ្យអ្នកត្រូវខ្ចីប្រាក់ទេ។',
    datesNote:
      'កាលបរិច្ឆេទ និងចំនួនទឹកប្រាក់ សន្មតថាប្រាក់ត្រូវបានបើកនៅថ្ងៃបើកប្រាក់ដែលបានបង្ហាញ។ ប្រសិនបើបើកនៅថ្ងៃផ្សេង កាលបរិច្ឆេទនឹងផ្លាស់ប្តូរ ហើយការប្រាក់ដំបូងអាចខុសគ្នាបន្តិច។',
  },
};

/** The statement's sections in one language. */
export function keyFactsSections(
  doc: KeyFactsDocument,
  lang: KeyFactsLanguage,
): Section[] {
  const t = T[lang];
  const f = doc.facts;
  const cur = f.currency;
  const m = (v: string | null | undefined) => money(v, cur);
  const sections: Section[] = [];

  sections.push({
    heading: t.about,
    rows: [
      [t.lender, doc.lender.name],
      [t.licence, doc.lender.licenceNumber ?? t.notConfigured],
      [t.borrower, doc.borrower.name],
      [t.application, doc.application.reference],
      [t.product, doc.product.name],
      [t.version, String(doc.version)],
      [t.issued, doc.issuedOn],
    ],
  });

  const fac = f.facility;
  const loanRows: Row[] = fac
    ? [
        [t.limit, m(fac.limit)],
        ...(fac.commitmentFeePct
          ? ([[t.commitmentFee, `${fac.commitmentFeePct}%`]] as Row[])
          : []),
        ...(fac.overlimitRatePct
          ? ([[t.overlimitRate, `${fac.overlimitRatePct}%`]] as Row[])
          : []),
        ...(fac.minimumPaymentPct || fac.minimumPaymentFloor
          ? ([
              [
                t.minimumPayment,
                [
                  fac.minimumPaymentPct ? `${fac.minimumPaymentPct}%` : null,
                  fac.minimumPaymentFloor ? m(fac.minimumPaymentFloor) : null,
                ]
                  .filter(Boolean)
                  .join(' / '),
              ],
            ] as Row[])
          : []),
      ]
    : [
        [t.principal, m(f.principal)],
        [t.cash, m(f.netDisbursement)],
        [t.booked, m(f.bookedPrincipal)],
      ];
  loanRows.push([t.disbursement, f.disbursementDate]);
  if (f.schedule) {
    loanRows.push(
      [t.instalments, String(f.schedule.numberOfInstalments)],
      [
        t.frequency,
        FREQ[lang][f.schedule.frequency ?? 'CUSTOM'] ?? FREQ[lang].CUSTOM,
      ],
      [t.term, f.schedule.lastDueDate],
    );
  }
  sections.push({ heading: t.yourLoan, rows: loanRows });

  const rateRows: Row[] = [
    [t.nominal, pct(f.rates.nominalAnnualRatePct)],
    [t.effective, pct(f.rates.effectiveAnnualRatePct)],
    [t.method, f.rates.interestMethod === 'FLAT' ? t.flat : t.reducing],
  ];
  sections.push({
    heading: t.rates,
    rows: rateRows,
    text: f.rates.floating
      ? [
          t.floatingRate(
            f.rates.floating.benchmarkCode,
            `${f.rates.floating.marginPct}%`,
            f.rates.floating.resetFrequency,
          ),
        ]
      : undefined,
  });

  const how = {
    DEDUCTED: t.deducted,
    FINANCED: t.financed,
    SEPARATE: t.separate,
  };
  sections.push({
    heading: t.fees,
    rows: f.fees.map((x) => [
      t.fee(x.name, how[x.treatment], x.payee === 'INSURER' ? t.insurer : ''),
      x.waived
        ? t.waived
        : `${m(x.total)}${new lending.D(x.tax).gt(0) ? t.incTax(m(x.tax)) : ''}`,
    ]),
    text: f.fees.length ? undefined : [t.noFees],
  });

  sections.push({
    heading: t.totals,
    rows: [
      [t.totalFees, m(f.totals.fees)],
      ...(f.totals.interest !== null
        ? ([
            [t.totalInterest, m(f.totals.interest)],
            [t.costOfCredit, m(f.totals.costOfCredit)],
            [t.repayable, m(f.totals.repayable)],
          ] as Row[])
        : []),
    ],
  });

  if (f.schedule) {
    const s = f.schedule;
    sections.push({
      heading: t.schedule,
      rows: [
        [t.firstPayment, `${s.firstDueDate} · ${m(s.firstInstalment)}`],
        [t.regular, m(s.regularInstalment)],
        [t.lastPayment, `${s.lastDueDate} · ${m(s.lastInstalment)}`],
      ],
      text: [t.datesNote, ...(s.projected ? [t.projected] : [])],
    });
  } else {
    sections.push({ heading: t.schedule, text: [t.facilityNote] });
  }

  const lp = f.latePayment;
  const late: string[] = [];
  if (lp.type === 'NONE') late.push(t.noPenalty);
  if (lp.type === 'FLAT_PER_INSTALMENT')
    late.push(t.penaltyFlat(m(lp.flatAmount), lp.graceDays));
  if (lp.type === 'PERCENT_PER_INSTALMENT')
    late.push(t.penaltyPercent(pct(lp.percentOfOverduePct), lp.graceDays));
  if (lp.type === 'RATE_ON_OVERDUE')
    late.push(t.penaltyRate(pct(lp.annualRatePct), lp.graceDays));
  if (lp.type !== 'NONE' && lp.capPerInstalment)
    late.push(t.capInstalment(m(lp.capPerInstalment)));
  if (lp.type !== 'NONE' && lp.capPerLoan)
    late.push(t.capLoan(m(lp.capPerLoan)));
  if (lp.returnedPaymentFee) late.push(t.returnedFee(m(lp.returnedPaymentFee)));
  late.push(t.arrearsWarning);
  sections.push({ heading: t.latePayment, text: late });

  // How to repay (D-160): only on statements issued since codes exist.
  if (doc.repayment !== undefined) {
    const r = doc.repayment;
    sections.push(
      r
        ? {
            heading: t.howToRepay,
            rows: [
              [t.payTo, `${r.merchantName} (${r.currency})`],
              [t.bakong, r.bakongAccountId],
              ...(r.bankName
                ? ([
                    [
                      t.bankAccount,
                      `${r.bankName}${r.accountNumber ? ` ${r.accountNumber}` : ''}`,
                    ],
                  ] as Row[])
                : []),
            ],
            text: [...t.repaySteps],
            image: r.qrImage,
          }
        : { heading: t.howToRepay, text: [t.repayNoCode] },
    );
  }

  const pp = f.prepayment;
  sections.push({
    heading: t.prepayment,
    text: [
      pp.partialAllowed
        ? t.partialYes(
            pp.partialMinAmount ? m(pp.partialMinAmount) : null,
            pp.partialFeePct ? pct(pp.partialFeePct) : null,
          )
        : t.partialNo,
      pp.settlementAllowed
        ? t.settleYes(
            pp.settlementFeePct ? pct(pp.settlementFeePct) : null,
            pp.settlementFeeFixed ? m(pp.settlementFeeFixed) : null,
          )
        : t.settleNo,
      ...(pp.settlementAllowed ? [t.rebate(pp.rebateMethod)] : []),
    ],
  });

  const applies = f.lockIn.appliesTo
    .map((a) => (a === 'EARLY_SETTLEMENT' ? t.appliesSettle : t.appliesPartial))
    .join(', ');
  sections.push({
    heading: t.lockIn,
    text: f.lockIn.tiers.length
      ? f.lockIn.tiers.map((x) =>
          t.tier(
            x.untilMonth,
            x.action,
            x.ratePct ? pct(x.ratePct) : null,
            x.fixed ? m(x.fixed) : null,
            applies,
          ),
        )
      : [t.noLockIn],
  });

  const sec = doc.security;
  sections.push({
    heading: t.security,
    text:
      sec.collateral.length || sec.guarantees.length
        ? [
            ...sec.collateral.map((c) =>
              t.collateral(
                c.type,
                c.description,
                c.value ? money(c.value, c.currency) : '',
              ),
            ),
            ...sec.guarantees.map((g) =>
              t.guarantor(g.name, money(g.amount, g.currency)),
            ),
          ]
        : [t.noSecurity],
  });

  const co = doc.coolingOff;
  sections.push({
    heading: t.coolingOff,
    text: [
      co.days > 0
        ? t.coolingOffYes(
            co.days,
            co.chargesAccruedInterest,
            co.refundsLenderFees,
          )
        : t.coolingOffNo,
    ],
  });

  const c = doc.complaints;
  sections.push({
    heading: t.complaints,
    text: [t.complaintsIntro],
    rows: [
      [t.phone, c.phone ?? t.notConfigured],
      [t.email, c.email ?? t.notConfigured],
      [t.address, c.address ?? t.notConfigured],
      [t.regulator, c.regulator],
    ],
  });

  sections.push({ heading: t.acceptance, text: [t.acceptanceText] });
  return sections;
}

/** The statement as a self-contained HTML document in one language. */
export function renderKeyFacts(
  doc: KeyFactsDocument,
  lang: KeyFactsLanguage,
): Buffer {
  const t = T[lang];
  const body = keyFactsSections(doc, lang)
    .map((s) => {
      const text = (s.text ?? []).map((p) => `<p>${esc(p)}</p>`).join('');
      const rows = s.rows?.length
        ? `<table>${s.rows.map(([k, v]) => `<tr><th>${esc(k)}</th><td>${esc(v)}</td></tr>`).join('')}</table>`
        : '';
      // Only a PNG data URI is embedded: the document stays self-contained.
      const image =
        s.image && /^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(s.image)
          ? `<p><img src="${s.image}" alt="KHQR" width="200" height="200"></p>`
          : '';
      return `<section><h2>${esc(s.heading)}</h2>${image}${rows}${text}</section>`;
    })
    .join('\n');
  const font =
    lang === 'km'
      ? "'Khmer OS Siemreap','Noto Sans Khmer','Khmer OS',sans-serif"
      : 'sans-serif';
  return Buffer.from(
    `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><title>${esc(t.title)} — ${esc(doc.application.reference)}</title>` +
      `<style>body{font-family:${font};max-width:760px;margin:24px auto;color:#1a1f36;line-height:1.5}` +
      `th{text-align:left;padding:4px 12px 4px 0;color:#697386;font-weight:600;vertical-align:top}td{padding:4px 0}` +
      `h1{font-size:20px}h2{font-size:15px;margin-top:20px;border-bottom:1px solid #e3e8ee}</style></head>` +
      `<body><h1>${esc(t.title)}</h1>\n<p>${esc(t.intro)}</p>\n${body}</body></html>`,
    'utf8',
  );
}
