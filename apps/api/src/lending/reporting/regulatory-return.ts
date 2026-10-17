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
}

/** NBC loan classes (Prakas on credit risk grading), worst last. */
export const REGULATORY_CLASSES = lending.NBC_IMPAIRMENT_CLASSES;

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
 * The regulatory class: by days past due on the NBC bands, never better than
 * the class the tenant's own policy recorded (a restructured loan held at a
 * worse class by its probation floor stays there).
 */
export function regulatoryClass(dpd: number, recorded: string | null) {
  let idx = 0;
  REGULATORY_CLASSES.forEach((c, i) => {
    if (dpd >= c.minDpd) idx = i;
  });
  const rec = recorded
    ? REGULATORY_CLASSES.findIndex((c) => c.code === recorded)
    : -1;
  if (rec > idx) idx = rec;
  return REGULATORY_CLASSES[idx];
}

/** Loan size bands on the booked amount; KHR bands are the USD bands × 4,000. */
export function sizeBands(
  currency: string,
): { label: string; upTo: Dec | null }[] {
  const f = currency === 'KHR' ? 4000 : 1;
  const edges = [500, 1_000, 5_000, 10_000, 50_000].map((e) => e * f);
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
): { label: string; upTo: Dec | null; aboveCap: boolean }[] {
  const cap = D(capPct);
  const edges = [D(12), D(15)].filter((e) => e.lt(cap));
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
    this.required = this.required.plus(
      pr.times(regulatoryClass(p.daysPastDue, p.recordedClass).rate),
    );
    if (p.daysPastDue >= 1) this.par1 = this.par1.plus(pr);
    if (p.daysPastDue >= 30) this.par30 = this.par30.plus(pr);
    if (p.daysPastDue >= 90) this.par90 = this.par90.plus(pr);
  }
}

function group<K extends string>(
  positions: LoanPosition[],
  key: (p: LoanPosition) => K,
): Map<K, Acc> {
  const m = new Map<K, Acc>();
  for (const p of positions) {
    const k = key(p);
    const a = m.get(k) ?? new Acc();
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
      const all = new Acc();
      for (const stack of ['LENDING', 'LEGACY'] as Stack[]) {
        const a = new Acc();
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
        (p) => regulatoryClass(p.daysPastDue, p.recordedClass).code,
      );
      const all = new Acc();
      for (const k of REGULATORY_CLASSES) {
        const a = g.get(k.code) ?? new Acc();
        byCur(c)
          .filter(
            (p) =>
              regulatoryClass(p.daysPastDue, p.recordedClass).code === k.code,
          )
          .forEach((p) => all.add(p));
        rows.push({
          currency: c,
          class: k.label,
          days: `${k.minDpd}+`,
          rate: D(k.rate).times(100).toString(),
          loans: a.count,
          principal: money(a.principal, c),
          provisionRequired: money(a.required, c),
          allowance: money(a.allowance, c),
        });
      }
      totals.push(
        totalRow(c, all, {
          class: 'Total',
          provisionRequired: money(all.required, c),
          allowance: money(all.allowance, c),
        }),
      );
    }
    tables.push({
      code: 'CLASSIFICATION',
      title: 'Loan classification and provisioning',
      description:
        'NBC classes by days past due at month end (never better than the class recorded by the impairment policy); required provision = principal × class rate.',
      columns: [
        { key: 'currency', label: 'Currency', kind: 'text' },
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
      const all = new Acc();
      for (const stack of ['LENDING', 'LEGACY'] as Stack[]) {
        const a = new Acc();
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
      const g = group(byCur(c), (p) => dims.map((d) => d.of(p)).join(sep));
      const keys = order
        ? order(c)
        : [...g.keys()].sort((a, b) => a.localeCompare(b));
      const all = new Acc();
      byCur(c).forEach((p) => all.add(p));
      for (const k of keys) {
        const a = g.get(k) ?? new Acc();
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
          const b = sizeBands(p.currency).find(
            (x) => x.upTo === null || D(p.bookedPrincipal).lte(x.upTo),
          )!;
          return b.label;
        },
      },
    ],
    (c) => sizeBands(c).map((b) => b.label),
  );

  // 9. Restructured loans.
  {
    const rows: Row[] = [];
    const totals: Row[] = [];
    for (const c of currencies) {
      const rs = byCur(c).filter((p) => p.restructured);
      const all = new Acc();
      rs.forEach((p) => all.add(p));
      for (const stack of ['LENDING', 'LEGACY'] as Stack[]) {
        const g = group(
          rs.filter((p) => p.stack === stack),
          (p) => regulatoryClass(p.daysPastDue, p.recordedClass).code,
        );
        for (const k of REGULATORY_CLASSES) {
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
      const all = new Acc();
      byCur(c).forEach((p) => all.add(p));
      const byBorrower = new Map<
        string,
        { name: string; a: Acc; worst: number }
      >();
      for (const p of byCur(c)) {
        const e = byBorrower.get(p.borrowerId) ?? {
          name: p.borrowerName,
          a: new Acc(),
          worst: 0,
        };
        e.a.add(p);
        e.worst = Math.max(
          e.worst,
          REGULATORY_CLASSES.findIndex(
            (k) =>
              k.code === regulatoryClass(p.daysPastDue, p.recordedClass).code,
          ),
        );
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
          class: REGULATORY_CLASSES[e.worst].label,
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
    const bands = rateBands(input.rateCapPct);
    for (const c of currencies) {
      const all = new Acc();
      byCur(c).forEach((p) => all.add(p));
      const bandOf = (p: LoanPosition) => {
        if (p.annualRatePct === null) return 'Not recorded';
        const r = D(p.annualRatePct);
        return bands.find((b) => b.upTo === null || r.lte(b.upTo))!.label;
      };
      const g = group(byCur(c), bandOf);
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
      ['PORTFOLIO', 'MOVEMENTS', 'RESTRUCTURED', 'LARGE_EXPOSURES'].includes(
        t.code,
      )
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
    warnings: input.warnings,
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
