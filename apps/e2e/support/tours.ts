import type { Page } from '@playwright/test';
import { expect } from '@playwright/test';
// The tour definitions the web app renders (packages/shared), so the test
// knows each step's target and whether it waits for a click.
import { TOUR_BY_ID, LESSON_BY_ID } from '../../../packages/shared/src/learning/catalogue';

export { TOUR_BY_ID, LESSON_BY_ID };

/** The open tour popover. */
export const tourPopover = (page: Page) => page.getByRole('dialog').filter({ has: page.locator('#tour-step-title') });

/**
 * Step through an active tour to its end. Returns the titles of the steps
 * that were shown; a step whose target never appears is skipped by the
 * engine, so the caller can tell which targets are missing from the page.
 * "Click" steps are done by clicking the highlighted element, as a person
 * would; explanation steps advance with Next; the last with Done.
 */
export async function stepThroughTour(
  page: Page,
  tourId: string,
  /** How to do a "click" step whose target is a container (click the button inside, say). */
  clicks: Record<string, (page: Page) => Promise<void>> = {},
): Promise<string[]> {
  const tour = TOUR_BY_ID[tourId];
  if (!tour) throw new Error(`unknown tour ${tourId}`);
  const pop = tourPopover(page);
  const shown: string[] = [];
  for (let guard = 0; guard < tour.steps.length * 2 + 2; guard++) {
    if (!(await pop.isVisible())) break;
    // Wait while the engine is still looking for the step's target.
    // The engine waits up to 5 s for a target, then skips the step.
    // When the last steps are all skipped the tour simply ends.
    await expect
      .poll(async () => ((await pop.isVisible()) ? await pop.locator('#tour-step-body').innerText() : '<closed>'), { timeout: 12_000 })
      .not.toMatch(/Looking for this on the page/);
    if (!(await pop.isVisible())) break;
    const title = (await pop.locator('#tour-step-title').innerText()).trim();
    const counter = (await pop.locator('p').first().innerText()).trim();
    const step = tour.steps.find((s) => s.title === title);
    if (!step) throw new Error(`tour ${tourId}: unexpected step "${title}"`);
    if (shown[shown.length - 1] !== title) shown.push(title);
    if (step.action === 'click' && step.target && clicks[step.target]) {
      await clicks[step.target](page);
    } else if (step.action === 'click' && step.target) {
      await page.locator(`[data-tour="${step.target}"]:visible`).first().click();
    } else {
      const [, at, of] = counter.match(/step (\d+) of (\d+)/i) ?? [];
      const last = !!at && at === of;
      await pop.getByRole('button', { name: last ? 'Done' : 'Next', exact: true }).click();
    }
    // The popover moves on (or closes) before the next read.
    await expect
      .poll(async () => (await pop.isVisible()) ? (await pop.locator('#tour-step-title').innerText()).trim() : '<closed>', { timeout: 10_000 })
      .not.toBe(title);
  }
  await expect(pop).toBeHidden();
  return shown;
}

/** The steps of a tour that were not shown (their target never appeared). */
export function skippedSteps(tourId: string, shown: string[]): string[] {
  return TOUR_BY_ID[tourId].steps.map((s) => s.title).filter((t) => !shown.includes(t));
}

/** The first lesson whose "Try it" starts this tour. */
export function lessonFor(tourId: string): string {
  const lesson = Object.values(LESSON_BY_ID).find((l) => l.tourId === tourId);
  if (!lesson) throw new Error(`no lesson starts tour ${tourId}`);
  return lesson.id;
}
