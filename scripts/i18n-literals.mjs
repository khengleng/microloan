#!/usr/bin/env node
/**
 * Hard-coded UI text scan for the web portal (apps/web/src).
 *
 * Walks every .ts/.tsx file with the TypeScript compiler API and reports
 * user-facing English that bypasses next-intl (apps/web/messages/*.json):
 *
 *   - JSX text children with letters                 <p>Loan details</p>
 *   - text-bearing JSX attributes                    placeholder="Search…"
 *   - text-bearing object properties                 { label: 'Principal' }
 *   - arguments of toast / confirm / error setters   showToast('Saved')
 *   - English fallbacks after || / ??                msg || 'Failed to save'
 *   - thrown / constructed Error messages shown to users
 *
 * A literal is "user-facing" when it has a word and either a space or a
 * capitalised word (so codes like 'ACTIVE', 'USD', 'en-US' are not flagged).
 *
 * Intentional literals (brand names, ISO codes, the English-only public site,
 * sample placeholders such as an email address) live in
 * scripts/i18n-literals-allowlist.json as { file, text, reason } entries.
 *
 * Usage:
 *   node scripts/i18n-literals.mjs            report; exit 1 if any literal is not allow-listed
 *   node scripts/i18n-literals.mjs --report   report only, always exit 0
 *   node scripts/i18n-literals.mjs --json     machine-readable list
 *   node scripts/i18n-literals.mjs --all      ignore the allowlist (count everything)
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ts = require('typescript');

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'apps/web/src');
const ALLOWLIST = path.join(ROOT, 'scripts/i18n-literals-allowlist.json');

const args = new Set(process.argv.slice(2));
const reportOnly = args.has('--report');
const asJson = args.has('--json');
const ignoreAllowlist = args.has('--all');

// Directories that are deliberately English-only or not UI.
const SKIP_DIRS = [
    'apps/web/src/app/(site)', // public marketing / policy pages: English-only by design (own <html lang="en">)
    'apps/web/src/generated', // generated user guide
    'apps/web/src/app/api', // route handlers: no rendered UI (error bodies are machine-readable)
];
const SKIP_FILE = /\.(test|spec)\.(m?[jt]sx?)$|\.d\.ts$/;

const TEXT_ATTRS = new Set([
    'label', 'title', 'placeholder', 'aria-label', 'alt', 'description', 'subtitle', 'heading',
    'confirmLabel', 'cancelLabel', 'emptyText', 'emptyMessage', 'empty', 'hint', 'helper', 'helperText',
    'tooltip', 'caption', 'message', 'text', 'actionLabel', 'submitLabel', 'loadingText', 'error', 'note',
]);
const TEXT_PROPS = new Set([
    'label', 'title', 'placeholder', 'description', 'subtitle', 'heading', 'confirmLabel', 'cancelLabel',
    'emptyText', 'emptyMessage', 'hint', 'helper', 'helperText', 'tooltip', 'caption', 'message', 'body',
    'actionLabel', 'submitLabel', 'confirmText', 'cancelText', 'desc', 'header', 'sub', 'detail', 'details',
]);
const TEXT_CALLS = new Set([
    'showToast', 'toast', 'alert', 'confirm', 'setError', 'setMessage', 'setNotice', 'setSuccess', 'setInfo',
    'setStatusMessage', 'setFormError', 'setErr', 'setMsg', 'setWarning', 'notify', 'prompt',
]);

function userFacing(s) {
    const t = s.replace(/\s+/g, ' ').trim();
    if (!/[A-Za-z]{2,}/.test(t)) return false;
    if (/^(https?:|mailto:|tel:|\/|#|\.|@)/.test(t)) return false; // URLs, paths, selectors
    if (/^[\w.-]+@[\w.-]+$/.test(t)) return false; // email-shaped
    if (/^[a-z0-9_.:\-/[\]]+$/.test(t)) return false; // keys, codes, css-ish tokens
    if (/^[A-Z0-9_]+$/.test(t)) return false; // ENUM_CODES, ISO codes
    return /\s/.test(t) || /^[A-Z][a-z]/.test(t) || /[a-z]{3,}/.test(t);
}

function walk(dir, out) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        const rel = path.relative(ROOT, p).split(path.sep).join('/');
        if (SKIP_DIRS.some((d) => rel === d || rel.startsWith(d + '/'))) continue;
        if (e.isDirectory()) walk(p, out);
        else if (/\.(tsx?|mts)$/.test(e.name) && !SKIP_FILE.test(e.name)) out.push(p);
    }
    return out;
}

function literalText(node) {
    if (!node) return null;
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
    if (ts.isTemplateExpression(node)) {
        const parts = [node.head.text, ...node.templateSpans.map((s) => s.literal.text)];
        const joined = parts.join(' {…} ');
        return /[A-Za-z]{3,}/.test(parts.join(' ')) ? joined : null;
    }
    return null;
}

function nameOf(n) {
    if (!n) return '';
    if (ts.isIdentifier(n) || ts.isPrivateIdentifier(n)) return n.text;
    if (ts.isStringLiteral(n)) return n.text;
    if (ts.isPropertyAccessExpression(n)) return n.name.text;
    return '';
}

function inConsoleOrIgnored(node) {
    for (let p = node.parent; p; p = p.parent) {
        if (ts.isCallExpression(p)) {
            const callee = p.expression;
            if (ts.isPropertyAccessExpression(callee) && nameOf(callee.expression) === 'console') return true;
            const n = nameOf(callee);
            // translator calls, class helpers and test ids are never UI text
            if (['t', 'cn', 'clsx', 'cva', 'useTranslations', 'getTranslations', 'require', 'import'].includes(n)) return true;
        }
        if (ts.isImportDeclaration(p) || ts.isExportDeclaration(p)) return true;
    }
    return false;
}

function scanFile(file) {
    const src = fs.readFileSync(file, 'utf8');
    const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, file.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    const rel = path.relative(ROOT, file).split(path.sep).join('/');
    const found = [];
    const add = (node, kind, text) => {
        const clean = text.replace(/\s+/g, ' ').trim();
        if (!userFacing(clean)) return;
        if (inConsoleOrIgnored(node)) return;
        const { line, character } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
        found.push({ file: rel, line: line + 1, col: character + 1, kind, text: clean });
    };

    const visit = (node) => {
        if (ts.isJsxText(node)) {
            add(node, 'jsx-text', node.text);
        } else if (ts.isJsxAttribute(node)) {
            const n = nameOf(node.name);
            if (TEXT_ATTRS.has(n) && node.initializer) {
                let init = node.initializer;
                if (ts.isJsxExpression(init)) init = init.expression;
                const text = literalText(init);
                if (text != null) add(node, `attr:${n}`, text);
                else if (init && ts.isConditionalExpression(init)) {
                    for (const branch of [init.whenTrue, init.whenFalse]) {
                        const bt = literalText(branch);
                        if (bt != null) add(branch, `attr:${n}`, bt);
                    }
                }
            }
        } else if (ts.isJsxExpression(node) && node.expression && node.parent && (ts.isJsxElement(node.parent) || ts.isJsxFragment(node.parent))) {
            // {'Some text'} or {cond ? 'Yes' : 'No'} rendered as a child
            const e = node.expression;
            const text = literalText(e);
            if (text != null) add(e, 'jsx-expr', text);
            else if (ts.isConditionalExpression(e)) {
                for (const branch of [e.whenTrue, e.whenFalse]) {
                    const bt = literalText(branch);
                    if (bt != null) add(branch, 'jsx-expr', bt);
                }
            } else if (ts.isBinaryExpression(e) && (e.operatorToken.kind === ts.SyntaxKind.BarBarToken || e.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken || e.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken)) {
                const bt = literalText(e.right);
                if (bt != null) add(e.right, 'jsx-expr', bt);
            }
        } else if (ts.isPropertyAssignment(node)) {
            const n = nameOf(node.name);
            if (TEXT_PROPS.has(n)) {
                const text = literalText(node.initializer);
                if (text != null) add(node.initializer, `prop:${n}`, text);
            }
        } else if (ts.isCallExpression(node) || ts.isNewExpression(node)) {
            const n = nameOf(node.expression);
            const isErr = ts.isNewExpression(node) && n === 'Error';
            if (TEXT_CALLS.has(n) || isErr) {
                for (const a of node.arguments || []) {
                    const text = literalText(a);
                    if (text != null) add(a, isErr ? 'error' : `call:${n}`, text);
                    else if (ts.isBinaryExpression(a)) {
                        const bt = literalText(a.right);
                        if (bt != null) add(a.right, `call:${n}`, bt);
                    } else if (ts.isConditionalExpression(a)) {
                        for (const branch of [a.whenTrue, a.whenFalse]) {
                            const bt = literalText(branch);
                            if (bt != null) add(branch, `call:${n}`, bt);
                        }
                    }
                }
            }
        } else if (ts.isBinaryExpression(node) && (node.operatorToken.kind === ts.SyntaxKind.BarBarToken || node.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken)) {
            // `err.response?.data?.message || 'Failed to save'`
            const text = literalText(node.right);
            if (text != null && /^[A-Z]/.test(text.trim()) && /\s/.test(text.trim())) add(node.right, 'fallback', text);
        }
        ts.forEachChild(node, visit);
    };
    visit(sf);
    // de-duplicate (a fallback inside a call is reported once)
    const seen = new Set();
    return found.filter((f) => {
        const k = `${f.line}:${f.col}:${f.text}`;
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
    });
}

const files = walk(SRC, []).sort();
let all = files.flatMap(scanFile);

let allow = [];
if (fs.existsSync(ALLOWLIST)) allow = JSON.parse(fs.readFileSync(ALLOWLIST, 'utf8')).entries || [];
const allowed = (f) => allow.some((a) => (a.file === f.file || (a.file.endsWith('/**') && f.file.startsWith(a.file.slice(0, -2)))) && (a.text === '*' || a.text === f.text));
const unused = ignoreAllowlist ? [] : allow.filter((a) => a.text !== '*' && !all.some((f) => (a.file === f.file) && a.text === f.text));
const report = ignoreAllowlist ? all : all.filter((f) => !allowed(f));

if (asJson) {
    console.log(JSON.stringify(report, null, 2));
} else {
    for (const f of report) console.log(`${f.file}:${f.line}:${f.col}  [${f.kind}]  ${f.text}`);
    const byFile = new Set(report.map((f) => f.file));
    console.log(`\ni18n literal scan: ${report.length} hard-coded UI string(s) in ${byFile.size} file(s)` +
        (ignoreAllowlist ? ' (allowlist ignored)' : `; ${all.length - report.length} allow-listed`) + ` across ${files.length} scanned files.`);
    if (unused.length) console.log(`Stale allowlist entries (no longer found): ${unused.map((u) => `${u.file} "${u.text}"`).join('; ')}`);
}
if (!reportOnly && !asJson && report.length) {
    console.error('Move these strings into apps/web/messages/{en,km}.json, or allow-list an intentional literal in scripts/i18n-literals-allowlist.json with a reason.');
    process.exit(1);
}
