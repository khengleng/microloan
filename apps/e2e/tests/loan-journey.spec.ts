import type { Page } from '@playwright/test';
import { test, expect, expectNoRawMessageKeys, msg } from '../support/fixtures';
import { signedFormPdf } from '../support/files';
import { lessonFor, skippedSteps, stepThroughTour } from '../support/tours';

/**
 * The lending journey end to end, as the QA accounts walk it on the demo:
 *
 *   qa.maker     registers a borrower, records KYC and AML clearance,
 *                creates and submits the application, records the customer's
 *                acceptance of the key facts statement, books the loan and
 *                prepares the disbursement;
 *   qa.checker   confirms KYC, approves the AML clearance, recommends;
 *   qa.approver  approves the application and the disbursement.
 *
 * Maker-checker means no account may both make and approve the same thing,
 * so the steps hop between three signed-in browsers. One serial test file:
 * each step builds on the previous one.
 */
test.describe.configure({ mode: 'serial' });

const stamp = `${Date.now() % 1_000_000}`;
const firstName = 'E2e';
const lastName = `Borrower${stamp}`;
const fullName = `${firstName} ${lastName}`;

let maker: Page;
let checker: Page;
let approver: Page;
let borrowerUrl = '';
let applicationUrl = '';
let loanUrl = '';
let loanReference = '';

test.beforeAll(async ({ browser }) => {
  // Long journey: one context per account for the whole file.
  const open = async (key: string) => (await browser.newContext({ storageState: `.auth/${key}.json` })).newPage();
  maker = await open('qa.maker');
  checker = await open('qa.checker');
  approver = await open('qa.approver');
});

test.afterAll(async () => {
  for (const p of [maker, checker, approver]) await p?.context().close();
});

test.beforeEach(async ({ consoleGuard }) => {
  for (const p of [maker, checker, approver]) consoleGuard.watch(p);
});

test('register a borrower', async () => {
  await maker.goto('/en/borrowers');
  await maker.getByRole('button', { name: 'New Borrower' }).click();
  await maker.getByLabel('First Name').fill(firstName);
  await maker.getByLabel('Last Name').fill(lastName);
  await maker.getByLabel('Phone Number').fill(`+85512${stamp.padStart(6, '0')}`);
  await maker.getByLabel('National ID / Passport').fill(`E2E${stamp}`);
  await maker.getByLabel('Address').fill('Street 1, Phnom Penh');
  await maker.getByLabel('ID document type').selectOption({ label: 'National ID card' });
  await maker.getByLabel('Date of birth').fill('1990-05-01');
  await maker.getByLabel('Occupation').fill('Shop owner');
  await maker.getByLabel('Branch').selectOption({ label: 'Phnom Penh (PNH)' });
  await maker.getByLabel('Nationality').fill('KH');
  await maker.getByLabel('Monthly Income (USD)').fill('1500');
  await maker.getByLabel('Monthly Expenses (USD)').fill('400');
  await maker.getByRole('button', { name: 'Add Borrower' }).click();

  const row = maker.locator('[data-tour=borrower-row]', { hasText: fullName });
  await expect(row).toBeVisible();
  await row.getByRole('link', { name: 'View' }).click();
  await expect(maker.getByRole('heading', { name: fullName })).toBeVisible();
  borrowerUrl = maker.url();
  await expect(maker.getByText('This customer cannot borrow yet')).toBeVisible();
});

test('KYC: one person records, another confirms', async () => {
  await maker.getByRole('button', { name: 'Record verification' }).click();
  await expect(maker.getByText('You recorded this verification; a colleague must confirm it.')).toBeVisible();

  await checker.goto(borrowerUrl);
  await checker.getByRole('button', { name: 'Confirm verification' }).click();
  await expect(checker.getByText('Identity verified').first()).toBeVisible();
});

test('AML: screened, clearance recorded by one person and approved by another', async () => {
  await maker.reload();
  await maker.getByRole('button', { name: 'Screen now' }).click();
  // Screening reloads the panel: wait for it before opening the clearance form.
  await expect(maker.getByText('No watch-list match')).toBeVisible();
  await maker.getByRole('button', { name: 'Record AML clearance' }).click();
  const reason = maker.getByLabel('Reason');
  await reason.fill('Screened against the watch lists: no match. Identity verified.');
  // The form's own submit button comes after the panel's opener.
  await maker.getByRole('button', { name: 'Record AML clearance' }).last().click();
  await expect(maker.getByText('Clearance recorded; a second person must approve it')).toBeVisible();
  await expect(maker.getByText(/AML clearance recorded by .*, awaiting a second person/)).toBeVisible();

  await checker.goto(borrowerUrl);
  await checker.getByRole('button', { name: 'Approve clearance' }).click();
  await expect(checker.getByText(/This customer may borrow/)).toBeVisible();
  await expectNoRawMessageKeys(checker);
});

test('create and submit an application; the credit score card is shown', async () => {
  await maker.goto('/en/lending/applications');
  await maker.getByRole('button', { name: 'New application' }).click();
  await maker.locator('[data-tour=app-find-borrower]').fill(lastName);
  await maker.getByRole('button', { name: 'Search', exact: true }).first().click();
  const borrowerSelect = maker.locator('select[data-tour=app-borrower-select]');
  await expect(borrowerSelect.locator('option', { hasText: fullName })).toHaveCount(1);
  await borrowerSelect.selectOption({ label: (await borrowerSelect.locator('option', { hasText: fullName }).innerText()).trim() });
  const productSelect = maker.locator('select[data-tour=app-product-select]');
  const personal = productSelect.locator('option', { hasText: '(PL-STD)' });
  await expect(personal).toHaveCount(1);
  await productSelect.selectOption({ label: (await personal.innerText()).trim() });
  await maker.getByLabel(/^Principal/).fill('1200');
  await maker.getByLabel(/Number of instalments/).fill('12');
  await maker.locator('[data-tour=app-create-draft]').click();

  await expect(maker).toHaveURL(/\/en\/lending\/applications\/[0-9a-f-]{36}/);
  applicationUrl = maker.url();
  // The header breadcrumb names the section, not the record id.
  const id = applicationUrl.split('/').pop()!;
  await expect(maker.locator('body')).not.toContainText(id.replace(/-/g, ' '), { ignoreCase: true });
  const title = maker.getByRole('heading', { level: 1 });
  await expect(title).toContainText('Draft');
  await expect(maker.getByRole('main')).toContainText(fullName);

  // The product asks for an identity document before submission.
  await maker.getByRole('button', { name: 'Upload document' }).click();
  const docType = maker.getByLabel('Document type');
  await docType.selectOption({ label: (await docType.locator('option', { hasText: 'Identity document' }).first().innerText()).trim() });
  await maker.getByLabel(/^File/).setInputFiles(signedFormPdf('national-id.pdf'));
  await maker.getByRole('button', { name: 'Upload', exact: true }).click();
  await expect(maker.getByRole('main')).toContainText('national-id.pdf');

  await maker.getByRole('button', { name: 'Submit', exact: true }).click();
  const confirm = maker.getByRole('alertdialog', { name: 'Submit application' });
  await confirm.getByRole('button', { name: 'Submit' }).click();
  await expect(confirm).toBeHidden();
  await expect(title).toContainText('Submitted');
  await expect(maker.getByText('Credit score').first()).toBeVisible();
  await expectNoRawMessageKeys(maker);
});

test('recommend (second person) and approve (third person)', async () => {
  await checker.goto(applicationUrl);
  await checker.getByRole('button', { name: 'Recommend', exact: true }).click();
  await checker.locator('[data-tour=app-decision-rationale]').fill('Affordable; score within appetite.');
  await checker.locator('[data-tour=app-decision-submit]').click();
  await expect(checker.getByRole('heading', { level: 1 })).toContainText('Recommended');

  await approver.goto(applicationUrl);
  await approver.getByRole('button', { name: 'Approve', exact: true }).click();
  await approver.locator('[data-tour=app-decision-rationale]').fill('Approved within authority.');
  await approver.locator('[data-tour=app-decision-submit]').click();
  await expect(approver.getByRole('heading', { level: 1 })).toContainText('Approved');
});

test('key facts statement: issued, customer acceptance recorded with the signed form', async () => {
  await maker.goto(applicationUrl);
  const generate = maker.getByRole('button', { name: 'Generate statement for the current terms' });
  if (await generate.isVisible().catch(() => false)) await generate.click();
  await expect(maker.getByText('Version 1')).toBeVisible();
  await expect(maker.getByText('Effective annual rate (APR)')).toBeVisible();
  await expect(maker.getByText('Cooling-off')).toBeVisible();
  await maker.getByRole('button', { name: 'Record customer acceptance' }).click();
  await maker.getByLabel(/Signed statement/).setInputFiles(signedFormPdf());
  await maker.getByRole('button', { name: 'Record acceptance', exact: true }).click();
  await expect(maker.getByText('Accepted by the customer')).toBeVisible();
});

test('book the loan account', async () => {
  await maker.getByRole('button', { name: 'Book agreement' }).click();
  await maker.getByRole('button', { name: 'Book loan account' }).click();
  const link = maker.getByRole('link', { name: /^[A-Z]{2,}-?[\w-]+$/ }).first();
  await expect(maker.getByText('Booked', { exact: true }).first()).toBeVisible();
  loanReference = (await link.innerText()).trim();
  await link.click();
  await expect(maker).toHaveURL(/\/en\/lending\/loans\/[0-9a-f-]{36}/);
  loanUrl = maker.url();
});

test('guided tour "Pay out a loan" over the booked loan', async () => {
  await maker.goto(`/en/learn/${lessonFor('disbursement')}`);
  await maker.getByRole('button', { name: 'Start the guided tour' }).click();
  const shown = await stepThroughTour(maker, 'disbursement', {
    // Open this journey's loan, and its Disbursement panel, as a person would.
    'loan-list-row-link': (page) => page.locator('[data-tour=loan-list-row-link]', { hasText: loanReference }).click(),
    'loan-servicing-actions': (page) =>
      page.locator('[data-tour=loan-servicing-actions]').getByRole('button', { name: 'Disbursement', exact: true }).click(),
  });
  test.info().annotations.push({ type: 'steps shown', description: shown.join(' → ') });
  // Nothing is prepared or approved yet: the approval task, the payees and
  // the execute step only appear once a disbursement is prepared / approved.
  expect(skippedSteps('disbursement', shown)).toEqual(['Step 2: approve or reject', 'Pay to', 'Step 3: execute']);
  await expect(maker).toHaveURL(loanUrl);
});

test('conditions precedent: the signed loan agreement is recorded', async () => {
  await maker.goto(applicationUrl);
  const row = maker.getByRole('row', { name: /Loan agreement signed by the borrower/ });
  await row.getByRole('button', { name: 'Satisfy' }).click();
  await maker.getByLabel(/^Evidence/).fill(`Agreement signed at the branch, file E2E-${stamp}`);
  await maker.getByRole('button', { name: 'Mark satisfied' }).click();
  await expect(row).toContainText('Satisfied');
});

async function openServicing(page: Page, action: string) {
  await page.goto(loanUrl);
  await page.locator('[data-tour=loan-servicing-actions]').getByRole('button', { name: action, exact: true }).click();
}

test('disbursement: prepared by one person, approved and executed by another', async () => {
  await openServicing(maker, 'Disbursement');
  await maker.locator('[data-tour=disb-prepare]').getByRole('button', { name: 'Prepare disbursement' }).click();
  await expect(maker.getByText('Disbursement prepared — awaiting approval')).toBeVisible();
  await openServicing(maker, 'Disbursement');
  await expect(maker.locator('[data-tour=disb-pending-task]')).toBeVisible();
  // The maker cannot approve their own task.
  await expect(maker.locator('[data-tour=disb-pending-task]').getByRole('button', { name: 'Approve' })).toHaveCount(0);

  await openServicing(approver, 'Disbursement');
  await approver.locator('[data-tour=disb-pending-task]').getByRole('button', { name: 'Approve' }).click();
  const approve = approver.getByRole('alertdialog', { name: 'Approve disbursement' });
  await approve.getByRole('button', { name: 'Approve' }).click();
  await expect(approver.getByText('Disbursement approved')).toBeVisible();
  if (!(await approver.locator('[data-tour=disb-execute]').isVisible())) await openServicing(approver, 'Disbursement');
  await expect(approver.locator('[data-tour=disb-execute]')).toBeVisible();
  await approver.locator('[data-tour=disb-execute]').getByLabel('External reference').fill(`E2E-PAYOUT-${stamp}`);
  await approver.locator('[data-tour=disb-execute]').getByRole('button', { name: 'Execute disbursement' }).click();
  await approver.getByRole('alertdialog', { name: 'Execute disbursement' }).getByRole('button', { name: 'Execute' }).click();
  await expect(approver.getByRole('heading', { level: 1 })).toContainText('Active');
});

test('servicing: schedule and events, post a repayment, early-settlement quote', async () => {
  await maker.goto(loanUrl);
  const main = maker.getByRole('main');
  await expect(main.getByText('Schedule', { exact: true })).toBeVisible();
  await expect(main.getByText('Financial events', { exact: true })).toBeVisible();

  await openServicing(maker, 'Post repayment');
  await maker.locator('[data-tour=repay-amount-fields]').getByLabel(/^Amount/).fill('50');
  await maker.locator('[data-tour=repay-post-button]').click();
  await expect(maker.getByText('Repayment posted')).toBeVisible();
  await expectNoRawMessageKeys(maker);

  await openServicing(maker, 'Early settlement');
  await maker.getByRole('button', { name: 'Get quote' }).click();
  await expect(maker.getByText('Payable').first()).toBeVisible();
  await expect(maker.getByRole('button', { name: /^Settle / })).toBeVisible();
  await expectNoRawMessageKeys(maker);
});

test('cooling-off: the cancellation window and amount are shown for the new loan', async () => {
  // The key facts statement promised a cooling-off period (D-125).
  await openServicing(maker, 'Cooling-off cancellation');
  await expect(maker.getByText(/The customer may cancel within \d+ days of disbursement/)).toBeVisible();
  await expect(maker.getByText('To cancel today')).toBeVisible();
  await expect(maker.getByRole('button', { name: 'Record cancellation request' })).toBeVisible();
  await expectNoRawMessageKeys(maker);
});

test('in Khmer: the loan account and its application', async () => {
  await maker.goto(loanUrl.replace('/en/', '/km/'));
  await expect(maker.locator('html')).toHaveAttribute('lang', 'km');
  await expect(maker.getByRole('heading', { level: 1 })).toContainText(loanReference);
  await expect(maker.getByRole('main')).toContainText(msg('km', 'LendingServicing.loanDetail.schedule.title'));
  await maker.waitForLoadState('networkidle');
  await expectNoRawMessageKeys(maker);

  await maker.goto(applicationUrl.replace('/en/', '/km/'));
  await expect(maker.getByRole('main')).toContainText(msg('km', 'LendingOrigination.keyFacts.title'));
  await maker.waitForLoadState('networkidle');
  await expectNoRawMessageKeys(maker);
});
