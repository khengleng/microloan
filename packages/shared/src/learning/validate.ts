import type { LearningModule, LearningPath } from './types.js';
import { LESSON_ID_PATTERN } from './catalogue.js';

export interface GuideIndex {
  /** Chapter slugs (file names without .md). */
  slugs: readonly string[];
  /** Heading anchors of each chapter (GitHub style). */
  anchors: Readonly<Record<string, readonly string[]>>;
}

const unnumbered = (slug: string) => slug.replace(/^\d+-/, '');

/** The chapter's current slug, as the portal's guide links resolve it. */
export function resolveChapter(chapter: string, slugs: readonly string[]): string | null {
  if (slugs.includes(chapter)) return chapter;
  return slugs.find((s) => unnumbered(s) === unnumbered(chapter)) ?? null;
}

/**
 * Checks the learning content for broken references. Returns one message per
 * problem; an empty list means the content is consistent.
 *
 * - ids are unique and kebab-case; every lesson's tour exists;
 * - every path lesson exists and every lesson is in a path;
 * - quizzes have 3–5 questions with a valid answer and pass mark;
 * - with `guide`: every manual link names an existing chapter and heading;
 * - with `targets`: every tour step's target is a data-tour id on a screen.
 */
export function validateLearningContent(
  modules: readonly LearningModule[],
  paths: readonly LearningPath[],
  opts: { guide?: GuideIndex; targets?: ReadonlySet<string> } = {},
): string[] {
  const errors: string[] = [];
  const lessons = modules.flatMap((m) => m.lessons);
  const tours = modules.flatMap((m) => m.tours);
  const dup = (ids: string[], what: string) => {
    const seen = new Set<string>();
    for (const id of ids) {
      if (seen.has(id)) errors.push(`duplicate ${what} id ${id}`);
      seen.add(id);
      if (!LESSON_ID_PATTERN.test(id)) errors.push(`${what} id ${id} is not kebab-case`);
    }
  };
  dup(lessons.map((l) => l.id), 'lesson');
  dup(tours.map((t) => t.id), 'tour');
  const tourIds = new Set(tours.map((t) => t.id));
  const lessonIds = new Set(lessons.map((l) => l.id));

  for (const t of tours) {
    if (!t.startPath.startsWith('/')) errors.push(`tour ${t.id}: startPath must start with /`);
    if (!t.pages.length) errors.push(`tour ${t.id}: no pages offer it`);
    if (!t.steps.length) errors.push(`tour ${t.id}: no steps`);
    t.steps.forEach((s, i) => {
      if (!s.title.trim() || !s.body.trim()) errors.push(`tour ${t.id} step ${i + 1}: title and body are required`);
      if (s.action === 'click' && !s.target) errors.push(`tour ${t.id} step ${i + 1}: a click step needs a target`);
      if (s.target && opts.targets && !opts.targets.has(s.target))
        errors.push(`tour ${t.id} step ${i + 1}: no element has data-tour="${s.target}"`);
    });
  }

  for (const l of lessons) {
    if (l.tourId && !tourIds.has(l.tourId)) errors.push(`lesson ${l.id}: tour ${l.tourId} does not exist`);
    if (!l.objectives.length) errors.push(`lesson ${l.id}: no objectives`);
    const stages = l.explainer.stages.length;
    if (stages < 2 || stages > 8) errors.push(`lesson ${l.id}: explainer needs 2–8 stages, has ${stages}`);
    const qs = l.quiz.questions;
    if (qs.length < 3 || qs.length > 5) errors.push(`lesson ${l.id}: quiz needs 3–5 questions, has ${qs.length}`);
    if (l.quiz.passMark < 1 || l.quiz.passMark > qs.length)
      errors.push(`lesson ${l.id}: pass mark ${l.quiz.passMark} is outside 1–${qs.length}`);
    const qids = new Set<string>();
    for (const q of qs) {
      if (qids.has(q.id)) errors.push(`lesson ${l.id}: duplicate question id ${q.id}`);
      qids.add(q.id);
      if (q.options.length < 2 || q.options.length > 5)
        errors.push(`lesson ${l.id} question ${q.id}: needs 2–5 options`);
      if (!Number.isInteger(q.answer) || q.answer < 0 || q.answer >= q.options.length)
        errors.push(`lesson ${l.id} question ${q.id}: answer ${q.answer} is not an option`);
      if (!q.explanation.trim()) errors.push(`lesson ${l.id} question ${q.id}: no explanation`);
    }
    if (opts.guide) {
      const slug = resolveChapter(l.guide.chapter, opts.guide.slugs);
      if (!slug) errors.push(`lesson ${l.id}: manual chapter ${l.guide.chapter} does not exist`);
      else if (l.guide.anchor && !(opts.guide.anchors[slug] ?? []).includes(l.guide.anchor))
        errors.push(`lesson ${l.id}: chapter ${slug} has no heading #${l.guide.anchor}`);
    }
  }

  const inPath = new Set<string>();
  for (const p of paths) {
    if (!p.lessonIds.length) errors.push(`path ${p.id}: no lessons`);
    for (const id of p.lessonIds) {
      if (!lessonIds.has(id)) errors.push(`path ${p.id}: lesson ${id} does not exist`);
      inPath.add(id);
    }
  }
  for (const m of modules)
    for (const [path, ids] of Object.entries(m.pathLessons))
      if (!paths.some((p) => p.id === path)) errors.push(`unknown path ${path} (lessons ${ids?.join(', ')})`);
  for (const l of lessons) if (!inPath.has(l.id)) errors.push(`lesson ${l.id} is in no learning path`);
  return errors;
}
