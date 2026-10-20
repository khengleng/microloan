/**
 * Message catalogue checks (apps/web/messages/{en,km}.json):
 *  - both locales have exactly the same keys;
 *  - every message parses with intl-messageformat in its own locale — an
 *    unescaped "{", a broken plural or a stray apostrophe fails here rather
 *    than as a raw key or a crash on the page;
 *  - the Khmer message uses the same arguments as the English one;
 *  - the product-configuration wizard (configSchema.ts keeps English labels as
 *    a fallback) has a translated label and hint for every field and step.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { IntlMessageFormat } from 'intl-messageformat';

// AST node types of @formatjs/icu-messageformat-parser (TYPE enum).
const TYPE = { argument: 1, number: 2, date: 3, time: 4, select: 5, plural: 6, tag: 8 };

const WEB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const load = (l) => JSON.parse(fs.readFileSync(path.join(WEB, 'messages', `${l}.json`), 'utf8'));
const en = load('en');
const km = load('km');

function flatten(obj, prefix = '', out = new Map()) {
    for (const [k, v] of Object.entries(obj)) {
        const key = prefix ? `${prefix}.${k}` : k;
        if (v !== null && typeof v === 'object') flatten(v, key, out);
        else out.set(key, v);
    }
    return out;
}
const EN = flatten(en);
const KM = flatten(km);

test('en and km have the same keys', () => {
    const onlyEn = [...EN.keys()].filter((k) => !KM.has(k));
    const onlyKm = [...KM.keys()].filter((k) => !EN.has(k));
    assert.deepEqual({ onlyEn, onlyKm }, { onlyEn: [], onlyKm: [] });
});

test('every value is a string', () => {
    const bad = [...EN, ...KM].filter(([, v]) => typeof v !== 'string').map(([k]) => k);
    assert.deepEqual(bad, []);
});

/** Argument names used by a parsed message (recursing into plural/select/tag bodies). */
function argNames(ast, out = new Set()) {
    for (const el of ast) {
        if (el.type === TYPE.argument || el.type === TYPE.number || el.type === TYPE.date || el.type === TYPE.time) out.add(el.value);
        if (el.type === TYPE.plural || el.type === TYPE.select) {
            out.add(el.value);
            for (const o of Object.values(el.options)) argNames(o.value, out);
        }
        if (el.type === TYPE.tag) {
            out.add(`<${el.value}>`);
            argNames(el.children, out);
        }
    }
    return out;
}

for (const [locale, messages] of [['en', EN], ['km', KM]]) {
    test(`every ${locale} message parses with intl-messageformat`, () => {
        const failures = [];
        for (const [key, msg] of messages) {
            try {
                new IntlMessageFormat(msg, locale);
            } catch (e) {
                failures.push(`${key}: ${e.message}`);
            }
        }
        assert.deepEqual(failures, []);
    });
}

test('km messages use the same arguments as en', () => {
    const mismatched = [];
    for (const [key, msg] of EN) {
        const other = KM.get(key);
        if (typeof msg !== 'string' || typeof other !== 'string') continue;
        let a, b;
        try {
            a = [...argNames(new IntlMessageFormat(msg, 'en').getAst())].sort();
            b = [...argNames(new IntlMessageFormat(other, 'km').getAst())].sort();
        } catch {
            continue; // reported by the parse tests
        }
        if (a.join() !== b.join()) mismatched.push(`${key}: en {${a}} km {${b}}`);
    }
    assert.deepEqual(mismatched, []);
});

test('the product configuration wizard is translated for every field and step', async () => {
    const { STEPS } = await import('./components/lending/products/configSchema.ts');
    const missing = [];
    for (const [locale, messages] of [['en', en], ['km', km]]) {
        const c = messages.LendingProducts.config;
        for (const s of STEPS) {
            if (!c.steps?.[s.key]?.label) missing.push(`${locale} steps.${s.key}.label`);
            if (s.note && !c.steps?.[s.key]?.note) missing.push(`${locale} steps.${s.key}.note`);
            for (const f of s.fields) {
                const k = f.path.replace(/\./g, '_');
                if (!c.fields?.[k]?.label) missing.push(`${locale} fields.${k}.label`);
                if (f.hint !== undefined && !c.fields?.[k]?.hint) missing.push(`${locale} fields.${k}.hint`);
            }
        }
    }
    assert.deepEqual(missing, []);
});
