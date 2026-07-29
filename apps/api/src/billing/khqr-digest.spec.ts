import {
  buildKhqrPayload,
  crc16,
  parseKhqrPayload,
  parseTlvBlock,
} from './khqr';

/**
 * Digesting an uploaded KHQR.
 *
 * The round trip matters most: whatever the operator uploads must survive
 * parse → re-mint, because the code customers actually scan is generated from
 * the parsed details, not from the uploaded bytes.
 */

const MERCHANT = {
  bakongAccountId: 'acme_micro@devb',
  merchantName: 'Acme Microfinance',
  merchantCity: 'Siem Reap',
  merchantCategoryCode: '5999',
};

/** A static merchant QR, the usual thing exported from the Bakong app. */
function staticMerchantQr(overrides: { tag?: string } = {}): string {
  const tlv = (id: string, v: string) =>
    `${id}${String(v.length).padStart(2, '0')}${v}`;
  const accountTag = overrides.tag ?? '29';
  const body = [
    tlv('00', '01'),
    tlv('01', '11'), // static — no amount
    tlv(
      accountTag,
      tlv('00', 'kh.gov.nbc.bakong') + tlv('01', MERCHANT.bakongAccountId),
    ),
    tlv('52', MERCHANT.merchantCategoryCode),
    tlv('58', 'KH'),
    tlv('59', MERCHANT.merchantName),
    tlv('60', MERCHANT.merchantCity),
  ].join('');
  const framed = `${body}6304`;
  return `${framed}${crc16(framed)}`;
}

describe('parseKhqrPayload', () => {
  it('recovers merchant details from a static merchant QR', () => {
    const parsed = parseKhqrPayload(staticMerchantQr());
    expect(parsed).toMatchObject({
      bakongAccountId: 'acme_micro@devb',
      merchantName: 'Acme Microfinance',
      merchantCity: 'Siem Reap',
      merchantCategoryCode: '5999',
      pointOfInitiation: '11',
    });
  });

  it('finds the Bakong account outside tag 29', () => {
    // The spec allows merchant account information anywhere in 26–51 and
    // issuers vary, so the parser scans the range rather than assuming 29.
    const parsed = parseKhqrPayload(staticMerchantQr({ tag: '30' }));
    expect(parsed.bakongAccountId).toBe('acme_micro@devb');
  });

  it('tolerates surrounding whitespace and newlines from a paste', () => {
    const parsed = parseKhqrPayload(`  ${staticMerchantQr()}\n `);
    expect(parsed.merchantName).toBe('Acme Microfinance');
  });

  it('round-trips: a re-minted dynamic QR keeps the uploaded merchant', () => {
    const parsed = parseKhqrPayload(staticMerchantQr());
    const minted = buildKhqrPayload(parsed, {
      amount: 149,
      currency: 'USD',
      billNumber: 'REF1',
    });
    const reparsed = parseKhqrPayload(minted);

    expect(reparsed.bakongAccountId).toBe(parsed.bakongAccountId);
    expect(reparsed.merchantName).toBe(parsed.merchantName);
    // The re-mint is dynamic and carries the plan price.
    expect(reparsed.pointOfInitiation).toBe('12');
    expect(reparsed.amount).toBe('149.00');
  });

  it('discards an amount present on the uploaded QR', () => {
    // Uploading a dynamic "$1" QR must not pin every plan to a dollar — the
    // amount is re-derived from the plan, never inherited.
    const tlv = (id: string, v: string) =>
      `${id}${String(v.length).padStart(2, '0')}${v}`;
    const body = [
      tlv('00', '01'),
      tlv('01', '12'),
      tlv('29', tlv('00', 'kh.gov.nbc.bakong') + tlv('01', 'acme@devb')),
      tlv('53', '840'),
      tlv('54', '1.00'),
      tlv('58', 'KH'),
      tlv('59', 'Acme'),
      tlv('60', 'Phnom Penh'),
    ].join('');
    const framed = `${body}6304`;
    const parsed = parseKhqrPayload(`${framed}${crc16(framed)}`);

    expect(parsed.amount).toBe('1.00');
    const minted = buildKhqrPayload(parsed, {
      amount: 499,
      currency: 'USD',
      billNumber: 'R',
    });
    expect(parseKhqrPayload(minted).amount).toBe('499.00');
  });

  describe('rejections', () => {
    it('rejects a corrupted payload via the CRC', () => {
      const good = staticMerchantQr();
      // Flip one character in the merchant name; TLV still parses, CRC does not.
      const corrupted = good.replace('Acme Microfinance', 'Bcme Microfinance');
      expect(() => parseKhqrPayload(corrupted)).toThrow(/checksum mismatch/i);
    });

    it('rejects a truncated payload', () => {
      expect(() => parseKhqrPayload(staticMerchantQr().slice(0, 40))).toThrow(
        /trailing CRC/i,
      );
    });

    it('rejects a non-KHQR QR (a plain URL)', () => {
      expect(() => parseKhqrPayload('https://example.com/pay/123')).toThrow();
    });

    it('rejects an EMVCo QR with no Bakong account', () => {
      const tlv = (id: string, v: string) =>
        `${id}${String(v.length).padStart(2, '0')}${v}`;
      const body = [
        tlv('00', '01'),
        tlv('01', '11'),
        tlv('29', tlv('00', 'com.other.wallet') + tlv('01', 'someone')),
        tlv('59', 'Acme'),
      ].join('');
      const framed = `${body}6304`;
      expect(() => parseKhqrPayload(`${framed}${crc16(framed)}`)).toThrow(
        /No Bakong account/i,
      );
    });

    it('rejects a payload whose format indicator is not EMVCo 01', () => {
      const tlv = (id: string, v: string) =>
        `${id}${String(v.length).padStart(2, '0')}${v}`;
      const body = [tlv('00', '02'), tlv('59', 'Acme')].join('');
      const framed = `${body}6304`;
      expect(() => parseKhqrPayload(`${framed}${crc16(framed)}`)).toThrow(
        /payload format indicator/i,
      );
    });

    it('rejects an empty string', () => {
      expect(() => parseKhqrPayload('')).toThrow(/does not look like/i);
    });
  });
});

describe('parseTlvBlock', () => {
  it('rejects a field claiming more bytes than remain', () => {
    // 99 declared, 3 supplied — a silent slice would hide the truncation.
    expect(() => parseTlvBlock('0099abc')).toThrow(/bad length/i);
  });

  it('rejects a truncated header', () => {
    expect(() => parseTlvBlock('001')).toThrow(/truncated/i);
  });
});
