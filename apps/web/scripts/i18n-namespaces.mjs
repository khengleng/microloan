#!/usr/bin/env node
/**
 * Which message namespaces does a route's client code use?
 *
 * Follows the static import graph (relative and "@/" imports) from a route's
 * entry files and collects the namespaces passed to useTranslations(...) /
 * getTranslations(...). src/i18n-namespaces.ts lists, per route segment, the
 * namespaces sent to the browser; src/i18n-namespaces.test.mjs uses this walk
 * to prove each list covers its route, so a new component that reads another
 * namespace fails the test instead of rendering raw keys.
 *
 *   node scripts/i18n-namespaces.mjs            print the namespaces per route
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const WEB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(WEB, 'src');
const EXT = ['.tsx', '.ts', '.mjs', '.js'];

function resolveImport(from, spec) {
    let base;
    if (spec.startsWith('@/')) base = path.join(SRC, spec.slice(2));
    else if (spec.startsWith('.')) base = path.resolve(path.dirname(from), spec);
    else return null; // packages: never call useTranslations themselves
    for (const c of [base, ...EXT.map((e) => base + e), ...EXT.map((e) => path.join(base, 'index' + e))]) {
        if (fs.existsSync(c) && fs.statSync(c).isFile()) return c;
    }
    return null;
}

const IMPORT_RE = /(?:import|export)\s+(?:type\s+)?(?:[^'"]*?\sfrom\s+)?['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)/g;
const NS_RE = /\b(?:useTranslations|getTranslations)\(\s*(?:\{\s*(?:locale\s*:\s*[^,}]+,\s*)?namespace\s*:\s*)?(['"`])([^'"`]*)\1/g;
const BARE_RE = /\b(?:useTranslations|getTranslations)\(\s*\)/;

/** Namespaces (top-level keys) reachable from the given entry files. `'*'` means "all" (a bare useTranslations()). */
export function namespacesFor(entries) {
    const seen = new Set();
    const ns = new Set();
    const stack = entries.map((e) => path.resolve(WEB, e));
    while (stack.length) {
        const f = stack.pop();
        if (seen.has(f)) continue;
        seen.add(f);
        const src = fs.readFileSync(f, 'utf8');
        if (/\.test\.|\.spec\./.test(f)) continue;
        for (const m of src.matchAll(NS_RE)) ns.add(m[2].split('.')[0]);
        if (BARE_RE.test(src)) ns.add('*');
        for (const m of src.matchAll(IMPORT_RE)) {
            if (/^\s*import\s+type\s/.test(m[0])) continue;
            const r = resolveImport(f, m[1] || m[2]);
            if (r) stack.push(r);
        }
    }
    return [...ns].sort();
}

/** Route segments whose client messages are trimmed, with their entry files (relative to apps/web). */
export const ROUTE_ENTRIES = {
    shell: ['src/app/[locale]/layout.tsx', 'src/app/[locale]/page.tsx'],
    login: ['src/app/[locale]/login'],
    register: ['src/app/[locale]/register'],
    'forgot-password': ['src/app/[locale]/forgot-password'],
    'reset-password': ['src/app/[locale]/reset-password'],
    signup: ['src/app/[locale]/signup'],
    portal: ['src/app/[locale]/portal'],
};

/** Every page/layout/template file under the given directories. */
export function routeFiles(entries) {
    const out = [];
    const walk = (p) => {
        const abs = path.resolve(WEB, p);
        if (fs.statSync(abs).isDirectory()) for (const e of fs.readdirSync(abs)) walk(path.join(abs, e));
        else if (/\.(tsx?|mjs)$/.test(abs) && !/\.(test|spec)\./.test(abs)) out.push(abs);
    };
    for (const e of entries) walk(e);
    return out;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    for (const [route, entries] of Object.entries(ROUTE_ENTRIES)) {
        console.log(route.padEnd(16), namespacesFor(routeFiles(entries)).join(', '));
    }
}
