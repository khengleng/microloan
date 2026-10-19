import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { lending as L } from '../src/index.js';

const settings = L.defaultTenantLendingSettings().aml;
const opts = {
  threshold: Number(settings.screening.matchThreshold),
  tokenFloor: Number(settings.screening.tokenFloor),
  singleTokenPenalty: Number(settings.screening.singleTokenPenalty),
  ignoredTitles: settings.screening.ignoredTitles,
};
const sim = (a: string, b: string) => L.nameSimilarity(a, b, opts).score;

describe('AML name normalisation (D-119)', () => {
  test('folds case and Latin accents, and splits on punctuation', () => {
    assert.deepEqual(L.normalizeNameTokens('  SOKHÀ   Chéa-Vibol '), ['sokha', 'chea', 'vibol']);
    assert.equal(L.normalizeName("O'Neil, Mary-Ann"), 'o neil mary an');
  });

  test('collapses doubled letters of inconsistent romanisation', () => {
    assert.equal(L.normalizeName('Sokkha Chann'), L.normalizeName('Sokha Chan'));
  });

  test('drops titles and honorifics, longest first, but never the whole name', () => {
    const titles = settings.screening.ignoredTitles;
    assert.equal(L.normalizeName('Lok Chumteav Chan Thy', titles), 'chan thy');
    assert.equal(L.normalizeName('H.E. Oknha Sok Dara', titles), 'sok dara');
    assert.equal(L.normalizeName('Oknha', titles), 'oknha');
  });

  test('keeps Khmer-script vowel signs', () => {
    const khmer = 'សុខ ដារា';
    assert.deepEqual(L.normalizeNameTokens(khmer), ['សុខ', 'ដារា']);
  });
});

describe('Jaro-Winkler', () => {
  test('textbook values', () => {
    assert.equal(Number(L.jaro('MARTHA', 'MARHTA').toFixed(4)), 0.9444);
    assert.equal(Number(L.jaroWinkler('MARTHA', 'MARHTA').toFixed(4)), 0.9611);
    assert.equal(Number(L.jaroWinkler('DIXON', 'DICKSONX').toFixed(4)), 0.8133);
    assert.equal(L.jaroWinkler('same', 'same'), 1);
    assert.equal(L.jaro('', 'abc'), 0);
  });
});

describe('token-set name similarity', () => {
  test('word order does not matter', () => {
    assert.equal(sim('Sok Dara', 'Dara Sok'), 1);
  });

  test('Khmer romanisation spacing matches through the joined comparison', () => {
    const m = L.nameSimilarity('Chanthy Sok', 'Chan Thy Sok', opts);
    assert.equal(m.method, 'JOINED');
    assert.ok(m.score >= opts.threshold, `score ${m.score}`);
    assert.ok(sim('Sokdara Chan', 'Sok Dara Chan') >= opts.threshold);
  });

  test('small spelling variants still match', () => {
    assert.ok(sim('Chan Sopheak', 'Chan Sophea') >= opts.threshold);
    assert.ok(sim('Keo Phalla', 'Keo Phala') === 1);
    assert.ok(sim('Sokhà Chea', 'Sokha Chea') === 1);
  });

  test('a missing middle name does not hide a match', () => {
    assert.equal(sim('Sok Dara', 'Sok Dara Vibol'), 1);
  });

  test('one shared word of a longer name is discounted', () => {
    assert.ok(sim('Dara', 'Sok Dara') < opts.threshold);
  });

  test('different people sharing a family name do not match', () => {
    assert.ok(sim('Sok Dara', 'Sok Dina') < opts.threshold, String(sim('Sok Dara', 'Sok Dina')));
    assert.ok(sim('Chan Sophea', 'Chea Sopheap') < 1);
    assert.ok(sim('Lim Bunthoeun', 'Meas Sreymom') < 0.5);
  });

  test('screenName reports the best alias per entry, best first, with a date-of-birth note', () => {
    const hits = L.screenName(
      { name: 'Sokhom Rithy', dateOfBirth: '1980-02-01' },
      [
        { id: 'e1', name: 'Fictional Person', aliases: ['Rithy Sokhom'], entryType: 'SANCTION', dateOfBirth: '1975-01-01' },
        { id: 'e2', name: 'Someone Else', aliases: [], entryType: 'PEP' },
      ],
      opts,
    );
    assert.equal(hits.length, 1);
    assert.equal(hits[0].entryId, 'e1');
    assert.equal(hits[0].matchedName, 'Rithy Sokhom');
    assert.equal(hits[0].dobMismatch, true);
  });
});

describe('watch-list files', () => {
  test('parses entries with optional columns in any order', () => {
    const r = L.parseWatchListFile(
      [
        'type,name,list_date,source,aliases,country,date_of_birth',
        '# fictional entries',
        'SANCTION,Fictional Sanctioned Person,2026-01-15,UN 1718 (fictional),"Alias One; Alias Two",KP,1970-05-01',
        'pep,Example Minister,2026-02-01,Internal PEP register,,KH,',
      ].join('\n'),
      100,
    );
    assert.deepEqual(r.errors, []);
    assert.equal(r.entries.length, 2);
    assert.deepEqual(r.entries[0].aliases, ['Alias One', 'Alias Two']);
    assert.equal(r.entries[1].entryType, 'PEP');
    assert.equal(r.entries[1].dateOfBirth, null);
  });

  test('reports every bad line and missing columns', () => {
    const missing = L.parseWatchListFile('name,type\nX,PEP', 100);
    assert.match(missing.errors[0].message, /Missing column/);
    const bad = L.parseWatchListFile('name,type,source,list_date\nA,FOO,,2026-13-01\nGood Name,INTERNAL,Own list,2026-01-01', 100);
    assert.equal(bad.entries.length, 1);
    assert.equal(bad.errors.length, 4);
    assert.ok(bad.errors.every((e) => e.lineNo === 2));
    const many = L.parseWatchListFile('name,type,source,list_date\nAa Bb,PEP,S,2026-01-01\nCc Dd,PEP,S,2026-01-01', 1);
    assert.match(many.errors[0].message, /at most 1/);
  });
});

describe('customer risk rating (D-120)', () => {
  const risk = settings.risk;
  const base = { pep: false, nationality: 'KH', occupation: 'Teacher', productFamilies: [] as string[], cashShare: null };

  test('an ordinary customer is LOW', () => {
    const r = L.rateCustomerRisk(base, risk);
    assert.equal(r.rating, 'LOW');
    assert.equal(r.score, 0);
    assert.equal(r.factors.length, 5);
  });

  test('a cash-intensive occupation makes MEDIUM; a high-risk nationality HIGH', () => {
    assert.equal(L.rateCustomerRisk({ ...base, occupation: 'Market vendor' }, risk).rating, 'MEDIUM');
    assert.equal(L.rateCustomerRisk({ ...base, nationality: 'kp' }, risk).rating, 'HIGH');
  });

  test('cash share at or above the threshold counts as cash intensive', () => {
    const r = L.rateCustomerRisk({ ...base, cashShare: '0.75' }, risk);
    assert.equal(r.factors.find((f) => f.code === 'CASH_INTENSITY')!.present, true);
    assert.match(r.factors.find((f) => f.code === 'CASH_INTENSITY')!.detail, /75/);
    assert.equal(L.rateCustomerRisk({ ...base, cashShare: '0.2' }, risk).score, 0);
  });

  test('weights add up and a PEP is always HIGH when configured', () => {
    const custom = { ...risk, weights: { ...risk.weights, pep: 1 }, highRiskProductFamilies: ['PAWN'] };
    const r = L.rateCustomerRisk({ ...base, pep: true, occupation: 'Gold dealer', productFamilies: ['PAWN'] }, custom);
    assert.equal(r.score, 1 + risk.weights.highRiskOccupation + risk.weights.highRiskProduct);
    assert.equal(r.rating, 'HIGH');
    assert.equal(L.rateCustomerRisk({ ...base, pep: true }, { ...custom, pepAlwaysHigh: false }).rating, 'LOW');
  });

  test('occupations match whole words only', () => {
    assert.equal(L.rateCustomerRisk({ ...base, occupation: 'Contractor' }, risk).score, 0);
    assert.equal(L.rateCustomerRisk({ ...base, occupation: 'Rice trader' }, risk).rating, 'MEDIUM');
  });

  test('review dates by rating', () => {
    assert.equal(L.nextAmlReviewDate('2026-01-31', 'HIGH', risk.reviewMonths), '2027-01-31');
    assert.equal(L.nextAmlReviewDate('2026-01-31', 'LOW', risk.reviewMonths), '2029-01-31');
  });
});

describe('cash transaction report (D-121)', () => {
  const thresholds = settings.ctr.thresholds;
  const t = (id: string, borrowerId: string, date: string, amount: string, currency = 'USD', direction: 'IN' | 'OUT' = 'IN') => ({
    id,
    borrowerId,
    date,
    amount,
    currency,
    direction,
  });

  test('single transactions at the threshold are reported, below are not', () => {
    const r = L.cashTransactionReport([t('a', 'b1', '2026-03-01', '10000'), t('b', 'b2', '2026-03-01', '9999.99')], thresholds);
    assert.equal(r.groups.length, 1);
    assert.equal(r.groups[0].basis, 'SINGLE');
    assert.equal(r.groups[0].borrowerId, 'b1');
  });

  test('same-day transactions of one customer are aggregated, in and out together', () => {
    const r = L.cashTransactionReport(
      [
        t('a', 'b1', '2026-03-01', '6000'),
        t('b', 'b1', '2026-03-01', '4000', 'USD', 'OUT'),
        t('c', 'b1', '2026-03-02', '9000'),
        t('d', 'b2', '2026-03-01', '6000'),
      ],
      thresholds,
    );
    assert.equal(r.groups.length, 1);
    assert.equal(r.groups[0].basis, 'AGGREGATED');
    assert.equal(r.groups[0].total, '10000');
    assert.deepEqual(r.groups[0].transactions.map((x) => x.id), ['a', 'b']);
  });

  test('each currency has its own threshold; unknown currencies are listed, not assessed', () => {
    const r = L.cashTransactionReport(
      [t('a', 'b1', '2026-03-01', '40000000', 'KHR'), t('b', 'b1', '2026-03-01', '9000'), t('c', 'b1', '2026-03-01', '1000000', 'THB')],
      thresholds,
    );
    assert.equal(r.groups.length, 1);
    assert.equal(r.groups[0].currency, 'KHR');
    assert.deepEqual(r.unassessedCurrencies, ['THB']);
  });

  test('CSV has one line per transaction with its day total', () => {
    const r = L.cashTransactionReport([t('a', 'b1', '2026-03-01', '6000'), t('b', 'b1', '2026-03-01', '5000')], thresholds);
    const csv = L.cashTransactionReportCsv(r.groups, () => ({ name: 'Dara, Sok', idType: 'NATIONAL_ID', idNumberHint: '***123', branch: 'PNH' }));
    const lines = csv.trim().split('\n');
    assert.equal(lines.length, 3);
    assert.match(lines[1], /^2026-03-01,b1,"Dara, Sok",NATIONAL_ID,\*\*\*123,PNH,USD,IN,6000,a,11000,10000,AGGREGATED$/);
  });
});

describe('AML settings validation', () => {
  test('defaults validate; inverted thresholds do not', () => {
    const s = L.defaultTenantLendingSettings();
    assert.deepEqual(L.validateTenantLendingSettings(s), []);
    s.aml.risk.mediumAt = 9;
    assert.ok(L.validateTenantLendingSettings(s).some((i) => i.includes('mediumAt')));
  });
});
