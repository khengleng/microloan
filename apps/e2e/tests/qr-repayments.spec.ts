import { test, expect, expectNoRawMessageKeys, msg } from '../support/fixtures';
import { storageOf } from '../support/accounts';

/**
 * KHQR repayments (D-160…D-165): the demo lender's static codes, and a bank
 * statement checked first and then imported — a line naming no loan is held
 * in suspense — in English and Khmer.
 */
test.use({ storageState: storageOf('qa.maker') });

/** Today in the demo's time zone: the demo business date is the day it was seeded. */
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Phnom_Penh' }).format(new Date());

test('KHQR codes: the demo lender has a USD and a KHR code in force', async ({ page }) => {
  await page.goto('/en/lending/qr-repayments?tab=codes');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('KHQR repayments');
  await expect(page.getByRole('main').getByText('Payments are not confirmed automatically').first()).toBeVisible();
  for (const currency of ['USD', 'KHR']) {
    const tile = page.getByTestId(`khqr-code-${currency}`).first();
    await expect(tile).toBeVisible();
    await expect(tile.getByAltText(`KHQR code (${currency})`)).toBeVisible();
  }
  await expectNoRawMessageKeys(page);
});

test('statement import: checked first, then imported; an unmatched line is held in suspense', async ({ page }) => {
  const ref = `E2ESTMT${Date.now() % 10_000_000}`;
  const csv = [
    'Transaction Date,Reference No,Description,Sender Name,From Account,Debit,Credit,Currency',
    `${today()},${ref},for my aunt,UNKNOWN SENDER,,,7.25,USD`,
    `${today()},E2EFEE${Date.now() % 1_000_000},bank charge,,,1.00,,USD`,
  ].join('\n');
  await page.goto('/en/lending/qr-repayments');
  await page.getByRole('tab', { name: 'Statement import' }).click();
  const form = page.getByTestId('statement-import');
  await expect(form).toBeVisible();
  await form.getByLabel('Statement file').setInputFiles({ name: 'statement.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) });
  await page.getByRole('button', { name: 'Check first' }).click();
  await expect(page.getByText('What the import would do')).toBeVisible();
  await expect(page.getByRole('cell', { name: ref })).toBeVisible();
  await expect(page.getByRole('cell', { name: /Hold in suspense/ })).toBeVisible();

  await page.getByRole('button', { name: 'Import statement' }).click();
  await expect(page.getByText('Statement imported')).toBeVisible();
  await expect(page.getByText('1 payments: 0 posted, 1 held in suspense, 0 already received')).toBeVisible();

  await page.getByRole('tab', { name: 'Held in suspense' }).click();
  await expect(page.getByRole('cell', { name: ref })).toBeVisible();
  await expectNoRawMessageKeys(page);
});

test('in Khmer: the KHQR repayments screen', async ({ page }) => {
  await page.goto('/km/lending/qr-repayments');
  await expect(page.locator('html')).toHaveAttribute('lang', 'km');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(msg('km', 'Workspace.nav.qrRepayments'));
  await page.getByRole('tab', { name: msg('km', 'LendingQr.view.tab_statements') }).click();
  await expect(page.getByRole('heading', { name: msg('km', 'LendingQr.statement.title') })).toBeVisible();
  await page.waitForLoadState('networkidle');
  await expectNoRawMessageKeys(page);
});
