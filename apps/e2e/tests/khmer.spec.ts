import { test, expect, expectNoRawMessageKeys, msg } from '../support/fixtures';
import { storageOf } from '../support/accounts';

/**
 * Each journey's screens in Khmer: the page title is the Khmer one, the menu
 * is Khmer, and no message key or MISSING_MESSAGE text is rendered. Titles
 * come from apps/web/messages/km.json, so a translation change does not
 * break the test while a missing translation does.
 */
test.use({ storageState: storageOf('qa.checker') });

const PAGES: [string, string][] = [
  ['/km/borrowers', 'Borrowers.title'],
  ['/km/lending/applications', 'LendingOrigination.list.title'],
  ['/km/lending/loans', 'Workspace.nav.loanAccounts'],
  ['/km/lending/aml', 'Workspace.nav.aml'],
  ['/km/lending/scorecards', 'Scoring.scorecards.title'],
  ['/km/lending/scorecard-monitoring', 'Scoring.monitoring.title'],
  ['/km/learn', 'Learning.title'],
  ['/km/account', 'Account.title'],
];

for (const [path, titleKey] of PAGES) {
  test(`in Khmer: ${path}`, async ({ page }) => {
    await page.goto(path);
    await expect(page.locator('html')).toHaveAttribute('lang', 'km');
    await expect(page.getByRole('heading', { level: 1 }).first()).toHaveText(msg('km', titleKey));
    await expect(page.getByRole('complementary').getByRole('link', { name: msg('km', 'Workspace.nav.help') })).toBeVisible();
    await page.waitForLoadState('networkidle');
    await expectNoRawMessageKeys(page);
  });
}

test('in Khmer: help and the user guide', async ({ page }) => {
  await page.goto('/km/help');
  await expect(page.locator('html')).toHaveAttribute('lang', 'km');
  // The guide itself is English for now, and says so.
  await expect(page.getByText(msg('km', 'Help.englishOnly'))).toBeVisible();
  await expectNoRawMessageKeys(page);
});
