import { inflateRawSync } from 'node:zlib';

/**
 * The first worksheet of an .xlsx file as rows of text cells — just enough to
 * read a bank's transaction export (D-163).
 *
 * Deliberately not the `xlsx` package's reader: the published 0.18.x parser
 * has known prototype-pollution and ReDoS issues with crafted workbooks, and a
 * statement upload is untrusted input. This reads only what a statement
 * needs — shared strings, inline strings and values of one sheet — from the
 * ZIP container with bounded inflation, and ignores everything else
 * (formulas' text, styles, macros, external links).
 */

export interface SheetRow {
  /** 1-based row number in the sheet. */
  lineNo: number;
  cells: string[];
}

export interface XlsxLimits {
  /** Largest uncompressed part read. */
  maxPartBytes: number;
  /** Most rows returned. */
  maxRows: number;
}

const SIG_EOCD = 0x06054b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_LOCAL = 0x04034b50;

interface Entry {
  name: string;
  method: number;
  compressedSize: number;
  size: number;
  offset: number;
}

function entries(buf: Buffer): Map<string, Entry> {
  // The end-of-central-directory record is in the last 64 KiB + 22 bytes.
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65_557); i--)
    if (buf.readUInt32LE(i) === SIG_EOCD) {
      eocd = i;
      break;
    }
  if (eocd < 0) throw new Error('Not an .xlsx file (no ZIP directory).');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const out = new Map<string, Entry>();
  for (let n = 0; n < count; n++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== SIG_CENTRAL)
      throw new Error('The .xlsx file is damaged (central directory).');
    const method = buf.readUInt16LE(p + 10);
    const compressedSize = buf.readUInt32LE(p + 20);
    const size = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const offset = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    out.set(name, { name, method, compressedSize, size, offset });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

function part(
  buf: Buffer,
  all: Map<string, Entry>,
  name: string,
  limits: XlsxLimits,
): string | null {
  const e = all.get(name);
  if (!e) return null;
  if (e.size > limits.maxPartBytes)
    throw new Error(`The workbook part ${name} is too large.`);
  const h = e.offset;
  if (h + 30 > buf.length || buf.readUInt32LE(h) !== SIG_LOCAL)
    throw new Error('The .xlsx file is damaged (local header).');
  const start = h + 30 + buf.readUInt16LE(h + 26) + buf.readUInt16LE(h + 28);
  const data = buf.subarray(start, start + e.compressedSize);
  if (e.method === 0) return data.toString('utf8');
  if (e.method !== 8)
    throw new Error('The .xlsx file uses an unsupported compression.');
  return inflateRawSync(data, {
    maxOutputLength: limits.maxPartBytes,
  }).toString('utf8');
}

const ENTITY: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
};
function unescapeXml(s: string): string {
  return s.replace(/&(#x[0-9a-fA-F]+|#\d+|[a-z]+);/g, (m, e: string) => {
    if (e.startsWith('#x'))
      return String.fromCodePoint(parseInt(e.slice(2), 16));
    if (e.startsWith('#'))
      return String.fromCodePoint(parseInt(e.slice(1), 10));
    return ENTITY[e] ?? m;
  });
}

/** All `<t>` text inside a fragment (rich text runs are joined). */
function texts(fragment: string): string {
  let out = '';
  for (const m of fragment.matchAll(/<t(?:\s[^>]*)?>([^<]*)<\/t>/g))
    out += unescapeXml(m[1]);
  return out;
}

function columnIndex(ref: string): number {
  const letters = /^[A-Z]+/.exec(ref)?.[0] ?? 'A';
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

/** The path of the workbook's first sheet, from workbook.xml and its relationships. */
function firstSheetPath(workbook: string | null, rels: string | null): string {
  const fallback = 'xl/worksheets/sheet1.xml';
  if (!workbook || !rels) return fallback;
  const sheet = /<sheet\b[^>]*\br:id="([^"]+)"/.exec(workbook);
  if (!sheet) return fallback;
  const rel = new RegExp(
    `<Relationship\\b[^>]*\\bId="${sheet[1].replace(/[^\w-]/g, '')}"[^>]*\\bTarget="([^"]+)"`,
  ).exec(rels);
  if (!rel) return fallback;
  const target = rel[1].replace(/^\//, '');
  return target.startsWith('xl/') ? target : `xl/${target}`;
}

/** Read the first worksheet of an .xlsx workbook as text rows. */
export function readXlsxRows(buf: Buffer, limits: XlsxLimits): SheetRow[] {
  const all = entries(buf);
  const shared: string[] = [];
  const sst = part(buf, all, 'xl/sharedStrings.xml', limits);
  if (sst)
    for (const m of sst.matchAll(/<si>([\s\S]*?)<\/si>/g))
      shared.push(texts(m[1]));
  const sheetPath = firstSheetPath(
    part(buf, all, 'xl/workbook.xml', limits),
    part(buf, all, 'xl/_rels/workbook.xml.rels', limits),
  );
  const sheet = part(buf, all, sheetPath, limits);
  if (!sheet) throw new Error('The workbook has no worksheet.');
  const rows: SheetRow[] = [];
  for (const rm of sheet.matchAll(/<row\b([^>]*)>([\s\S]*?)<\/row>/g)) {
    if (rows.length >= limits.maxRows) break;
    const r = /\br="(\d+)"/.exec(rm[1]);
    const lineNo = r ? Number(r[1]) : rows.length + 1;
    const cells: string[] = [];
    for (const cm of rm[2].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = cm[1];
      const body = cm[2] ?? '';
      const ref = /\br="([A-Z]+\d+)"/.exec(attrs)?.[1];
      const type = /\bt="(\w+)"/.exec(attrs)?.[1] ?? 'n';
      const v = /<v>([^<]*)<\/v>/.exec(body)?.[1];
      let text = '';
      if (type === 's') text = shared[Number(v)] ?? '';
      else if (type === 'inlineStr') text = texts(body);
      else if (v !== undefined) text = unescapeXml(v);
      const i = ref ? columnIndex(ref) : cells.length;
      if (i > 200) continue;
      while (cells.length < i) cells.push('');
      cells[i] = text.trim();
    }
    rows.push({ lineNo, cells });
  }
  return rows;
}
