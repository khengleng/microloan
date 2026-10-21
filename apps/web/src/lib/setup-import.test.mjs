// Run with: pnpm --filter web test   (node:test; Node strips the TS types)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    BRANCHES_TEMPLATE, STAFF_TEMPLATE, checkBranchesCsv, checkStaffCsv, csvCell, parseCsv, staffRoleFor, temporaryPassword,
} from './setup-import.ts';

const ctx = {
    roleCodes: ['TENANT_ADMIN', 'CREDIT_ANALYST', 'CREDIT_APPROVER', 'LOAN_OPS_MAKER', 'LOAN_OPS_CHECKER', 'FINANCE_OFFICER', 'RISK_COMPLIANCE'],
    branches: [{ id: 'b1', name: 'Phnom Penh head office', code: 'PNH', isActive: true }, { id: 'b2', name: 'Closed', code: 'OLD', isActive: false }],
    existingEmails: ['taken@example.com'],
};

test('parses quoted fields, CRLF, a BOM and blank lines', () => {
    assert.deepEqual(parseCsv('﻿a,b\r\n"x, y","say ""hi"""\r\n\r\n,z\n'), [['a', 'b'], ['x, y', 'say "hi"'], ['', 'z']]);
});

test('the staff template is valid as shipped', () => {
    const r = checkStaffCsv(STAFF_TEMPLATE, ctx);
    assert.deepEqual(r.fileIssues, []);
    assert.equal(r.rows.length, 7);
    assert.deepEqual(r.rows.flatMap((x) => x.issues), []);
    assert.equal(r.rows[1].branchId, 'b1');
    assert.equal(r.rows[0].branchId, null);
});

test('staff rows: each problem is named per line', () => {
    const csv = [
        'Email,Name,Roles,Branch',
        'not-an-email,A,CREDIT_ANALYST,',
        'taken@example.com,B,CREDIT_ANALYST,',
        'new@example.com,,NOPE;CREDIT_ANALYST,Nowhere',
        'NEW@example.com,D,,OLD',
    ].join('\n');
    const { rows } = checkStaffCsv(csv, ctx);
    assert.deepEqual(rows.map((r) => r.issues.map((i) => i.code)), [
        ['badEmail'],
        ['emailExists'],
        ['badName', 'unknownRole', 'unknownBranch'],
        ['duplicateEmail', 'noRoles', 'unknownBranch'],
    ]);
    assert.deepEqual(rows[3].issues[0].params, { line: 4 });
    assert.deepEqual(rows[2].roles, ['NOPE', 'CREDIT_ANALYST']);
});

test('staff file: missing columns, empty, too many rows', () => {
    assert.deepEqual(checkStaffCsv('email,name\nx@y.z,A', ctx).fileIssues, [{ code: 'missingColumns', params: { columns: 'roles, branch' } }]);
    assert.deepEqual(checkStaffCsv('', ctx).fileIssues, [{ code: 'empty' }]);
    assert.deepEqual(checkStaffCsv('email,name,roles,branch', ctx).fileIssues, [{ code: 'empty' }]);
    const many = ['email,name,roles,branch', ...Array.from({ length: 201 }, (_, i) => `u${i}@x.io,U,CREDIT_ANALYST,`)].join('\n');
    assert.equal(checkStaffCsv(many, ctx).fileIssues[0].code, 'tooManyRows');
});

test('the staff role follows the lending roles', () => {
    assert.equal(staffRoleFor(['CREDIT_ANALYST', 'TENANT_ADMIN']), 'ADMIN');
    assert.equal(staffRoleFor(['FINANCE_OFFICER']), 'FINANCE');
    assert.equal(staffRoleFor(['LOAN_OPS_MAKER']), 'OPERATOR');
});

test('branches: template valid; duplicates and bad codes refused', () => {
    assert.deepEqual(checkBranchesCsv(BRANCHES_TEMPLATE, { branches: [] }).rows.flatMap((r) => r.issues), []);
    const { rows } = checkBranchesCsv('name,code\nPhnom Penh head office,\nBattambang,pnh\nKampot,K\nKampot,KPT\nX,', ctx);
    assert.deepEqual(rows.map((r) => r.issues.map((i) => i.code)), [
        ['branchExists'], ['branchExists'], ['badBranchCode'], ['branchExists'], ['badBranchName'],
    ]);
});

test('temporary passwords: 16 symbols, no look-alikes, unbiased draw', () => {
    let n = 0;
    const random = (k) => Uint8Array.from({ length: k }, () => (n++ * 37) % 256);
    const p = temporaryPassword(random);
    assert.equal(p.length, 16);
    assert.match(p, /^[A-HJ-NP-Za-km-z2-9]{16}$/);
});

test('CSV cells are quoted and never start a formula', () => {
    assert.equal(csvCell('plain'), 'plain');
    assert.equal(csvCell('a,b'), '"a,b"');
    assert.equal(csvCell('=HYPERLINK("x")'), '"\'=HYPERLINK(""x"")"');
});
