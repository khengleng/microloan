import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { AUTH_DIR, STACK_STATE, repoRoot } from './paths';

/**
 * Before every run: the QA accounts' authenticators are switched off again
 * (as on the hosted demo), so the setup project enrols them through the UI
 * each time and every run starts from the same state. Only for the local
 * stack this repository started (apps/e2e/.stack/state.json); a run against
 * another E2E_BASE_URL leaves its data alone.
 */
export default function globalSetup() {
  // Re-running one spec while fixing it: keep this run's sessions and skip the
  // setup project (`E2E_KEEP_SESSIONS=1 npx playwright test --no-deps <spec>`).
  // Each full run signs every QA account in once, and the API allows ten
  // sign-ins per account per 15 minutes.
  if (process.env.E2E_KEEP_SESSIONS === '1') return;
  fs.rmSync(AUTH_DIR, { recursive: true, force: true });
  fs.mkdirSync(AUTH_DIR, { recursive: true });
  if (!fs.existsSync(STACK_STATE)) {
    throw new Error(
      'No local stack found (apps/e2e/.stack/state.json). Start it with `node scripts/e2e-stack.mjs up`.',
    );
  }
  execFileSync('node', [path.join(repoRoot, 'scripts/e2e-stack.mjs'), 'reset-qa-mfa'], {
    cwd: repoRoot,
    stdio: 'inherit',
  });
}
