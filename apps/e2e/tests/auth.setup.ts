// The guarded test: the enrolment pages must not log console errors either.
import { test as setup, expect } from '../support/fixtures';
import fs from 'node:fs';
import { PASSWORD_ONLY_SESSION, QA, codeFor, emailOf, saveTotpSecret, storageOf } from '../support/accounts';
import { demoPassword } from '../support/paths';

/**
 * Sign the four QA accounts in and enrol their authenticators through the UI,
 * as a tester on the hosted demo does: the accounts hold the organisation
 * administrator role, which must use an authenticator (D-128), so the first
 * sign-in lands on My account with only the setup card available. The secret
 * shown on screen is kept for the run so later tests can compute codes
 * (step-up, D-129).
 */
for (const key of QA) {
  setup(`sign in and enrol the authenticator: ${key}`, async ({ page }) => {
    await page.goto('/en/login');
    await page.getByLabel('Email').fill(emailOf(key));
    await page.getByLabel('Password', { exact: true }).fill(demoPassword());
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();

    // Enrolment required: only My account is reachable.
    await expect(page).toHaveURL(/\/en\/account\?enrol=1/);
    await expect(page.getByRole('heading', { name: 'My account' })).toBeVisible();
    await expect(page.getByText('Set up an authenticator to continue')).toBeVisible();
    await expect(page.getByText('Signed in with password only')).toBeVisible();

    if (key === 'qa.approver2') {
      // Kept for the step-up test: this session predates the authenticator.
      await page.context().storageState({ path: PASSWORD_ONLY_SESSION });
    }

    await page.getByRole('button', { name: 'Set up authenticator' }).click();
    await expect(page.getByRole('img', { name: /QR/i })).toBeVisible();
    const keyText = await page.getByText(/Or enter this key by hand/).innerText();
    const secret = keyText.match(/[A-Z2-7]{16,}/)?.[0];
    expect(secret, 'the manual-entry key is shown next to the QR code').toBeTruthy();

    const { code, step } = await codeFor(secret!);
    await page.getByLabel(/6-digit code/i).fill(code);
    await page.getByRole('button', { name: 'Finish setup' }).click();
    saveTotpSecret(key, secret!, step);

    // A fresh MFA session: the rest of the app opens.
    await expect(page.getByText('Set up an authenticator to continue')).toBeHidden();
    await page.goto('/en/lending');
    await expect(page.getByRole('complementary').getByRole('link', { name: 'Loan accounts' })).toBeVisible();
    await expect(page).not.toHaveURL(/account\?enrol/);

    // First sign-in offers the orientation tour; "Not now" is kept by the
    // API, so it stays dismissed for the rest of the run.
    const prompt = page.getByRole('dialog', { name: 'New here? Take the two-minute tour' });
    await expect(prompt).toBeVisible();
    await prompt.getByRole('button', { name: 'Not now' }).first().click();
    await expect(prompt).toBeHidden();
    await page.reload();
    await expect(page.getByRole('complementary').getByRole('link', { name: 'Loan accounts' })).toBeVisible();
    await page.waitForLoadState('networkidle');
    await expect(prompt).toBeHidden();
    await page.context().storageState({ path: storageOf(key) });
    expect(fs.existsSync(storageOf(key))).toBe(true);
  });
}
