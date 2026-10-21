import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { lending as L } from '../src/index.js';

const AS_OF = '2026-10-15';
const BUREAU = L.SCORECARD_TEMPLATE_BY_CODE.INTERNAL_BUREAU.definition;
const RULES: L.BureauScoreRules = { minHistoryMonths: 6, derogatoryDpd: 90 };

/** Monthly instalments due on the 5th, from `first` for `n` months; `late` maps instalment index → days late (null = unpaid). */
function monthly(first: string, n: number, late: Record<number, number | null> = {}): L.ReportInstalment[] {
  return Array.from({ length: n }, (_, i) => {
    const dueDate = L.addMonths(first, i);
    const l = late[i];
    if (l === null) return { dueDate, clearedOn: null };
    const clearedOn = L.addDays(dueDate, l ?? 0);
    return { dueDate, clearedOn: L.compareDates(clearedOn, AS_OF) <= 0 ? clearedOn : null };
  });
}

function facility(over: Partial<L.CreditFacilityInput> = {}): L.CreditFacilityInput {
  return {
    id: over.id ?? 'f1',
    source: 'LENDING',
    reference: 'LN-1',
    product: 'Personal loan',
    kind: 'TERM_LOAN',
    revolving: false,
    currency: 'USD',
    openedOn: '2025-01-05',
    closedOn: null,
    status: 'ACTIVE',
    limit: null,
    principal: '1200.00',
    balance: '600.00',
    instalment: '110.00',
    writtenOffOn: null,
    restructuredOn: [],
    settled: false,
    currentDpd: null,
    instalments: monthly('2025-02-05', 12),
    ...over,
  };
}

const subject: L.CreditReportSubject = {
  borrowerId: 'b1',
  name: 'Sok Dara',
  dateOfBirth: '1990-01-01',
  idType: 'NATIONAL_ID',
  idNumberMasked: '••••5678',
  phoneMasked: '••••4567',
  occupation: 'Trader',
  branch: 'PP',
  customerSince: '2024-12-01',
};

const report = (facilities: L.CreditFacilityInput[], enquiries: L.EnquiryInput[] = []) =>
  L.buildCreditReport({ asOf: AS_OF, subject, facilities, guarantees: [], enquiries });

describe('payment-status codes', () => {
  test('0 is current; 1–6 are 30-day buckets past due, 6 covers everything beyond', () => {
    const cases: [number, string][] = [
      [0, '0'],
      [1, '1'],
      [29, '1'],
      [30, '2'],
      [59, '2'],
      [60, '3'],
      [90, '4'],
      [120, '5'],
      [149, '5'],
      [150, '6'],
      [900, '6'],
    ];
    for (const [dpd, code] of cases) assert.equal(L.paymentStatusCode(dpd), code, `${dpd} days`);
  });

  test('the grid has 24 months, oldest first, ending with the as-of month', () => {
    const m = L.reportMonths(AS_OF);
    assert.equal(m.length, 24);
    assert.equal(m[0], '2024-11');
    assert.equal(m[23], '2026-10');
  });
});

describe('grid derivation from instalments and payment dates', () => {
  test('month-end days past due: the oldest instalment due and still owed at the month end', () => {
    const inst = [
      { dueDate: '2026-03-05', clearedOn: '2026-04-20' },
      { dueDate: '2026-04-05', clearedOn: '2026-04-20' },
    ];
    assert.equal(L.daysPastDueOn(inst, '2026-03-31'), 26);
    assert.equal(L.daysPastDueOn(inst, '2026-04-19'), 45);
    assert.equal(L.daysPastDueOn(inst, '2026-04-30'), 0);
    // Due on the day itself is not yet past due.
    assert.equal(L.daysPastDueOn(inst, '2026-03-05'), 0);
  });

  test('a loan paid on time is 0 every month from its opening; blank before it', () => {
    const line = report([facility()]).facilities[0];
    const byMonth = Object.fromEntries(line.history.map((h) => [h.month, h.code]));
    assert.equal(byMonth['2024-11'], '');
    assert.equal(byMonth['2024-12'], '');
    assert.equal(byMonth['2025-01'], '0');
    assert.equal(byMonth['2026-10'], '0');
    assert.equal(line.worstDpd24m, 0);
  });

  test('late months show their bucket; paying up returns to 0', () => {
    // Instalment 3 (due 2025-05-05) paid 40 days late; instalment 8 (due 2025-10-05) paid 70 days late.
    const line = report([facility({ instalments: monthly('2025-02-05', 12, { 3: 40, 8: 70 }) })]).facilities[0];
    const code = (m: string) => line.history.find((h) => h.month === m)!.code;
    assert.equal(code('2025-04'), '0');
    assert.equal(code('2025-05'), '1'); // 26 days at 31 May
    assert.equal(code('2025-06'), '0'); // paid 14 June
    assert.equal(code('2025-10'), '1'); // 26 days
    assert.equal(code('2025-11'), '2'); // 56 days at 30 Nov
    assert.equal(line.history.find((h) => h.month === '2025-11')!.dpd, 56);
    assert.equal(code('2025-12'), '0');
    assert.equal(line.worstDpd, 70);
    assert.equal(line.worstDpd12m, 70); // cleared 14 Dec 2025, within the last 12 months
    assert.equal(line.worstDpd24m, 70);
  });

  test('W from the write-off month, R in a restructure month, C in the closing month, blank after', () => {
    const w = report([facility({ writtenOffOn: '2026-06-20', status: 'WRITTEN_OFF', instalments: monthly('2025-02-05', 20, { 12: null, 13: null, 14: null, 15: null, 16: null, 17: null, 18: null, 19: null }) })]).facilities[0];
    const wc = (m: string) => w.history.find((h) => h.month === m)!.code;
    assert.equal(wc('2026-05'), '4'); // due 2026-02-05 unpaid: 115 days at 31 May
    assert.equal(wc('2026-06'), 'W');
    assert.equal(wc('2026-10'), 'W');
    assert.ok(w.writtenOff);

    const r = report([facility({ restructuredOn: ['2025-08-12'] })]).facilities[0];
    assert.equal(r.history.find((h) => h.month === '2025-08')!.code, 'R');
    assert.equal(r.history.find((h) => h.month === '2025-09')!.code, '0');
    assert.ok(r.restructured);

    const c = report([facility({ status: 'CLOSED', closedOn: '2026-01-10', balance: '0.00' })]).facilities[0];
    assert.equal(c.history.find((h) => h.month === '2025-12')!.code, '0');
    assert.equal(c.history.find((h) => h.month === '2026-01')!.code, 'C');
    assert.equal(c.history.find((h) => h.month === '2026-02')!.code, '');
  });

  test("the current month uses the servicing system's days past due", () => {
    const line = report([facility({ currentDpd: 45 })]).facilities[0];
    const last = line.history[line.history.length - 1];
    assert.deepEqual([last.code, last.dpd], ['2', 45]);
    assert.equal(line.currentDpd, 45);
  });

  test('legacy clearing dates are rebuilt by applying payments to instalments oldest first', () => {
    const rows = L.legacyClearances(
      [
        { dueDate: '2025-01-05', amountDue: '100', isPaid: true },
        { dueDate: '2025-02-05', amountDue: '100', isPaid: true },
        { dueDate: '2025-03-05', amountDue: '100', isPaid: false },
      ],
      [
        { date: '2025-01-05', amount: '100' },
        { date: '2025-03-01', amount: '60' },
        { date: '2025-03-20', amount: '60' },
      ],
    );
    assert.deepEqual(rows, [
      { dueDate: '2025-01-05', clearedOn: '2025-01-05' },
      { dueDate: '2025-02-05', clearedOn: '2025-03-20' },
      { dueDate: '2025-03-05', clearedOn: null },
    ]);
  });
});

describe('report characteristics and totals', () => {
  test('a mixed file: term loan, card, legacy write-off, enquiries', () => {
    const card = facility({
      id: 'c1',
      reference: 'CARD-1',
      kind: 'CARD',
      revolving: true,
      limit: '1000.00',
      balance: '800.00',
      instalment: null,
      openedOn: '2026-01-10',
      instalments: [],
    });
    const legacy = facility({
      id: 'l1',
      source: 'LEGACY',
      reference: 'LEGACY-1',
      kind: 'LEGACY_LOAN',
      openedOn: '2022-03-01',
      status: 'WRITTEN_OFF',
      writtenOffOn: '2023-06-30',
      balance: '0.00',
      instalments: monthly('2022-04-01', 12, { 6: null, 7: null }),
    });
    const r = report(
      [facility(), card, legacy],
      [
        { id: 'a1', type: 'APPLICATION', date: '2026-08-01', purpose: 'Personal', reference: 'APP-1', by: null },
        { id: 'a2', type: 'APPLICATION', date: '2026-01-01', purpose: 'Personal', reference: 'APP-2', by: null },
        { id: 'a3', type: 'APPLICATION', date: '2026-10-14', purpose: 'Personal', reference: 'APP-3', by: null, current: true },
        { id: 'p1', type: 'REPORT', date: '2026-10-14', purpose: 'NEW_APPLICATION', reference: 'CR-1', by: 'u1' },
      ],
    );
    const c = r.characteristics;
    assert.equal(c.bureauWriteOff, true);
    assert.equal(c.bureauRevolvingUtilisation, '0.8');
    assert.equal(c.bureauEnquiries6m, 1);
    assert.equal(c.bureauEnquiries12m, 2);
    assert.equal(c.bureauActiveFacilities, 2);
    assert.equal(c.bureauOldestFacilityMonths, 55);
    // The legacy write-off is older than 24 months: it does not set the 24-month delinquency.
    assert.equal(c.bureauWorstDpd24m, 0);
    assert.equal(c.bureauMonthsSinceDelinquency, 39);
    assert.deepEqual(r.totals.exposure, [{ currency: 'USD', amount: '1400.00' }]);
    assert.deepEqual(r.totals.monthlyObligation, [{ currency: 'USD', amount: '110.00' }]);
    assert.equal(r.totals.lenders, 1);
    assert.equal(r.totals.writtenOffFacilities, 1);
    assert.equal(r.facilities.length, 3);
    assert.equal(r.enquiries.length, 4);
  });

  test('30+ months in the last 12 months are counted per facility month end', () => {
    const r = report([facility({ instalments: monthly('2025-02-05', 20, { 13: 40, 15: 70 }) })]);
    // due 2026-03-05 paid +40 → 26 at Mar end (no), cleared 14 Apr; due 2026-05-05 paid +70 → 26 at May end, 56 at Jun end (yes), cleared 14 Jul.
    assert.equal(r.characteristics.bureauTimes30Dpd12m, 1);
    assert.equal(r.characteristics.bureauWorstDpd12m, 70);
    assert.equal(r.characteristics.bureauMonthsSinceDelinquency, 3);
  });

  test('a never-disbursed facility is not reported', () => {
    const r = report([facility({ openedOn: null })]);
    assert.equal(r.facilities.length, 0);
    assert.equal(r.totals.lenders, 0);
  });
});

describe('bureau score', () => {
  test('the INTERNAL_BUREAU template is valid and scores on 300–850', () => {
    const v = L.validateScorecardDefinition(BUREAU);
    assert.ok(v.ok);
    assert.equal(BUREAU.minScore, 300);
    assert.equal(BUREAU.maxScore, 850);
    for (const c of BUREAU.characteristics) assert.equal(L.SCORING_VARIABLE_BY_CODE[c.variable].source, 'BUREAU', c.variable);
  });

  test('no history → no score (null) with reason NO_HISTORY, not a low score', () => {
    const empty = L.scoreCreditReport(BUREAU, report([]), RULES);
    assert.equal(empty.score, null);
    assert.equal(empty.noScoreReason, 'NO_HISTORY');
    const young = L.scoreCreditReport(BUREAU, report([facility({ openedOn: '2026-08-01', instalments: monthly('2026-09-01', 12) })]), RULES);
    assert.equal(young.score, null);
    assert.equal(young.noScoreReason, 'NO_HISTORY');
    assert.match(young.message, /6 months/);
  });

  test('a write-off is always scored, however short the history', () => {
    const r = report([facility({ openedOn: '2026-07-01', status: 'WRITTEN_OFF', writtenOffOn: '2026-10-01', instalments: monthly('2026-08-01', 6, { 0: null, 1: null }) })]);
    const s = L.scoreCreditReport(BUREAU, r, RULES);
    assert.notEqual(s.score, null);
    assert.ok(s.score! < 500, `score ${s.score}`);
    assert.ok(s.adverseReasons.some((a) => a.code === 'WRITE_OFF'));
  });

  test('clean long history scores high; delinquency lowers it; adverse reasons name the cause', () => {
    const clean = L.scoreCreditReport(BUREAU, report([facility({ openedOn: '2021-01-05', instalments: monthly('2021-02-05', 60) })]), RULES);
    const late = L.scoreCreditReport(BUREAU, report([facility({ openedOn: '2021-01-05', instalments: monthly('2021-02-05', 60, { 55: 75 }) })]), RULES);
    assert.ok(clean.score! >= 720, `clean ${clean.score}`);
    assert.equal(clean.grade, 'A');
    assert.ok(late.score! < clean.score!, `late ${late.score} vs ${clean.score}`);
    assert.ok(late.adverseReasons.some((a) => a.code === 'RECENT_ARREARS'));
  });

  test('characteristic outcomes follow the bins', () => {
    const base: L.ScoringInputs = {
      bureauWorstDpd12m: 0,
      bureauWorstDpd24m: 0,
      bureauMonthsSinceDelinquency: null,
      bureauTimes30Dpd12m: 0,
      bureauWriteOff: false,
      bureauRestructured: false,
      bureauRevolvingUtilisation: null,
      bureauOldestFacilityMonths: 40,
      bureauEnquiries6m: 0,
      bureauEnquiries12m: 0,
      bureauActiveFacilities: 1,
    };
    const pts = (inputs: L.ScoringInputs, code: string) => L.evaluateScorecard(BUREAU, inputs).characteristics.find((c) => c.code === code)!.points;
    assert.equal(pts(base, 'WORST_DPD_12M'), 80);
    assert.equal(pts({ ...base, bureauWorstDpd12m: 95 }, 'WORST_DPD_12M'), -120);
    assert.equal(pts(base, 'SINCE_DELINQUENCY'), 40);
    assert.equal(pts({ ...base, bureauMonthsSinceDelinquency: 3 }, 'SINCE_DELINQUENCY'), -40);
    assert.equal(pts({ ...base, bureauRevolvingUtilisation: '0.95' }, 'UTILISATION'), -70);
    assert.ok(!L.evaluateScorecard(BUREAU, base).adverseReasons.some((a) => a.code === 'HIGH_UTILISATION'));
    assert.equal(pts({ ...base, bureauRestructured: true }, 'RESTRUCTURED'), -60);
    assert.equal(pts({ ...base, bureauEnquiries6m: 4 }, 'ENQUIRIES_6M'), -45);
    assert.equal(L.evaluateScorecard(BUREAU, base).score, 560 + 80 + 30 + 40 + 20 + 35 + 10 + 15);
  });

  test('STANDARD_RETAIL reads the bureau score as before; null keeps the old behaviour', () => {
    const STANDARD = L.SCORECARD_TEMPLATE_BY_CODE.STANDARD_RETAIL.definition;
    const inputs = { debtServiceRatio: '0.25', ageYears: 35, closedLoans: 1, worstCurrentDpd: 0, writtenOff: false, loanToValue: null, guarantees: 0 };
    const none = L.evaluateScorecard(STANDARD, { ...inputs, bureauScore: null });
    const withScore = L.evaluateScorecard(STANDARD, { ...inputs, bureauScore: 700 });
    assert.equal(none.characteristics.find((c) => c.code === 'BUREAU')!.points, 0);
    assert.equal(withScore.characteristics.find((c) => c.code === 'BUREAU')!.points, 50);
    assert.equal(withScore.score - none.score, 50);
  });

  test('the same input always builds the same report (reproducible from stored inputs)', () => {
    const input: L.CreditReportInput = { asOf: AS_OF, subject, facilities: [facility()], guarantees: [], enquiries: [] };
    assert.equal(L.canonicalJson(L.buildCreditReport(input)), L.canonicalJson(L.buildCreditReport(JSON.parse(JSON.stringify(input)))));
  });
});
