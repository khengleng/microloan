import { existsSync } from 'node:fs';
import { join } from 'node:path';
import PDFDocument from 'pdfkit';
import type { lending } from '@microloan/shared';

/**
 * The printable credit report (DECISIONS D-179): every heading in English
 * and Khmer, the figures as stored. Rendered from the stored report only, so
 * the same report always prints the same way. Khmer is set in Battambang
 * (SIL Open Font License, apps/api/assets/fonts — Noto Sans Khmer trips a
 * mark-positioning bug in pdfkit's font engine); if the font file is missing
 * the headings print in English only rather than as empty boxes.
 */
export interface CreditReportDocument {
  lender: string;
  reference: string;
  provider: string;
  purpose: string;
  requestedBy: string;
  requestedAt: string;
  applicationReference: string | null;
  content: StoredCreditReport;
}

/** The report as stored in CreditReport.content. */
export type StoredCreditReport = lending.CreditReportBody & {
  provider: string;
  score: lending.BureauScore & {
    scorecard: { code: string; version: number; source: string };
  };
};

const KHMER_FONT = join(
  __dirname,
  '..',
  '..',
  '..',
  'assets',
  'fonts',
  'Battambang-Regular.ttf',
);

/** Headings: English, Khmer. */
const H = {
  title: ['Credit report', 'របាយការណ៍ឥណទាន'],
  subject: ['Borrower', 'អ្នកខ្ចី'],
  score: ['Bureau score', 'ពិន្ទុឥណទាន'],
  reasons: ['Main reasons', 'មូលហេតុសំខាន់ៗ'],
  summary: ['Summary', 'សេចក្តីសង្ខេប'],
  facilities: ['Credit facilities', 'គណនីឥណទាន'],
  history: ['Payment history (24 months)', 'ប្រវត្តិការសងប្រាក់ (២៤ ខែ)'],
  guarantees: ['Guarantees given', 'ការធានាដែលបានផ្តល់'],
  enquiries: ['Enquiries (12 months)', 'ការសាកសួរ (១២ ខែ)'],
  legend: ['Payment status codes', 'កូដស្ថានភាពការសង'],
} as const;

type Heading = keyof typeof H;

export function renderCreditReportPdf(
  doc: CreditReportDocument,
): Promise<Buffer> {
  const pdf = new PDFDocument({ margin: 36, size: 'A4' });
  const chunks: Buffer[] = [];
  pdf.on('data', (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve) =>
    pdf.on('end', () => resolve(Buffer.concat(chunks))),
  );
  const khmer = existsSync(KHMER_FONT);
  if (khmer) pdf.registerFont('khmer', KHMER_FONT);
  const r = doc.content;
  const width = pdf.page.width - 72;

  const heading = (h: Heading, size = 12) => {
    pdf.moveDown(0.6);
    pdf.font('Helvetica-Bold').fontSize(size).fillColor('#1A1F36');
    pdf.text(H[h][0], { continued: khmer });
    if (khmer)
      pdf
        .font('khmer')
        .fontSize(size - 1)
        .fillColor('#4F566B')
        .text(`   ${H[h][1]}`);
    pdf.moveDown(0.2);
    pdf.font('Helvetica').fontSize(9).fillColor('#1A1F36');
  };
  const line = (label: string, value: string) => {
    pdf.font('Helvetica-Bold').text(`${label}: `, { continued: true });
    pdf.font('Helvetica').text(value);
  };

  heading('title', 18);
  pdf.text(doc.lender);
  line(
    'Report',
    `${doc.reference}  ·  as of ${r.asOf}  ·  provider ${doc.provider}`,
  );
  line(
    'Purpose',
    `${doc.purpose}${doc.applicationReference ? ` (application ${doc.applicationReference})` : ''}`,
  );
  line('Requested', `${doc.requestedAt} by ${doc.requestedBy}`);

  heading('subject');
  const s = r.subject;
  line('Name', s.name);
  line('Date of birth', s.dateOfBirth ?? '—');
  line('ID', `${s.idType ?? '—'} ${s.idNumberMasked ?? ''}`.trim());
  line('Phone', s.phoneMasked ?? '—');
  line('Occupation', s.occupation ?? '—');
  line('Branch', s.branch ?? '—');
  line('Customer since', s.customerSince);

  heading('score');
  const sc = r.score;
  if (sc.score === null) {
    pdf.font('Helvetica-Bold').fontSize(14).text('No score');
    pdf
      .font('Helvetica')
      .fontSize(9)
      .text(`${sc.noScoreReason}: ${sc.message}`);
  } else {
    pdf
      .font('Helvetica-Bold')
      .fontSize(20)
      .text(`${sc.score}`, { continued: true });
    pdf
      .fontSize(11)
      .text(
        `   grade ${sc.grade}${sc.gradeLabel ? ` (${sc.gradeLabel})` : ''}`,
      );
    pdf.font('Helvetica').fontSize(9).moveDown(0.4);
  }
  pdf
    .fillColor('#697386')
    .text(
      `Scorecard ${sc.scorecard.code} ${sc.scorecard.version === 0 ? 'template' : `v${sc.scorecard.version}`}`,
    );
  pdf.fillColor('#1A1F36');
  if (sc.adverseReasons.length) {
    heading('reasons', 10);
    for (const a of sc.adverseReasons) pdf.text(`• ${a.text} (${a.code})`);
  }

  heading('summary');
  const t = r.totals;
  const amounts = (xs: { currency: string; amount: string }[]) =>
    xs.length ? xs.map((x) => `${x.amount} ${x.currency}`).join(', ') : '0';
  line('Active facilities', String(t.activeFacilities));
  line('Closed facilities', String(t.closedFacilities));
  line('Written off', String(t.writtenOffFacilities));
  line('Total exposure', amounts(t.exposure));
  line('Monthly obligation', amounts(t.monthlyObligation));
  line('Lenders reporting', String(t.lenders));

  heading('facilities');
  if (!r.facilities.length) pdf.text('No credit facility on record.');
  for (const f of r.facilities) {
    if (pdf.y > pdf.page.height - 140) pdf.addPage();
    pdf
      .font('Helvetica-Bold')
      .text(
        `${f.reference}  ·  ${f.product}  ·  ${f.kind.replace(/_/g, ' ').toLowerCase()}${f.source === 'LEGACY' ? '  ·  legacy archive' : ''}`,
      );
    pdf
      .font('Helvetica')
      .text(
        [
          `Status ${f.status}`,
          `opened ${f.openedOn ?? '—'}`,
          f.closedOn ? `closed ${f.closedOn}` : null,
          f.limit
            ? `limit ${f.limit} ${f.currency}`
            : `principal ${f.principal} ${f.currency}`,
          `balance ${f.balance} ${f.currency}`,
          f.instalment ? `instalment ${f.instalment}` : null,
          `DPD now ${f.currentDpd}, worst ${f.worstDpd} (12m ${f.worstDpd12m}, 24m ${f.worstDpd24m})`,
          f.writtenOff ? 'WRITTEN OFF' : null,
          f.restructured ? 'RESTRUCTURED' : null,
          f.settled ? 'SETTLED' : null,
          f.transferredTo ? `moved to ${f.transferredTo}` : null,
        ]
          .filter(Boolean)
          .join('  ·  '),
        { width },
      );
    grid(pdf, r.months, f.history, width);
    pdf.moveDown(0.4);
  }

  heading('guarantees');
  if (!r.guarantees.length) pdf.text('None.');
  for (const g of r.guarantees)
    pdf.text(
      `${g.givenOn}  ${g.type.toLowerCase()} guarantee of ${g.amount} ${g.currency} for ${g.principalBorrower} (application ${g.applicationReference}, ${g.applicationStatus.toLowerCase()})${g.loan ? `; loan ${g.loan.reference} ${g.loan.status.toLowerCase()}, ${g.loan.daysPastDue} days past due` : ''}`,
      { width },
    );

  heading('enquiries');
  if (!r.enquiries.length) pdf.text('None.');
  for (const e of r.enquiries)
    pdf.text(
      `${e.date}  ${e.type === 'APPLICATION' ? 'Application' : 'Report pulled'}  ${e.reference}  ${e.purpose}${e.current ? '  (this application)' : ''}`,
    );

  heading('legend', 10);
  pdf.text(
    '0 current · 1 = 1–29 days past due · 2 = 30–59 · 3 = 60–89 · 4 = 90–119 · 5 = 120–149 · 6 = 150 or more · W written off · R restructured · C closed · blank: no account that month.',
    { width },
  );
  pdf.moveDown(0.8);
  pdf
    .fontSize(7)
    .fillColor('#697386')
    .text(
      `Built from ${doc.lender}'s own records only (lending loans, credit lines, cards and its legacy loan archive). It is not a Credit Bureau Cambodia report and includes no other lender's data.`,
      { width },
    );
  pdf.end();
  return done;
}

/** One facility's 24 months: month labels above, codes below. */
function grid(
  pdf: PDFKit.PDFDocument,
  months: string[],
  history: lending.PaymentMonth[],
  width: number,
) {
  const cell = Math.floor(width / months.length);
  const x0 = pdf.page.margins.left;
  const y = pdf.y + 2;
  pdf.fontSize(6).fillColor('#697386');
  months.forEach((m, i) =>
    pdf.text(`${m.slice(5)}/${m.slice(2, 4)}`, x0 + i * cell, y, {
      width: cell,
      align: 'center',
      lineBreak: false,
    }),
  );
  pdf.fontSize(9).fillColor('#1A1F36');
  const codes = new Map(history.map((h) => [h.month, h.code]));
  months.forEach((m, i) => {
    const code = codes.get(m) ?? '';
    const bad = code !== '' && !['0', 'C'].includes(code);
    pdf
      .rect(x0 + i * cell, y + 9, cell - 1, 12)
      .fillAndStroke(bad ? '#FDECEC' : '#F7FAFC', '#E3E8EE');
    pdf
      .fillColor(bad ? '#B42318' : '#1A1F36')
      .text(code || ' ', x0 + i * cell, y + 11, {
        width: cell - 1,
        align: 'center',
        lineBreak: false,
      });
  });
  pdf.fillColor('#1A1F36').fontSize(9);
  pdf.x = x0;
  pdf.y = y + 26;
}
