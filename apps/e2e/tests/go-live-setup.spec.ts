import { test, expect, expectNoRawMessageKeys, msg } from '../support/fixtures';
import { storageOf } from '../support/accounts';

/**
 * The go-live setup checklist (D-171…D-175) on the demo organisation: the
 * page computes each item from the demo's real configuration, links to the
 * screens, and a tenant administrator marks an optional item not applicable
 * and counts it again. In English and in Khmer.
 */
test.use({ storageState: storageOf('qa.checker') });

const ITEM_KEYS = [
  'consumer_protection', 'branches', 'staff_roles', 'admin_mfa', 'approval_authorities', 'business_date', 'fx_rates',
  'chart_of_accounts', 'opening_balances', 'products', 'impairment_policy', 'scorecards', 'aml_watch_list',
  'aml_settings', 'payment_khqr', 'alert_emails', 'feature_flags', 'learning',
];

test('go-live setup: every item is checked and links to its screen; Home links to it', async ({ page }) => {
  await page.goto('/en/home');
  await page.getByTestId('home-go-live-setup').click();
  await expect(page).toHaveURL(/\/en\/lending\/setup$/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(msg('en', 'Workspace.nav.goLiveSetup'));
  await expect(page.getByTestId('setup-progress')).toContainText('%');
  for (const key of ITEM_KEYS) {
    const row = page.getByTestId(`setup-item-${key}`);
    await expect(row).toBeVisible();
    await expect(row).toContainText(msg('en', `GoLiveSetup.items.${key}.title`));
    await expect(row).toHaveAttribute('data-status', /^(DONE|TODO|BLOCKED|NOT_APPLICABLE|NOT_CHECKED|INFO)$/);
  }
  // The demo organisation has branches and an active product.
  await expect(page.getByTestId('setup-item-branches')).toHaveAttribute('data-status', 'DONE');
  await expect(page.getByTestId('setup-item-products')).toHaveAttribute('data-status', 'DONE');
  await expect(page.getByTestId('setup-item-learning')).toHaveAttribute('data-status', 'INFO');
  await page.waitForLoadState('networkidle');
  await expectNoRawMessageKeys(page);

  // "Open" goes to the screen where the item is done.
  await page.getByTestId('setup-item-impairment_policy').getByRole('link', { name: 'Open' }).click();
  await expect(page).toHaveURL(/\/en\/lending\/operations\?tab=impairment$/);
  await expect(page.getByRole('tab', { name: msg('en', 'LendingOps.tabs.impairment') })).toHaveAttribute('aria-selected', 'true');
});

test('go-live setup: an optional item is marked not applicable with a reason, then counted again', async ({ page }) => {
  await page.goto('/en/lending/setup');
  const row = page.getByTestId('setup-item-opening_balances');
  await expect(row).toHaveAttribute('data-status', /^(TODO|NOT_APPLICABLE)$/);
  // Leave it as found if an earlier attempt marked it.
  if ((await row.getAttribute('data-status')) === 'NOT_APPLICABLE') {
    await row.getByRole('button', { name: msg('en', 'GoLiveSetup.clear') }).click();
    await expect(row).toHaveAttribute('data-status', 'TODO');
  }
  await row.getByRole('button', { name: msg('en', 'GoLiveSetup.markNotApplicable') }).click();
  const save = row.getByRole('button', { name: msg('en', 'GoLiveSetup.save') });
  await expect(save).toBeDisabled();
  await row.getByRole('textbox', { name: msg('en', 'GoLiveSetup.reasonLabel') }).fill('No existing loan book to migrate at launch');
  await save.click();
  await expect(row).toHaveAttribute('data-status', 'NOT_APPLICABLE');
  await expect(row).toContainText('No existing loan book to migrate at launch');

  await row.getByRole('button', { name: msg('en', 'GoLiveSetup.clear') }).click();
  await expect(row).toHaveAttribute('data-status', 'TODO');

  // Items every lender needs offer no such button.
  await expect(page.getByTestId('setup-item-impairment_policy').getByRole('button', { name: msg('en', 'GoLiveSetup.markNotApplicable') })).toHaveCount(0);
});

test('go-live setup in Khmer', async ({ page }) => {
  await page.goto('/km/lending/setup');
  await expect(page.locator('html')).toHaveAttribute('lang', 'km');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(msg('km', 'Workspace.nav.goLiveSetup'));
  await expect(page.getByTestId('breadcrumb-page')).toHaveText(msg('km', 'Workspace.nav.goLiveSetup'));
  const branches = page.getByTestId('setup-item-branches');
  await expect(branches).toContainText(msg('km', 'GoLiveSetup.items.branches.title'));
  await expect(branches).toContainText(msg('km', 'GoLiveSetup.status.DONE'));
  await expect(page.getByTestId('setup-item-learning')).toContainText(msg('km', 'GoLiveSetup.status.INFO'));
  await expect(page.getByText(msg('km', 'GoLiveSetup.imports.title'))).toBeVisible();
  await page.waitForLoadState('networkidle');
  await expectNoRawMessageKeys(page);
});
