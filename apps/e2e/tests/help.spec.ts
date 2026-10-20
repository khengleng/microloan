import { test, expect, expectNoRawMessageKeys } from '../support/fixtures';
import { storageOf } from '../support/accounts';

/** The user guide (Help): chapters, search, and the contextual link on a lending page. */
test.use({ storageState: storageOf('qa.checker') });

test('open a chapter from the contents', async ({ page }) => {
  await page.goto('/en/help');
  await expect(page.getByRole('heading', { name: 'User guide — lending web portal', level: 1 })).toBeVisible();
  const contents = page.getByRole('navigation', { name: 'Contents' });
  await contents.getByRole('link', { name: '06 · Disbursement' }).click();
  await expect(page).toHaveURL(/\/en\/help\/06-disbursement/);
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Disbursement');
  // Previous / next chapter navigation.
  await expect(page.getByRole('link', { name: /Next/ }).last()).toBeVisible();
  await expectNoRawMessageKeys(page);
});

test('search finds sections and opens one', async ({ page }) => {
  await page.goto('/en/help');
  const search = page.getByRole('searchbox', { name: 'Search the user guide' }).or(page.getByLabel('Search the user guide'));
  await search.fill('payoff letter');
  await expect(page.getByText(/\d+ sections?/).first()).toBeVisible();
  const hit = page.getByRole('main').getByRole('link', { name: /payoff/i }).first();
  await expect(hit).toBeVisible();
  await hit.click();
  await expect(page).toHaveURL(/\/en\/help\/[\w-]+/);
  await expect(page.getByRole('main')).toContainText(/payoff/i);

  await page.goto('/en/help');
  await search.fill('zzqx-no-such-words');
  await expect(page.getByText('No sections match “zzqx-no-such-words”.')).toBeVisible();
});

test('the Help link on a lending page opens the matching chapter in a new tab', async ({ page, context, consoleGuard }) => {
  await page.goto('/en/lending/applications');
  const help = page.getByRole('main').getByRole('link', { name: 'Help', exact: true });
  await expect(help).toHaveAttribute('href', /\/en\/help\/05-applications-and-credit-decisions/);
  const [tab] = await Promise.all([context.waitForEvent('page'), help.click()]);
  consoleGuard.watch(tab);
  await tab.waitForLoadState();
  await expect(tab).toHaveURL(/\/en\/help\/05-applications-and-credit-decisions/);
  await expect(tab.getByRole('heading', { level: 1 })).toContainText('Applications and credit decisions');
  await tab.close();

  await page.goto('/en/lending/aml');
  await expect(page.getByRole('main').getByRole('link', { name: 'Help', exact: true })).toHaveAttribute('href', /\/en\/help\/26-aml-and-compliance/);
});
