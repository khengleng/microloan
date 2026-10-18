/**
 * The Learning centre's content model (D-090…D-093).
 *
 * Lessons, learning paths, quizzes and guided tours are data: the web app
 * renders them, the API grades quizzes and reports progress against them, and
 * the content tests check that every tour target, tour reference and manual
 * link resolves. Business facts in lesson text must agree with the end-user
 * manual (docs/user-guide); lessons link to the manual instead of repeating it.
 *
 * Lesson body text is English for now (like the manual); the portal's chrome
 * around it is translated.
 */

/** A role-based learning path. */
export type LearningPathId =
  | 'loan-officer'
  | 'credit-analyst'
  | 'credit-approver'
  | 'loan-operations'
  | 'collections'
  | 'finance'
  | 'product-team'
  | 'risk-compliance'
  | 'auditor'
  | 'tenant-admin';

/** One step of a guided tour. */
export interface TourStep {
  /**
   * The `data-tour="…"` id of the element to highlight. Absent: an
   * explanation in the middle of the screen. When the element is not on the
   * page (hidden by permissions, or the page has no data yet) the step is
   * skipped.
   */
  target?: string;
  title: string;
  body: string;
  /**
   * 'click': the step waits for the person to click the highlighted element
   * (which may open a dialog or another page; the tour follows). Default: the
   * step is an explanation and advances with Next.
   */
  action?: 'click';
  /** Where the popover sits relative to the target. Default 'auto'. */
  placement?: 'auto' | 'top' | 'bottom' | 'left' | 'right';
}

/** A guided tour over real portal screens. */
export interface TourDefinition {
  id: string;
  title: string;
  summary: string;
  /** Page the tour starts on, without the locale ("/lending/applications"). */
  startPath: string;
  /**
   * Pages whose "Take the tour" button offers this tour, without the locale.
   * Like the manual's contextual help: "/lending/loans" matches that page and
   * its sub-pages; a prefix ending in "/" ("/lending/loans/") matches only
   * sub-pages.
   */
  pages: string[];
  /** Demo Lending Co account to practise with ("officer.pnh"). */
  demoAccount?: string;
  steps: TourStep[];
}

/** A caption of an animated explainer. */
export interface ExplainerStage {
  label: string;
  caption: string;
}

/**
 * A short animated illustration. Each kind is drawn by one component; what
 * it shows (labels, accounts, buckets, points) comes from here.
 */
export type Explainer =
  /** A token moving along a chain of stages (a lifecycle, a pipeline). */
  | { kind: 'flow'; stages: ExplainerStage[] }
  /** Two people handing a record back and forth (maker-checker). */
  | {
      kind: 'handoff';
      actors: [string, string];
      stages: (ExplainerStage & { actor: 0 | 1 })[];
    }
  /** Journal entries building up in T-accounts (money flow). */
  | {
      kind: 'ledger';
      stages: (ExplainerStage & {
        entries: { account: string; side: 'DR' | 'CR'; amount: string }[];
      })[];
    }
  /** A loan's days past due moving through ageing buckets. */
  | {
      kind: 'ageing';
      buckets: { label: string; fromDays: number; toDays?: number }[];
      stages: (ExplainerStage & { days: number })[];
    }
  /** Scorecard points adding up to a score and a grade. */
  | {
      kind: 'points';
      attributes: { name: string; value: string; points: number }[];
      /** Grade bands, lowest minimum first. */
      grades: { grade: string; min: number }[];
      stages: ExplainerStage[];
    }
  /** The portal's layout, one area at a time. */
  | {
      kind: 'screen';
      stages: (ExplainerStage & {
        area: 'menu' | 'queues' | 'search' | 'language' | 'help' | 'content';
      })[];
    };

export interface QuizQuestion {
  id: string;
  prompt: string;
  options: string[];
  /** Index of the correct option. */
  answer: number;
  /** Shown after answering: why the answer is right. */
  explanation: string;
}

export interface Lesson {
  id: string;
  title: string;
  summary: string;
  /** Estimated minutes, including the tour and quiz. */
  minutes: number;
  objectives: string[];
  explainer: Explainer;
  /** The guided tour "Try it" launches. */
  tourId?: string;
  /** The manual chapter (file name without .md) and optional heading anchor. */
  guide: { chapter: string; anchor?: string };
  quiz: {
    /** Correct answers needed to pass. */
    passMark: number;
    questions: QuizQuestion[];
  };
}

export interface LearningPath {
  id: LearningPathId;
  title: string;
  summary: string;
  /** Lending roles (ROLE_DEFINITIONS codes) the path is meant for. */
  roles: string[];
  lessonIds: string[];
}

/** One content module: an area's tours, lessons and the paths they belong to. */
export interface LearningModule {
  tours: TourDefinition[];
  lessons: Lesson[];
  /** Lesson ids to append to each path, in order. */
  pathLessons: Partial<Record<LearningPathId, string[]>>;
}
