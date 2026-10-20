import { test, expect, expectNoRawMessageKeys, msg } from '../support/fixtures';
import { storageOf } from '../support/accounts';

/**
 * Each journey's screens in Khmer: the page title is the Khmer one, the menu
 * is Khmer, and no message key or MISSING_MESSAGE text is rendered. Titles
 * come from apps/web/messages/km.json, so a translation change does not
 * break the test while a missing translation does.
 */
test.use({ storageState: storageOf('qa.checker') });

/** [path, page title key, header breadcrumb key (the menu's name for the page)]. */
const PAGES: [string, string, string][] = [
  ['/km/borrowers', 'Borrowers.title', 'Workspace.nav.borrowers'],
  ['/km/lending/applications', 'LendingOrigination.list.title', 'Workspace.nav.applications'],
  ['/km/lending/loans', 'Workspace.nav.loanAccounts', 'Workspace.nav.loanAccounts'],
  ['/km/lending/aml', 'Workspace.nav.aml', 'Workspace.nav.aml'],
  ['/km/lending/scorecards', 'Scoring.scorecards.title', 'Workspace.nav.scorecards'],
  ['/km/lending/scorecard-monitoring', 'Scoring.monitoring.title', 'Workspace.nav.scorecardMonitoring'],
  ['/km/learn', 'Learning.title', 'Workspace.nav.learn'],
  ['/km/account', 'Account.title', 'Account.menuLink'],
];

for (const [path, titleKey, crumbKey] of PAGES) {
  test(`in Khmer: ${path}`, async ({ page }) => {
    await page.goto(path);
    await expect(page.locator('html')).toHaveAttribute('lang', 'km');
    await expect(page.getByRole('heading', { level: 1 }).first()).toHaveText(msg('km', titleKey));
    // The header breadcrumb names the page in Khmer, not by its English URL segment.
    await expect(page.getByTestId('breadcrumb-page')).toHaveText(msg('km', crumbKey));
    await expect(page.getByTestId('breadcrumb-sub')).toHaveCount(0);
    await expect(page.getByRole('complementary').getByRole('link', { name: msg('km', 'Workspace.nav.help') })).toBeVisible();
    await page.waitForLoadState('networkidle');
    await expectNoRawMessageKeys(page);
  });
}

test('in Khmer: the breadcrumb of a page below a menu page skips record ids', async ({ page }) => {
  await page.goto('/km/learn/portal-orientation');
  await expect(page.getByTestId('breadcrumb-page')).toHaveText(msg('km', 'Workspace.nav.learn'));
  await expect(page.getByTestId('breadcrumb-sub')).toHaveText(/portal orientation/i);
  // A record id is not a page name (a lesson id that does not exist: no data needed).
  await page.goto('/km/learn/0b5e3c1a-7d2f-4e8a-9c6b-1f2e3d4c5b6a');
  await expect(page.getByTestId('breadcrumb-page')).toHaveText(msg('km', 'Workspace.nav.learn'));
  await expect(page.getByTestId('breadcrumb-sub')).toHaveCount(0);
  await page.waitForLoadState('networkidle');
});

test('in Khmer: help and the user guide', async ({ page }) => {
  await page.goto('/km/help');
  await expect(page.locator('html')).toHaveAttribute('lang', 'km');
  // The guide itself is English for now, and says so.
  await expect(page.getByText(msg('km', 'Help.englishOnly'))).toBeVisible();
  await expectNoRawMessageKeys(page);
});
