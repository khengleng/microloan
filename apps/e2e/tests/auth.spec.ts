import { test, expect, expectNoRawMessageKeys, msg } from '../support/fixtures';
import { emailOf, freshCode, storageOf } from '../support/accounts';
import { demoPassword } from '../support/paths';

/**
 * Sign-in in both languages, the language switch, the menu, and the main
 * pages loading without console errors or React hydration errors.
 */

test.describe('signed out', () => {
  test('sign in (English) with password and authenticator code', async ({ page }) => {
    await page.goto('/en/login');
    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
    await page.getByLabel('Email').fill(emailOf('qa.checker'));
    await page.getByLabel('Password', { exact: true }).fill(demoPassword());
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    // The QA accounts enrolled an authenticator in the setup project.
    await expect(page.getByLabel('Verification code')).toBeVisible();
    await page.getByLabel('Verification code').fill(await freshCode('qa.checker'));
    await page.getByRole('button', { name: 'Confirm' }).click();
    await expect(page).not.toHaveURL(/\/login/);
    await expect(page.getByRole('complementary').getByRole('link', { name: 'Loan accounts' })).toBeVisible();
  });

  test('a wrong password is refused with a message', async ({ page, consoleGuard }) => {
    consoleGuard.allow(/status of 401/);
    await page.goto('/en/login');
    await page.getByLabel('Email').fill(emailOf('auditor'));
    await page.getByLabel('Password', { exact: true }).fill('not-the-password-1');
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(page.getByText(/Invalid credentials/)).toBeVisible();
    await expect(page).toHaveURL(/\/en\/login/);
  });

  test('sign in (Khmer): the page and the app are in Khmer', async ({ page }) => {
    await page.goto('/en/login');
    await page.getByRole('button', { name: 'ខ្មែរ' }).click();
    await expect(page).toHaveURL(/\/km\/login/);
    await expect(page.locator('html')).toHaveAttribute('lang', 'km');
    // A demo user without an authenticator requirement (credit analyst).
    await page.locator('#email').fill(emailOf('analyst'));
    await page.locator('#password').fill(demoPassword());
    await page.locator('button[type=submit]').click();
    await expect(page).not.toHaveURL(/\/login/);
    await expect(page).toHaveURL(/\/km\//);
    await expect(page.getByRole('complementary').getByRole('link', { name: msg('km', 'Workspace.nav.loanAccounts') })).toBeVisible();
    await expectNoRawMessageKeys(page);
  });
});

test.describe('signed in', () => {
  test.use({ storageState: storageOf('qa.maker') });

  test('the language switch keeps the page and changes the language', async ({ page }) => {
    await page.goto('/en/lending/applications');
    await expect(page.getByRole('heading', { name: 'Applications', level: 1 })).toBeVisible();
    await page.locator('[data-tour=language-switch]').getByRole('link', { name: 'KM' }).click();
    await expect(page).toHaveURL(/\/km\/lending\/applications/);
    await expect(page.getByRole('heading', { name: msg('km', 'LendingOrigination.list.title'), level: 1 })).toBeVisible();
    await page.locator('[data-tour=language-switch]').getByRole('link', { name: 'EN' }).click();
    await expect(page).toHaveURL(/\/en\/lending\/applications/);
    await expect(page.getByRole('heading', { name: 'Applications', level: 1 })).toBeVisible();
  });

  test('the menu lists every section', async ({ page }) => {
    await page.goto('/en/home');
    const nav = page.locator('[data-tour=nav-menu]');
    for (const section of ['Work', 'Customers', 'Origination', 'Loans', 'Collections & relief', 'Finance', 'Products', 'Risk & audit', 'Administration']) {
      await expect(nav.getByText(section, { exact: true })).toBeVisible();
    }
    await nav.getByRole('link', { name: 'Borrowers' }).click();
    await expect(page.getByRole('heading', { name: 'Borrowers', level: 1 })).toBeVisible();
  });

  // Main pages: each must render its title without console errors, uncaught
  // errors or hydration mismatches (the fixture fails the test on any).
  const PAGES: [string, string][] = [
    ['/en/home', 'My work'],
    ['/en/dashboard', 'Financial Dashboard'],
    ['/en/reports', 'Reports'],
    ['/en/kpi', 'Performance'],
    ['/en/lending/legacy-archive', 'Legacy loan archive'],
    ['/en/borrowers', 'Borrowers'],
    ['/en/lending/applications', 'Applications'],
    ['/en/lending/loans', 'Loan accounts'],
    ['/en/lending/products', 'Products & versions'],
    ['/en/lending/approvals', ''],
    ['/en/lending/collections', 'Collections'],
    ['/en/lending/accounting', 'Ledger & reconciliation'],
    ['/en/lending/operations', 'End of day & operations'],
    ['/en/lending/aml', 'AML & compliance'],
    ['/en/lending/scorecards', 'Scorecards'],
    ['/en/lending/scorecard-monitoring', 'Scorecard monitoring'],
    ['/en/lending/audit', 'Audit trail'],
    ['/en/lending/access', 'Access & policy'],
    ['/en/learn', 'Learning centre'],
    ['/en/help', 'User guide — lending web portal'],
    ['/en/account', 'My account'],
    ['/en/users', ''],
    ['/en/settings', ''],
  ];
  for (const [path, title] of PAGES) {
    test(`page loads cleanly: ${path}`, async ({ page }) => {
      const response = await page.goto(path);
      expect(response?.status(), 'HTTP status').toBeLessThan(400);
      await page.waitForLoadState('networkidle');
      if (title) await expect(page.getByRole('heading', { name: title, level: 1 }).first()).toBeVisible();
      await expect(page).not.toHaveURL(/\/login/);
      await expectNoRawMessageKeys(page);
    });
  }
});
