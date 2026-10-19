import type {
  LearningModule,
  LearningPath,
  LearningPathId,
  Lesson,
  TourDefinition,
} from './types.js';
import { ORIENTATION_MODULE } from './content/orientation.js';
import { GOVERNANCE_MODULE } from './content/governance.js';
import { ORIGINATION_MODULE } from './content/origination.js';
import { SERVICING_MODULE } from './content/servicing.js';
import { CONFIGURATION_MODULE } from './content/configuration.js';

/** Every content module, in the order their lessons appear in a path. */
export const LEARNING_MODULES: readonly LearningModule[] = [
  ORIENTATION_MODULE,
  GOVERNANCE_MODULE,
  ORIGINATION_MODULE,
  SERVICING_MODULE,
  CONFIGURATION_MODULE,
];

/** The learning paths: who each is for; lessons come from the modules. */
const PATHS: Omit<LearningPath, 'lessonIds'>[] = [
  {
    id: 'loan-officer',
    title: 'Loan officer',
    summary: 'Onboard customers, capture applications and submit them for assessment.',
    roles: ['RELATIONSHIP_OFFICER'],
  },
  {
    id: 'credit-analyst',
    title: 'Credit analyst',
    summary: 'Read the assessment and the credit score, then recommend a decision.',
    roles: ['CREDIT_ANALYST'],
  },
  {
    id: 'credit-approver',
    title: 'Credit approver',
    summary: 'Decide applications within your approval authority, with your authenticator.',
    roles: ['CREDIT_APPROVER'],
  },
  {
    id: 'loan-operations',
    title: 'Loan operations',
    summary: 'Book, disburse and service loans as maker or checker.',
    roles: ['LOAN_OPS_MAKER', 'LOAN_OPS_CHECKER'],
  },
  {
    id: 'collections',
    title: 'Collections',
    summary: 'Work overdue accounts from the collections queue and post what you collect.',
    roles: ['COLLECTIONS_OFFICER', 'RESTRUCTURE_COMMITTEE'],
  },
  {
    id: 'finance',
    title: 'Finance',
    summary: 'Follow the money through the ledger, run end of day and close the month.',
    roles: ['FINANCE_OFFICER'],
  },
  {
    id: 'product-team',
    title: 'Product team',
    summary: 'Design products and scorecards and put them in force under maker-checker.',
    roles: ['PRODUCT_MAKER', 'PRODUCT_CHECKER'],
  },
  {
    id: 'risk-compliance',
    title: 'Risk & compliance',
    summary: 'Approve risk models and closes, and oversee access and the audit trail.',
    roles: ['RISK_COMPLIANCE'],
  },
  {
    id: 'auditor',
    title: 'Auditor',
    summary: 'Find out who did what, when, and what changed.',
    roles: ['AUDITOR'],
  },
  {
    id: 'tenant-admin',
    title: 'Tenant administrator',
    summary: 'Manage people, roles and approval authorities, and follow the team’s training.',
    roles: ['TENANT_ADMIN'],
  },
];

export const LEARNING_PATHS: readonly LearningPath[] = PATHS.map((p) => ({
  ...p,
  lessonIds: [
    ...new Set(LEARNING_MODULES.flatMap((m) => m.pathLessons[p.id] ?? [])),
  ],
}));

export const LESSONS: readonly Lesson[] = LEARNING_MODULES.flatMap((m) => m.lessons);
export const TOURS: readonly TourDefinition[] = LEARNING_MODULES.flatMap((m) => m.tours);

export const LESSON_BY_ID: Readonly<Record<string, Lesson>> = Object.fromEntries(
  LESSONS.map((l) => [l.id, l]),
);
export const TOUR_BY_ID: Readonly<Record<string, TourDefinition>> = Object.fromEntries(
  TOURS.map((t) => [t.id, t]),
);
export const PATH_BY_ID: Readonly<Record<string, LearningPath>> = Object.fromEntries(
  LEARNING_PATHS.map((p) => [p.id, p]),
);

/** The tour the first-login prompt offers, and the lesson that records it. */
export const ORIENTATION_LESSON_ID = 'portal-orientation';

/** Lesson ids are kebab-case, as in the content modules. */
export const LESSON_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export interface QuizResult {
  score: number;
  total: number;
  passed: boolean;
}

/**
 * Marks a quiz. `answers[i]` is the chosen option of question i; a missing
 * or out-of-range answer is wrong. Returns null for an unknown lesson or an
 * answer list of the wrong length.
 */
export function gradeQuiz(lessonId: string, answers: readonly number[]): QuizResult | null {
  const lesson = LESSON_BY_ID[lessonId];
  if (!lesson) return null;
  const qs = lesson.quiz.questions;
  if (answers.length !== qs.length) return null;
  const score = qs.reduce((n, q, i) => n + (answers[i] === q.answer ? 1 : 0), 0);
  return { score, total: qs.length, passed: score >= lesson.quiz.passMark };
}

/** The learning paths for a set of lending role codes (all paths when none match). */
export function pathsForRoles(roleCodes: readonly string[]): LearningPath[] {
  const mine = LEARNING_PATHS.filter((p) => p.roles.some((r) => roleCodes.includes(r)));
  return mine.length ? mine : [...LEARNING_PATHS];
}

/**
 * Does a page path (without the locale) offer this tour? Same rules as the
 * manual's contextual help: "/x" matches /x and its sub-pages, "/x/" only
 * sub-pages.
 */
export function tourMatchesPath(tour: TourDefinition, path: string): boolean {
  return tour.pages.some((prefix) =>
    prefix.endsWith('/')
      ? path.startsWith(prefix) && path.length > prefix.length
      : path === prefix || path.startsWith(`${prefix}/`),
  );
}

/** Tours offered on a page, most specific page prefix first. */
export function toursForPath(path: string): TourDefinition[] {
  const best = (t: TourDefinition) =>
    Math.max(...t.pages.filter((p) => tourMatchesPath({ ...t, pages: [p] }, path)).map((p) => p.length));
  return TOURS.filter((t) => tourMatchesPath(t, path)).sort((a, b) => best(b) - best(a));
}

/** Lessons whose "Try it" is this tour. */
export function lessonsForTour(tourId: string): Lesson[] {
  return LESSONS.filter((l) => l.tourId === tourId);
}

export type { LearningPathId };
