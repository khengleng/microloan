import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { lending as L } from '../src/index.js';

const MERCHANT = { bakongAccountId: 'demo_lender@devb', merchantName: 'Demo Lending Co', merchantCity: 'Phnom Penh', merchantCategoryCode: '6012' };

describe('static KHQR payloads (D-160)', () => {
  test('CRC-16/CCITT-FALSE check value', () => {
    assert.equal(L.crc16('123456789'), '29B1');
  });

  test('a static code has point of initiation 11, the currency, no amount and a valid CRC', () => {
    for (const currency of ['USD', 'KHR'] as const) {
      const payload = L.buildStaticKhqrPayload(MERCHANT, currency);
      assert.ok(payload.startsWith('000201010211'), payload);
      const tags = L.parseTlvBlock(payload.slice(0, -8));
      assert.equal(tags['01'], '11');
      assert.equal(tags['54'], undefined, 'no amount');
      assert.equal(tags['62'], undefined, 'no bill number: one code serves every loan');
      assert.equal(tags['53'], currency === 'USD' ? '840' : '116');
      assert.equal(tags['58'], 'KH');
      assert.equal(tags['59'], 'Demo Lending Co');
      assert.equal(payload.slice(-8, -4), '6304');
      assert.equal(payload.slice(-4), L.crc16(payload.slice(0, -4)));
      const parsed = L.parseKhqrPayload(payload);
      assert.equal(parsed.bakongAccountId, 'demo_lender@devb');
      assert.equal(parsed.pointOfInitiation, '11');
      assert.equal(parsed.currency, currency);
      assert.equal(parsed.amount, undefined);
      assert.deepEqual(L.staticKhqrProblems(parsed, currency), []);
    }
  });

  test('the same merchant always gives the same static code', () => {
    assert.equal(L.buildStaticKhqrPayload(MERCHANT, 'USD'), L.buildStaticKhqrPayload({ ...MERCHANT }, 'USD'));
  });

  test('a dynamic code is refused as a repayment code; so is one for the other currency', () => {
    const dynamic = L.parseKhqrPayload(L.buildKhqrPayload(MERCHANT, { amount: 12.5, currency: 'USD', billNumber: 'PAY-1' }));
    assert.equal(dynamic.pointOfInitiation, '12');
    const problems = L.staticKhqrProblems(dynamic, 'USD');
    assert.equal(problems.length, 2);
    assert.match(problems[0], /dynamic/);
    assert.match(problems[1], /fixed amount/);
    const khr = L.parseKhqrPayload(L.buildStaticKhqrPayload(MERCHANT, 'KHR'));
    assert.match(L.staticKhqrProblems(khr, 'USD')[0], /for KHR, not USD/);
  });

  test('merchant details are validated: account id shape, lengths, ASCII', () => {
    assert.deepEqual(L.khqrMerchantProblems(MERCHANT), []);
    assert.equal(L.khqrMerchantProblems({ ...MERCHANT, bakongAccountId: 'no-at-sign' }).length, 1);
    assert.equal(L.khqrMerchantProblems({ ...MERCHANT, merchantName: 'x'.repeat(26) }).length, 1);
    assert.equal(L.khqrMerchantProblems({ ...MERCHANT, merchantCity: 'ភ្នំពេញ' }).length, 1);
    assert.throws(() => L.buildStaticKhqrPayload({ ...MERCHANT, bakongAccountId: '' }, 'USD'), /name@bank/);
  });

  test('a corrupted payload fails its checksum', () => {
    const payload = L.buildStaticKhqrPayload(MERCHANT, 'USD');
    assert.throws(() => L.parseKhqrPayload(payload.replace('Demo', 'Dimo')), /checksum/);
  });
});

describe('bank references and remarks', () => {
  test('bank references compare on letters and digits, upper case', () => {
    assert.equal(L.bankRefKey(' ft-2602 1512/ab '), 'FT26021512AB');
    assert.equal(L.bankRefProblem('12-34'), L.bankRefProblem('1234'));
    assert.match(L.bankRefProblem('1234') ?? '', /at least 6/);
    assert.equal(L.bankRefProblem('8a3f9c21'), null);
  });

  test('posting date: the day paid, within the business date and the back-dating the product allows', () => {
    assert.equal(L.khqrPostingDate('2026-01-19', '2026-01-20', 0), '2026-01-20');
    assert.equal(L.khqrPostingDate('2026-01-19', '2026-01-20', 5), '2026-01-19');
    assert.equal(L.khqrPostingDate('2026-01-21', '2026-01-20', 5), '2026-01-20');
    assert.equal(L.khqrPostingDate('2026-01-01', '2026-01-20', 5), '2026-01-15');
  });

  test('loan references are found however the payer typed them', () => {
    for (const remark of ['LN-260105-AB12CD', 'pay ln 260105 ab12cd thanks', 'loan:LN-260105-AB12CD.', 'LN260105AB12CD'])
      assert.ok(
        L.loanRefCandidates(remark).includes('LN-260105-AB12CD') || L.loanRefCandidates(remark).includes('LN260105AB12CD'),
        remark,
      );
    assert.ok(L.loanRefCandidates('ln 260105 ab12cd').includes('LN-260105-AB12CD'));
    assert.deepEqual(L.loanRefCandidates(''), []);
  });

  test('phone numbers are offered in local and international spellings', () => {
    const v = L.phoneVariants('+855 12 345 678');
    assert.ok(v.includes('012345678') && v.includes('+85512345678') && v.includes('85512345678'));
    assert.ok(L.phoneVariants('012-345-678').includes('+85512345678'));
    assert.deepEqual(L.phoneVariants('sokdara@aclb'), []);
  });

  test('names match in either order, ignoring case and punctuation; one word is not enough', () => {
    assert.ok(L.sameName('SOK DARA', 'Dara Sok'));
    assert.ok(L.sameName('sok, dara', 'Sok Dara'));
    assert.ok(!L.sameName('Sok', 'Sok'));
    assert.ok(!L.sameName('Sok Dara', 'Sok Dary'));
  });
});

describe('statement files (D-163)', () => {
  const GENERIC = L.STATEMENT_PRESETS.find((m) => m.code === 'GENERIC')!;
  const opts = { maxLines: 100 };

  test('the generic layout: header names, dates, amounts, currencies, credits only', () => {
    const csv = [
      'Statement for account 000123',
      '',
      'Transaction Date,Reference No,Description,Sender Name,From Account,Debit,Credit,Currency',
      '05/02/2026 09:14,FT26036AAA1,LN-260105-AB12CD,SOK DARA,012345678,,"1,250.00",USD',
      '05/02/2026 10:00,FT26036AAA2,fee,,,"2.00",,USD',
      '06-Feb-2026,FT26037BBB3,ln 260105 zz99yy,CHAN SOKHA,,,40000,KHR',
    ].join('\n');
    const r = L.parseStatementCsv(csv, GENERIC, opts);
    assert.deepEqual(r.errors, []);
    assert.equal(r.headerLine, 3);
    assert.equal(r.lines.length, 2);
    assert.deepEqual(r.skipped, [{ lineNo: 5, reason: 'no amount received' }]);
    assert.deepEqual(
      { ...r.lines[0], remark: r.lines[0].remark },
      {
        lineNo: 4,
        valueDate: '2026-02-05',
        amount: '1250',
        currency: 'USD',
        bankRef: 'FT26036AAA1',
        bankRefKey: 'FT26036AAA1',
        payerName: 'SOK DARA',
        payerAccount: '012345678',
        remark: 'LN-260105-AB12CD',
        duplicateOf: null,
      },
    );
    assert.equal(r.lines[1].valueDate, '2026-02-06');
    assert.deepEqual(r.totals, { USD: '1250', KHR: '40000' });
  });

  test('a signed amount column: negatives are money out; a direction column skips debits', () => {
    const csv = ['date,amount,currency,reference,remark,type', '2026-02-05,25.00,USD,REF000001,x,CR', '2026-02-05,-5,USD,REF000002,x,CR', '2026-02-05,7,USD,REF000003,x,DR'].join('\n');
    const r = L.parseStatementCsv(csv, GENERIC, opts);
    assert.equal(r.lines.length, 1);
    assert.deepEqual(
      r.skipped.map((s) => s.lineNo),
      [3, 4],
    );
  });

  test('the file currency applies when there is no currency column', () => {
    const csv = ['date,amount,reference', '2026-02-05,25.5,REF000001'].join('\n');
    assert.match(L.parseStatementCsv(csv, GENERIC, opts).errors[0].message, /no currency/);
    assert.equal(L.parseStatementCsv(csv, GENERIC, { ...opts, currency: 'USD' }).lines[0].currency, 'USD');
  });

  test('errors: bad dates, too many decimals, short references, a reference reused for a different payment', () => {
    const csv = [
      'date,amount,currency,reference',
      '31/02/2026,10,USD,REF000001',
      '2026-02-05,10.505,KHR,REF000002',
      '2026-02-05,10,USD,R1',
      '2026-02-05,10,USD,REF000004',
      '2026-02-05,11,USD,ref-000004',
      '2026-02-05,10,USD,REF000004',
    ].join('\n');
    const r = L.parseStatementCsv(csv, GENERIC, opts);
    assert.deepEqual(
      r.errors.map((e) => e.lineNo),
      [2, 3, 4, 6],
    );
    assert.equal(r.lines.find((l) => l.lineNo === 7)?.duplicateOf, 5);
  });

  test('a file without a recognisable header is refused; semicolon files are read', () => {
    assert.throws(() => L.parseStatementCsv('a,b,c\n1,2,3', GENERIC, opts), /No header row/);
    const r = L.parseStatementCsv('Date;Amount;Currency;Reference\n2026-02-05;12;USD;REF000009', GENERIC, opts);
    assert.equal(r.lines.length, 1);
  });

  test('statement dates in each supported format', () => {
    const all = L.STATEMENT_DATE_FORMATS;
    assert.equal(L.parseStatementDate('2026-02-05T10:11:12', all), '2026-02-05');
    assert.equal(L.parseStatementDate('05-02-2026', ['DD-MM-YYYY']), '2026-02-05');
    assert.equal(L.parseStatementDate('02/05/2026', ['MM/DD/YYYY']), '2026-02-05');
    assert.equal(L.parseStatementDate('5 Feb 2026', ['DD MMM YYYY']), '2026-02-05');
    assert.equal(L.parseStatementDate('2026/02/05', ['YYYY/MM/DD']), '2026-02-05');
    assert.equal(L.parseStatementDate('29/02/2026', ['DD/MM/YYYY']), null);
    // A spreadsheet date serial: 46058 is 5 Feb 2026.
    assert.equal(L.parseStatementDate('46058', ['DD/MM/YYYY']), '2026-02-05');
  });

  test('a lender mapping in the settings is validated and offered after the presets', () => {
    const settings = L.tenantLendingSettingsSchema.parse({
      payments: {
        khqr: {
          statementMappings: [
            { code: 'MY_BANK', label: 'My bank', columns: { date: ['Posted'], credit: ['In'], reference: ['Ref'] }, dateFormats: ['DD/MM/YYYY'] },
          ],
        },
      },
    });
    assert.deepEqual(L.validateTenantLendingSettings(settings), []);
    const mine = L.statementMappingsOf(settings).at(-1)!;
    assert.equal(mine.code, 'MY_BANK');
    const r = L.parseStatementCsv('Posted,In,Ref\n05/02/2026,9,ABC12345', mine, { ...opts, currency: 'USD' });
    assert.equal(r.lines[0].amount, '9');
    const clash = L.tenantLendingSettingsSchema.parse({
      payments: { khqr: { statementMappings: [{ code: 'GENERIC', label: 'x x', columns: { date: ['d'], amount: ['a'], reference: ['r'] }, dateFormats: ['YYYY-MM-DD'] }] } },
    });
    assert.match(L.validateTenantLendingSettings(clash)[0], /built-in/);
    assert.equal(
      L.tenantLendingSettingsSchema.safeParse({
        payments: { khqr: { statementMappings: [{ code: 'NO_AMOUNT', label: 'x x', columns: { date: ['d'], reference: ['r'] }, dateFormats: ['YYYY-MM-DD'] }] } },
      }).success,
      false,
    );
  });

  test('defaults: exact statement matches post automatically', () => {
    const d = L.defaultTenantLendingSettings().payments.khqr;
    assert.equal(d.statementAutoPost, true);
    assert.equal(d.claimMatchWindowDays, 3);
  });
});

describe('matching a statement line (D-161)', () => {
  const line = { amount: '50', currency: 'USD', valueDate: '2026-02-05' };
  const none = { loansInRemark: [], pendingReceipts: [], payers: [] };
  const loan = (over = {}) => ({ loanId: 'L1', reference: 'LN-1', status: 'ACTIVE', currency: 'USD', ...over });

  test('a confirmed receipt needs the same amount and currency', () => {
    assert.equal(L.lineConfirmsReceipt(line, { amount: '50.00', currency: 'USD' }).ok, true);
    assert.equal(L.lineConfirmsReceipt(line, { amount: '49', currency: 'USD' }).ok, false);
    assert.equal(L.lineConfirmsReceipt(line, { amount: '50', currency: 'KHR' }).ok, false);
  });

  test('rule 1: the loan reference in the remark', () => {
    assert.deepEqual(L.matchStatementLine(line, { ...none, loansInRemark: [loan()] }, 3), {
      kind: 'LOAN',
      rule: 'LOAN_REFERENCE',
      loanId: 'L1',
      reason: 'The remark names loan LN-1.',
    });
    assert.equal(L.matchStatementLine(line, { ...none, loansInRemark: [loan({ status: 'CLOSED' })] }, 3).kind, 'NONE');
    assert.equal(L.matchStatementLine(line, { ...none, loansInRemark: [loan({ currency: 'KHR' })] }, 3).kind, 'NONE');
    const two = L.matchStatementLine(line, { ...none, loansInRemark: [loan(), loan({ loanId: 'L2', reference: 'LN-2' })] }, 3);
    assert.equal(two.kind, 'NONE');
    assert.deepEqual(two.kind === 'NONE' && two.suggestions, ['LN-1', 'LN-2']);
  });

  test('rule 2: one pending claim of the payer for the same amount within the window', () => {
    const claim = { receiptId: 'R1', loanId: 'L1', loanReference: 'LN-1', amount: '50.00', currency: 'USD', valueDate: '2026-02-03', payerIsBorrower: true };
    const r = L.matchStatementLine(line, { ...none, pendingReceipts: [claim] }, 3);
    assert.equal(r.kind, 'RECEIPT');
    assert.equal(L.matchStatementLine(line, { ...none, pendingReceipts: [{ ...claim, valueDate: '2026-01-30' }] }, 3).kind, 'NONE');
    assert.equal(L.matchStatementLine(line, { ...none, pendingReceipts: [{ ...claim, payerIsBorrower: false }] }, 3).kind, 'NONE');
    assert.equal(L.matchStatementLine(line, { ...none, pendingReceipts: [claim, { ...claim, receiptId: 'R2' }] }, 3).kind, 'NONE');
  });

  test('rule 3: the payer by phone, one live loan, the amount due on it', () => {
    const payer = (by: 'PHONE' | 'NAME', loans = [{ loanId: 'L1', reference: 'LN-1', currency: 'USD', amountsDue: ['50.00', '120'] }]) => ({ borrowerId: 'B1', by, loans });
    assert.equal(L.matchStatementLine(line, { ...none, payers: [payer('PHONE')] }, 3).kind, 'LOAN');
    assert.equal(L.matchStatementLine(line, { ...none, payers: [payer('NAME')] }, 3).kind, 'LOAN');
    // A different amount, two loans, two borrowers of that name: suspense, with suggestions.
    const off = L.matchStatementLine({ ...line, amount: '51' }, { ...none, payers: [payer('PHONE')] }, 3);
    assert.equal(off.kind, 'NONE');
    assert.deepEqual(off.kind === 'NONE' && off.suggestions, ['LN-1']);
    const twoLoans = payer('PHONE', [
      { loanId: 'L1', reference: 'LN-1', currency: 'USD', amountsDue: ['50'] },
      { loanId: 'L2', reference: 'LN-2', currency: 'USD', amountsDue: ['50'] },
    ]);
    assert.equal(L.matchStatementLine(line, { ...none, payers: [twoLoans] }, 3).kind, 'NONE');
    assert.equal(L.matchStatementLine(line, { ...none, payers: [payer('NAME'), { ...payer('NAME'), borrowerId: 'B2' }] }, 3).kind, 'NONE');
    // A phone match outranks name matches.
    assert.equal(L.matchStatementLine(line, { ...none, payers: [payer('PHONE'), { ...payer('NAME'), borrowerId: 'B2' }] }, 3).kind, 'LOAN');
    assert.equal(L.matchStatementLine(line, none, 3).kind, 'NONE');
  });
});
