import {
  buildKhqrPayload,
  crc16,
  khqrConfigured,
  khqrMerchantFromEnv,
} from './khqr';

const MERCHANT = {
  bakongAccountId: 'acme_micro@devb',
  merchantName: 'Acme Microfinance',
  merchantCity: 'Phnom Penh',
  merchantCategoryCode: '6012',
};

/** Parse an EMVCo payload back into a flat tag map. */
function parseTlv(payload: string): Record<string, string> {
  const out: Record<string, string> = {};
  let i = 0;
  while (i < payload.length) {
    const id = payload.slice(i, i + 2);
    const len = Number(payload.slice(i + 2, i + 4));
    out[id] = payload.slice(i + 4, i + 4 + len);
    i += 4 + len;
  }
  return out;
}

describe('KHQR payload', () => {
  describe('crc16', () => {
    // The canonical CCITT-FALSE check value. If this drifts, every QR this
    // platform mints becomes unscannable, so it is pinned explicitly.
    it('matches the CCITT-FALSE check value for "123456789"', () => {
      expect(crc16('123456789')).toBe('29B1');
    });

    it('is stable and uppercase 4-hex-digit', () => {
      expect(crc16('abc')).toMatch(/^[0-9A-F]{4}$/);
    });
  });

  describe('structure', () => {
    const payload = buildKhqrPayload(MERCHANT, {
      amount: 149,
      currency: 'USD',
      billNumber: 'ABC123',
    });
    const tags = parseTlv(payload);

    it('declares EMVCo format 01 and a dynamic point of initiation', () => {
      expect(tags['00']).toBe('01');
      // "12" = dynamic (carries an amount, single use). A static "11" QR would
      // let the payer choose their own amount.
      expect(tags['01']).toBe('12');
    });

    it('nests the Bakong GUID and account under tag 29', () => {
      expect(parseTlv(tags['29'])).toEqual({
        '00': 'kh.gov.nbc.bakong',
        '01': 'acme_micro@devb',
      });
    });

    it('encodes currency, amount, country and merchant', () => {
      expect(tags['52']).toBe('6012');
      expect(tags['53']).toBe('840'); // ISO 4217 numeric for USD
      expect(tags['54']).toBe('149.00');
      expect(tags['58']).toBe('KH');
      expect(tags['59']).toBe('Acme Microfinance');
      expect(tags['60']).toBe('Phnom Penh');
    });

    it('carries the payment reference as the bill number', () => {
      expect(parseTlv(tags['62'])).toEqual({ '01': 'ABC123' });
    });

    it('terminates with a CRC computed over the framed payload', () => {
      const framed = payload.slice(0, -4);
      expect(framed.endsWith('6304')).toBe(true);
      expect(payload.slice(-4)).toBe(crc16(framed));
    });
  });

  describe('currency handling', () => {
    it('emits KHR without decimals', () => {
      // KHR is zero-decimal; "12000.00" is rejected by some wallets.
      const tags = parseTlv(
        buildKhqrPayload(MERCHANT, {
          amount: 12000.4,
          currency: 'KHR',
          billNumber: 'R1',
        }),
      );
      expect(tags['53']).toBe('116');
      expect(tags['54']).toBe('12000');
    });

    it('emits USD with two decimals', () => {
      const tags = parseTlv(
        buildKhqrPayload(MERCHANT, {
          amount: 49,
          currency: 'USD',
          billNumber: 'R1',
        }),
      );
      expect(tags['54']).toBe('49.00');
    });
  });

  describe('guards', () => {
    it('refuses a zero or negative amount', () => {
      expect(() =>
        buildKhqrPayload(MERCHANT, {
          amount: 0,
          currency: 'USD',
          billNumber: 'R1',
        }),
      ).toThrow(/greater than zero/);
    });

    it('refuses an unconfigured merchant', () => {
      expect(() =>
        buildKhqrPayload(
          { ...MERCHANT, bakongAccountId: '' },
          { amount: 10, currency: 'USD', billNumber: 'R1' },
        ),
      ).toThrow(/not configured/);
    });

    it('truncates merchant name and city to their EMVCo limits', () => {
      const tags = parseTlv(
        buildKhqrPayload(
          {
            ...MERCHANT,
            merchantName: 'A'.repeat(60),
            merchantCity: 'B'.repeat(40),
          },
          { amount: 10, currency: 'USD', billNumber: 'R1' },
        ),
      );
      expect(tags['59']).toHaveLength(25);
      expect(tags['60']).toHaveLength(15);
    });
  });

  describe('configuration', () => {
    const original = { ...process.env };
    afterEach(() => {
      process.env = { ...original };
    });

    it('reports unconfigured when the Bakong account is missing', () => {
      delete process.env.KHQR_BAKONG_ACCOUNT_ID;
      process.env.KHQR_MERCHANT_NAME = 'Acme';
      expect(khqrConfigured()).toBe(false);
    });

    it('reports configured once both required values are present', () => {
      process.env.KHQR_BAKONG_ACCOUNT_ID = 'acme@devb';
      process.env.KHQR_MERCHANT_NAME = 'Acme';
      expect(khqrConfigured()).toBe(true);
      expect(khqrMerchantFromEnv().merchantCity).toBe('Phnom Penh'); // default
    });
  });
});
