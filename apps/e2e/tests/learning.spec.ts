import type { Page } from '@playwright/test';
import { test, expect, expectNoRawMessageKeys } from '../support/fixtures';
import { storageOf } from '../support/accounts';
import { LESSON_BY_ID, TOUR_BY_ID, lessonFor, skippedSteps, stepThroughTour, tourPopover } from '../support/tours';

/**
 * Learning centre (D-092): paths, lessons, guided tours over the real screens
 * and quizzes. Signed in as qa.approver, whose progress the global setup
 * clears before each run.
 */
test.use({ storageState: storageOf('qa.approver') });

test('paths and lessons are listed; a lesson opens with its explainer and quiz', async ({ page }) => {
  await page.goto('/en/learn');
  await expect(page.getByRole('heading', { name: 'Learning centre', level: 1 })).toBeVisible();
  await expect(page.getByText('Learning paths', { exact: true })).toBeVisible();
  await page.getByRole('link', { name: /1\. Finding your way around/ }).first().click();
  await expect(page).toHaveURL(/\/en\/learn\/portal-orientation/);
  await expect(page.getByRole('heading', { name: 'Finding your way around' })).toBeVisible();
  await expect(page.getByText('What you will learn')).toBeVisible();
  await expect(page.getByText('Check your understanding')).toBeVisible();
  await expectNoRawMessageKeys(page);
});

test('portal orientation tour: every step is shown and completion is recorded', async ({ page }) => {
  await page.goto('/en/learn/portal-orientation');
  await page.getByRole('button', { name: 'Start the guided tour' }).click();
  await expect(tourPopover(page)).toBeVisible();
  const shown = await stepThroughTour(page, 'portal-orientation');
  expect(skippedSteps('portal-orientation', shown), 'tour steps whose target is missing').toEqual([]);

  // The completion is saved by the API; the lesson then says so.
  await page.waitForLoadState('networkidle');
  await page.goto('/en/learn/portal-orientation');
  await expect(page.getByText('Tour done')).toBeVisible();
  await page.goto('/en/learn');
  await expect(page.getByRole('link', { name: /Finding your way around/ }).first()).toContainText(/In progress|Completed/);
});

test('a quiz: wrong answers fail, right answers pass and complete the lesson', async ({ page }) => {
  const lesson = LESSON_BY_ID['portal-orientation'];
  await page.goto('/en/learn/portal-orientation');
  await page.waitForLoadState('networkidle');
  const answer = async (pick: (q: (typeof lesson.quiz.questions)[number]) => number) => {
    for (const [i, q] of lesson.quiz.questions.entries()) {
      // Each question is a fieldset whose legend is "<n>. <prompt>".
      const group = page.getByRole('group', { name: `${i + 1}. ${q.prompt}` });
      await group.getByLabel(q.options[pick(q)], { exact: true }).check();
    }
    await page.getByRole('button', { name: 'Check answers' }).click();
  };
  // All wrong first.
  await answer((q) => (q.answer + 1) % q.options.length);
  await expect(page.getByText(/You need \d+ correct answers to pass/)).toBeVisible();
  await page.getByRole('button', { name: 'Try again' }).click();
  await answer((q) => q.answer);
  await expect(page.getByText('Passed — lesson complete.')).toBeVisible();
  await expect(page.getByText(`You scored ${lesson.quiz.questions.length} of ${lesson.quiz.questions.length}.`)).toBeVisible();
});

for (const tourId of ['scorecards', 'create-application'] as const) {
  test(`guided tour "${TOUR_BY_ID[tourId].title}" runs to the end`, async ({ page }) => {
    await page.goto(`/en/learn/${lessonFor(tourId)}`);
    await page.getByRole('button', { name: 'Start the guided tour' }).click();
    await expect(tourPopover(page)).toBeVisible();
    const shown = await stepThroughTour(page, tourId, CLICKS[tourId]);
    test.info().annotations.push({ type: 'steps shown', description: shown.join(' → ') });
    expect(skippedSteps(tourId, shown), 'tour steps whose target is missing').toEqual(EXPECTED_SKIPS[tourId]);
  });
}

/**
 * Steps a tour skips by design in this state: they point at controls that
 * only exist in another state.
 */
const EXPECTED_SKIPS: Record<string, string[]> = {
  // Save / submit / approve exist only on a draft version; the tour opens the active one.
  scorecards: ['Save the draft', 'Submit (maker)', 'Approve, then activate (reviewer)'],
  'create-application': [],
};

/** How the tours' "do it" steps are done when they need more than a click. */
const CLICKS: Record<string, Record<string, (page: Page) => Promise<void>>> = {
  scorecards: {},
  'create-application': {
    // Fill the form the tour has just walked through, then create the draft:
    // the remaining steps are on the new application.
    'app-create-draft': async (page) => {
      await page.locator('[data-tour=app-find-borrower]').fill('Sokha');
      await page.locator('[data-tour=app-find-borrower]').press('Enter');
      const borrower = page.locator('select[data-tour=app-borrower-select]');
      await expect(borrower.locator('option', { hasText: 'Sokha Chan' })).toHaveCount(1);
      await borrower.selectOption({ label: (await borrower.locator('option', { hasText: 'Sokha Chan' }).innerText()).trim() });
      const product = page.locator('select[data-tour=app-product-select]');
      await product.selectOption({ label: (await product.locator('option', { hasText: '(PL-STD)' }).innerText()).trim() });
      await page.getByLabel(/^Principal/).fill('1200');
      await page.getByLabel(/Number of instalments/).fill('12');
      await page.locator('[data-tour=app-create-draft]').click();
    },
  },
};
