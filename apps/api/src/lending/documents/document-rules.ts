import { lending } from '@microloan/shared';
import { operationalConfig } from '../../config/operational-config';

/** Document categories of the customer library (DOC-1). */
export const DOCUMENT_CATEGORIES = [
  'KYC',
  'APPLICATION',
  'LOAN',
  'COLLATERAL',
  'AGREEMENT',
  'GENERATED',
  'OTHER',
] as const;
export type DocumentCategory = (typeof DOCUMENT_CATEGORIES)[number];

/**
 * Retention by category when a tenant has set no rule (DOC-7, DECISIONS D-020).
 * Years, counted from the later of the document's filing and the end of the
 * customer relationship (last loan closed, no open application).
 */
export const DEFAULT_RETENTION_YEARS: Record<DocumentCategory, number> = {
  KYC: 5,
  APPLICATION: 5,
  LOAN: 7,
  COLLATERAL: 7,
  AGREEMENT: 7,
  GENERATED: 7,
  OTHER: 5,
};

/** Reminder lead time before a document expires (DOC-6). */
export function expiryReminderDays(): number {
  // DOCUMENT_EXPIRY_REMINDER_DAYS (1..365, default 30), validated at boot.
  return operationalConfig().documents.expiryReminderDays;
}

export interface RetentionRuleRow {
  scope: string;
  code: string;
  retentionYears: number;
}

/** A TYPE rule beats a CATEGORY rule, which beats the built-in default. */
export function retentionYearsFor(
  doc: { category: string; typeCode: string },
  rules: RetentionRuleRow[],
): { years: number; source: string } {
  const type = rules.find((r) => r.scope === 'TYPE' && r.code === doc.typeCode);
  if (type) return { years: type.retentionYears, source: `type ${type.code}` };
  const cat = rules.find(
    (r) => r.scope === 'CATEGORY' && r.code === doc.category,
  );
  if (cat) return { years: cat.retentionYears, source: `category ${cat.code}` };
  return {
    years:
      DEFAULT_RETENTION_YEARS[doc.category as DocumentCategory] ??
      DEFAULT_RETENTION_YEARS.OTHER,
    source: 'default',
  };
}

/** `date` plus whole years (29 Feb rolls to 28 Feb). */
export function addYears(date: string, years: number): string {
  const [y, m, d] = date.split('-').map(Number);
  const ty = y + years;
  const last = new Date(Date.UTC(ty, m, 0)).getUTCDate();
  return `${ty}-${String(m).padStart(2, '0')}-${String(Math.min(d, last)).padStart(2, '0')}`;
}

/**
 * Checklist status of one required document, from the customer's library.
 * A document counts once uploaded and not rejected or expired; only an
 * accepted, unexpired one is final.
 */
export type ChecklistStatus =
  | 'ACCEPTED'
  | 'PENDING_REVIEW'
  | 'REJECTED'
  | 'EXPIRED'
  | 'REQUESTED'
  | 'MISSING';

export function checklistStatus(
  docs: {
    reviewStatus: string;
    expiresOn: Date | null;
  }[],
  today: string,
  requested: boolean,
): ChecklistStatus {
  const live = docs.filter(
    (d) =>
      !d.expiresOn ||
      lending.compareDates(d.expiresOn.toISOString().slice(0, 10), today) >= 0,
  );
  if (live.some((d) => ['ACCEPTED', 'NOT_REQUIRED'].includes(d.reviewStatus)))
    return 'ACCEPTED';
  if (live.some((d) => d.reviewStatus === 'PENDING_REVIEW'))
    return 'PENDING_REVIEW';
  if (docs.length && live.length < docs.length && !live.length)
    return 'EXPIRED';
  if (requested) return 'REQUESTED';
  if (docs.some((d) => d.reviewStatus === 'REJECTED')) return 'REJECTED';
  return 'MISSING';
}

/** Statuses that let a stage proceed (the item is present, maybe awaiting review). */
export const CHECKLIST_PRESENT: ChecklistStatus[] = [
  'ACCEPTED',
  'PENDING_REVIEW',
];

/** Escape text for the generated HTML letters. */
export function esc(v: string | number | null | undefined): string {
  return String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** A minimal, self-contained HTML letter (no scripts, no external assets). */
export function htmlLetter(
  title: string,
  sections: { heading?: string; rows?: [string, string][]; text?: string }[],
): Buffer {
  const body = sections
    .map((s) => {
      const h = s.heading ? `<h2>${esc(s.heading)}</h2>` : '';
      const t = s.text ? `<p>${esc(s.text)}</p>` : '';
      const rows = s.rows?.length
        ? `<table>${s.rows.map(([k, v]) => `<tr><th>${esc(k)}</th><td>${esc(v)}</td></tr>`).join('')}</table>`
        : '';
      return `<section>${h}${t}${rows}</section>`;
    })
    .join('\n');
  return Buffer.from(
    `<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title>` +
      `<style>body{font-family:sans-serif;max-width:720px;margin:24px auto;color:#1a1f36}` +
      `th{text-align:left;padding:4px 12px 4px 0;color:#697386;font-weight:600}td{padding:4px 0}` +
      `h1{font-size:20px}h2{font-size:15px;margin-top:20px}</style></head>` +
      `<body><h1>${esc(title)}</h1>\n${body}</body></html>`,
    'utf8',
  );
}
