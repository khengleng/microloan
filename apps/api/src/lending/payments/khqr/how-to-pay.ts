import { readFileSync } from 'node:fs';
import PDFDocument from 'pdfkit';

/**
 * "How to pay" instructions for a loan repaid through the lender's static
 * KHQR code (D-160), in English and Khmer: the words shared by the printable
 * card, the statement, the key facts statement, notices and the Telegram bot.
 *
 * The rule a borrower must follow is the same everywhere: scan the code, type
 * the amount, and write the loan reference in the payment remark — that is
 * how the lender recognises the payment on its bank statement.
 */
export type PayLanguage = 'en' | 'km';

export interface PayCode {
  currency: string;
  merchantName: string;
  bakongAccountId: string;
  bankName: string | null;
  accountNumber: string | null;
}

const T = {
  en: {
    title: 'How to repay your loan',
    lender: 'Lender',
    borrower: 'Borrower',
    reference: 'Loan reference — write it in the payment remark',
    currency: 'Pay in',
    merchant: 'Pays to',
    bakong: 'Bakong account',
    bank: 'Bank',
    account: 'Account number',
    steps: (ref: string, currency: string) => [
      'Open any bank or wallet app that pays KHQR and scan this code.',
      `Type the amount you are paying, in ${currency}.`,
      `In the remark / note, write your loan reference: ${ref}`,
      'Keep the receipt. In the borrower portal press "I have paid" and enter the transaction reference (hash) from the receipt — or show the receipt to your loan officer.',
    ],
    credited:
      'Your payment is credited once the lender has checked it with its bank. A payment without the loan reference in the remark may take longer.',
    warning: (lender: string) =>
      `Only pay to this code. ${lender} staff will never ask you to pay into a personal account.`,
    noCode: (currency: string) =>
      `No KHQR code for ${currency} is set up yet — ask the lender how to pay.`,
    printed: 'Printed',
  },
  km: {
    title: 'របៀបសងប្រាក់កម្ចីរបស់អ្នក',
    lender: 'អ្នកផ្តល់កម្ចី',
    borrower: 'អ្នកខ្ចី',
    reference: 'លេខយោងកម្ចី — សូមសរសេរវានៅក្នុងចំណាំនៃការបង់ប្រាក់',
    currency: 'បង់ជា',
    merchant: 'បង់ទៅ',
    bakong: 'គណនីបាគង',
    bank: 'ធនាគារ',
    account: 'លេខគណនី',
    steps: (ref: string, currency: string) => [
      'បើកកម្មវិធីធនាគារ ឬកាបូបអេឡិចត្រូនិក ដែលអាចបង់តាម KHQR ហើយស្កេនកូដនេះ។',
      `បញ្ចូលចំនួនទឹកប្រាក់ដែលអ្នកបង់ ជា ${currency}។`,
      `នៅក្នុងចំណាំ (remark) សូមសរសេរលេខយោងកម្ចីរបស់អ្នក៖ ${ref}`,
      'រក្សាទុកបង្កាន់ដៃ។ នៅក្នុងវិបផតថលអ្នកខ្ចី ចុច "ខ្ញុំបានបង់ហើយ" ហើយបញ្ចូលលេខយោងប្រតិបត្តិការ (hash) ពីបង្កាន់ដៃ — ឬបង្ហាញបង្កាន់ដៃទៅមន្ត្រីឥណទានរបស់អ្នក។',
    ],
    credited:
      'ការបង់ប្រាក់របស់អ្នកនឹងត្រូវបានកត់ត្រា បន្ទាប់ពីអ្នកផ្តល់កម្ចីបានផ្ទៀងផ្ទាត់ជាមួយធនាគាររបស់ខ្លួន។ ការបង់ប្រាក់ដែលគ្មានលេខយោងកម្ចីនៅក្នុងចំណាំ អាចចំណាយពេលយូរជាងនេះ។',
    warning: (lender: string) =>
      `សូមបង់តែតាមកូដនេះប៉ុណ្ណោះ។ បុគ្គលិករបស់ ${lender} នឹងមិនសុំឱ្យអ្នកបង់ចូលគណនីផ្ទាល់ខ្លួនឡើយ។`,
    noCode: (currency: string) =>
      `មិនទាន់មានកូដ KHQR សម្រាប់ ${currency} នៅឡើយទេ — សូមសួរអ្នកផ្តល់កម្ចីពីរបៀបបង់ប្រាក់។`,
    printed: 'បោះពុម្ព',
  },
} as const;

/** The instructions as plain lines (statement, notices, chat). */
export function howToPayText(
  lang: PayLanguage,
  input: {
    lender: string;
    reference: string;
    currency: string;
    code: PayCode | null;
  },
): string[] {
  const t = T[lang];
  if (!input.code) return [t.noCode(input.currency)];
  const c = input.code;
  return [
    `${t.reference}: ${input.reference}`,
    `${t.merchant}: ${c.merchantName} (${t.bakong} ${c.bakongAccountId})${c.bankName ? ` — ${c.bankName}${c.accountNumber ? ` ${c.accountNumber}` : ''}` : ''}`,
    ...t.steps(input.reference, c.currency).map((s, i) => `${i + 1}. ${s}`),
    t.credited,
    t.warning(input.lender),
  ];
}

/** One short line for an SMS-style notice. */
export function howToPayShort(reference: string, code: PayCode | null): string {
  if (!code) return '';
  return `Pay with our KHQR (${code.merchantName}, Bakong ${code.bakongAccountId}) and write ${reference} in the remark.`;
}

// ── The printable card ──────────────────────────────────────────────────────

/** Kantumruy Pro (SIL OFL), as published by Fontsource: its Khmer and Latin subsets. (Noto Sans Khmer has empty mark anchors the PDF library's shaper cannot handle.) */
function font(subset: 'khmer' | 'latin', weight: 400 | 700): Buffer {
  return readFileSync(
    require.resolve(
      `@fontsource/kantumruy-pro/files/kantumruy-pro-${subset}-${weight}-normal.woff`,
    ),
  );
}

const KHMER = /[ក-៿᧠-᧿]/;

/**
 * Write a line that may mix Khmer and Latin text: each run in the subset that
 * has its glyphs (pdfkit draws one font at a time).
 */
function mixed(
  doc: PDFKit.PDFDocument,
  text: string,
  bold: boolean,
  size: number,
  opts: PDFKit.Mixins.TextOptions = {},
) {
  const runs: { khmer: boolean; text: string }[] = [];
  for (const ch of text) {
    const khmer = KHMER.test(ch) || (ch === ' ' && runs.at(-1)?.khmer === true);
    const last = runs.at(-1);
    if (last && last.khmer === khmer) last.text += ch;
    else runs.push({ khmer, text: ch });
  }
  const fontOf = (r: { khmer: boolean }) =>
    `${r.khmer ? 'kh' : 'lt'}-${bold ? 700 : 400}`;
  doc.fontSize(size);
  if (opts.align === 'center' || opts.align === 'right') {
    // A short centred line: pdfkit cannot align text continued across fonts,
    // so the runs are measured and placed one after another.
    const left = doc.page.margins.left;
    const avail = opts.width ?? doc.page.width - left - doc.page.margins.right;
    const widths = runs.map((r) => doc.font(fontOf(r)).widthOfString(r.text));
    const total = widths.reduce((a, b) => a + b, 0);
    let x =
      left +
      Math.max(
        0,
        opts.align === 'center' ? (avail - total) / 2 : avail - total,
      );
    const y = doc.y;
    runs.forEach((r, i) => {
      doc.font(fontOf(r)).text(r.text, x, y, { lineBreak: false });
      x += widths[i];
    });
    doc.x = left;
    doc.y = y + doc.currentLineHeight(true);
    return;
  }
  runs.forEach((r, i) => {
    doc
      .font(fontOf(r))
      .text(r.text, { ...opts, continued: i < runs.length - 1 });
  });
}

export interface HowToPayCard {
  lender: string;
  borrower: string;
  reference: string;
  currency: string;
  code: PayCode | null;
  /** PNG of the code. */
  qr: Buffer | null;
  printedOn: string;
}

/** The printable "How to pay" card for one loan: one A5 page per language. */
export function howToPayPdf(
  card: HowToPayCard,
  langs: PayLanguage[],
): Promise<Buffer> {
  const doc = new PDFDocument({
    size: 'A5',
    margin: 36,
    info: { Title: `How to pay — ${card.reference}` },
  });
  for (const w of [400, 700] as const) {
    doc.registerFont(`kh-${w}`, font('khmer', w));
    doc.registerFont(`lt-${w}`, font('latin', w));
  }
  const chunks: Buffer[] = [];
  doc.on('data', (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve) =>
    doc.on('end', () => resolve(Buffer.concat(chunks))),
  );
  const width = doc.page.width - 72;
  langs.forEach((lang, page) => {
    const t = T[lang];
    if (page > 0) doc.addPage();
    doc.fillColor('#1A1F36');
    mixed(doc, t.title, true, 16);
    doc.moveDown(0.2);
    mixed(doc, `${t.lender}: ${card.lender}`, false, 9, { width });
    mixed(doc, `${t.borrower}: ${card.borrower}`, false, 9, { width });
    doc.moveDown(0.5);
    doc.fillColor('#697386');
    mixed(doc, t.reference, false, 8.5, { width });
    doc.fillColor('#1A1F36');
    mixed(doc, card.reference, true, 20, { width });
    doc.moveDown(0.4);
    if (!card.code || !card.qr) {
      mixed(doc, t.noCode(card.currency), true, 11, { width });
    } else {
      const size = 150;
      const top = doc.y;
      doc.image(card.qr, 36 + (width - size) / 2, top, {
        width: size,
        height: size,
      });
      doc.y = top + size + 6;
      const c = card.code;
      mixed(
        doc,
        `${t.currency} ${c.currency} · ${t.merchant}: ${c.merchantName}`,
        true,
        10,
        { width, align: 'center' },
      );
      mixed(doc, `${t.bakong}: ${c.bakongAccountId}`, false, 9, {
        width,
        align: 'center',
      });
      if (c.bankName)
        mixed(
          doc,
          `${t.bank}: ${c.bankName}${c.accountNumber ? ` · ${t.account}: ${c.accountNumber}` : ''}`,
          false,
          9,
          { width, align: 'center' },
        );
      doc.moveDown(0.6);
      t.steps(card.reference, c.currency).forEach((s, i) => {
        mixed(doc, `${i + 1}. ${s}`, false, 9.5, { width });
        doc.moveDown(0.2);
      });
      doc.moveDown(0.3);
      doc.fillColor('#697386');
      mixed(doc, t.credited, false, 8.5, { width });
      doc.moveDown(0.3);
      doc.fillColor('#B42318');
      mixed(doc, t.warning(card.lender), true, 8.5, { width });
    }
    doc.fillColor('#8792A2');
    mixed(doc, `${t.printed} ${card.printedOn}`, false, 7, {
      width,
      align: 'right',
    });
  });
  doc.end();
  return done;
}
