#!/usr/bin/env node
/**
 * Lint, without fixing, the lending files this branch adds or changes.
 *
 *   node scripts/lint-changed-lending.mjs [base-ref]     (default: origin/main)
 *
 * The repository carries thousands of legacy lint errors (mostly prettier),
 * so CI runs the full lint as information only. This is the blocking part:
 * every lending file a change touches must be clean, so the lending code
 * gets cleaner with each change instead of accumulating more. Fix a file
 * with `pnpm --filter api exec eslint --fix <file>` (or `--filter web`).
 *
 * Needs the base ref in the clone (actions/checkout with fetch-depth: 0).
 * With no merge base (a shallow clone, a push to main itself) it lints
 * nothing and says so.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';

const base = process.argv[2] || 'origin/main';

/** Files under these prefixes are linted by the app named, relative to it. */
const SCOPES = [
  { app: 'apps/api', filter: 'api', prefixes: ['apps/api/src/lending/', 'apps/api/test/lending/'], ext: /\.ts$/ },
  {
    app: 'apps/web',
    filter: 'web',
    prefixes: ['apps/web/src/components/lending/', 'apps/web/src/app/[locale]/(app)/lending/'],
    ext: /\.(ts|tsx)$/,
  },
];

let mergeBase;
try {
  mergeBase = execFileSync('git', ['merge-base', base, 'HEAD'], { encoding: 'utf8' }).trim();
} catch {
  console.log(`No merge base with ${base}; nothing to lint (fetch the base ref to enable this check).`);
  process.exit(0);
}

const changed = execFileSync('git', ['diff', '--name-only', '--diff-filter=ACMR', `${mergeBase}...HEAD`], {
  encoding: 'utf8',
})
  .split('\n')
  .filter(Boolean)
  .filter((f) => fs.existsSync(f));

let failed = false;
for (const scope of SCOPES) {
  const files = changed
    .filter((f) => scope.prefixes.some((p) => f.startsWith(p)) && scope.ext.test(f))
    .map((f) => f.slice(scope.app.length + 1));
  if (!files.length) {
    console.log(`${scope.app}: no changed lending files.`);
    continue;
  }
  console.log(`${scope.app}: linting ${files.length} changed lending file(s).`);
  const r = spawnSync('pnpm', ['--filter', scope.filter, 'exec', 'eslint', '--', ...files], {
    stdio: 'inherit',
  });
  if (r.status !== 0) failed = true;
}
process.exit(failed ? 1 : 0);
