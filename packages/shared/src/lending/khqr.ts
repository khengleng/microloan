/**
 * KHQR (Cambodia) payloads: building and reading them.
 *
 * KHQR is the NBC's national QR standard, built on EMVCo's TLV format: a flat
 * sequence of `IDLLVALUE` triples, terminated by a CRC-16/CCITT-FALSE over
 * everything preceding it (including the CRC tag and its length).
 *
 * Two kinds of code are made here:
 *
 *  - a STATIC code (point of initiation "11", no amount): one fixed code a
 *    lender prints and shows; the payer types the amount and writes the loan
 *    reference in the remark. Borrowers repay lenders this way (DECISIONS
 *    D-160);
 *  - a DYNAMIC code (point of initiation "12", amount embedded, single use):
 *    the platform's own plan payments.
 *
 * Pure: no I/O, no settlement. Nothing here confirms that a payment happened —
 * there is no Bakong API integration; receipts are captured and reconciled by
 * people and bank statements (D-160…D-165).
 */

/** EMVCo root tags used here. */
const TAG = {
  PAYLOAD_FORMAT: '00',
  POINT_OF_INITIATION: '01',
  /** Bakong lives in the 26–51 merchant-account-information range. */
  MERCHANT_ACCOUNT_BAKONG: '29',
  MERCHANT_CATEGORY_CODE: '52',
  TRANSACTION_CURRENCY: '53',
  TRANSACTION_AMOUNT: '54',
  COUNTRY_CODE: '58',
  MERCHANT_NAME: '59',
  MERCHANT_CITY: '60',
  ADDITIONAL_DATA: '62',
  CRC: '63',
} as const;

/** "11": a static code, reusable, with no amount. */
export const KHQR_POI_STATIC = '11';
/** "12": a dynamic code, single use, with the amount embedded. */
export const KHQR_POI_DYNAMIC = '12';

/** The currencies KHQR carries, with their ISO 4217 numeric codes. */
export const KHQR_CURRENCIES = ['USD', 'KHR'] as const;
export type KhqrCurrency = (typeof KHQR_CURRENCIES)[number];
const CURRENCY_NUMERIC: Record<KhqrCurrency, string> = { USD: '840', KHR: '116' };
const CURRENCY_FROM_NUMERIC: Record<string, KhqrCurrency> = { '840': 'USD', '116': 'KHR' };

/** Bakong's globally unique identifier, per the KHQR specification. */
export const BAKONG_GUID = 'kh.gov.nbc.bakong';

/** EMVCo field limits the payer's app shows. */
export const KHQR_LIMITS = { merchantName: 25, merchantCity: 15, bakongAccountId: 32, billNumber: 25 } as const;

/** A Bakong account id: `name@bank` (letters, digits, dot, underscore, dash). */
export const BAKONG_ACCOUNT_ID = /^[A-Za-z0-9._-]{1,40}@[A-Za-z0-9._-]{1,20}$/;

/** `ID` + zero-padded 2-digit length + value. */
function tlv(id: string, value: string): string {
  if (value.length > 99) {
    throw new Error(`KHQR field ${id} exceeds the 99-character EMVCo limit.`);
  }
  return `${id}${value.length.toString().padStart(2, '0')}${value}`;
}

/**
 * CRC-16/CCITT-FALSE: polynomial 0x1021, initial value 0xFFFF, no reflection,
 * no final XOR. Uppercase 4-hex-digit output.
 */
export function crc16(input: string): string {
  let crc = 0xffff;
  for (let i = 0; i < input.length; i++) {
    crc ^= input.charCodeAt(i) << 8;
    for (let bit = 0; bit < 8; bit++) {
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

export type KhqrMerchant = {
  /** Bakong account id, e.g. "acme_bank@devb". */
  bakongAccountId: string;
  /** Shown in the payer's app. EMVCo caps this at 25 characters. */
  merchantName: string;
  /** EMVCo caps this at 15 characters. */
  merchantCity: string;
  /** ISO 18245 merchant category. 6012 = financial institutions. */
  merchantCategoryCode?: string;
};

export type KhqrRequest = {
  amount: number;
  currency: KhqrCurrency;
  /** Written into the payer's reference field so receipts can be matched. */
  billNumber: string;
};

/** Validate the merchant details of a code; the messages are for the operator. */
export function khqrMerchantProblems(m: KhqrMerchant): string[] {
  const problems: string[] = [];
  if (!BAKONG_ACCOUNT_ID.test(m.bakongAccountId ?? ''))
    problems.push('The Bakong account id must look like name@bank (letters, digits, . _ -).');
  if (!m.merchantName?.trim()) problems.push('Enter the merchant name the payer will see.');
  else if (m.merchantName.trim().length > KHQR_LIMITS.merchantName)
    problems.push(`The merchant name may have at most ${KHQR_LIMITS.merchantName} characters.`);
  if (!m.merchantCity?.trim()) problems.push('Enter the merchant city.');
  else if (m.merchantCity.trim().length > KHQR_LIMITS.merchantCity)
    problems.push(`The merchant city may have at most ${KHQR_LIMITS.merchantCity} characters.`);
  if (m.merchantCategoryCode && !/^\d{4}$/.test(m.merchantCategoryCode))
    problems.push('The merchant category code has four digits (6012 for financial institutions).');
  // EMVCo payloads are ASCII; a Khmer merchant name would make some wallets refuse the code.
  if (/[^\x20-\x7E]/.test(`${m.bakongAccountId}${m.merchantName}${m.merchantCity}`))
    problems.push('Use Latin letters, digits and spaces only (the KHQR standard carries ASCII).');
  return problems;
}

function merchantFields(merchant: KhqrMerchant): string[] {
  return [
    tlv(TAG.MERCHANT_ACCOUNT_BAKONG, tlv('00', BAKONG_GUID) + tlv('01', merchant.bakongAccountId)),
    tlv(TAG.MERCHANT_CATEGORY_CODE, merchant.merchantCategoryCode || '6012'),
  ];
}

function frame(fields: string[]): string {
  const framed = `${fields.join('')}${TAG.CRC}04`;
  return `${framed}${crc16(framed)}`;
}

/**
 * Build a static KHQR payload: point of initiation "11", the currency, and no
 * amount — the payer types the amount, and the same code serves every loan.
 *
 * Fields are emitted in ascending tag order because some wallet parsers are
 * strict about it, and the CRC is computed over the payload with the CRC tag
 * and length already appended — that framing is part of the spec.
 */
export function buildStaticKhqrPayload(merchant: KhqrMerchant, currency: KhqrCurrency): string {
  const problems = khqrMerchantProblems(merchant);
  if (problems.length) throw new Error(problems.join(' '));
  const numeric = CURRENCY_NUMERIC[currency];
  if (!numeric) throw new Error(`KHQR does not support currency ${currency}.`);
  const [account, category] = merchantFields(merchant);
  return frame([
    tlv(TAG.PAYLOAD_FORMAT, '01'),
    tlv(TAG.POINT_OF_INITIATION, KHQR_POI_STATIC),
    account,
    category,
    tlv(TAG.TRANSACTION_CURRENCY, numeric),
    tlv(TAG.COUNTRY_CODE, 'KH'),
    tlv(TAG.MERCHANT_NAME, merchant.merchantName.trim()),
    tlv(TAG.MERCHANT_CITY, merchant.merchantCity.trim()),
  ]);
}

/**
 * Build a dynamic (amount-bearing, single-use) KHQR payload — the platform's
 * own plan payments.
 */
export function buildKhqrPayload(merchant: KhqrMerchant, request: KhqrRequest): string {
  if (!merchant.bakongAccountId || !merchant.merchantName) {
    throw new Error('KHQR merchant is not configured.');
  }
  const numeric = CURRENCY_NUMERIC[request.currency];
  if (!numeric) throw new Error(`KHQR does not support currency ${request.currency}.`);
  if (!(request.amount > 0)) throw new Error('KHQR amount must be greater than zero.');
  // KHR is a zero-decimal currency; emitting "12000.00" makes some wallets
  // reject the payload outright.
  const amount = request.currency === 'KHR' ? Math.round(request.amount).toString() : request.amount.toFixed(2);
  const [account, category] = merchantFields(merchant);
  return frame([
    tlv(TAG.PAYLOAD_FORMAT, '01'),
    tlv(TAG.POINT_OF_INITIATION, KHQR_POI_DYNAMIC),
    account,
    category,
    tlv(TAG.TRANSACTION_CURRENCY, numeric),
    tlv(TAG.TRANSACTION_AMOUNT, amount),
    tlv(TAG.COUNTRY_CODE, 'KH'),
    tlv(TAG.MERCHANT_NAME, merchant.merchantName.slice(0, KHQR_LIMITS.merchantName)),
    tlv(TAG.MERCHANT_CITY, merchant.merchantCity.slice(0, KHQR_LIMITS.merchantCity)),
    // 62-01 is the bill/reference number the payer's receipt will carry.
    tlv(TAG.ADDITIONAL_DATA, tlv('01', request.billNumber.slice(0, KHQR_LIMITS.billNumber))),
  ]);
}

// ── Reading a KHQR ──────────────────────────────────────────────────────────

/** Merchant details recovered from a KHQR payload. */
export type ParsedKhqr = KhqrMerchant & {
  /** "11" static (no amount) or "12" dynamic (amount baked in). */
  pointOfInitiation: string;
  /** Present only on a dynamic QR. */
  amount?: string;
  currency?: KhqrCurrency;
  countryCode?: string;
};

/** Split a payload into `{ tag: value }`, rejecting malformed TLV. */
export function parseTlvBlock(payload: string): Record<string, string> {
  const out: Record<string, string> = {};
  let i = 0;
  while (i < payload.length) {
    if (i + 4 > payload.length) throw new Error('Malformed QR: truncated field header.');
    const id = payload.slice(i, i + 2);
    const len = Number(payload.slice(i + 2, i + 4));
    if (!Number.isInteger(len) || len < 0 || i + 4 + len > payload.length) {
      throw new Error(`Malformed QR: bad length for field ${id}.`);
    }
    out[id] = payload.slice(i + 4, i + 4 + len);
    i += 4 + len;
  }
  return out;
}

/**
 * Digest a KHQR payload into merchant details, verifying the CRC rather than
 * trusting it: a mistyped payload that still looks like valid TLV would
 * otherwise be stored and produce codes no wallet can read.
 */
export function parseKhqrPayload(raw: string): ParsedKhqr {
  // Strip only line breaks and tabs, which a wrapped copy-paste introduces.
  // NOT all whitespace: merchant names and cities legitimately contain spaces,
  // and removing those changes the bytes the CRC was computed over.
  const payload = raw.trim().replace(/[\r\n\t]+/g, '');
  if (payload.length < 12) throw new Error('That does not look like a KHQR payload.');

  const crcIndex = payload.lastIndexOf('6304');
  if (crcIndex < 0 || crcIndex !== payload.length - 8) {
    throw new Error('Malformed QR: missing the trailing CRC field.');
  }
  const framed = payload.slice(0, crcIndex + 4);
  const supplied = payload.slice(crcIndex + 4).toUpperCase();
  const expected = crc16(framed);
  if (supplied !== expected) {
    throw new Error(
      `QR checksum mismatch (expected ${expected}, got ${supplied}). ` +
        'The code may have been copied incompletely or is not a valid KHQR.',
    );
  }

  const tags = parseTlvBlock(payload.slice(0, crcIndex));
  if (tags['00'] !== '01') throw new Error('Unsupported QR: payload format indicator is not EMVCo 01.');

  // Bakong normally sits at tag 29, but the spec allows 26–51 for merchant
  // account information, and issuers do vary. Scan the range for the GUID.
  let bakongAccountId = '';
  for (let tag = 26; tag <= 51; tag++) {
    const value = tags[String(tag).padStart(2, '0')];
    if (!value) continue;
    let inner: Record<string, string>;
    try {
      inner = parseTlvBlock(value);
    } catch {
      continue;
    }
    if (inner['00']?.toLowerCase() === BAKONG_GUID && inner['01']) {
      bakongAccountId = inner['01'];
      break;
    }
  }
  if (!bakongAccountId) {
    throw new Error('No Bakong account found in that QR. Upload the KHQR from your Bakong merchant or business account.');
  }
  const merchantName = tags['59']?.trim();
  if (!merchantName) throw new Error('Malformed QR: no merchant name (tag 59).');

  return {
    bakongAccountId,
    merchantName,
    merchantCity: tags['60']?.trim() || 'Phnom Penh',
    merchantCategoryCode: tags['52']?.trim() || '6012',
    pointOfInitiation: tags['01'] || KHQR_POI_STATIC,
    amount: tags['54'],
    currency: tags['53'] ? CURRENCY_FROM_NUMERIC[tags['53']] : undefined,
    countryCode: tags['58'],
  };
}

/**
 * Whether a parsed payload is usable as a lender's static repayment code:
 * static point of initiation, no amount, and the currency it is filed under.
 * Empty when it is.
 */
export function staticKhqrProblems(parsed: ParsedKhqr, currency: KhqrCurrency): string[] {
  const problems: string[] = [];
  if (parsed.pointOfInitiation !== KHQR_POI_STATIC)
    problems.push(
      'This is a dynamic (single-payment) KHQR. Upload the static merchant code from your bank app — the one without an amount.',
    );
  if (parsed.amount) problems.push(`This code carries a fixed amount (${parsed.amount}); a repayment code must have none.`);
  if (parsed.currency && parsed.currency !== currency)
    problems.push(`This code is for ${parsed.currency}, not ${currency}.`);
  return problems;
}
