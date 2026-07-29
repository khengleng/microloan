/**
 * KHQR (Cambodia) payload generation.
 *
 * KHQR is the NBC's national QR standard, built on EMVCo's TLV format: a flat
 * sequence of `IDLLVALUE` triples, terminated by a CRC-16/CCITT-FALSE over
 * everything preceding it (including the CRC tag and its length).
 *
 * This generates the payload only. It does not settle or verify anything —
 * Bakong exposes no public settlement API here, which is why a confirmed
 * payment requires a SUPERADMIN to acknowledge receipt out of band.
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

/** ISO 4217 numeric codes for the two currencies this platform supports. */
const CURRENCY_NUMERIC: Record<string, string> = { USD: '840', KHR: '116' };

/** Bakong's globally unique identifier, per the KHQR specification. */
const BAKONG_GUID = 'kh.gov.nbc.bakong';

/** `ID` + zero-padded 2-digit length + value. */
function tlv(id: string, value: string): string {
  const length = value.length.toString().padStart(2, '0');
  if (value.length > 99) {
    throw new Error(`KHQR field ${id} exceeds the 99-character EMVCo limit.`);
  }
  return `${id}${length}${value}`;
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
  currency: 'USD' | 'KHR';
  /** Written into the payer's reference field so receipts can be matched. */
  billNumber: string;
};

/** True when the platform has enough configuration to mint a KHQR. */
export function khqrConfigured(): boolean {
  return Boolean(
    process.env.KHQR_BAKONG_ACCOUNT_ID?.trim() &&
    process.env.KHQR_MERCHANT_NAME?.trim(),
  );
}

export function khqrMerchantFromEnv(): KhqrMerchant {
  return {
    bakongAccountId: process.env.KHQR_BAKONG_ACCOUNT_ID?.trim() ?? '',
    merchantName: process.env.KHQR_MERCHANT_NAME?.trim() ?? '',
    merchantCity: process.env.KHQR_MERCHANT_CITY?.trim() || 'Phnom Penh',
    merchantCategoryCode:
      process.env.KHQR_MERCHANT_CATEGORY_CODE?.trim() || '6012',
  };
}

/**
 * Build a dynamic (amount-bearing, single-use) KHQR payload.
 *
 * Fields are emitted in ascending tag order because some wallet parsers are
 * strict about it, and the CRC is computed over the payload with the CRC tag
 * and length already appended — that framing is part of the spec, not an
 * oversight.
 */
export function buildKhqrPayload(
  merchant: KhqrMerchant,
  request: KhqrRequest,
): string {
  if (!merchant.bakongAccountId || !merchant.merchantName) {
    throw new Error('KHQR merchant is not configured.');
  }
  const currencyNumeric = CURRENCY_NUMERIC[request.currency];
  if (!currencyNumeric) {
    throw new Error(`KHQR does not support currency ${request.currency}.`);
  }
  if (!(request.amount > 0)) {
    throw new Error('KHQR amount must be greater than zero.');
  }

  // KHR is a zero-decimal currency; emitting "12000.00" makes some wallets
  // reject the payload outright.
  const amount =
    request.currency === 'KHR'
      ? Math.round(request.amount).toString()
      : request.amount.toFixed(2);

  const payload = [
    tlv(TAG.PAYLOAD_FORMAT, '01'),
    // "12" = dynamic: the QR carries an amount and is meant to be used once.
    tlv(TAG.POINT_OF_INITIATION, '12'),
    tlv(
      TAG.MERCHANT_ACCOUNT_BAKONG,
      tlv('00', BAKONG_GUID) + tlv('01', merchant.bakongAccountId),
    ),
    tlv(TAG.MERCHANT_CATEGORY_CODE, merchant.merchantCategoryCode || '6012'),
    tlv(TAG.TRANSACTION_CURRENCY, currencyNumeric),
    tlv(TAG.TRANSACTION_AMOUNT, amount),
    tlv(TAG.COUNTRY_CODE, 'KH'),
    tlv(TAG.MERCHANT_NAME, merchant.merchantName.slice(0, 25)),
    tlv(TAG.MERCHANT_CITY, merchant.merchantCity.slice(0, 15)),
    // 62-01 is the bill/reference number the payer's receipt will carry.
    tlv(TAG.ADDITIONAL_DATA, tlv('01', request.billNumber.slice(0, 25))),
  ].join('');

  const framed = `${payload}${TAG.CRC}04`;
  return `${framed}${crc16(framed)}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Digesting an uploaded KHQR
// ─────────────────────────────────────────────────────────────────────────────

/** Merchant details recovered from a KHQR the platform operator uploaded. */
export type ParsedKhqr = KhqrMerchant & {
  /** "11" static (no amount) or "12" dynamic (amount baked in). */
  pointOfInitiation: string;
  /** Present only on a dynamic QR; ignored when re-minting per-plan codes. */
  amount?: string;
  currency?: string;
  countryCode?: string;
};

/** Split a payload into `{ tag: value }`, rejecting malformed TLV. */
export function parseTlvBlock(payload: string): Record<string, string> {
  const out: Record<string, string> = {};
  let i = 0;
  while (i < payload.length) {
    if (i + 4 > payload.length) {
      throw new Error('Malformed QR: truncated field header.');
    }
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

const CURRENCY_FROM_NUMERIC: Record<string, string> = {
  '840': 'USD',
  '116': 'KHR',
};

/**
 * Digest a KHQR payload into reusable merchant details.
 *
 * Accepts either a static merchant QR (the usual thing a Bakong app exports)
 * or a dynamic one. Any amount on the uploaded code is deliberately discarded
 * downstream — the platform re-mints a fresh dynamic QR per plan, so uploading
 * a QR that happens to carry "$1" cannot pin every signup to a dollar.
 *
 * The CRC is verified rather than trusted: a mistyped payload that still looks
 * like valid TLV would otherwise be stored and produce QR codes no wallet can
 * read, and the failure would only surface at a customer's phone.
 */
export function parseKhqrPayload(raw: string): ParsedKhqr {
  // Strip only line breaks and tabs, which a wrapped copy-paste introduces.
  // NOT all whitespace: merchant names and cities legitimately contain spaces
  // ("Acme Microfinance", "Siem Reap"), and removing those changes the bytes
  // the CRC was computed over, so every real QR would fail the checksum.
  const payload = raw.trim().replace(/[\r\n\t]+/g, '');
  if (payload.length < 12)
    throw new Error('That does not look like a KHQR payload.');

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

  if (tags['00'] !== '01') {
    throw new Error(
      'Unsupported QR: payload format indicator is not EMVCo 01.',
    );
  }

  // Bakong normally sits at tag 29, but the spec allows 26–51 for merchant
  // account information, and issuers do vary. Scan the range for the GUID
  // rather than assuming a fixed tag.
  let bakongAccountId = '';
  for (let tag = 26; tag <= 51; tag++) {
    const key = String(tag).padStart(2, '0');
    const value = tags[key];
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
    throw new Error(
      'No Bakong account found in that QR. Upload the KHQR from your Bakong ' +
        'merchant or business account.',
    );
  }

  const merchantName = tags['59']?.trim();
  if (!merchantName) {
    throw new Error('Malformed QR: no merchant name (tag 59).');
  }

  return {
    bakongAccountId,
    merchantName,
    merchantCity: tags['60']?.trim() || 'Phnom Penh',
    merchantCategoryCode: tags['52']?.trim() || '6012',
    pointOfInitiation: tags['01'] || '11',
    amount: tags['54'],
    currency: tags['53'] ? CURRENCY_FROM_NUMERIC[tags['53']] : undefined,
    countryCode: tags['58'],
  };
}
