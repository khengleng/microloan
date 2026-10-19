import { lending } from '@microloan/shared';
import {
  KeyFactsDocument,
  keyFactsSections,
  money,
  renderKeyFacts,
} from './key-facts-render';

function doc(over: Partial<KeyFactsDocument> = {}): KeyFactsDocument {
  const c = structuredClone(
    lending.TEMPLATE_BY_CODE.PERSONAL_INSTALMENT.defaultConfig,
  );
  const terms = {
    principal: '1000',
    numberOfInstalments: 12,
    annualRate: '0.18',
    disbursementDate: '2026-01-05',
  };
  const fees = lending.computeUpfrontFees(
    terms.principal,
    'USD',
    c.pricing.rounding,
    [
      {
        code: 'PROC',
        name: 'Processing fee',
        calculation: 'PERCENT_OF_PRINCIPAL',
        rate: '0.02',
        treatment: 'DEDUCTED',
        waivable: false,
      },
    ],
  );
  const input = lending.toScheduleInput(c, terms, fees.bookedPrincipal);
  const schedule = lending.generateSchedule(input);
  return {
    facts: lending.buildKeyFacts({
      currency: 'USD',
      principal: terms.principal,
      disbursementDate: terms.disbursementDate,
      nominalAnnualRate: '0.18',
      effectiveAnnualRate: '0.2234567',
      fees,
      schedule,
      config: c,
    }),
    version: 1,
    issuedOn: '2026-01-05',
    lender: { name: 'Test MFI Plc.', licenceNumber: 'MFI-7' },
    borrower: { name: 'Sok Dara' },
    application: { reference: 'APP-1' },
    product: { name: 'Personal loan' },
    security: {
      collateral: [],
      guarantees: [
        {
          name: 'Chan Sopheap',
          type: 'PERSONAL',
          amount: '500',
          currency: 'USD',
        },
      ],
    },
    coolingOff: {
      days: 7,
      chargesAccruedInterest: true,
      refundsLenderFees: true,
    },
    complaints: {
      phone: '+855 23 000 000',
      email: null,
      address: null,
      regulator: 'National Bank of Cambodia',
    },
    ...over,
  };
}

describe('key facts statement rendering (D-123)', () => {
  it('prints rates as percentages with two decimals and every total', () => {
    const html = renderKeyFacts(doc(), 'en').toString('utf8');
    expect(html).toContain('<html lang="en">');
    expect(html).toContain('18.00%');
    expect(html).toContain('22.35%');
    expect(html).not.toContain('>0.18<');
    expect(html).toContain('Processing fee (deducted from the loan)');
    expect(html).toContain('20.00 USD');
    expect(html).toContain('980.00 USD');
    expect(html).toContain('Total cost of credit');
    expect(html).toContain('within 7 days');
    expect(html).toContain('Guarantor: Chan Sopheap, for up to 500.00 USD');
    expect(html).toContain('MFI-7');
    // Unset contacts say so, rather than printing nothing.
    expect(html).toContain('not configured');
  });

  it('words the same figures in Khmer', () => {
    const en = keyFactsSections(doc(), 'en');
    const km = keyFactsSections(doc(), 'km');
    expect(km.map((s) => (s.rows ?? []).map((r) => r[1]))).toEqual(
      en.map((s) =>
        (s.rows ?? []).map((r) =>
          // Only the labels and words change; amounts and rates are identical.
          /\d/.test(r[1]) ? r[1] : expect.any(String),
        ),
      ),
    );
    const html = renderKeyFacts(doc(), 'km').toString('utf8');
    expect(html).toContain('<html lang="km">');
    expect(html).toContain('សេចក្តីថ្លែងការណ៍ព័ត៌មានសំខាន់ៗអំពីឥណទាន');
    expect(html).toContain('អត្រាការប្រាក់ប្រសិទ្ធភាពប្រចាំឆ្នាំ');
    expect(html).toContain('22.35%');
  });

  it('states when there is no cooling-off period', () => {
    const html = renderKeyFacts(
      doc({
        coolingOff: {
          days: 0,
          chargesAccruedInterest: true,
          refundsLenderFees: true,
        },
      }),
      'en',
    ).toString('utf8');
    expect(html).toContain('This loan has no cooling-off period.');
  });

  it('formats money at the currency’s minor units', () => {
    expect(money('1234567.5', 'USD')).toBe('1,234,567.50 USD');
    expect(money('4000000', 'KHR')).toBe('4,000,000.00 KHR');
    expect(money(null, 'USD')).toBe('—');
  });
});
