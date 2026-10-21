import { test, expect, expectNoRawMessageKeys, msg } from '../support/fixtures';
import { storageOf } from '../support/accounts';

/**
 * The in-house credit report on an application (D-176…D-181), in English and
 * Khmer. The demo's Sokha Chan has consented to her credit report and has a
 * repaid loan in the legacy archive: a draft application for her shows the
 * credit report card, a fresh report is pulled from it, and the report — its
 * score, facility and 24-month payment grid — reads in both languages.
 */
test.describe.configure({ mode: 'serial' });
test.use({ storageState: storageOf('qa.maker') });

let applicationPath = '';

test('pull a credit report from a draft application (English)', async ({ page }) => {
  await page.goto('/en/lending/applications');
  await page.getByRole('button', { name: 'New application' }).click();
  await page.locator('[data-tour=app-find-borrower]').fill('Sokha');
  await page.getByRole('button', { name: 'Search', exact: true }).first().click();
  const borrowerSelect = page.locator('select[data-tour=app-borrower-select]');
  const sokha = borrowerSelect.locator('option', { hasText: 'Sokha Chan' });
  await expect(sokha.first()).toBeAttached();
  await borrowerSelect.selectOption({ label: (await sokha.first().innerText()).trim() });
  const productSelect = page.locator('select[data-tour=app-product-select]');
  const personal = productSelect.locator('option', { hasText: '(PL-STD)' });
  await expect(personal).toHaveCount(1);
  await productSelect.selectOption({ label: (await personal.innerText()).trim() });
  await page.getByLabel(/^Principal/).fill('800');
  await page.getByLabel(/Number of instalments/).fill('10');
  await page.locator('[data-tour=app-create-draft]').click();
  await expect(page).toHaveURL(/\/en\/lending\/applications\/[0-9a-f-]{36}/);
  applicationPath = new URL(page.url()).pathname.replace(/^\/en/, '');

  const card = page.locator('[data-tour=app-credit-report]');
  await expect(page.getByText(msg('en', 'Scoring.creditReport.cardTitle')).first()).toBeVisible();
  // Consent is on file: the report can be pulled for this application.
  await card.getByTestId('credit-report-pull').click();
  await expect(page.getByText(msg('en', 'Scoring.creditReport.pulled'))).toBeVisible();
  const report = card.getByTestId('credit-report');
  await expect(report).toBeVisible();
  await expect(report.getByTestId('credit-report-score')).toHaveText(/^\d{3}$/);
  // The repaid legacy loan, with its 24-month payment grid.
  const facility = report.getByTestId('credit-report-facility').first();
  await expect(facility).toContainText(msg('en', 'Scoring.creditReport.statuses.CLOSED'));
  await expect(facility.getByTestId('credit-report-grid').locator('td')).toHaveCount(24);
  await expect(facility.getByTestId('credit-report-grid')).toContainText('C');
  await expect(report).toContainText(msg('en', 'Scoring.creditReport.thisApplication'));
  await expectNoRawMessageKeys(page);
});

test('the same report in Khmer', async ({ page }) => {
  test.skip(!applicationPath, 'needs the application from the previous step');
  await page.goto(`/km${applicationPath}`);
  await expect(page.locator('html')).toHaveAttribute('lang', 'km');
  await expect(page.getByText(msg('km', 'Scoring.creditReport.cardTitle')).first()).toBeVisible();
  const report = page.locator('[data-tour=app-credit-report]').getByTestId('credit-report');
  await expect(report).toBeVisible();
  await expect(report).toContainText(msg('km', 'Scoring.creditReport.bureauScore'));
  await expect(report).toContainText(msg('km', 'Scoring.creditReport.facilities'));
  await expect(report.getByTestId('credit-report-grid').first().locator('td')).toHaveCount(24);
  await expect(report).toContainText(msg('km', 'Scoring.creditReport.internalNote'));
  await page.waitForLoadState('networkidle');
  await expectNoRawMessageKeys(page);
});
