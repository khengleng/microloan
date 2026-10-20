/**
 * The public route segments send the browser only some message namespaces
 * (src/i18n-namespaces.ts). Walk each segment's import graph and check its
 * list covers every namespace its components read, so a component that starts
 * using another namespace fails here instead of showing raw keys.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { ROUTE_ENTRIES, WEB, namespacesFor, routeFiles } from '../scripts/i18n-namespaces.mjs';
import { ROUTE_NAMESPACES, SHELL_NAMESPACES, pickMessages } from './i18n-namespaces.ts';

const en = JSON.parse(fs.readFileSync(path.join(WEB, 'messages/en.json'), 'utf8'));

test('every trimmed route segment has a layout that uses RouteMessages', () => {
    for (const route of Object.keys(ROUTE_NAMESPACES)) {
        const layout = fs.readFileSync(path.join(WEB, `src/app/[locale]/${route}/layout.tsx`), 'utf8');
        assert.match(layout, new RegExp(`<RouteMessages route="${route}">`), route);
    }
});

test('the [locale] shell sends the namespaces its providers and the landing page read', () => {
    const used = namespacesFor(routeFiles(ROUTE_ENTRIES.shell));
    assert.ok(!used.includes('*'), 'a bare useTranslations() needs the whole catalogue');
    assert.deepEqual(used.filter((n) => !SHELL_NAMESPACES.includes(n)), []);
});

for (const [route, entries] of Object.entries(ROUTE_ENTRIES)) {
    if (route === 'shell') continue;
    test(`/${route} sends every namespace its components read`, () => {
        const used = namespacesFor(routeFiles(entries));
        assert.ok(!used.includes('*'), 'a bare useTranslations() needs the whole catalogue');
        const sent = new Set([...SHELL_NAMESPACES, ...ROUTE_NAMESPACES[route]]);
        assert.deepEqual(used.filter((n) => !sent.has(n)), []);
    });
}

test('every listed namespace exists', () => {
    const all = new Set([...SHELL_NAMESPACES, ...Object.values(ROUTE_NAMESPACES).flat()]);
    assert.deepEqual([...all].filter((n) => !(n in en)), []);
});

test('pickMessages keeps only the listed namespaces', () => {
    assert.deepEqual(pickMessages({ A: { x: '1' }, B: { y: '2' }, C: {} }, ['A', 'C', 'Missing']), { A: { x: '1' }, C: {} });
});
