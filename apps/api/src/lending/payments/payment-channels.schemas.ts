import { z } from 'zod';

const money = z
  .string()
  .regex(/^\d+(\.\d{1,4})?$/, 'amount must be a decimal string');
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'dates are YYYY-MM-DD');
const currency = z.string().regex(/^[A-Z]{3}$/, 'an ISO 4217 code');
/** A CSV file as text; 2 MB is far above the 5,000-line limit. */
const content = z.string().min(1).max(2_000_000);
const fileName = z.string().min(1).max(200);

/** Request bodies of the payment-channel routes (UC-16, UC-18, UC-19, UC-21). */
export const PC = {
  settings: z
    .object({
      fxSpreadBps: z.number().int().min(0).max(1000),
      fxMaxRateAgeDays: z.number().int().min(0).max(31),
      autoDebitMaxAttempts: z.number().int().min(1).max(10),
      autoDebitRetryDays: z.number().int().min(1).max(31),
    })
    .strict(),
  mandate: z
    .object({
      mandateReference: z.string().min(3).max(64),
      bankCode: z.string().min(2).max(32),
      accountNumber: z
        .string()
        .regex(/^[0-9A-Za-z-]{4,34}$/, 'letters, digits and dashes only'),
      accountName: z.string().min(2).max(120),
      consentDate: date,
    })
    .strict(),
  revokeMandate: z.object({ reason: z.string().min(3).max(500) }).strict(),
  settlementFile: z
    .object({
      channel: z.enum(['MOBILE', 'QR', 'WALLET', 'AGENT']),
      fileName,
      content,
    })
    .strict(),
  payrollFile: z
    .object({
      employer: z.string().min(2).max(80),
      period: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'YYYY-MM'),
      currency,
      valueDate: date,
      fileName,
      content,
    })
    .strict(),
  fxRepayment: z
    .object({
      amount: money,
      currency,
      valueDate: date.optional(),
      externalReference: z.string().max(120).optional(),
      prepaymentStrategy: z.enum(['RECAST', 'SHORTEN']).optional(),
      applyExcessAs: z.enum(['ADVANCE', 'PREPAY']).optional(),
      payer: z
        .object({
          name: z.string().min(2).max(120),
          relationship: z.enum([
            'BORROWER',
            'GUARANTOR',
            'FAMILY',
            'EMPLOYER',
            'GROUP_MEMBER',
            'OTHER',
          ]),
          reference: z.string().max(120).optional(),
        })
        .strict()
        .optional(),
    })
    .strict(),
};

export type SettlementFileBody = z.infer<typeof PC.settlementFile>;
export type PayrollFileBody = z.infer<typeof PC.payrollFile>;
export type FxRepaymentBody = z.infer<typeof PC.fxRepayment>;
export type MandateBody = z.infer<typeof PC.mandate>;
export type SettingsBody = z.infer<typeof PC.settings>;
