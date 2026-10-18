/**
 * Learning centre content (D-090…D-093): every reference in the lessons and
 * tours resolves — tours named by lessons exist, tour steps point at
 * data-tour ids that are on a screen, and manual links name an existing
 * chapter and heading of docs/user-guide.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { learning as L } from '../src/index.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../../..');
const GUIDE_DIR = path.join(repo, 'docs/user-guide');
const WEB_SRC = path.join(repo, 'apps/web/src');

/** GitHub's heading anchors, as the portal's guide generator makes them. */
const githubSlug = (text: string) =>
  text
    .toLowerCase()
    .trim()
    .replace(/[^\p{L}\p{M}\p{N}\p{Pc} -]/gu, '')
    .replace(/ /g, '-');

const plain = (md: string) =>
  md
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[*_`]/g, '')
    .replace(/<[^>]*>/g, '')
    .trim();

function guideIndex(): L.GuideIndex {
  const files = fs.readdirSync(GUIDE_DIR).filter((f) => f.endsWith('.md') && f !== 'README.md');
  const anchors: Record<string, string[]> = {};
  for (const f of files) {
    const seen = new Map<string, number>();
    const ids: string[] = [];
    let fenced = false;
    for (const line of fs.readFileSync(path.join(GUIDE_DIR, f), 'utf8').split('\n')) {
      if (/^\s*```/.test(line)) fenced = !fenced;
      const m = !fenced && /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line);
      if (!m) continue;
      const base = githubSlug(plain(m[2]));
      const n = seen.get(base) ?? 0;
      seen.set(base, n + 1);
      ids.push(n === 0 ? base : `${base}-${n}`);
    }
    anchors[f.replace(/\.md$/, '')] = ids;
  }
  return { slugs: Object.keys(anchors), anchors };
}

function dataTourIds(): Set<string> {
  const ids = new Set<string>();
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (e.name !== 'generated' && e.name !== 'node_modules') walk(p);
      } else if (/\.tsx?$/.test(e.name)) {
        for (const m of fs.readFileSync(p, 'utf8').matchAll(/['"]?data-tour['"]?\s*[=:]\s*['"]([a-z0-9-]+)['"]/g)) ids.add(m[1]);
      }
    }
  };
  walk(WEB_SRC);
  return ids;
}

describe('learning content', () => {
  test('is internally consistent, links to real manual headings and real screen elements', () => {
    const errors = L.validateLearningContent(L.LEARNING_MODULES, L.LEARNING_PATHS, {
      guide: guideIndex(),
      targets: dataTourIds(),
    });
    assert.deepEqual(errors, []);
  });

  test('every lesson tour exists and every tour is used by a lesson', () => {
    for (const l of L.LESSONS) if (l.tourId) assert.ok(L.TOUR_BY_ID[l.tourId], `${l.id} → ${l.tourId}`);
    for (const t of L.TOURS) assert.ok(L.lessonsForTour(t.id).length > 0, `tour ${t.id} has no lesson`);
  });

  test('covers the ten role paths, each starting with the orientation lesson', () => {
    assert.equal(L.LEARNING_PATHS.length, 10);
    for (const p of L.LEARNING_PATHS) {
      assert.equal(p.lessonIds[0], L.ORIENTATION_LESSON_ID, p.id);
      assert.ok(p.lessonIds.length >= 2, `${p.id} has too few lessons`);
    }
  });

  test('the validator reports broken references', () => {
    const lesson = L.LESSONS[0];
    const broken: L.LearningModule = {
      tours: [{ id: 'x-tour', title: 't', summary: 's', startPath: '/home', pages: ['/home'], steps: [{ target: 'nowhere', title: 't', body: 'b' }] }],
      lessons: [{ ...lesson, id: 'x-lesson', tourId: 'missing-tour', guide: { chapter: '99-nothing' } }],
      pathLessons: { auditor: ['x-lesson', 'ghost'] },
    };
    const errors = L.validateLearningContent([broken], [{ ...L.LEARNING_PATHS[0], id: 'auditor', lessonIds: ['x-lesson', 'ghost'] }], {
      guide: guideIndex(),
      targets: new Set(),
    });
    assert.ok(errors.some((e) => e.includes('tour missing-tour does not exist')));
    assert.ok(errors.some((e) => e.includes('manual chapter 99-nothing')));
    assert.ok(errors.some((e) => e.includes('data-tour="nowhere"')));
    assert.ok(errors.some((e) => e.includes('lesson ghost does not exist')));
  });

  test('marks quizzes', () => {
    const l = L.LESSON_BY_ID[L.ORIENTATION_LESSON_ID];
    const right = l.quiz.questions.map((q) => q.answer);
    assert.deepEqual(L.gradeQuiz(l.id, right), { score: right.length, total: right.length, passed: true });
    const wrong = l.quiz.questions.map((q) => (q.answer + 1) % q.options.length);
    assert.deepEqual(L.gradeQuiz(l.id, wrong), { score: 0, total: right.length, passed: false });
    assert.equal(L.gradeQuiz(l.id, right.slice(1)), null);
    assert.equal(L.gradeQuiz('no-such-lesson', right), null);
  });

  test('offers tours by page like the contextual help', () => {
    const t: L.TourDefinition = { id: 'x', title: '', summary: '', startPath: '/a', pages: ['/lending/loans/'], steps: [] };
    assert.equal(L.tourMatchesPath(t, '/lending/loans'), false);
    assert.equal(L.tourMatchesPath(t, '/lending/loans/abc'), true);
    assert.equal(L.tourMatchesPath({ ...t, pages: ['/home'] }, '/home'), true);
    assert.equal(L.tourMatchesPath({ ...t, pages: ['/home'] }, '/homework'), false);
    assert.ok(L.toursForPath('/home').some((x) => x.id === 'portal-orientation'));
  });

  test('suggests paths from lending roles', () => {
    assert.deepEqual(L.pathsForRoles(['CREDIT_ANALYST']).map((p) => p.id), ['credit-analyst']);
    assert.equal(L.pathsForRoles([]).length, 10);
  });
});
