/**
 * KHQR for the platform's own plan payments.
 *
 * The EMVCo/KHQR payload code itself (TLV, CRC, static and dynamic payloads,
 * parsing an uploaded code) lives in @microloan/shared (`lending/khqr.ts`),
 * shared with the lenders' static repayment codes (DECISIONS D-160). This
 * module keeps only what is platform-specific: the operator's merchant
 * account from the environment.
 *
 * Nothing here settles or verifies a payment — Bakong exposes no public
 * settlement API here, which is why a confirmed plan payment requires a
 * SUPERADMIN to acknowledge receipt out of band.
 */
import { lending } from '@microloan/shared';

export type KhqrMerchant = lending.KhqrMerchant;
export type KhqrRequest = lending.KhqrRequest;
export type ParsedKhqr = lending.ParsedKhqr;

export const crc16 = lending.crc16;
export const buildKhqrPayload = lending.buildKhqrPayload;
export const buildStaticKhqrPayload = lending.buildStaticKhqrPayload;
export const parseTlvBlock = lending.parseTlvBlock;
export const parseKhqrPayload = lending.parseKhqrPayload;

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
