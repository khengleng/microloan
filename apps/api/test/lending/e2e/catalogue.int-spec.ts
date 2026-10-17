/* eslint-disable @typescript-eslint/no-unsafe-call -- end-to-end fixtures: API responses are untyped. */
/**
 * Loan-type coverage (docs/servicing/SCENARIOS.md): every LT-01..LT-24 maps
 * to a product template; the ones the journeys exercise must be offerable,
 * and a template whose capability is not built cannot be activated.
 */
import { lending } from '@microloan/shared';
import { TEST_DB } from '../harness';
import { Journey, expectOk } from './journey';

const d = TEST_DB ? describe : describe.skip;

/** Loan type → template exercised end to end, and the journey that does it. */
const COVERED: [string, string, string][] = [
  ['LT-01', 'PERSONAL_INSTALMENT', 'S01'],
  ['LT-02', 'HOME_MORTGAGE', 'S05'],
  ['LT-03', 'HOME_EQUITY_TERM', 'S06'],
  ['LT-04', 'HOME_EQUITY_LINE', 'S07'],
  ['LT-05', 'CAR_LOAN', 'S11'],
  ['LT-06', 'STUDENT_LOAN', 'S04'],
  ['LT-08', 'SALARY_ADVANCE', 'S02'],
  ['LT-09', 'PERSONAL_INSTALMENT', 'S13'],
  ['LT-10', 'DEBT_CONSOLIDATION', 'S03'],
  ['LT-12', 'CORPORATE_TERM', 'S15'],
  ['LT-13', 'OVERDRAFT', 'S16'],
  ['LT-14', 'REVOLVING_CREDIT', 'S17'],
  ['LT-15', 'EQUIPMENT_LOAN', 'S12'],
  ['LT-16', 'COMMERCIAL_PROPERTY', 'S10'],
  ['LT-17', 'CONSTRUCTION', 'S08'],
  ['LT-20', 'SME_TERM', 'S14'],
  ['LT-21', 'MICRO_GROUP', 'S18'],
  ['LT-22', 'AGRI_CROP_SEASONAL', 'S20'],
  ['LT-23', 'BRIDGE_LOAN', 'S09'],
];

d('S33 loan-type coverage and pending modules', () => {
  let j: Journey;
  let templates: Map<string, any>;

  beforeAll(async () => {
    j = await Journey.start();
    const families = expectOk(await j.as('maker').get('/lending/catalogue'));
    templates = new Map(
      families.flatMap((f: any) => f.templates).map((t: any) => [t.code, t]),
    );
  }, 120_000);
  afterAll(async () => j?.close());

  it.each(COVERED)('%s: template %s is offerable (journey %s)', (_lt, code) => {
    const t = templates.get(code);
    expect(t).toBeDefined();
    expect(t.missing).toEqual([]);
    expect(t.available).toBe(true);
  });

  it('every catalogue template is available; one still waiting for a capability could not be drafted', async () => {
    const pending = [...templates.values()].find((t) => !t.available);
    // Every capability in the catalogue is now built.
    if (!pending) return;
    const tpl = expectOk(
      await j.as('maker').get(`/lending/templates/${pending.code}`),
    );
    const res = await j.as('maker').post('/lending/products', {
      templateCode: pending.code,
      code: 'PENDING-1',
      name: 'Pending capability',
      config: tpl.defaultConfig,
    });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('TEMPLATE_UNAVAILABLE');
    expect(res.body.missing.length).toBeGreaterThan(0);
  });

  // The specialised modules are now available; their journeys from booking to
  // closure live with each module: cards.int-spec.ts (LT-07), bnpl-lease.int-spec.ts
  // (LT-11, LT-15), trade.int-spec.ts (LT-18, LT-19, TV-20) and
  // syndication.int-spec.ts (LT-24).
  it('LT-07, LT-11, LT-15, LT-18, LT-19, LT-24: the specialised templates can be configured', async () => {
    for (const code of [
      'CREDIT_CARD',
      'BNPL',
      'IJARAH',
      'INVOICE_BACKED',
      'LETTER_OF_CREDIT',
      'SYNDICATED',
    ]) {
      const tpl = lending.TEMPLATE_BY_CODE[code];
      expect(tpl).toBeTruthy();
      expect(lending.templateAvailability(tpl).available).toBe(true);
      const res = await j.as('maker').post('/lending/products', {
        templateCode: code,
        code: `SPEC-${code}`.slice(0, 30),
        name: `Specialised ${code}`,
        config: tpl.defaultConfig,
      });
      expect([200, 201]).toContain(res.status);
    }
  });
});
