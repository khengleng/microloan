#!/usr/bin/env node
/**
 * Configuration and in-process-state audit (docs/security/HARDCODING_AUDIT.md).
 *
 * Unlike the keyword scans in security-scan.mjs, these checks look at what the
 * production code actually does:
 *
 *   env-documented   every environment variable production code reads is
 *                    documented in .env.example
 *   literal-secret   credentials, private keys, tokens and credential-bearing
 *                    connection strings in string literals
 *   literal-url      URLs whose host is not a reserved name (localhost,
 *                    example.*, *.test) or a known vendor endpoint
 *   literal-email    e-mail addresses outside reserved domains
 *   literal-uuid     ids (tenant, user, branch …) written into code
 *   literal-phone    phone numbers written into code
 *   brand            the operator's names outside the files that hold their defaults
 *   ledger-code      postings to a literal account code or ACCOUNT_CODES.*
 *                    instead of the product / tenant account mapping
 *   rule-constant    named business-rule constants (MAX_*, *_DAYS, *_ATTEMPTS …)
 *                    in API services instead of configuration
 *   module-state     module-level `let` / `var`, or a module-level Map/Set/array
 *                    that the module mutates (API only)
 *   instance-state   class fields that hold mutable state: a Map/Set/array/object
 *                    initialiser, or a non-readonly flag/counter (API only)
 *   test-branch      NODE_ENV === 'test' outside a scheduler/timer entry point
 *   mock-unguarded   a Mock/Fake/Stub/Dummy class that is not flagged isMock and
 *                    refused in production
 *
 * Production code: apps/api/src, apps/web/src, packages/shared/src,
 * packages/db/src and the seeds in packages/db/prisma; tests are excluded.
 * Exceptions live in scripts/config-audit-allowlist.json, each with a reason
 * and an expiry. An entry that no longer matches anything fails the audit, so
 * the list cannot silently grow stale.
 *
 * Usage: node scripts/config-audit.mjs [--json]
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ts = require('typescript');

const root = process.cwd();
const ALLOWLIST_FILE = 'scripts/config-audit-allowlist.json';

const PRODUCTION_ROOTS = ['apps/api/src/', 'apps/web/src/', 'packages/shared/src/', 'packages/db/src/', 'packages/db/prisma/'];
const isTest = (f) =>
  /\.(spec|test|int-spec)\.tsx?$/.test(f) || f.includes('/__tests__/') || f.includes('/test/');

const files = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], { encoding: 'utf8' })
  .split('\n')
  .filter(Boolean)
  .filter((f) => PRODUCTION_ROOTS.some((r) => f.startsWith(r)))
  .filter((f) => /\.(ts|tsx|mjs|js)$/.test(f))
  .filter((f) => !isTest(f))
  .filter((f) => !f.includes('/migrations/'))
  .filter((f) => fs.existsSync(f));

const findings = [];
const add = (rule, file, line, match, message) => findings.push({ rule, file, line, match: String(match).slice(0, 160), message });

// ── Reserved and vendor hosts ────────────────────────────────────────────────
/** RFC 2606 / 6761 names: never a real deployment. */
const RESERVED_HOST = /(^|\.)(localhost|example|example\.(com|org|net)|test|invalid)$|^127\.0\.0\.1$|^0\.0\.0\.0$/i;
/**
 * Public vendor endpoints the code integrates with by contract: these are
 * protocol constants of a third-party API, not deployment configuration.
 */
const VENDOR_HOSTS = new Map([
  ['accounts.google.com', 'Google Identity Services (sign-in script, iframe and CSP)'],
  ['www.gstatic.com', 'Google Identity Services static assets (CSP)'],
  ['www.clarity.ms', 'Microsoft Clarity tag loader; the project id comes from NEXT_PUBLIC_CLARITY_PROJECT_ID'],
  ['api.resend.com', 'Resend e-mail API default; EMAIL_API_URL overrides it'],
  ['t.me', 'Telegram BotFather help link shown to administrators'],
  ['www.w3.org', 'XML/SVG namespace identifiers'],
]);

// ── Helpers ──────────────────────────────────────────────────────────────────
function lineOf(text, index) {
  let n = 1;
  for (let i = 0; i < index; i++) if (text.charCodeAt(i) === 10) n++;
  return n;
}

/** String-literal and template-literal text of a file, with positions. */
function stringLiterals(sf) {
  const out = [];
  const visit = (node) => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) out.push({ text: node.text, pos: node.getStart(sf) });
    else if (ts.isTemplateExpression(node)) {
      out.push({ text: node.head.text, pos: node.head.getStart(sf) });
      for (const span of node.templateSpans) out.push({ text: span.literal.text, pos: span.literal.getStart(sf) });
    } else if (ts.isJsxText(node)) out.push({ text: node.text, pos: node.getStart(sf) });
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}

// ── 1. Every env var read is documented ─────────────────────────────────────
const envExample = fs.readFileSync('.env.example', 'utf8') + '\n' + (fs.existsSync('packages/db/.env.example') ? fs.readFileSync('packages/db/.env.example', 'utf8') : '');
const documented = new Set([...envExample.matchAll(/(?:^|[\s#])([A-Z][A-Z0-9_]{2,})=/gm)].map((m) => m[1]));
/** Set by the platform or the runtime, never by an operator. */
const RUNTIME_ENV = new Set(['NODE_ENV']);
const envReads = new Map();
const ENV_READ = [
  /process\.env\.([A-Z][A-Z0-9_]+)/g,
  /process\.env\[['"]([A-Z][A-Z0-9_]+)['"]\]/g,
  /\benv\.([A-Z][A-Z0-9_]+)/g,
  /\benv(?:Int|String|Bool|Number|Duration|Url|Optional)\(\s*['"]([A-Z][A-Z0-9_]+)['"]/g,
];

// ── 2. Literal patterns ──────────────────────────────────────────────────────
const SECRET_PATTERNS = [
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, 'private key'],
  [/\bAKIA[0-9A-Z]{16}\b/, 'AWS access key id'],
  [/\b(sk|rk)_(live|test)_[0-9A-Za-z]{10,}/, 'Stripe secret key'],
  [/\bwhsec_[0-9A-Za-z]{10,}/, 'Stripe webhook secret'],
  [/\bxox[abprs]-[0-9A-Za-z-]{10,}/, 'Slack token'],
  [/\bgh[pousr]_[0-9A-Za-z]{30,}/, 'GitHub token'],
  [/\beyJ[0-9A-Za-z_-]{10,}\.eyJ[0-9A-Za-z_-]{10,}\./, 'JSON web token'],
  [/\b\d{8,10}:[0-9A-Za-z_-]{35}\b/, 'Telegram bot token'],
  [/\b(postgres(ql)?|mysql|mongodb(\+srv)?|redis|rediss|amqps?):\/\/[^\s'"`@/]+:[^\s'"`@/]+@/i, 'connection string with credentials'],
];
const ASSIGNED_SECRET = /\b(password|passwd|secret|token|api[_-]?key|private[_-]?key|pepper)\b["']?\s*[:=]\s*['"`]([^'"`\s<>${}]{8,})['"`]/i;
/** A secret-named variable or env var that falls back to a literal: `PASSWORD = env || 'x'`. */
const SECRET_FALLBACK = /[\w.]*(password|passwd|secret|secret_key|token|api_?key|pepper)(\?\.trim\(\)|\.trim\(\))?\s*(\|\||\?\?)\s*['"]([^'"\s]{4,})['"]/i;
const EMAIL = /[A-Za-z0-9._%+-]+@([A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,})/g;
const URL_RE = /\b(?:https?|wss?):\/\/([A-Za-z0-9.-]+)(?::\d+)?/g;
const UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/i;
const PHONE = /(?:\+855[\s-]?\d{2}[\s-]?\d{3}[\s-]?\d{3,4}|\b0[1-9]\d{7,8}\b)/;
/** The operator's own names: defaults live in operational-config.ts and lib/site.ts only. */
const BRAND = /\b(Magic ?Money|DBank|dbankcambodia)\b/i;

// ── 3. State and rule checks (TypeScript AST) ───────────────────────────────
const RULE_NAME = /^(MAX|MIN)_|_(DAYS|ATTEMPTS|TTL|TTL_MS|LIMIT|THRESHOLD|RETRIES|WINDOW_MS|TIMEOUT_MS|FAILURES)$|^(LIMIT|THRESHOLD)$/;
const MUTATORS = ['set', 'add', 'delete', 'clear', 'push', 'pop', 'shift', 'unshift', 'splice'];
const SCHEDULER_DECORATORS = new Set(['Cron', 'Interval', 'Timeout']);
const LIFECYCLE = new Set(['onModuleInit', 'onApplicationBootstrap', 'onModuleDestroy']);

function decoratorNames(node) {
  const decos = ts.canHaveDecorators?.(node) ? ts.getDecorators(node) ?? [] : node.decorators ?? [];
  return decos.map((d) => {
    const e = d.expression;
    if (ts.isCallExpression(e)) return e.expression.getText();
    return e.getText();
  });
}

function isMutableInitializer(init) {
  if (!init) return false;
  if (ts.isArrayLiteralExpression(init) || ts.isObjectLiteralExpression(init)) return true;
  if (ts.isNewExpression(init)) return /^(Map|Set|WeakMap|WeakSet|Array)$/.test(init.expression.getText());
  return false;
}
function isScalarInitializer(init) {
  if (!init) return false;
  return (
    init.kind === ts.SyntaxKind.TrueKeyword ||
    init.kind === ts.SyntaxKind.FalseKeyword ||
    init.kind === ts.SyntaxKind.NullKeyword ||
    ts.isNumericLiteral(init) ||
    (ts.isPrefixUnaryExpression(init) && ts.isNumericLiteral(init.operand))
  );
}

for (const file of files) {
  const text = fs.readFileSync(file, 'utf8');
  const isApi = file.startsWith('apps/api/src/');
  const kind = file.endsWith('.tsx') ? ts.ScriptKind.TSX : file.endsWith('.ts') ? ts.ScriptKind.TS : ts.ScriptKind.JS;
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, kind);

  // env reads
  for (const re of ENV_READ)
    for (const m of text.matchAll(re)) {
      if (!envReads.has(m[1])) envReads.set(m[1], `${file}:${lineOf(text, m.index)}`);
    }

  // literals (string content only, so comments and identifiers do not count)
  for (const lit of stringLiterals(sf)) {
    const line = lineOf(text, lit.pos);
    for (const [re, what] of SECRET_PATTERNS) if (re.test(lit.text)) add('literal-secret', file, line, lit.text, `${what} in a string literal`);
    for (const m of lit.text.matchAll(URL_RE)) {
      const host = m[1].toLowerCase();
      if (RESERVED_HOST.test(host) || VENDOR_HOSTS.has(host)) continue;
      add('literal-url', file, line, m[0], `URL to ${host}: read it from configuration`);
    }
    for (const m of lit.text.matchAll(EMAIL)) {
      const domain = m[1].toLowerCase();
      if (RESERVED_HOST.test(domain)) continue;
      add('literal-email', file, line, m[0], 'e-mail address: read it from configuration');
    }
    if (UUID.test(lit.text)) add('literal-uuid', file, line, lit.text, 'an id written into code');
    if (PHONE.test(lit.text)) add('literal-phone', file, line, lit.text, 'a phone number written into code');
    if (BRAND.test(lit.text)) add('brand', file, line, lit.text, "the operator's name: use PLATFORM_NAME / lib/site.ts");
  }
  // assigned secrets anywhere in code (key: 'value')
  text.split('\n').forEach((l, i) => {
    const m = ASSIGNED_SECRET.exec(l);
    if (m && !/^\s*(\/\/|\*)/.test(l)) add('literal-secret', file, i + 1, m[0], 'a credential assigned from a literal');
    const f = SECRET_FALLBACK.exec(l);
    if (f && !/^\s*(\/\/|\*)/.test(l)) add('literal-secret', file, i + 1, f[0], 'a credential that falls back to a literal when unset');
  });

  // ledger postings to literal codes
  if (isApi && !file.startsWith('apps/api/src/ledger/'))
    text.split('\n').forEach((l, i) => {
      if (/accountCode:\s*(ACCOUNT_CODES\.|['"`]\d)/.test(l))
        add('ledger-code', file, i + 1, l.trim(), 'posting to a fixed account: use the product accounting mapping or the tenant lending settings');
    });

  // AST checks
  const visit = (node) => {
    // test-only branches
    if (
      ts.isBinaryExpression(node) &&
      [ts.SyntaxKind.EqualsEqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsEqualsToken, ts.SyntaxKind.EqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsToken].includes(node.operatorToken.kind) &&
      /process\.env\.NODE_ENV/.test(node.getText()) &&
      /['"]test['"]/.test(node.getText())
    ) {
      let fn = node.parent;
      while (fn && !ts.isMethodDeclaration(fn) && !ts.isFunctionDeclaration(fn) && !ts.isConstructorDeclaration(fn)) fn = fn.parent;
      const name = fn?.name?.getText?.() ?? '';
      const decos = fn ? decoratorNames(fn) : [];
      const body = fn?.getText?.() ?? '';
      const ok = decos.some((d) => SCHEDULER_DECORATORS.has(d)) || LIFECYCLE.has(name) || /setInterval|setTimeout/.test(body);
      if (!ok) add('test-branch', file, lineOf(text, node.getStart(sf)), node.getText(), 'behaviour that differs under test outside a scheduler or timer entry point');
    }

    if (isApi) {
      // module level
      if (ts.isVariableStatement(node) && node.parent === sf) {
        const flags = node.declarationList.flags;
        const isLet = (flags & ts.NodeFlags.Let) !== 0;
        const isConst = (flags & ts.NodeFlags.Const) !== 0;
        for (const d of node.declarationList.declarations) {
          const name = d.name.getText();
          if (!isConst) add('module-state', file, lineOf(text, d.getStart(sf)), name, `module-level ${isLet ? 'let' : 'var'}: process-local state`);
          else if (isMutableInitializer(d.initializer)) {
            const mutated = MUTATORS.some((m) => text.includes(`${name}.${m}(`)) || new RegExp(`\\b${name}\\[[^\\]]+\\]\\s*=[^=]`).test(text);
            if (mutated) add('module-state', file, lineOf(text, d.getStart(sf)), name, 'module-level collection that is mutated: process-local state');
          } else if (ts.isNumericLiteral(d.initializer ?? {}) && RULE_NAME.test(name))
            add('rule-constant', file, lineOf(text, d.getStart(sf)), `${name} = ${d.initializer.getText()}`, 'a business or operational limit in code: product config, tenant settings or env');
        }
      }
      // class fields
      // Only classes the framework holds as singletons (decorated: services,
      // controllers, guards …) — a plain class instantiated per use, like an
      // accumulator, holds no state between requests.
      if (ts.isPropertyDeclaration(node) && ts.isClassLike(node.parent) && decoratorNames(node.parent).length) {
        const mods = (ts.getModifiers?.(node) ?? node.modifiers ?? []).map((m) => m.kind);
        const readonly = mods.includes(ts.SyntaxKind.ReadonlyKeyword);
        const isStatic = mods.includes(ts.SyntaxKind.StaticKeyword);
        const name = node.name.getText();
        const init = node.initializer;
        const cls = node.parent.name?.getText() ?? '<anonymous>';
        if (isMutableInitializer(init))
          add('instance-state', file, lineOf(text, node.getStart(sf)), `${cls}.${name}`, 'a class-level collection: shared only within one process');
        else if (!readonly && isScalarInitializer(init))
          add('instance-state', file, lineOf(text, node.getStart(sf)), `${cls}.${name}`, 'a mutable flag/counter on a service: holds only within one process');
        else if (isStatic && !readonly && init)
          add('instance-state', file, lineOf(text, node.getStart(sf)), `${cls}.${name}`, 'a mutable static field');
      }
      // mock classes
      if (ts.isClassDeclaration(node) && node.name && /^(Mock|Fake|Stub|Dummy)/.test(node.name.text)) {
        const body = node.getText();
        if (!/isMock\s*=\s*true/.test(body) || !/isMock\s*&&\s*this\.production/.test(text))
          add('mock-unguarded', file, lineOf(text, node.getStart(sf)), node.name.text, 'a mock that is not flagged isMock and refused in production');
      }
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(sf, visit);
}

for (const [name, where] of envReads) {
  if (RUNTIME_ENV.has(name) || documented.has(name)) continue;
  add('env-documented', where.split(':')[0], Number(where.split(':')[1]), name, `${name} is read but not documented in .env.example`);
}

// ── Allowlist ────────────────────────────────────────────────────────────────
const allowlist = JSON.parse(fs.readFileSync(ALLOWLIST_FILE, 'utf8'));
const today = new Date().toISOString().slice(0, 10);
const problems = [];
const used = new Set();
for (const [i, e] of allowlist.entries()) {
  for (const k of ['rule', 'file', 'match', 'reason', 'expires'])
    if (!e[k]) problems.push(`allowlist entry ${i}: missing "${k}"`);
  if (e.expires && e.expires < today) problems.push(`allowlist entry ${i} (${e.rule} ${e.file}) expired on ${e.expires}`);
}
const remaining = findings.filter((f) => {
  const idx = allowlist.findIndex(
    (e) => e.rule === f.rule && e.file === f.file && f.match.includes(e.match) && !(e.expires < today),
  );
  if (idx >= 0) used.add(idx);
  return idx < 0;
});
allowlist.forEach((e, i) => {
  if (!used.has(i)) problems.push(`allowlist entry ${i} (${e.rule} ${e.file} "${e.match}") matches nothing: remove it`);
});

if (process.argv.includes('--json')) {
  console.log(JSON.stringify({ findings: remaining, problems }, null, 2));
}
if (remaining.length || problems.length) {
  console.error(`Configuration audit failed: ${remaining.length} finding(s), ${problems.length} allowlist problem(s).`);
  for (const f of remaining) console.error(`  [${f.rule}] ${f.file}:${f.line}  ${f.match}\n      ${f.message}`);
  for (const p of problems) console.error(`  [allowlist] ${p}`);
  process.exit(1);
}
console.log(`Configuration audit passed (${files.length} files, ${findings.length} allowlisted exception(s), ${envReads.size} env vars documented).`);
