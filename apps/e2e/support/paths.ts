import fs from 'node:fs';
import path from 'node:path';

export const e2eRoot = path.resolve(__dirname, '..');
export const repoRoot = path.resolve(e2eRoot, '../..');
export const STACK_STATE = path.join(e2eRoot, '.stack/state.json');
/** Sessions and authenticator secrets the setup project creates for this run. */
export const AUTH_DIR = path.join(e2eRoot, '.auth');

export interface StackState {
  webUrl: string;
  apiUrl: string;
  databaseUrl: string;
  demoPassword: string;
}

export function stackState(): StackState {
  return JSON.parse(fs.readFileSync(STACK_STATE, 'utf8')) as StackState;
}

/** The demo users' password: DEMO_PASSWORD, else the one the stack seeded with. */
export function demoPassword(): string {
  return process.env.DEMO_PASSWORD?.trim() || stackState().demoPassword;
}
