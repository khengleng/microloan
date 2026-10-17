/**
 * Copies the template book to the target size.
 *
 * Every row a template loan owns — its application and decisions, borrower,
 * agreement versions, schedule, financial events, journal, accruals,
 * allocations, collection tasks, restructure case, audit trail, group or
 * facility — is found by following references from the loan, then written
 * out N times with fresh ids. Ids are remapped consistently everywhere they
 * appear (columns, idempotency keys, JSON), and human references that must be
 * unique get a copy suffix, so each copy is a loan the API could have written
 * itself, with a ledger that balances and reconciles exactly as its
 * template's does. Rows are streamed with COPY.
 */
import { createHash } from 'node:crypto';
import type { PrismaClient } from '@microloan/db';
import { copyIn } from './common';
import type { TemplateUnit } from './templates';

/** Configuration and reference data the book shares; never copied. */
const SHARED = new Set([
  'Tenant',
  'Branch',
  'User',
  'LendingProduct',
  'ProductVersion',
  'PricingConfiguration',
  'RepaymentConfiguration',
  'LedgerAccount',
  'TenantBusinessDate',
  'AccountingPeriod',
  'PeriodCloseLog',
  'AccessRole',
  'RolePermission',
  'RoleAssignment',
  'ApprovalAuthority',
  'Delegation',
  'AccessPolicy',
  'PolicyVersion',
  'FlagRule',
  'FlagChangeApproval',
  'CohortMembership',
  'ServiceAccount',
  'WorkflowVersion',
  'ImpairmentPolicy',
  'AffordabilityPolicy',
  'HolidayCalendar',
  'Holiday',
  'LendingPolicy',
  'LendingPolicyVersion',
  'PaymentChannelSettings',
  'PaymentHolidayProgramme',
  'DocumentRetentionRule',
  'ExchangeRate',
  'RateObservation',
  'Portfolio',
  'LegalEntity',
  'LedgerAccount',
  'OutboxMessage',
]);

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g;

/** Deterministic, well-formed v4-style id for copy `k` of `old`. */
export function cloneId(old: string, k: number): string {
  const h = createHash('sha1').update(`${old}#${k}`).digest('hex');
  const variant = ((parseInt(h[16], 16) & 0x3) | 0x8).toString(16);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-${variant}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

interface Column {
  name: string;
  type: string;
}

export async function cloneBook(
  db: PrismaClient,
  ownerUrl: string,
  tenantId: string,
  units: TemplateUnit[],
  target: number,
  log: (m: string) => void,
) {
  // ── Schema ────────────────────────────────────────────────────────────────
  const cols = await db.$queryRawUnsafe<
    { table_name: string; column_name: string; data_type: string }[]
  >(
    `SELECT table_name, column_name, data_type FROM information_schema.columns
     WHERE table_schema = 'public' ORDER BY table_name, ordinal_position`,
  );
  const tables = new Map<string, Column[]>();
  for (const c of cols) {
    if (!tables.has(c.table_name)) tables.set(c.table_name, []);
    tables.get(c.table_name)!.push({ name: c.column_name, type: c.data_type });
  }
  const candidates = [...tables.entries()].filter(
    ([t, cs]) =>
      !SHARED.has(t) &&
      !t.startsWith('_') &&
      cs.some((c) => c.name === 'id') &&
      cs.some((c) => c.name === 'tenantId'),
  );

  // ── Ownership: follow references from each loan to fixpoint ───────────────
  const owner = new Map<string, number>(); // id → unit index
  const parent = units.map((_, i) => i); // union-find over units
  const find = (i: number): number =>
    parent[i] === i ? i : (parent[i] = find(parent[i]));
  const loans = await db.$queryRawUnsafe<
    { id: string; agreementId: string; applicationId: string }[]
  >(
    `SELECT id, "agreementId", "applicationId" FROM "LoanAccount" WHERE id = ANY($1::text[])`,
    units.map((u) => u.loanId),
  );
  const byLoan = new Map(loans.map((l) => [l.id, l]));
  units.forEach((u, i) => {
    const l = byLoan.get(u.loanId)!;
    for (const id of [u.loanId, l.agreementId, l.applicationId, ...u.roots])
      owner.set(id, i);
  });
  const ownedRows = new Map<string, Set<string>>();
  // Semi-naive: each pass only follows references to ids found last pass.
  let frontier = [...owner.keys()];
  for (let pass = 0; ; pass++) {
    const found: string[] = [];
    const ids = frontier;
    for (const [table, cs] of candidates) {
      // Rows that are themselves roots (borrowers, groups, the loan).
      const self = await db.$queryRawUnsafe<{ id: string }[]>(
        `SELECT id FROM "${table}" WHERE "tenantId" = $1 AND id = ANY($2::text[])`,
        tenantId,
        ids,
      );
      for (const r of self) {
        if (!ownedRows.has(table)) ownedRows.set(table, new Set());
        ownedRows.get(table)!.add(r.id);
      }
      const refs = cs.filter((c) => c.name !== 'tenantId' && c.type === 'text');
      for (const c of refs) {
        const rows = await db.$queryRawUnsafe<{ id: string; ref: string }[]>(
          `SELECT id, "${c.name}" AS ref FROM "${table}"
           WHERE "tenantId" = $1 AND "${c.name}" = ANY($2::text[])`,
          tenantId,
          ids,
        );
        for (const r of rows) {
          const u = owner.get(r.ref)!;
          const have = owner.get(r.id);
          if (have === undefined) {
            owner.set(r.id, u);
            found.push(r.id);
          } else if (find(have) !== find(u)) parent[find(have)] = find(u);
          if (!ownedRows.has(table)) ownedRows.set(table, new Set());
          ownedRows.get(table)!.add(r.id);
        }
      }
    }
    if (!found.length) break;
    frontier = found;
    if (pass > 20) throw new Error('Ownership closure did not converge');
  }
  // Units joined by a shared row are copied together.
  const groups = new Map<number, number[]>();
  units.forEach((_, i) => {
    const r = find(i);
    if (!groups.has(r)) groups.set(r, []);
    groups.get(r)!.push(i);
  });
  if (groups.size !== units.length)
    log(`  ${units.length - groups.size} template(s) merged with another`);

  // ── Copies per unit, by weight ────────────────────────────────────────────
  const copies = target - units.length;
  if (copies < 0)
    throw new Error(
      `Target ${target} is below the ${units.length} template loans.`,
    );
  const unitCopies = new Map<number, number>();
  let assigned = 0;
  const roots = [...groups.keys()];
  const weightOf = (r: number) =>
    groups.get(r)!.reduce((s, i) => s + units[i].weight, 0);
  const totalWeight = roots.reduce((s, r) => s + weightOf(r), 0);
  for (const r of roots) {
    const n = Math.floor((copies * weightOf(r)) / totalWeight);
    unitCopies.set(r, n);
    assigned += n;
  }
  // Rounding remainder to the heaviest units.
  const byWeight = [...roots].sort((a, b) => weightOf(b) - weightOf(a));
  for (let i = 0; assigned < copies; i++, assigned++) {
    const r = byWeight[i % byWeight.length];
    unitCopies.set(r, unitCopies.get(r)! + 1);
  }

  // ── Unique indexes, to know which columns need a copy suffix ─────────────
  const uniques = await db.$queryRawUnsafe<{ table: string; cols: string[] }[]>(
    `SELECT t.relname AS table, array_agg(a.attname::text ORDER BY k.ord) AS cols
     FROM pg_index i
     JOIN pg_class t ON t.oid = i.indrelid
     JOIN pg_namespace n ON n.oid = t.relnamespace AND n.nspname = 'public'
     CROSS JOIN LATERAL unnest(i.indkey) WITH ORDINALITY AS k(attnum, ord)
     JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = k.attnum
     WHERE i.indisunique AND NOT i.indisprimary
     GROUP BY i.indexrelid, t.relname`,
  );

  // ── Stream the copies ─────────────────────────────────────────────────────
  let rowsWritten = 0;
  for (const [table, idSet] of ownedRows) {
    const cs = tables.get(table)!;
    const ids = [...idSet];
    const select = cs.map((c) => `"${c.name}"::text`).join(', ');
    const rows: (string | null)[][] = [];
    for (let i = 0; i < ids.length; i += 5000) {
      const part = await db.$queryRawUnsafe<{ r: (string | null)[] }[]>(
        `SELECT ARRAY[${select}] AS r FROM "${table}" WHERE id = ANY($1::text[])`,
        ids.slice(i, i + 5000),
      );
      rows.push(...part.map((p) => p.r));
    }
    const idIdx = cs.findIndex((c) => c.name === 'id');
    const textual = cs.map(
      (c) =>
        c.type === 'text' ||
        c.type === 'character varying' ||
        c.type === 'jsonb' ||
        c.type === 'json' ||
        c.type === 'ARRAY',
    );
    const suffixCols = uniques
      .filter((u) => u.table === table)
      .map((u) => u.cols.map((n) => cs.findIndex((c) => c.name === n)));
    const out = copyIn(
      ownerUrl,
      table,
      cs.map((c) => c.name),
    );
    let buf = '';
    for (const row of rows) {
      const unitRoot = find(owner.get(row[idIdx]!)!);
      const n = unitCopies.get(unitRoot) ?? 0;
      for (let k = 1; k <= n; k++) {
        const next = row.map((v, i) =>
          v === null || !textual[i]
            ? v
            : v.replace(UUID_RE, (m) => (owner.has(m) ? cloneId(m, k) : m)),
        );
        for (const idx of suffixCols) {
          if (idx.some((i) => i < 0)) continue;
          if (idx.some((i) => next[i] !== row[i])) continue;
          const at = idx.find(
            (i) => textual[i] && cs[i].name !== 'tenantId' && next[i] !== null,
          );
          if (at !== undefined) next[at] = `${next[at]}-C${k}`;
        }
        buf += next.map(copyField).join('\t') + '\n';
        if (buf.length > 1 << 20) {
          await out.write(buf);
          buf = '';
        }
        rowsWritten++;
      }
    }
    if (buf) await out.write(buf);
    await out.end();
    log(`  ${table}: ${rows.length} template rows copied`);
  }
  return {
    templates: units.length,
    copies,
    rowsWritten,
    unitCopies: [...unitCopies.entries()].map(([r, n]) => ({
      units: groups.get(r)!.map((i) => units[i].key),
      copies: n,
    })),
  };
}

function copyField(v: string | null): string {
  if (v === null) return '\\N';
  return v
    .replace(/\\/g, '\\\\')
    .replace(/\t/g, '\\t')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r');
}
