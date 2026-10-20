import type { Page } from '@playwright/test';
import { test, expect, expectNoRawMessageKeys } from '../support/fixtures';
import { PASSWORD_ONLY_SESSION, emailOf, freshCode } from '../support/accounts';
import { demoPassword } from '../support/paths';

/**
 * My account: change-password validation (the demo password is never
 * changed), authenticator setup, and the step-up prompt (D-129).
 */

async function signIn(page: Page, key: string) {
  await page.goto('/en/login');
  await page.getByLabel('Email').fill(emailOf(key));
  await page.getByLabel('Password', { exact: true }).fill(demoPassword());
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page).not.toHaveURL(/\/login/);
}

test('change password: the form checks length, match and the current password', async ({ page, consoleGuard }) => {
  // The auditor: no authenticator required, so the page opens straight away.
  await signIn(page, 'auditor');
  await page.goto('/en/account');
  const current = page.getByLabel('Current password');
  const next = page.getByLabel('New password', { exact: true });
  const again = page.getByLabel('Repeat new password');
  const submit = page.getByRole('button', { name: 'Change password' });

  await expect(page.getByText('At least 12 characters.')).toBeVisible();
  await expect(submit).toBeDisabled();
  await current.fill('whatever-it-is');
  await next.fill('short');
  await expect(page.getByText('The new password must be at least 12 characters.')).toBeVisible();
  await expect(submit).toBeDisabled();
  await next.fill('A-long-enough-passphrase-1');
  await again.fill('A-different-passphrase-2');
  await expect(page.getByText('The two new passwords do not match.')).toBeVisible();
  await expect(submit).toBeDisabled();

  // A wrong current password: refused with a message; the person stays signed in.
  consoleGuard.allow(/auth\/change-password/);
  await again.fill('A-long-enough-passphrase-1');
  await expect(submit).toBeEnabled();
  await submit.click();
  await expect(page.locator('form').getByRole('alert')).toBeVisible();
  await expect(page).toHaveURL(/\/en\/account/);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'My account', level: 1 })).toBeVisible();
  await expectNoRawMessageKeys(page);
});

test('authenticator setup shows the QR code and key; cancel leaves it off', async ({ page }) => {
  await signIn(page, 'finance');
  await page.goto('/en/account');
  await page.getByRole('button', { name: 'Set up authenticator' }).click();
  await expect(page.getByRole('img', { name: 'QR code for your authenticator app' })).toBeVisible();
  await expect(page.getByText(/Or enter this key by hand: [A-Z2-7]{16,}/)).toBeVisible();
  await expect(page.getByLabel(/6-digit code/)).toBeVisible();
  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByRole('button', { name: 'Set up authenticator' })).toBeVisible();
});

test('step-up: a session older than the authenticator asks for a fresh code, then carries on', async ({ browser, consoleGuard }) => {
  // qa.approver2's password-only session, saved by the setup project just
  // before the account enrolled its authenticator.
  const context = await browser.newContext({ storageState: PASSWORD_ONLY_SESSION });
  const page = await context.newPage();
  consoleGuard.watch(page);
  // The refused first calls (403 MFA_STEP_UP_REQUIRED) are the point.
  consoleGuard.allow(/status of 403/);
  await page.goto('/en/lending/applications');

  const prompt = page.getByRole('dialog').filter({ has: page.getByLabel(/code/i) });
  await expect(prompt).toBeVisible();
  // A wrong code is refused inside the prompt.
  consoleGuard.allow(/status of 400|auth\/step-up/);
  await prompt.getByLabel(/code/i).fill('000000');
  await prompt.getByRole('button', { name: /Confirm|Continue|Verify/ }).click();
  await expect(prompt.getByRole('alert')).toBeVisible();

  await prompt.getByLabel(/code/i).fill(await freshCode('qa.approver2'));
  await prompt.getByRole('button', { name: /Confirm|Continue|Verify/ }).click();
  await expect(prompt).toBeHidden();
  await page.goto('/en/lending/applications');
  await expect(page.getByRole('heading', { name: 'Applications', level: 1 })).toBeVisible();
  await page.goto('/en/account');
  await expect(page.getByText('Signed in with your authenticator code')).toBeVisible();
  await context.close();
});
