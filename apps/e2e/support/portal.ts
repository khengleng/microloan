import { createHmac } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { Browser, BrowserContext, Page } from '@playwright/test';
import { e2eRoot } from './paths';

/**
 * A borrower-portal session for a customer, without the SMS one-time code:
 * the portal token is signed the way the API signs it (HS256 with the
 * borrower secret derived from the stack's throwaway JWT_ACCESS_SECRET,
 * apps/e2e/.stack/secrets.json) and set as the portal's HttpOnly cookie.
 * Only for the local test stack.
 */
function stackJwtSecret(): string {
  const dir = path.resolve(e2eRoot, process.env.E2E_STACK_DIR || '.stack');
  const secrets = JSON.parse(fs.readFileSync(path.join(dir, 'secrets.json'), 'utf8')) as { JWT_ACCESS_SECRET: string };
  return createHmac('sha256', secrets.JWT_ACCESS_SECRET).update('borrower-portal-v1').digest('hex');
}

const b64url = (v: string | Buffer) => Buffer.from(v).toString('base64url');

function sign(payload: Record<string, unknown>, secret: string): string {
  const head = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = b64url(JSON.stringify(payload));
  const sig = createHmac('sha256', secret).update(`${head}.${body}`).digest('base64url');
  return `${head}.${body}.${sig}`;
}

/** The tenant of a signed-in staff page, read from its access-token cookie. */
async function staffTenant(staff: Page): Promise<string> {
  for (const c of await staff.context().cookies()) {
    const parts = c.value.split('.');
    if (parts.length !== 3) continue;
    try {
      const claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')) as { tenantId?: string };
      if (claims.tenantId) return claims.tenantId;
    } catch {
      // not a token
    }
  }
  throw new Error('No staff access token with a tenant among the cookies.');
}

export async function borrowerContext(browser: Browser, staff: Page, borrowerId: string, baseURL: string): Promise<BrowserContext> {
  const tenantId = await staffTenant(staff);
  const now = Math.floor(Date.now() / 1000);
  const token = sign({ sub: borrowerId, typ: 'borrower', tenantId, iat: now, exp: now + 3600 }, stackJwtSecret());
  const ctx = await browser.newContext();
  await ctx.addCookies([{ name: 'borrower_token', value: token, url: baseURL, httpOnly: true, sameSite: 'Strict' }]);
  return ctx;
}
