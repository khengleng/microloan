import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { lending as L } from '../src/index.js';

const USD: L.RoundingRule = { increment: '0.01', mode: 'HALF_UP' };
const TPL = L.TEMPLATE_BY_CODE.INCOME_CONTINGENT_EDUCATION.defaultConfig;
const D = (v: string) => new L.D(v);
const total = (lines: L.ScheduleLine[], k: 'principal' | 'interest' | 'capitalizedInterest') => lines.reduce((s, l) => s.plus(l[k]), new L.D(0));

function contract(over: Partial<L.ProductConfig['incomeContingent'] & object> = {}, income = '0', rate = '0.03', n = 120) {
  const c = structuredClone(TPL) as L.ProductConfig;
  Object.assign(c.incomeContingent!, over);
  return L.toScheduleInput(c, { principal: '10000', numberOfInstalments: n, disbursementDate: '2026-01-05', declaredAnnualIncome: income, annualRate: rate }, '10000');
}

describe('income-contingent repayment (education)', () => {
  test('the instalment is the repayment rate on income above the threshold', () => {
    const p = L.incomeContingentPayment('20000', { repaymentRate: '0.09', incomeThreshold: '3000' }, 12, USD);
    assert.equal(p.incomeAboveThreshold, '17000');
    assert.equal(p.annualRepayment, '1530');
    assert.equal(p.periodicPayment, '127.5');
    const none = L.incomeContingentPayment('2500', { repaymentRate: '0.09', incomeThreshold: '3000' }, 12, USD);
    assert.equal(none.periodicPayment, '0');
    assert.match(none.explanation, /nothing is payable, and nothing falls into arrears/);
    assert.throws(() => L.incomeContingentPayment('-1', { repaymentRate: '0.09', incomeThreshold: '3000' }, 12, USD));
  });

  test('below the threshold nothing is due: only capitalisation lines, and the rest is forgiven at the end of the term', () => {
    const s = L.generateSchedule(contract());
    const due = s.lines.filter((l) => D(l.total).gt(0) && l.kind !== 'FINAL');
    assert.equal(due.length, 0, 'no instalment falls due');
    assert.equal(s.instalmentAmount, '0');
    const final = s.lines.at(-1)!;
    assert.equal(final.kind, 'FINAL');
    assert.equal(final.dueDate, '2036-01-05');
    assert.ok(L.isForgivenessLine(final, L.incomeContingentTermEnd(contract())));
    // Every principal the schedule asks for, less what it capitalises, is the amount financed.
    assert.equal(total(s.lines, 'principal').minus(total(s.lines, 'capitalizedInterest')).toString(), '10000');
  });

  test('a payment above the interest amortises and the loan ends early', () => {
    const s = L.generateSchedule(contract({}, '20000'));
    assert.equal(s.instalmentAmount, '127.5');
    assert.equal(s.lines[0].interest, '25');
    assert.equal(s.lines[0].principal, '102.5');
    assert.ok(!s.lines.some((l) => l.kind === 'FINAL' || l.kind === 'CAPITALIZATION'));
    assert.equal(total(s.lines, 'principal').toString(), '10000');
    assert.ok(L.compareDates(s.maturityDate, '2036-01-05') < 0);
  });

  test('a payment below the interest pays interest only and capitalises the shortfall on its own line', () => {
    // 9% of 300 above the threshold = 27 a year = 2.25 a month, against 25 of interest.
    const s = L.generateSchedule(contract({}, '3300'));
    const [cap, pay] = s.lines;
    assert.equal(cap.kind, 'CAPITALIZATION');
    assert.equal(cap.capitalizedInterest, '22.75');
    assert.equal(cap.total, '0');
    assert.equal(pay.kind, 'INTEREST_ONLY');
    assert.equal(pay.interest, '2.25');
    assert.equal(pay.total, '2.25', 'the borrower never owes more than the assessed payment');
    assert.equal(pay.dueDate, cap.dueDate);
  });

  test('capitalisation stops at the cap; beyond it uncovered interest is not charged', () => {
    const s = L.generateSchedule(contract({ capitalisationCap: '0.01' }));
    assert.equal(total(s.lines, 'capitalizedInterest').toString(), '100');
    assert.ok(s.explanation.some((e) => /not charged/.test(e)));
  });

  test('subsidised interest: nothing capitalised, the balance does not grow', () => {
    const s = L.generateSchedule(contract({ unpaidInterest: 'SUBSIDISE' }));
    assert.equal(total(s.lines, 'capitalizedInterest').toString(), '0');
    assert.equal(s.lines.length, 1);
    assert.equal(s.lines[0].principal, '10000');
  });

  test('a reassessment rebuilds the rest of the term from a period start, numbering on', () => {
    const input = contract({}, '0');
    assert.equal(L.incomeContingentEffectiveDate(input, '2027-01-05'), '2027-01-05');
    assert.equal(L.incomeContingentEffectiveDate(input, '2027-01-06'), '2027-02-05');
    assert.equal(L.incomeContingentEffectiveDate(input, '2036-01-06'), null);
    const next = { ...input, incomeContingent: { ...input.incomeContingent!, declaredAnnualIncome: '15000' } };
    const s = L.incomeContingentSchedule(next, { fromDate: '2027-02-05', openingBalance: '10300', capitalisedToDate: '300', firstNumber: 14 });
    assert.equal(s.lines[0].number, 14);
    assert.equal(s.lines[0].periodStart, '2027-02-05');
    assert.equal(s.instalmentAmount, '90');
    assert.equal(total(s.lines, 'principal').minus(total(s.lines, 'capitalizedInterest')).toString(), '10300');
    assert.throws(() => L.incomeContingentSchedule(next, { fromDate: '2027-02-06', openingBalance: '10300', capitalisedToDate: '0', firstNumber: 14 }), /does not start a period/);
  });

  test('configuration: anything else that rebuilds the schedule is refused', () => {
    const bad = (mutate: (c: any) => void) => {
      const c = structuredClone(TPL) as any;
      mutate(c);
      const r = L.validateProductConfig(c);
      return r.ok ? [] : r.issues.map((i) => i.path);
    };
    assert.deepEqual(bad(() => undefined), []);
    assert.ok(bad((c) => { c.operations.restructureAllowed = true; }).includes('operations.restructureAllowed'));
    assert.ok(bad((c) => { c.pricing.accrualBasis = 'DAILY'; }).includes('pricing.accrualBasis'));
    assert.ok(bad((c) => { c.repayment.prepayment.allowed = true; }).includes('repayment.prepayment'));
    assert.ok(L.requiredCapabilitiesFor(TPL).includes('education.income_contingent'));
    const terms = L.checkTerms(L.TEMPLATE_BY_CODE.PERSONAL_INSTALMENT.defaultConfig, { principal: '1000', numberOfInstalments: 12, disbursementDate: '2026-01-05', declaredAnnualIncome: '1000' });
    assert.ok(terms.issues.some((i) => i.path === 'declaredAnnualIncome'));
  });
});
