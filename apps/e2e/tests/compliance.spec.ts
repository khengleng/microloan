import { test, expect, expectNoRawMessageKeys } from '../support/fixtures';
import { storageOf } from '../support/accounts';

/** AML & compliance (Risk & audit), scorecards and scorecard monitoring. */
test.use({ storageState: storageOf('qa.checker') });

test('AML & compliance: every tab loads', async ({ page }) => {
  await page.goto('/en/lending/aml');
  await expect(page.getByRole('heading', { name: 'AML & compliance', level: 1 })).toBeVisible();
  const tabs: [string, RegExp][] = [
    ['Screening cases', /Customers whose name matched a watch list/],
    ['Watch lists', /DEMO_FICTIONAL/],
    ['Risk & EDD', /./],
    ['Cash transactions', /./],
    ['Suspicious transactions', /./],
  ];
  for (const [name, body] of tabs) {
    const tab = page.getByRole('tab', { name });
    await tab.click();
    await expect(tab).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByRole('main')).toContainText(body);
    await page.waitForLoadState('networkidle');
    await expectNoRawMessageKeys(page);
  }
});

test('AML: the demo screening case opens with the match details', async ({ page }) => {
  await page.goto('/en/lending/aml');
  const row = page.getByRole('row', { name: /AMLC-DEMO-0001/ });
  await expect(row).toContainText('Demo Exposed Official');
  await row.click();
  const main = page.getByRole('main');
  await expect(main.getByText('Matched name')).toBeVisible();
  await expect(main.getByText('DEMO_FICTIONAL').first()).toBeVisible();
  await expect(main.getByRole('button', { name: 'Propose outcome' })).toBeVisible();
  await expectNoRawMessageKeys(page);
});

test('AML: the case is reachable from the customer profile', async ({ page }) => {
  await page.goto('/en/borrowers');
  await page.locator('[data-tour=borrower-row]', { hasText: 'Demo Exposed Official' }).getByRole('link', { name: 'View' }).click();
  await expect(page.getByText(/Watch-list match AMLC-DEMO-0001 awaits compliance review/)).toBeVisible();
  await page.getByRole('link', { name: 'Open the screening case' }).click();
  await expect(page).toHaveURL(/\/en\/lending\/aml\?tab=cases&case=/);
  await expect(page.getByRole('main').getByRole('button', { name: 'Propose outcome' })).toBeVisible();
});

test('scorecards: the active scorecards are listed and Test score runs', async ({ page }) => {
  await page.goto('/en/lending/scorecards');
  await expect(page.getByRole('heading', { name: 'Scorecards', level: 1 })).toBeVisible();
  const main = page.getByRole('main');
  await expect(main.getByRole('row', { name: /STANDARD_RETAIL/ }).first()).toContainText('Active');
  await expect(main.getByRole('row', { name: /THIN_FILE/ }).first()).toContainText('Active');

  await page.getByRole('tab', { name: 'Test score' }).click();
  const source = page.locator('[data-tour=scorecards-test-source]');
  const option = source.locator('option', { hasText: 'STANDARD_RETAIL' }).first();
  await source.selectOption({ label: (await option.innerText()).trim() });
  await page.locator('[data-tour=scorecards-test-run]').click();
  await expect(main.getByText('Grade', { exact: true }).first()).toBeVisible();
  await expect(main.getByText('Factors', { exact: true }).first()).toBeVisible();
  await expectNoRawMessageKeys(page);
});

test('scorecard monitoring loads', async ({ page }) => {
  await page.goto('/en/lending/scorecard-monitoring');
  await expect(page.getByRole('heading', { name: 'Scorecard monitoring', level: 1 })).toBeVisible();
  await page.waitForLoadState('networkidle');
  await expect(page.getByRole('main')).toContainText(/STANDARD_RETAIL|Standard retail/);
  await expectNoRawMessageKeys(page);
});
