import {
  LoanPosition,
  buildReturn,
  rateBands,
  regulatoryClass,
  returnCsv,
  sizeBands,
} from './regulatory-return';

const pos = (over: Partial<LoanPosition>): LoanPosition => ({
  stack: 'LENDING',
  loanId: 'l1',
  reference: 'L-1',
  borrowerId: 'b1',
  borrowerName: 'Sok Dara',
  branch: 'Phnom Penh',
  currency: 'USD',
  family: 'PERSONAL',
  product: 'Personal',
  purpose: 'Not recorded',
  borrowerType: 'INDIVIDUAL',
  bookedPrincipal: '1000',
  principal: '1000',
  interestReceivable: '0',
  allowance: '10',
  daysPastDue: 0,
  recordedClass: null,
  restructured: false,
  annualRatePct: '18',
  ...over,
});

const input = (positions: LoanPosition[], ledger: any[] = []) => ({
  tenantName: 'Test',
  year: 2026,
  month: 1,
  start: '2026-01-01',
  end: '2026-01-31',
  basis: 'CLOSED_PERIOD' as const,
  attributesAsOf: '2026-01-31',
  rateCapPct: '18',
  positions,
  movements: [],
  ledger,
  warnings: [],
});

describe('regulatory return builder', () => {
  it('classifies by NBC days-past-due bands, never better than the recorded class', () => {
    expect(regulatoryClass(0, null).code).toBe('STANDARD');
    expect(regulatoryClass(15, null).code).toBe('SPECIAL_MENTION');
    expect(regulatoryClass(31, null).code).toBe('SUBSTANDARD');
    expect(regulatoryClass(91, null).code).toBe('LOSS');
    expect(regulatoryClass(0, 'SUBSTANDARD').code).toBe('SUBSTANDARD');
    expect(regulatoryClass(95, 'STANDARD').code).toBe('LOSS');
    expect(regulatoryClass(5, 'SOMETHING_ELSE').code).toBe('STANDARD');
  });

  it('bands sizes per currency and rates against the cap', () => {
    expect(sizeBands('USD')[0].label).toBe('Up to 500');
    expect(sizeBands('KHR')[0].label).toBe('Up to 2,000,000');
    expect(rateBands('18').map((b) => b.label)).toEqual([
      'Up to 12%',
      '12% – 15%',
      '15% – 18% (cap)',
      'Above the 18% cap',
    ]);
  });

  it('keeps currencies apart and ties every table to the portfolio', () => {
    const c = buildReturn(
      input(
        [
          pos({}),
          pos({
            loanId: 'l2',
            principal: '500',
            daysPastDue: 40,
            annualRatePct: '20',
          }),
          pos({
            loanId: 'l3',
            currency: 'KHR',
            principal: '4000000',
            bookedPrincipal: '4000000',
            allowance: '40000',
          }),
          pos({ loanId: 'l4', principal: '0' }),
        ],
        [
          {
            stack: 'LENDING',
            currency: 'USD',
            principal: '1500',
            principalFrozen: '1500',
            allowance: '20',
            allowanceFrozen: '20',
            accounts: ['1200', '1300'],
          },
          {
            stack: 'LENDING',
            currency: 'KHR',
            principal: '4000000',
            principalFrozen: null,
            allowance: '40000',
            allowanceFrozen: null,
            accounts: ['1200', '1300'],
          },
        ],
      ),
    );
    expect(c.currencies).toEqual(['KHR', 'USD']);
    const port = c.tables.find((t) => t.code === 'PORTFOLIO')!;
    expect(port.totals.find((r) => r.currency === 'USD')!.principal).toBe(
      '1500.00',
    );
    expect(port.totals.find((r) => r.currency === 'KHR')!.principal).toBe(
      '4000000',
    );
    expect(c.checks.filter((x) => !x.passed)).toEqual([]);
    const cls = c.tables.find((t) => t.code === 'CLASSIFICATION')!;
    const sub = cls.rows.find(
      (r) => r.currency === 'USD' && r.class === 'Substandard',
    )!;
    expect(sub.principal).toBe('500.00');
    expect(sub.provisionRequired).toBe('125.00');
    const above = c.tables
      .find((t) => t.code === 'INTEREST_RATES')!
      .rows.find((r) => r.currency === 'USD' && r.aboveCap === 'Yes')!;
    expect(above.loans).toBe(1);
  });

  it('reports a break when the loans do not tie to the ledger, and treats migrated legacy loans as a reconciling item', () => {
    const broken = buildReturn(
      input(
        [pos({})],
        [
          {
            stack: 'LENDING',
            currency: 'USD',
            principal: '900',
            principalFrozen: '900',
            allowance: '10',
            allowanceFrozen: '10',
            accounts: ['1200'],
          },
        ],
      ),
    );
    expect(
      broken.checks.find((x) => x.code === 'LEDGER_PRINCIPAL_USD')!.passed,
    ).toBe(false);
    const migrated = buildReturn(
      input(
        [pos({ stack: 'LEGACY', allowance: '0' })],
        [
          {
            stack: 'LEGACY',
            currency: 'USD',
            principal: '1700',
            principalFrozen: null,
            allowance: '0',
            allowanceFrozen: null,
            principalMigrated: '700',
            allowanceMigrated: '0',
            accounts: ['1200'],
          },
        ],
      ),
    );
    const row = migrated.reconciliation.find(
      (r) => r.stack === 'LEGACY' && r.measure === 'PRINCIPAL',
    )!;
    expect(row.status).toBe('MATCHED');
    expect(row.migrated).toBe('700.00');
    expect(row.ledger).toBe('1700.00');
  });

  it('neutralises spreadsheet formulas in the CSV', () => {
    const c = buildReturn(input([pos({ borrowerName: '=HYPERLINK("x")' })]));
    const csv = returnCsv(c, {});
    expect(csv).toContain(`"'=HYPERLINK(""x"")"`);
    expect(csv).toContain('Reconciliation to the ledger');
  });
});
