/**
 * Go-live setup import helpers (D-175): the staff and branches CSV files a
 * new lender fills in, parsed and checked in the browser before anything is
 * sent. Nothing here creates anything: each valid row is then sent through
 * the normal screens' API calls one by one (POST /users, then
 * POST /lending/access/assignments; POST /lending/access/branches), so every
 * rule, approval and audit entry of those paths still applies.
 *
 * Pure functions, no imports: tested with node:test.
 */

export const STAFF_TEMPLATE = [
    'email,name,roles,branch',
    'sokha.admin@example.com,Sokha Chan,TENANT_ADMIN,',
    'dara.credit@example.com,Dara Keo,CREDIT_ANALYST,PNH',
    'vanna.approver@example.com,Vanna Lim,CREDIT_APPROVER,',
    'srey.ops@example.com,Srey Mom,LOAN_OPS_MAKER,PNH',
    'piseth.ops@example.com,Piseth Ou,LOAN_OPS_CHECKER,',
    'bopha.finance@example.com,Bopha Sok,FINANCE_OFFICER,',
    'rithy.risk@example.com,Rithy Hem,RISK_COMPLIANCE,',
].join('\n');

export const BRANCHES_TEMPLATE = ['name,code', 'Phnom Penh head office,PNH', 'Siem Reap,REP'].join('\n');

/** Most rows one file may carry (each row is one request after the other). */
export const MAX_IMPORT_ROWS = 200;

/** One CSV record per line; quoted fields may hold commas and doubled quotes. */
export function parseCsv(text: string): string[][] {
    const rows: string[][] = [];
    let row: string[] = [];
    let field = '';
    let quoted = false;
    const src = text.replace(/^﻿/, '');
    for (let i = 0; i < src.length; i++) {
        const c = src[i];
        if (quoted) {
            if (c === '"' && src[i + 1] === '"') { field += '"'; i++; }
            else if (c === '"') quoted = false;
            else field += c;
            continue;
        }
        if (c === '"' && field === '') quoted = true;
        else if (c === ',') { row.push(field); field = ''; }
        else if (c === '\n' || c === '\r') {
            if (c === '\r' && src[i + 1] === '\n') i++;
            row.push(field); field = '';
            rows.push(row); row = [];
        } else field += c;
    }
    if (field !== '' || row.length) { row.push(field); rows.push(row); }
    return rows.map((r) => r.map((x) => x.trim())).filter((r) => r.some((x) => x !== ''));
}

/** A problem with one row (or the file, line 0), as a code the page translates. */
export interface ImportIssue {
    code: string;
    params?: Record<string, string | number>;
}

export interface StaffRow {
    line: number;
    email: string;
    name: string;
    roles: string[];
    /** The branch the row names (code or name), resolved to its id; null: all branches. */
    branchId: string | null;
    branchLabel: string;
    /** The staff role the account is created with (Team page), derived from the lending roles. */
    staffRole: 'ADMIN' | 'FINANCE' | 'OPERATOR';
    issues: ImportIssue[];
}

export interface BranchRow {
    line: number;
    name: string;
    code: string | null;
    issues: ImportIssue[];
}

export interface ImportContext {
    /** Lending role codes the organisation has. */
    roleCodes: string[];
    branches: { id: string; name: string; code: string | null; isActive: boolean }[];
    /** E-mail addresses already registered (lower-case). */
    existingEmails: string[];
}

const EMAIL_RE = /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/;
const ROLE_RE = /^[A-Z][A-Z0-9_]{1,40}$/;
const BRANCH_CODE_RE = /^[A-Z0-9_-]{2,12}$/;

function header(rows: string[][], expected: string[]): ImportIssue | null {
    const got = (rows[0] ?? []).map((h) => h.toLowerCase());
    const missing = expected.filter((h) => !got.includes(h));
    return missing.length ? { code: 'missingColumns', params: { columns: missing.join(', ') } } : null;
}

/**
 * The staff role the account is created with: an administrator for
 * TENANT_ADMIN, finance for FINANCE_OFFICER, otherwise an operator. The
 * lending roles themselves are requested as assignments, which a second
 * administrator approves when the role is sensitive.
 */
export function staffRoleFor(roles: string[]): StaffRow['staffRole'] {
    if (roles.includes('TENANT_ADMIN')) return 'ADMIN';
    if (roles.includes('FINANCE_OFFICER')) return 'FINANCE';
    return 'OPERATOR';
}

export function checkStaffCsv(text: string, ctx: ImportContext): { rows: StaffRow[]; fileIssues: ImportIssue[] } {
    const all = parseCsv(text);
    const missing = header(all, ['email', 'name', 'roles', 'branch']);
    if (!all.length) return { rows: [], fileIssues: [{ code: 'empty' }] };
    if (missing) return { rows: [], fileIssues: [missing] };
    const cols = all[0].map((h) => h.toLowerCase());
    const at = (r: string[], name: string) => r[cols.indexOf(name)] ?? '';
    const body = all.slice(1);
    if (!body.length) return { rows: [], fileIssues: [{ code: 'empty' }] };
    if (body.length > MAX_IMPORT_ROWS) return { rows: [], fileIssues: [{ code: 'tooManyRows', params: { max: MAX_IMPORT_ROWS } }] };
    const known = new Set(ctx.roleCodes);
    const existing = new Set(ctx.existingEmails.map((e) => e.toLowerCase()));
    const seen = new Map<string, number>();
    const rows = body.map((r, i): StaffRow => {
        const line = i + 2;
        const issues: ImportIssue[] = [];
        const email = at(r, 'email').toLowerCase();
        const name = at(r, 'name');
        const roles = [...new Set(at(r, 'roles').split(/[;|]/).map((x) => x.trim().toUpperCase()).filter(Boolean))];
        const branchLabel = at(r, 'branch');
        if (!EMAIL_RE.test(email) || email.length > 160) issues.push({ code: 'badEmail' });
        else if (existing.has(email)) issues.push({ code: 'emailExists' });
        else if (seen.has(email)) issues.push({ code: 'duplicateEmail', params: { line: seen.get(email)! } });
        if (email) seen.set(email, seen.get(email) ?? line);
        if (!name || name.length > 120) issues.push({ code: 'badName' });
        if (!roles.length) issues.push({ code: 'noRoles' });
        for (const role of roles)
            if (!ROLE_RE.test(role) || !known.has(role)) issues.push({ code: 'unknownRole', params: { role } });
        let branchId: string | null = null;
        if (branchLabel) {
            const b = ctx.branches.find((x) => x.isActive && (x.code?.toUpperCase() === branchLabel.toUpperCase() || x.name.toLowerCase() === branchLabel.toLowerCase()));
            if (b) branchId = b.id;
            else issues.push({ code: 'unknownBranch', params: { branch: branchLabel } });
        }
        return { line, email, name, roles, branchId, branchLabel, staffRole: staffRoleFor(roles), issues };
    });
    return { rows, fileIssues: [] };
}

export function checkBranchesCsv(text: string, ctx: Pick<ImportContext, 'branches'>): { rows: BranchRow[]; fileIssues: ImportIssue[] } {
    const all = parseCsv(text);
    if (!all.length) return { rows: [], fileIssues: [{ code: 'empty' }] };
    const missing = header(all, ['name', 'code']);
    if (missing) return { rows: [], fileIssues: [missing] };
    const cols = all[0].map((h) => h.toLowerCase());
    const at = (r: string[], name: string) => r[cols.indexOf(name)] ?? '';
    const body = all.slice(1);
    if (!body.length) return { rows: [], fileIssues: [{ code: 'empty' }] };
    if (body.length > MAX_IMPORT_ROWS) return { rows: [], fileIssues: [{ code: 'tooManyRows', params: { max: MAX_IMPORT_ROWS } }] };
    const names = new Set(ctx.branches.map((b) => b.name.toLowerCase()));
    const codes = new Set(ctx.branches.map((b) => b.code?.toUpperCase()).filter(Boolean) as string[]);
    const seenNames = new Set<string>();
    const seenCodes = new Set<string>();
    const rows = body.map((r, i): BranchRow => {
        const line = i + 2;
        const issues: ImportIssue[] = [];
        const name = at(r, 'name');
        const code = at(r, 'code').toUpperCase() || null;
        if (name.length < 2 || name.length > 80) issues.push({ code: 'badBranchName' });
        else if (names.has(name.toLowerCase()) || seenNames.has(name.toLowerCase())) issues.push({ code: 'branchExists', params: { branch: name } });
        if (code && !BRANCH_CODE_RE.test(code)) issues.push({ code: 'badBranchCode' });
        else if (code && (codes.has(code) || seenCodes.has(code))) issues.push({ code: 'branchExists', params: { branch: code } });
        seenNames.add(name.toLowerCase());
        if (code) seenCodes.add(code);
        return { line, name, code, issues };
    });
    return { rows, fileIssues: [] };
}

/**
 * A temporary password for an imported account (the Team page asks the
 * administrator to type one; the import makes one per person). 16
 * characters from a 56-symbol alphabet without look-alikes, from the
 * browser's cryptographic generator.
 */
export function temporaryPassword(random: (n: number) => Uint8Array): string {
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
    const out: string[] = [];
    while (out.length < 16) {
        for (const b of random(32)) {
            // Rejection sampling keeps every symbol equally likely.
            if (b < 224 && out.length < 16) out.push(alphabet[b % alphabet.length]);
        }
    }
    return out.join('');
}

/** A CSV cell, quoted when it needs to be (and never read as a formula by a spreadsheet). */
export function csvCell(v: string): string {
    const safe = /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
    return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}
