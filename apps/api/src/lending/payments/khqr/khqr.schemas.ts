import { z } from 'zod';

const money = z
  .string()
  .regex(/^\d+(\.\d{1,4})?$/, 'amount must be a decimal string');
const currency = z.enum(['USD', 'KHR']);
/** When the transfer was made, as the payer's receipt shows it (ISO 8601). */
const paidAt = z
  .string()
  .datetime({ offset: true, message: 'paidAt is an ISO 8601 date-time' });
const bankRef = z.string().trim().min(1).max(120);
const screenshot = z
  .object({
    fileName: z.string().min(1).max(200),
    mimeType: z.enum(['image/png', 'image/jpeg', 'image/webp', 'application/pdf']),
    contentBase64: z.string().min(1).max(7_000_000),
  })
  .strict();

const receipt = {
  amount: money,
  currency,
  paidAt,
  bankRef,
  payerName: z.string().trim().max(120).optional(),
  payerAccount: z.string().trim().max(120).optional(),
  remark: z.string().trim().max(500).optional(),
  screenshot: screenshot.optional(),
};

/** Request bodies of the static KHQR routes (D-160…D-165). */
export const KQ = {
  /**
   * A proposed code: generated from the Bakong account details, or read from
   * the image / payload the bank gave. With an image that cannot be read,
   * the image is kept with the details typed here.
   */
  proposeCode: z
    .object({
      currency,
      branchId: z.string().uuid().nullable().optional(),
      mode: z.enum(['GENERATE', 'UPLOAD']),
      bakongAccountId: z.string().trim().max(64).optional(),
      merchantName: z.string().trim().max(25).optional(),
      merchantCity: z.string().trim().max(15).optional(),
      merchantCategoryCode: z
        .string()
        .regex(/^\d{4}$/)
        .optional(),
      /** UPLOAD: the QR image (PNG/JPEG, base64 or data URI)… */
      image: z.string().max(4_000_000).optional(),
      /** …or the payload text. */
      payload: z.string().max(512).optional(),
      bankName: z.string().trim().max(80).optional(),
      accountNumber: z.string().trim().max(40).optional(),
      reason: z.string().trim().min(3).max(500),
    })
    .strict(),
  /** Read an upload without saving it, to show the operator what it says. */
  previewCode: z
    .object({
      currency,
      image: z.string().max(4_000_000).optional(),
      payload: z.string().max(512).optional(),
    })
    .strict(),
  decide: z
    .object({
      approve: z.boolean(),
      comment: z.string().trim().max(500).optional(),
    })
    .strict(),
  /** The borrower's "I have paid". */
  claim: z.object(receipt).strict(),
  /** Staff record a payment seen in the lender's bank app. */
  staffReceipt: z.object(receipt).strict(),
  verify: z
    .object({
      comment: z.string().trim().max(500).optional(),
      prepaymentStrategy: z.enum(['RECAST', 'SHORTEN']).optional(),
      applyExcessAs: z.enum(['ADVANCE', 'PREPAY']).optional(),
    })
    .strict(),
  reject: z.object({ reason: z.string().trim().min(3).max(500) }).strict(),
  statement: z
    .object({
      fileName: z.string().min(1).max(200),
      /** CSV as text… */
      content: z.string().min(1).max(3_000_000).optional(),
      /** …or a spreadsheet (XLSX) as base64. */
      contentBase64: z.string().min(1).max(4_000_000).optional(),
      mapping: z.string().regex(/^[A-Z][A-Z0-9_]{1,31}$/).default('GENERIC'),
      /** The currency of rows without a currency column. */
      currency: currency.optional(),
      /** Parse and match only; nothing is saved or posted. */
      dryRun: z.boolean().optional(),
    })
    .strict()
    .refine((b) => !!b.content !== !!b.contentBase64, 'send content (CSV) or contentBase64 (XLSX), not both'),
};

export type ProposeCodeBody = z.infer<typeof KQ.proposeCode>;
export type PreviewCodeBody = z.infer<typeof KQ.previewCode>;
export type DecideBody = z.infer<typeof KQ.decide>;
export type ReceiptBody = z.infer<typeof KQ.claim>;
export type VerifyBody = z.infer<typeof KQ.verify>;
export type StatementBody = z.infer<typeof KQ.statement>;
