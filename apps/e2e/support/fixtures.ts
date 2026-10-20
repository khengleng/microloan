import { test as base, expect, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { repoRoot } from './paths';

/**
 * Console noise that is not the app's fault, allowed explicitly. Everything
 * else logged at "error" level, and every uncaught page error (including a
 * React hydration mismatch, which production React reports as an error),
 * fails the test.
 */
const KNOWN_NOISE: RegExp[] = [
  // Chrome's own message for a refused or failed favicon / font prefetch.
  /favicon\.ico/i,
];

/** The message namespaces (apps/web/messages/en.json): a rendered `Namespace.key` is a missing message. */
const NAMESPACES: string[] = Object.keys(
  JSON.parse(fs.readFileSync(path.join(repoRoot, 'apps/web/messages/en.json'), 'utf8')),
);
const MESSAGES: Record<string, unknown> = {
  en: JSON.parse(fs.readFileSync(path.join(repoRoot, 'apps/web/messages/en.json'), 'utf8')),
  km: JSON.parse(fs.readFileSync(path.join(repoRoot, 'apps/web/messages/km.json'), 'utf8')),
};

/** A UI string as the web app renders it (`msg('km', 'Workspace.nav.loanAccounts')`), so tests follow the translations. */
export function msg(locale: 'en' | 'km', key: string): string {
  const value = key.split('.').reduce<unknown>((o, k) => (o as Record<string, unknown> | undefined)?.[k], MESSAGES[locale]);
  if (typeof value !== 'string') throw new Error(`no message ${locale}:${key}`);
  return value;
}

const RAW_KEY = new RegExp(`\\b(${NAMESPACES.join('|')})\\.[a-zA-Z][\\w.]*`, 'g');

export interface ConsoleGuard {
  /** Allow console errors matching `pattern` for the rest of this test (an expected 4xx, say). */
  allow(pattern: RegExp): void;
  /** Watch another page (a second signed-in user's) as well. */
  watch(page: Page): void;
}

interface Fixtures {
  consoleGuard: ConsoleGuard;
}

export const test = base.extend<Fixtures>({
  consoleGuard: [
    async ({ page }, use, testInfo) => {
      const problems: (string | (() => string))[] = [];
      const allowed: RegExp[] = [...KNOWN_NOISE];
      // Bodies of failed API calls, so a "Failed to load resource" error says why.
      const failedApi = new Map<string, string>();
      const watch = (p: Page) => {
        p.on('response', async (res) => {
          if (res.status() < 400 || !res.url().includes('/api/')) return;
          const body = await res.text().catch(() => '');
          failedApi.set(res.url(), `${res.request().method()} ${res.status()} ${body.slice(0, 400)}`);
        });
        p.on('pageerror', (err) => problems.push(`pageerror on ${p.url()}: ${err.message}`));
        p.on('console', (msg) => {
          if (msg.type() !== 'error') return;
          const text = msg.text();
          const where = msg.location()?.url ?? '';
          if (allowed.some((re) => re.test(text) || re.test(where))) return;
          const at = p.url();
          // Formatted at the end, once the failed call's body has been read.
          problems.push(() => {
            const api = failedApi.get(where);
            return `console.error on ${at}: ${text}${where ? ` (${where})` : ''}${api ? ` → ${api}` : ''}`;
          });
        });
      };
      watch(page);
      await use({ allow: (re) => allowed.push(re), watch });
      if (problems.length) {
        const lines = problems.map((x) => (typeof x === 'string' ? x : x()));
        await testInfo.attach('console-errors', { body: lines.join('\n'), contentType: 'text/plain' });
        expect(lines, 'console errors / uncaught page errors').toEqual([]);
      }
    },
    { auto: true },
  ],
});

/**
 * No message key rendered raw (`LendingServicing.payoff`) and no next-intl
 * fallback text on the page.
 */
export async function expectNoRawMessageKeys(page: Page) {
  const text = await page.locator('body').innerText();
  const raw = [...new Set(text.match(RAW_KEY) ?? [])];
  expect(raw, `raw message keys rendered on ${page.url()}`).toEqual([]);
  expect(text).not.toContain('MISSING_MESSAGE');
}

export { expect };
