/**
 * The regulatory return (OPS-7) as a pure computation: loan positions at a
 * month end in, NBC-style tables, totals, self-checks and the ledger
 * reconciliation out. No database, no clock — the service gathers the facts,
 * this file turns them into the return, and the same facts always give the
 * same return (so its hash is meaningful).
 *
 * Every amount is a decimal string in the loan's own currency. Currencies are
 * never added together: every table is broken down by currency and every
 * total is per currency.
 */
import { lending } from '@microloan/shared';

type Dec = InstanceType<typeof lending.D>;
const D = (v: string | number | null | undefined) =>
  new lending.D(v === null || v === undefined || v === '' ? 0 : v);

export const RETURN_SCHEMA = 'nbc-monthly-v1';
export type Stack = 'LENDING' | 'LEGACY';

/** One loan as it stood at the month end. */
export interface LoanPosition {
  stack: Stack;
  loanId: string;
  reference: string;
  borrowerId: string;
  borrowerName: string;
  branch: string;
  currency: string;
  family: string;
  product: string;
  purpose: string;
  borrowerType: 'INDIVIDUAL' | 'GROUP';
  bookedPrincipal: string;
  /** Principal outstanding at month end, from the ledger. */
  principal: string;
  interestReceivable: string;
  /** Loss allowance held against the loan at month end. */
  allowance: string;
  daysPastDue: number;
  /** The classification recorded by the tenant's own policy, when there is one. */
  recordedClass: string | null;
  restructured: boolean;
  /** Annual nominal rate in percent, or null when not recorded. */
  annualRatePct: string | null;
  /** Days from disbursement to the original maturity: chooses the NBC band set (D-114); null grades short-term. */
  originalTermDays?: number | null;
  /** A restructured loan still short of the on-time instalments that cure it (D-113). */
  onProbation?: boolean;
  /** Days past due held while on probation (the restructure floor). */
  floorDpd?: number | null;
}

export interface Movement {
  stack: Stack;
  currency: string;
  kind: 'DISBURSED' | 'WRITTEN_OFF' | 'RECOVERED';
  count: number;
  amount: string;
}

/** What the ledger says for one stack and currency at month end. */
export interface LedgerFact {
  stack: Stack;
  currency: string;
  /** Loans receivable balance (debit) at month end, from the journal. */
  principal: string;
  /** The same balance in the close snapshot (frozen), when the month is closed. */
  principalFrozen: string | null;
  /** Loss allowance balance (credit) at month end. */
  allowance: string;
  allowanceFrozen: string | null;
  /**
   * Legacy loans moved to the lending platform by a loan-book migration but
   * still carried on the legacy ledger: a reconciling item, not a break, and
   * excluded from the return so a loan is never counted twice.
   */
  principalMigrated?: string;
  allowanceMigrated?: string;
  /** Account codes the balances were taken from. */
  accounts: string[];
}

export interface ReturnInput {
  tenantName: string;
  year: number;
  month: number;
  start: string;
  end: string;
  basis: 'CLOSED_PERIOD' | 'LIVE_PREVIEW';
  /** When the loan attributes (days past due, class) were captured. */
  attributesAsOf: string;
  rateCapPct: string;
  /** The lender's regulatory settings (classes and bands); the NBC defaults when absent. */
  regulatory?: RegulatorySettings;
  /**
   * The impairment policy in force (D-115, D-116): NONE when none is
   * approved. Absent: not known (no policy check or reserve table).
   */
  impairmentMode?: 'REGULATORY' | 'ECL' | 'NONE';
  /** Regulatory reserve on the lending ledger at month end, per currency (D-115). */
  reserve?: { account: string; held: { currency: string; balance: string }[] };
  positions: LoanPosition[];
  movements: Movement[];
  ledger: LedgerFact[];
  warnings: string[];
}

export type ColumnKind = 'text' | 'amount' | 'count' | 'ratio' | 'percent';
export interface Column {
  key: string;
  label: string;
  kind: ColumnKind;
}
export type Row = Record<string, string | number>;
export interface ReturnTable {
  code: string;
  title: string;
  description: string;
  columns: Column[];
  rows: Row[];
  /** One total row per currency. */
  totals: Row[];
  notes?: string[];
}
export interface ReconciliationRow {
  currency: string;
  stack: Stack | 'TOTAL';
  measure: 'PRINCIPAL' | 'ALLOWANCE';
  /** Sum of the loans in the return. */
  loans: string;
  /** Ledger balance at month end. */
  ledger: string;
  /** Ledger balance frozen at the close, when there is one (lending only). */
  frozen: string | null;
  /** Reconciling item: legacy loans already moved to the lending platform. */
  migrated: string;
  difference: string;
  status: 'MATCHED' | 'BREAK';
  accounts: string;
}
export interface ReturnCheck {
  code: string;
  label: string;
  passed: boolean;
  detail: string;
}
export interface ReturnContent {
  schema: string;
  tenant: string;
  period: {
    year: number;
    month: number;
    start: string;
    end: string;
    label: string;
  };
  basis: string;
  attributesAsOf: string;
  currencies: string[];
  rateCapPct: string;
  tables: ReturnTable[];
  reconciliation: ReconciliationRow[];
  checks: ReturnCheck[];
  warnings: string[];
  /** The impairment basis of the allowance, when known (D-115). */
  impairmentMode?: string;
}

/** NBC loan classes (Prakas on credit risk grading), worst last: the default when a lender has set none. */
export const REGULATORY_CLASSES = lending.NBC_IMPAIRMENT_CLASSES;

/** The parts of the lender's settings the return uses (lending settings `regulatory`). */
export type RegulatorySettings = lending.TenantLendingSettings['regulatory'];
type RegulatoryClassDef = {
  code: string;
  label: string;
  minDpd: number;
  rate: string;
};

const DEFAULT_REGULATORY: RegulatorySettings =
  lending.defaultTenantLendingSettings().regulatory;

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

/** Minor units reported per currency. */
export function scaleOf(currency: string): number {
  return currency === 'KHR' ? 0 : 2;
}
const money = (v: Dec, currency: string) =>
  v
    .toDecimalPlaces(scaleOf(currency), lending.D.ROUND_HALF_UP)
    .toFixed(scaleOf(currency));
const ratio = (part: Dec, whole: Dec) =>
  whole.isZero()
    ? '0.0000'
    : part.div(whole).toDecimalPlaces(4, lending.D.ROUND_HALF_UP).toFixed(4);

/**
 * The regulatory class on one band set: by days past due, never better than
 * the class the tenant's own policy recorded (a restructured loan held at a
 * worse class by its probation floor stays there).
 */
export function regulatoryClass(
  dpd: number,
  recorded: string | null,
  classes: RegulatoryClassDef[] = REGULATORY_CLASSES,
) {
  let idx = 0;
  classes.forEach((c, i) => {
    if (dpd >= c.minDpd) idx = i;
  });
  const rec = recorded ? classes.findIndex((c) => c.code === recorded) : -1;
  if (rec > idx) idx = rec;
  return classes[idx];
}

/** One loan's NBC grade in the return. */
export interface ReturnGrade {
  cls: RegulatoryClassDef;
  /** Position in the class order (the same codes in both sets). */
  index: number;
  term: lending.TermBasis;
}

const bandsOf = (reg: RegulatorySettings) =>
  lending.regulatoryBands({
    regulatory: reg,
  } as lending.TenantLendingSettings);

/**
 * One loan's NBC grade: the band set for its original term, the restructure
 * probation floor and minimum class (D-113, D-114), never better than the
 * class its impairment policy recorded.
 */
export function gradePosition(
  p: LoanPosition,
  reg: RegulatorySettings = DEFAULT_REGULATORY,
): ReturnGrade {
  const g = lending.classifyRegulatory(bandsOf(reg), {
    daysPastDue: p.daysPastDue,
    originalTermDays: p.originalTermDays ?? null,
    restructured: p.restructured,
    onProbation: p.onProbation ?? false,
    floorDpd: p.floorDpd ?? null,
  });
  const classes: RegulatoryClassDef[] =
    g.term === 'LONG' ? reg.longTermClasses : reg.classes;
  let index = g.index;
  const rec = p.recordedClass
    ? classes.findIndex((c) => c.code === p.recordedClass)
    : -1;
  if (rec > index) index = rec;
  return { cls: classes[index], index, term: g.term };
}

/**
 * Loan size bands on the booked amount; KHR bands are the USD bands × the
 * lender's fixed band conversion (default 500 / 1,000 / 5,000 / 10,000 /
 * 50,000 USD and 4,000 KHR per USD).
 */
export function sizeBands(
  currency: string,
  reg: Pick<
    RegulatorySettings,
    'sizeBandEdgesUsd' | 'sizeBandKhrPerUsd'
  > = DEFAULT_REGULATORY,
): { label: string; upTo: Dec | null }[] {
  const f = currency === 'KHR' ? D(reg.sizeBandKhrPerUsd).toNumber() : 1;
  const edges = reg.sizeBandEdgesUsd.map((e) => e * f);
  const fmt = (n: number) => n.toLocaleString('en-US');
  const out: { label: string; upTo: Dec | null }[] = [];
  let prev = 0;
  for (const e of edges) {
    out.push({
      label: prev === 0 ? `Up to ${fmt(e)}` : `${fmt(prev)} – ${fmt(e)}`,
      upTo: D(e),
    });
    prev = e;
  }
  out.push({ label: `Over ${fmt(prev)}`, upTo: null });
  return out;
}

/** Interest-rate bands against the regulatory cap. */
export function rateBands(
  capPct: string,
  edgesPct: string[] = DEFAULT_REGULATORY.rateBandEdgesPct,
): { label: string; upTo: Dec | null; aboveCap: boolean }[] {
  const cap = D(capPct);
  const edges = edgesPct.map((e) => D(e)).filter((e) => e.lt(cap));
  const out: { label: string; upTo: Dec | null; aboveCap: boolean }[] = [];
  let prev: Dec | null = null;
  for (const e of [...edges, cap]) {
    out.push({
      label:
        prev === null
          ? `Up to ${e.toString()}%`
          : `${prev.toString()}% – ${e.toString()}%${e.eq(cap) ? ' (cap)' : ''}`,
      upTo: e,
      aboveCap: false,
    });
    prev = e;
  }
  out.push({
    label: `Above the ${cap.toString()}% cap`,
    upTo: null,
    aboveCap: true,
  });
  return out;
}

class Acc {
  constructor(private readonly grade: (p: LoanPosition) => ReturnGrade) {}
  count = 0;
  principal = D(0);
  allowance = D(0);
  interest = D(0);
  required = D(0);
  par1 = D(0);
  par30 = D(0);
  par90 = D(0);
  add(p: LoanPosition) {
    const pr = D(p.principal);
    this.count += 1;
    this.principal = this.principal.plus(pr);
    this.allowance = this.allowance.plus(D(p.allowance));
    this.interest = this.interest.plus(D(p.interestReceivable));
    // Rounded per loan to the currency's minor unit, as the reserve is.
    this.required = this.required.plus(
      pr
        .times(this.grade(p).cls.rate)
        .toDecimalPlaces(scaleOf(p.currency), lending.D.ROUND_HALF_UP),
    );
    if (p.daysPastDue >= 1) this.par1 = this.par1.plus(pr);
    if (p.daysPastDue >= 30) this.par30 = this.par30.plus(pr);
    if (p.daysPastDue >= 90) this.par90 = this.par90.plus(pr);
  }
}

function group<K extends string>(
  positions: LoanPosition[],
  key: (p: LoanPosition) => K,
  newAcc: () => Acc,
): Map<K, Acc> {
  const m = new Map<K, Acc>();
  for (const p of positions) {
    const k = key(p);
    const a = m.get(k) ?? newAcc();
    a.add(p);
    m.set(k, a);
  }
  return m;
}

const STACK_LABEL: Record<string, string> = {
  LENDING: 'Lending platform',
  LEGACY: 'Legacy loans',
  TOTAL: 'Total',
};

export function buildReturn(input: ReturnInput): ReturnContent {
  const reg = input.regulatory ?? DEFAULT_REGULATORY;
  const classes: RegulatoryClassDef[] = reg.classes;
  const grades = new Map<LoanPosition, ReturnGrade>();
  const gradeOf = (p: LoanPosition) => {
    let g = grades.get(p);
    if (!g) grades.set(p, (g = gradePosition(p, reg)));
    return g;
  };
  const newAcc = () => new Acc(gradeOf);
  const classOf = (p: LoanPosition) => gradeOf(p).cls;
  const TERMS: {
    term: lending.TermBasis;
    label: string;
    set: RegulatoryClassDef[];
  }[] = [
    { term: 'SHORT', label: 'Short-term', set: reg.classes },
    { term: 'LONG', label: 'Long-term', set: reg.longTermClasses },
  ];
  const positions = input.positions.filter((p) => !D(p.principal).isZero());
  const currencies = [
    ...new Set([
      ...positions.map((p) => p.currency),
      ...input.ledger.map((l) => l.currency),
      ...input.movements.map((m) => m.currency),
    ]),
  ].sort();
  const byCur = (c: string) => positions.filter((p) => p.currency === c);
  const tables: ReturnTable[] = [];

  const totalRow = (c: string, a: Acc, extra: Row = {}): Row => ({
    currency: c,
    loans: a.count,
    principal: money(a.principal, c),
    ...extra,
  });

  // 1. Portfolio by currency and stack.
  {
    const rows: Row[] = [];
    const totals: Row[] = [];
    for (const c of currencies) {
      const all = newAcc();
      for (const stack of ['LENDING', 'LEGACY'] as Stack[]) {
        const a = newAcc();
        byCur(c)
          .filter((p) => p.stack === stack)
          .forEach((p) => {
            a.add(p);
            all.add(p);
          });
        rows.push({
          currency: c,
          stack: STACK_LABEL[stack],
          loans: a.count,
          principal: money(a.principal, c),
          interestReceivable: money(a.interest, c),
          allowance: money(a.allowance, c),
          provisionRequired: money(a.required, c),
          par30Ratio: ratio(a.par30, a.principal),
        });
      }
      totals.push(
        totalRow(c, all, {
          stack: STACK_LABEL.TOTAL,
          interestReceivable: money(all.interest, c),
          allowance: money(all.allowance, c),
          provisionRequired: money(all.required, c),
          par30Ratio: ratio(all.par30, all.principal),
        }),
      );
    }
    tables.push({
      code: 'PORTFOLIO',
      title: 'Loan portfolio by currency',
      description:
        'Outstanding principal at month end for the lending platform and the legacy loans, per currency.',
      columns: [
        { key: 'currency', label: 'Currency', kind: 'text' },
        { key: 'stack', label: 'Book', kind: 'text' },
        { key: 'loans', label: 'Loans', kind: 'count' },
        { key: 'principal', label: 'Principal outstanding', kind: 'amount' },
        {
          key: 'interestReceivable',
          label: 'Accrued interest',
          kind: 'amount',
        },
        { key: 'allowance', label: 'Allowance held', kind: 'amount' },
        {
          key: 'provisionRequired',
          label: 'NBC provision required',
          kind: 'amount',
        },
        { key: 'par30Ratio', label: 'PAR 30', kind: 'ratio' },
      ],
      rows,
      totals,
    });
  }

  // 2. Classification and provisioning.
  {
    const rows: Row[] = [];
    const totals: Row[] = [];
    for (const c of currencies) {
      const g = group(
        byCur(c),
        (p) => `${gradeOf(p).term}:${classOf(p).code}`,
        newAcc,
      );
      const all = newAcc();
      byCur(c).forEach((p) => all.add(p));
      for (const t of TERMS)
        t.set.forEach((k, i) => {
          const a = g.get(`${t.term}:${k.code}`) ?? newAcc();
          const next = t.set[i + 1];
          rows.push({
            currency: c,
            term: t.label,
            class: k.label,
            days: next ? `${k.minDpd}–${next.minDpd - 1}` : `${k.minDpd}+`,
            rate: D(k.rate).times(100).toString(),
            loans: a.count,
            principal: money(a.principal, c),
            provisionRequired: money(a.required, c),
            allowance: money(a.allowance, c),
          });
        });
      totals.push(
        totalRow(c, all, {
          term: 'Total',
          class: '',
          provisionRequired: money(all.required, c),
          allowance: money(all.allowance, c),
        }),
      );
    }
    const minClass = reg.restructured.minClass
      ? (classes.find((k) => k.code === reg.restructured.minClass)?.label ??
        reg.restructured.minClass)
      : null;
    const cure = reg.restructured.minProbationInstalments;
    tables.push({
      code: 'CLASSIFICATION',
      title: 'Loan classification and provisioning',
      description: `NBC classes by days past due at month end: the short-term bands for loans whose original term is up to ${reg.shortTermMaxDays} days, the long-term bands beyond; required provision = principal × class rate.`,
      notes: [
        `A restructured loan on probation is graded on the days past due it had when restructured, if more${minClass ? `, and at least ${minClass}` : ''}, until ${cure === 1 ? 'one revised instalment is' : `${cure} consecutive revised instalments are`} paid on time (or the product's own number, if more). A loan is never graded better than the class its impairment policy recorded.`,
        'Bands and rates as the lender has set them (by default NBC Prakas B7-017-344 as recalled; assumed, needs compliance sign-off).',
      ],
      columns: [
        { key: 'currency', label: 'Currency', kind: 'text' },
        { key: 'term', label: 'Term', kind: 'text' },
        { key: 'class', label: 'Class', kind: 'text' },
        { key: 'days', label: 'Days past due', kind: 'text' },
        { key: 'rate', label: 'Rate %', kind: 'percent' },
        { key: 'loans', label: 'Loans', kind: 'count' },
        { key: 'principal', label: 'Principal', kind: 'amount' },
        {
          key: 'provisionRequired',
          label: 'Provision required',
          kind: 'amount',
        },
        { key: 'allowance', label: 'Allowance held', kind: 'amount' },
      ],
      rows,
      totals,
    });
  }

  // 3. Portfolio at risk.
  {
    const rows: Row[] = [];
    const totals: Row[] = [];
    const parRow = (c: string, a: Acc): Row => ({
      principal: money(a.principal, c),
      par1: money(a.par1, c),
      par1Ratio: ratio(a.par1, a.principal),
      par30: money(a.par30, c),
      par30Ratio: ratio(a.par30, a.principal),
      par90: money(a.par90, c),
      par90Ratio: ratio(a.par90, a.principal),
    });
    for (const c of currencies) {
      const all = newAcc();
      for (const stack of ['LENDING', 'LEGACY'] as Stack[]) {
        const a = newAcc();
        byCur(c)
          .filter((p) => p.stack === stack)
          .forEach((p) => {
            a.add(p);
            all.add(p);
          });
        rows.push({
          currency: c,
          stack: STACK_LABEL[stack],
          loans: a.count,
          ...parRow(c, a),
        });
      }
      totals.push({
        currency: c,
        stack: STACK_LABEL.TOTAL,
        loans: all.count,
        ...parRow(c, all),
      });
    }
    tables.push({
      code: 'PAR',
      title: 'Portfolio at risk',
      description:
        'Principal of loans 1, 30 and 90 or more days past due at month end, and its share of the portfolio.',
      columns: [
        { key: 'currency', label: 'Currency', kind: 'text' },
        { key: 'stack', label: 'Book', kind: 'text' },
        { key: 'loans', label: 'Loans', kind: 'count' },
        { key: 'principal', label: 'Principal', kind: 'amount' },
        { key: 'par1', label: 'PAR 1', kind: 'amount' },
        { key: 'par1Ratio', label: 'PAR 1 %', kind: 'ratio' },
        { key: 'par30', label: 'PAR 30', kind: 'amount' },
        { key: 'par30Ratio', label: 'PAR 30 %', kind: 'ratio' },
        { key: 'par90', label: 'PAR 90', kind: 'amount' },
        { key: 'par90Ratio', label: 'PAR 90 %', kind: 'ratio' },
      ],
      rows,
      totals,
    });
  }

  // 4–8. Breakdowns.
  const breakdown = (
    code: string,
    title: string,
    description: string,
    dims: { key: string; label: string; of: (p: LoanPosition) => string }[],
    order?: (c: string) => string[],
    notes?: string[],
  ) => {
    const rows: Row[] = [];
    const totals: Row[] = [];
    for (const c of currencies) {
      const sep = '\u0001';
      const g = group(
        byCur(c),
        (p) => dims.map((d) => d.of(p)).join(sep),
        newAcc,
      );
      const keys = order
        ? order(c)
        : [...g.keys()].sort((a, b) => a.localeCompare(b));
      const all = newAcc();
      byCur(c).forEach((p) => all.add(p));
      for (const k of keys) {
        const a = g.get(k) ?? newAcc();
        const parts = k.split(sep);
        const row: Row = { currency: c };
        dims.forEach((d, i) => (row[d.key] = parts[i]));
        rows.push({
          ...row,
          loans: a.count,
          principal: money(a.principal, c),
          par30: money(a.par30, c),
          share: ratio(a.principal, all.principal),
        });
      }
      const t: Row = { currency: c };
      dims.forEach((d, i) => (t[d.key] = i === 0 ? 'Total' : ''));
      totals.push({
        ...t,
        loans: all.count,
        principal: money(all.principal, c),
        par30: money(all.par30, c),
        share: all.count ? '1.0000' : '0.0000',
      });
    }
    tables.push({
      code,
      title,
      description,
      columns: [
        { key: 'currency', label: 'Currency', kind: 'text' },
        ...dims.map((d) => ({
          key: d.key,
          label: d.label,
          kind: 'text' as const,
        })),
        { key: 'loans', label: 'Loans', kind: 'count' },
        { key: 'principal', label: 'Principal', kind: 'amount' },
        { key: 'par30', label: 'PAR 30', kind: 'amount' },
        { key: 'share', label: 'Share of portfolio', kind: 'ratio' },
      ],
      rows,
      totals,
      notes,
    });
  };
  breakdown(
    'BY_PRODUCT',
    'Portfolio by product',
    'Outstanding principal by book, loan family and product.',
    [
      { key: 'stack', label: 'Book', of: (p) => STACK_LABEL[p.stack] },
      { key: 'family', label: 'Family', of: (p) => p.family },
      { key: 'product', label: 'Product', of: (p) => p.product },
    ],
  );
  breakdown(
    'BY_BRANCH',
    'Portfolio by branch',
    'Outstanding principal by branch.',
    [{ key: 'branch', label: 'Branch', of: (p) => p.branch }],
  );
  breakdown(
    'BY_PURPOSE',
    'Portfolio by purpose',
    'Outstanding principal by the purpose stated on the application.',
    [{ key: 'purpose', label: 'Purpose', of: (p) => p.purpose }],
    undefined,
    [
      'Purpose is the free text of the lending application; legacy loans have none and show "Not recorded". An NBC economic-sector code is not captured yet.',
    ],
  );
  breakdown(
    'BY_BORROWER_TYPE',
    'Portfolio by borrower type',
    'Outstanding principal of individual and group (joint-liability) loans.',
    [
      {
        key: 'borrowerType',
        label: 'Borrower type',
        of: (p) => (p.borrowerType === 'GROUP' ? 'Group' : 'Individual'),
      },
    ],
    undefined,
    [
      'Borrower gender is not recorded in the customer file, so the gender breakdown cannot be produced.',
    ],
  );
  breakdown(
    'SIZE_BANDS',
    'Portfolio by loan size',
    'Outstanding principal by the amount originally lent.',
    [
      {
        key: 'band',
        label: 'Loan size',
        of: (p) => {
          const b = sizeBands(p.currency, reg).find(
            (x) => x.upTo === null || D(p.bookedPrincipal).lte(x.upTo),
          )!;
          return b.label;
        },
      },
    ],
    (c) => sizeBands(c, reg).map((b) => b.label),
  );

  // 9. Restructured loans.
  {
    const rows: Row[] = [];
    const totals: Row[] = [];
    for (const c of currencies) {
      const rs = byCur(c).filter((p) => p.restructured);
      const all = newAcc();
      rs.forEach((p) => all.add(p));
      for (const stack of ['LENDING', 'LEGACY'] as Stack[]) {
        const g = group(
          rs.filter((p) => p.stack === stack),
          (p) => classOf(p).code,
          newAcc,
        );
        for (const k of classes) {
          const a = g.get(k.code);
          if (!a) continue;
          rows.push({
            currency: c,
            stack: STACK_LABEL[stack],
            class: k.label,
            loans: a.count,
            principal: money(a.principal, c),
            allowance: money(a.allowance, c),
          });
        }
      }
      totals.push(
        totalRow(c, all, {
          stack: STACK_LABEL.TOTAL,
          class: '',
          allowance: money(all.allowance, c),
        }),
      );
    }
    tables.push({
      code: 'RESTRUCTURED',
      title: 'Restructured loans',
      description:
        'Loans restructured on or before the month end and still outstanding, by class.',
      columns: [
        { key: 'currency', label: 'Currency', kind: 'text' },
        { key: 'stack', label: 'Book', kind: 'text' },
        { key: 'class', label: 'Class', kind: 'text' },
        { key: 'loans', label: 'Loans', kind: 'count' },
        { key: 'principal', label: 'Principal', kind: 'amount' },
        { key: 'allowance', label: 'Allowance held', kind: 'amount' },
      ],
      rows,
      totals,
    });
  }

  // 10. Movements in the month.
  {
    const rows: Row[] = [];
    const totals: Row[] = [];
    const KINDS: [Movement['kind'], string][] = [
      ['DISBURSED', 'Disbursed'],
      ['WRITTEN_OFF', 'Written off'],
      ['RECOVERED', 'Recovered after write-off'],
    ];
    for (const c of currencies) {
      for (const [kind, label] of KINDS) {
        let count = 0;
        let amount = D(0);
        for (const stack of ['LENDING', 'LEGACY'] as Stack[]) {
          const m = input.movements.filter(
            (x) => x.currency === c && x.kind === kind && x.stack === stack,
          );
          const n = m.reduce((s, x) => s + x.count, 0);
          const a = m.reduce((s, x) => s.plus(D(x.amount)), D(0));
          count += n;
          amount = amount.plus(a);
          rows.push({
            currency: c,
            movement: label,
            stack: STACK_LABEL[stack],
            count: n,
            amount: money(a, c),
          });
        }
        totals.push({
          currency: c,
          movement: label,
          stack: STACK_LABEL.TOTAL,
          count,
          amount: money(amount, c),
        });
      }
    }
    tables.push({
      code: 'MOVEMENTS',
      title: 'Disbursed, written off and recovered in the month',
      description:
        'Money lent, principal and charges written off, and amounts recovered on written-off loans between the first and the last day of the month.',
      columns: [
        { key: 'currency', label: 'Currency', kind: 'text' },
        { key: 'movement', label: 'Movement', kind: 'text' },
        { key: 'stack', label: 'Book', kind: 'text' },
        { key: 'count', label: 'Count', kind: 'count' },
        { key: 'amount', label: 'Amount', kind: 'amount' },
      ],
      rows,
      totals,
    });
  }

  // 11. Large exposures: the 20 largest borrowers per currency.
  {
    const rows: Row[] = [];
    const totals: Row[] = [];
    for (const c of currencies) {
      const all = newAcc();
      byCur(c).forEach((p) => all.add(p));
      const byBorrower = new Map<
        string,
        { name: string; a: Acc; worst: number }
      >();
      for (const p of byCur(c)) {
        const e = byBorrower.get(p.borrowerId) ?? {
          name: p.borrowerName,
          a: newAcc(),
          worst: 0,
        };
        e.a.add(p);
        e.worst = Math.max(e.worst, gradeOf(p).index);
        byBorrower.set(p.borrowerId, e);
      }
      const top = [...byBorrower.entries()]
        .sort(
          ([ia, a], [ib, b]) =>
            b.a.principal.comparedTo(a.a.principal) || ia.localeCompare(ib),
        )
        .slice(0, 20);
      let sum = D(0);
      let loans = 0;
      top.forEach(([id, e], i) => {
        sum = sum.plus(e.a.principal);
        loans += e.a.count;
        rows.push({
          currency: c,
          rank: i + 1,
          borrower: e.name,
          borrowerId: id,
          loans: e.a.count,
          principal: money(e.a.principal, c),
          share: ratio(e.a.principal, all.principal),
          class: classes[e.worst].label,
          relatedParty: 'Not recorded',
        });
      });
      totals.push({
        currency: c,
        rank: '',
        borrower: `Top ${top.length}`,
        borrowerId: '',
        loans,
        principal: money(sum, c),
        share: ratio(sum, all.principal),
        class: '',
        relatedParty: '',
      });
    }
    tables.push({
      code: 'LARGE_EXPOSURES',
      title: 'Largest borrowers',
      description:
        'The 20 largest borrowers by outstanding principal, per currency, with their share of the portfolio and their worst class.',
      columns: [
        { key: 'currency', label: 'Currency', kind: 'text' },
        { key: 'rank', label: 'Rank', kind: 'count' },
        { key: 'borrower', label: 'Borrower', kind: 'text' },
        { key: 'borrowerId', label: 'Customer id', kind: 'text' },
        { key: 'loans', label: 'Loans', kind: 'count' },
        { key: 'principal', label: 'Principal', kind: 'amount' },
        { key: 'share', label: 'Share of portfolio', kind: 'ratio' },
        { key: 'class', label: 'Worst class', kind: 'text' },
        { key: 'relatedParty', label: 'Related party', kind: 'text' },
      ],
      rows,
      totals,
      notes: [
        'Large-exposure limits are set against net worth, which is not held in this system; the share shown is of the loan portfolio. Related parties are not recorded.',
      ],
    });
  }

  // 12. Interest rates against the cap.
  {
    const rows: Row[] = [];
    const totals: Row[] = [];
    const bands = rateBands(input.rateCapPct, reg.rateBandEdgesPct);
    for (const c of currencies) {
      const all = newAcc();
      byCur(c).forEach((p) => all.add(p));
      const bandOf = (p: LoanPosition) => {
        if (p.annualRatePct === null) return 'Not recorded';
        const r = D(p.annualRatePct);
        return bands.find((b) => b.upTo === null || r.lte(b.upTo))!.label;
      };
      const g = group(byCur(c), bandOf, newAcc);
      for (const label of [...bands.map((b) => b.label), 'Not recorded']) {
        const a = g.get(label);
        if (!a && label === 'Not recorded') continue;
        rows.push({
          currency: c,
          band: label,
          aboveCap: bands.find((b) => b.label === label)?.aboveCap
            ? 'Yes'
            : 'No',
          loans: a?.count ?? 0,
          principal: money(a?.principal ?? D(0), c),
          share: ratio(a?.principal ?? D(0), all.principal),
        });
      }
      totals.push({
        currency: c,
        band: 'Total',
        aboveCap: '',
        loans: all.count,
        principal: money(all.principal, c),
        share: all.count ? '1.0000' : '0.0000',
      });
    }
    tables.push({
      code: 'INTEREST_RATES',
      title: 'Interest rates against the cap',
      description: `Annual nominal interest rate of each loan at month end, in bands up to the ${input.rateCapPct}% cap.`,
      columns: [
        { key: 'currency', label: 'Currency', kind: 'text' },
        { key: 'band', label: 'Annual rate', kind: 'text' },
        { key: 'aboveCap', label: 'Above cap', kind: 'text' },
        { key: 'loans', label: 'Loans', kind: 'count' },
        { key: 'principal', label: 'Principal', kind: 'amount' },
        { key: 'share', label: 'Share of portfolio', kind: 'ratio' },
      ],
      rows,
      totals,
    });
  }

  // 13. Regulatory provision against the allowance, and the reserve (D-115).
  if (input.impairmentMode) {
    const mode = input.impairmentMode;
    const rows: Row[] = [];
    for (const c of currencies) {
      const a = newAcc();
      byCur(c)
        .filter((p) => p.stack === 'LENDING')
        .forEach((p) => a.add(p));
      const shortfall = lending.D.max(0, a.required.minus(a.allowance));
      const required = mode === 'ECL' ? shortfall : D(0);
      const held = D(
        input.reserve?.held.find((h) => h.currency === c)?.balance ?? 0,
      );
      rows.push({
        currency: c,
        basis:
          mode === 'ECL'
            ? 'CIFRS 9 expected credit loss'
            : mode === 'REGULATORY'
              ? 'NBC provision (not CIFRS 9)'
              : 'No impairment policy',
        regulatoryProvision: money(a.required, c),
        allowance: money(a.allowance, c),
        shortfall: money(shortfall, c),
        reserveRequired: money(required, c),
        reserveHeld: money(held, c),
        difference: money(held.minus(required), c),
      });
    }
    const account = input.reserve?.account ?? '3200';
    tables.push({
      code: 'REGULATORY_RESERVE',
      title: 'Regulatory provision and reserve',
      description:
        'Lending platform: the NBC provision required against the loss allowance held. Under CIFRS 9 (ECL) the provision above the allowance is held as a regulatory reserve in equity, appropriated from retained earnings.',
      columns: [
        { key: 'currency', label: 'Currency', kind: 'text' },
        { key: 'basis', label: 'Allowance basis', kind: 'text' },
        {
          key: 'regulatoryProvision',
          label: 'NBC provision required',
          kind: 'amount',
        },
        { key: 'allowance', label: 'Allowance held', kind: 'amount' },
        {
          key: 'shortfall',
          label: 'NBC provision above allowance',
          kind: 'amount',
        },
        { key: 'reserveRequired', label: 'Reserve required', kind: 'amount' },
        {
          key: 'reserveHeld',
          label: `Reserve on the ledger (${account})`,
          kind: 'amount',
        },
        { key: 'difference', label: 'Difference', kind: 'amount' },
      ],
      rows,
      totals: [],
      notes: [
        mode === 'ECL'
          ? `The allowance is the CIFRS 9 expected credit loss. Where the NBC provision is higher, the difference is appropriated from retained earnings to the regulatory reserve (${account}) at each month-end close and released when it falls; it is not an expense.`
          : mode === 'REGULATORY'
            ? 'The allowance is the NBC provision (REGULATORY impairment mode). These books are NOT CIFRS 9 compliant: CIFRS 9 requires an expected-credit-loss allowance, with any NBC provision above it held as a regulatory reserve.'
            : 'No impairment policy is approved, so no loss allowance is held on the lending platform (DECISIONS D-010). The books are neither CIFRS 9 compliant nor provisioned to the NBC classes.',
        'The reserve is measured when the month is closed, on the loans as they stood then; a difference here means the books moved after the close was prepared.',
      ],
    });
  }

  // Reconciliation of the loans to the ledger.
  const reconciliation: ReconciliationRow[] = [];
  for (const c of currencies) {
    for (const measure of ['PRINCIPAL', 'ALLOWANCE'] as const) {
      let loansT = D(0);
      let ledgerT = D(0);
      let migratedT = D(0);
      const codes = new Set<string>();
      for (const stack of ['LENDING', 'LEGACY'] as Stack[]) {
        const loans = byCur(c)
          .filter((p) => p.stack === stack)
          .reduce(
            (s, p) =>
              s.plus(D(measure === 'PRINCIPAL' ? p.principal : p.allowance)),
            D(0),
          );
        const fact = input.ledger.find(
          (l) => l.currency === c && l.stack === stack,
        );
        const migrated = D(
          measure === 'PRINCIPAL'
            ? fact?.principalMigrated
            : fact?.allowanceMigrated,
        );
        const ledger = D(
          measure === 'PRINCIPAL' ? fact?.principal : fact?.allowance,
        ).minus(migrated);
        const frozen =
          measure === 'PRINCIPAL'
            ? fact?.principalFrozen
            : fact?.allowanceFrozen;
        fact?.accounts.forEach((a) => codes.add(a));
        loansT = loansT.plus(loans);
        migratedT = migratedT.plus(migrated);
        ledgerT = ledgerT.plus(ledger);
        const frozenBreak =
          frozen !== null && frozen !== undefined && !D(frozen).eq(ledger);
        reconciliation.push({
          currency: c,
          stack,
          measure,
          loans: money(loans, c),
          ledger: money(ledger.plus(migrated), c),
          migrated: money(migrated, c),
          frozen:
            frozen === null || frozen === undefined
              ? null
              : money(D(frozen), c),
          difference: money(loans.minus(ledger), c),
          status: loans.eq(ledger) && !frozenBreak ? 'MATCHED' : 'BREAK',
          accounts: (fact?.accounts ?? []).join(', '),
        });
      }
      reconciliation.push({
        currency: c,
        stack: 'TOTAL',
        measure,
        loans: money(loansT, c),
        ledger: money(ledgerT.plus(migratedT), c),
        frozen: null,
        migrated: money(migratedT, c),
        difference: money(loansT.minus(ledgerT), c),
        status: loansT.eq(ledgerT) ? 'MATCHED' : 'BREAK',
        accounts: [...codes].join(', '),
      });
    }
  }

  // Self-checks: every breakdown adds up to the same portfolio.
  const checks: ReturnCheck[] = [];
  const portfolio = tables.find((t) => t.code === 'PORTFOLIO')!;
  for (const t of tables) {
    if (
      [
        'PORTFOLIO',
        'MOVEMENTS',
        'RESTRUCTURED',
        'LARGE_EXPOSURES',
        'REGULATORY_RESERVE',
      ].includes(t.code)
    )
      continue;
    for (const c of currencies) {
      const expected =
        portfolio.totals.find((r) => r.currency === c)?.principal ?? '0';
      const rowsSum = t.rows
        .filter((r) => r.currency === c && (t.code !== 'PAR' || true))
        .reduce((s, r) => s.plus(D(String(r.principal ?? 0))), D(0));
      const total = t.totals.find((r) => r.currency === c)?.principal ?? '0';
      const ok =
        D(String(total)).eq(D(String(expected))) &&
        rowsSum.eq(D(String(expected)));
      checks.push({
        code: `${t.code}_${c}`,
        label: `${t.title} adds up to the portfolio (${c})`,
        passed: ok,
        detail: ok
          ? `${money(D(String(expected)), c)} ${c}`
          : `rows ${money(rowsSum, c)}, total ${String(total)}, portfolio ${String(expected)}`,
      });
    }
  }
  for (const r of reconciliation.filter((x) => x.stack === 'TOTAL'))
    checks.push({
      code: `LEDGER_${r.measure}_${r.currency}`,
      label: `${r.measure === 'PRINCIPAL' ? 'Principal' : 'Allowance'} ties to the ledger (${r.currency})`,
      passed: r.status === 'MATCHED',
      detail:
        r.status === 'MATCHED'
          ? `${r.loans} ${r.currency} on ${r.accounts || 'no accounts'}`
          : `Loans ${r.loans}, ledger ${r.ledger}: difference ${r.difference}`,
    });

  // D-116: lending loans outstanding with no impairment policy hold no allowance.
  if (input.impairmentMode) {
    const lendingLoans = positions.filter((p) => p.stack === 'LENDING').length;
    const ok = input.impairmentMode !== 'NONE' || lendingLoans === 0;
    checks.push({
      code: 'IMPAIRMENT_POLICY',
      label: 'An impairment policy is approved',
      passed: ok,
      detail: !ok
        ? `${lendingLoans} lending loan(s) outstanding with no approved impairment policy: no loss allowance is held.`
        : input.impairmentMode === 'NONE'
          ? 'No lending loans outstanding.'
          : input.impairmentMode === 'ECL'
            ? 'Expected credit loss (CIFRS 9), with a regulatory reserve.'
            : 'Regulatory (NBC classes): not CIFRS 9 compliant.',
    });
  }

  // D-117: loans graded Loss that have reached the write-off floor.
  const aged = new Map<string, number>();
  const bands = bandsOf(reg);
  for (const p of positions) {
    if (p.stack !== 'LENDING' || gradeOf(p).cls.code !== 'LOSS') continue;
    const floor = lending.writeOffFloorDpd(
      bands,
      p.originalTermDays ?? null,
      reg.writeOffMinDpd,
    );
    if (p.daysPastDue >= floor)
      aged.set(p.currency, (aged.get(p.currency) ?? 0) + 1);
  }
  const warnings = [...input.warnings];
  for (const [c, n] of [...aged.entries()].sort())
    warnings.push(
      `${n} ${c} loan(s) graded Loss have reached the write-off floor and are not written off: review them for write-off.`,
    );

  return {
    schema: RETURN_SCHEMA,
    tenant: input.tenantName,
    period: {
      year: input.year,
      month: input.month,
      start: input.start,
      end: input.end,
      label: `${MONTHS[input.month - 1]} ${input.year}`,
    },
    basis: input.basis,
    attributesAsOf: input.attributesAsOf,
    currencies,
    rateCapPct: input.rateCapPct,
    tables,
    reconciliation,
    checks,
    warnings,
    ...(input.impairmentMode ? { impairmentMode: input.impairmentMode } : {}),
  };
}

// ── CSV ─────────────────────────────────────────────────────────────────────

function cell(v: string | number | null | undefined): string {
  let s = v === null || v === undefined ? '' : String(v);
  // Spreadsheet formula injection: a leading = + - @ is neutralised, except for numbers.
  if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function tableCsv(t: ReturnTable): string {
  const lines = [t.columns.map((c) => cell(c.label)).join(',')];
  for (const r of t.rows)
    lines.push(t.columns.map((c) => cell(r[c.key])).join(','));
  for (const r of t.totals)
    lines.push(t.columns.map((c) => cell(r[c.key])).join(','));
  return lines.join('\r\n');
}

export function reconciliationTable(rows: ReconciliationRow[]): ReturnTable {
  return {
    code: 'RECONCILIATION',
    title: 'Reconciliation to the ledger',
    description:
      'Loans in the return against the ledger balance at month end (and the balance frozen at the close).',
    columns: [
      { key: 'currency', label: 'Currency', kind: 'text' },
      { key: 'stack', label: 'Book', kind: 'text' },
      { key: 'measure', label: 'Measure', kind: 'text' },
      { key: 'accounts', label: 'Ledger accounts', kind: 'text' },
      { key: 'loans', label: 'Loans in the return', kind: 'amount' },
      { key: 'ledger', label: 'Ledger balance', kind: 'amount' },
      { key: 'frozen', label: 'Frozen at close', kind: 'amount' },
      { key: 'migrated', label: 'Less: migrated to lending', kind: 'amount' },
      { key: 'difference', label: 'Difference', kind: 'amount' },
      { key: 'status', label: 'Status', kind: 'text' },
    ],
    rows: rows.map((r) => ({
      ...r,
      stack: STACK_LABEL[r.stack],
      measure: r.measure === 'PRINCIPAL' ? 'Principal' : 'Allowance',
      frozen: r.frozen ?? '',
    })),
    totals: [],
  };
}

/** The whole return as one CSV: a heading line per section, a blank line between sections. */
export function returnCsv(
  content: ReturnContent,
  meta: Record<string, string>,
  only?: string,
): string {
  const sections: string[] = [];
  if (!only)
    sections.push(
      [
        ['Return', `${content.tenant} — ${content.period.label}`],
        ['Period', `${content.period.start} to ${content.period.end}`],
        ['Basis', content.basis],
        ['Loan attributes as of', content.attributesAsOf],
        ...Object.entries(meta),
      ]
        .map(([k, v]) => `${cell(k)},${cell(v)}`)
        .join('\r\n'),
    );
  const all = [...content.tables, reconciliationTable(content.reconciliation)];
  for (const t of all) {
    if (only && t.code !== only) continue;
    sections.push(`${cell(t.title)}\r\n${tableCsv(t)}`);
  }
  return sections.join('\r\n\r\n') + '\r\n';
}
