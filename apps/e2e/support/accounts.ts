import fs from 'node:fs';
import path from 'node:path';
import { generate } from 'otplib';
import { AUTH_DIR } from './paths';

/**
 * The demo's four all-round QA accounts (packages/db/prisma/demo-lending.ts):
 * every staff role, all branches, high approval limits. Maker-checker means
 * one person never makes and approves the same thing, so journeys switch
 * between them.
 */
export const QA = ['qa.maker', 'qa.checker', 'qa.approver', 'qa.approver2'] as const;
export type QaKey = (typeof QA)[number];

export const emailOf = (key: string) => `${key}@demo-lending.test`;

/** The signed-in browser state the setup project saved for an account. */
export const storageOf = (key: QaKey) => path.join(AUTH_DIR, `${key}.json`);

/**
 * A session of qa.approver2 signed in with the password only, saved just
 * before the account enrolled its authenticator: the API asks it for a fresh
 * code (step-up) before anything else answers.
 */
export const PASSWORD_ONLY_SESSION = path.join(AUTH_DIR, 'qa.approver2.password-only.json');

interface TotpRecord {
  secret: string;
  /** The last 30-second time step whose code was sent (the API refuses a replay). */
  lastStep: number;
}

const totpFile = (key: QaKey) => path.join(AUTH_DIR, `${key}.totp.json`);

export function saveTotpSecret(key: QaKey, secret: string, usedStep: number) {
  fs.writeFileSync(totpFile(key), JSON.stringify({ secret, lastStep: usedStep } satisfies TotpRecord));
}

const step = () => Math.floor(Date.now() / 30_000);

/** Do not hand out a code in the last seconds of its step: it could expire on the way. */
async function awayFromStepEnd() {
  const left = 30_000 - (Date.now() % 30_000);
  if (left < 4_000) await new Promise((r) => setTimeout(r, left + 250));
}

/**
 * A code for the current time step that has not been sent before for this
 * account: the API accepts each step once, so when the last code used this
 * step, wait for the next one.
 */
export async function freshCode(key: QaKey): Promise<string> {
  const record = JSON.parse(fs.readFileSync(totpFile(key), 'utf8')) as TotpRecord;
  while (step() <= record.lastStep) {
    await new Promise((r) => setTimeout(r, 1000));
  }
  await awayFromStepEnd();
  const now = step();
  const code = await generate({ secret: record.secret });
  fs.writeFileSync(totpFile(key), JSON.stringify({ ...record, lastStep: now }));
  return code;
}

/** A code for a secret just shown on screen (enrolment). */
export async function codeFor(secret: string): Promise<{ code: string; step: number }> {
  await awayFromStepEnd();
  return { code: await generate({ secret }), step: step() };
}
