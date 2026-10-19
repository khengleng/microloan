import {
  MFA_STEP_UP_REQUIRED,
  adminMfaSettingFrom,
  assertFreshMfa,
  mfaIsFresh,
  roleRequiresMfa,
} from './mfa-policy';
import { actorFromJwt } from '../lending/common/util';

const now = Date.UTC(2030, 0, 1, 12, 0, 0);
const secondsAgo = (s: number) => Math.floor(now / 1000) - s;

describe('MFA freshness (D-129)', () => {
  const original = process.env.AUTH_MFA_STEP_UP_MINUTES;
  afterEach(() => {
    if (original === undefined) delete process.env.AUTH_MFA_STEP_UP_MINUTES;
    else process.env.AUTH_MFA_STEP_UP_MINUTES = original;
  });

  it('a code from within the window is fresh; one older is not', () => {
    expect(mfaIsFresh({ amr: 'mfa', mfaAt: secondsAgo(60) }, now)).toBe(true);
    expect(mfaIsFresh({ amr: 'mfa', mfaAt: secondsAgo(14 * 60) }, now)).toBe(true);
    expect(mfaIsFresh({ amr: 'mfa', mfaAt: secondsAgo(16 * 60) }, now)).toBe(false);
  });

  it('a refreshed session that kept amr=mfa for days is not fresh', () => {
    expect(mfaIsFresh({ amr: 'mfa', mfaAt: secondsAgo(25 * 86_400) }, now)).toBe(false);
  });

  it('a session without mfaAt, or signed in with a password only, is never fresh', () => {
    expect(mfaIsFresh({ amr: 'mfa' }, now)).toBe(false);
    expect(mfaIsFresh({ amr: 'pwd', mfaAt: secondsAgo(1) }, now)).toBe(false);
  });

  it('a timestamp from the future is not trusted', () => {
    expect(mfaIsFresh({ amr: 'mfa', mfaAt: secondsAgo(-3600) }, now)).toBe(false);
  });

  it('the window is a deployment setting', () => {
    process.env.AUTH_MFA_STEP_UP_MINUTES = '60';
    expect(mfaIsFresh({ amr: 'mfa', mfaAt: secondsAgo(30 * 60) }, now)).toBe(true);
  });

  it('assertFreshMfa throws the step-up code the web reacts to', () => {
    let caught: any;
    try {
      assertFreshMfa({ amr: 'mfa', mfaAt: 1 });
    } catch (e) {
      caught = e;
    }
    expect(caught.getStatus()).toBe(403);
    expect(caught.getResponse().code).toBe(MFA_STEP_UP_REQUIRED);
  });

  it('lending actions see MFA assurance only while the code is fresh', () => {
    const base = { sub: 'u1', email: 'a@b.c', role: 'LOAN_OFFICER', tenantId: 't1' } as any;
    const fresh = actorFromJwt({ ...base, amr: 'mfa', mfaAt: Math.floor(Date.now() / 1000) });
    const stale = actorFromJwt({ ...base, amr: 'mfa', mfaAt: Math.floor(Date.now() / 1000) - 86_400 });
    expect(fresh.assurance).toBe('MFA');
    expect(stale.assurance).toBe('SINGLE_FACTOR');
  });
});

describe('who must use an authenticator (D-128)', () => {
  const original = process.env.AUTH_MFA_REQUIRED_SUPERADMIN;
  afterEach(() => {
    if (original === undefined) delete process.env.AUTH_MFA_REQUIRED_SUPERADMIN;
    else process.env.AUTH_MFA_REQUIRED_SUPERADMIN = original;
  });

  it('SUPERADMIN by default, switchable only by the deployment', () => {
    expect(roleRequiresMfa('SUPERADMIN')).toBe(true);
    process.env.AUTH_MFA_REQUIRED_SUPERADMIN = 'false';
    expect(roleRequiresMfa('SUPERADMIN')).toBe(false);
  });

  it('tenant administrators (including the legacy ADMIN name) by default', () => {
    expect(roleRequiresMfa('TENANT_ADMIN', adminMfaSettingFrom(undefined))).toBe(true);
    expect(roleRequiresMfa('ADMIN', adminMfaSettingFrom(null))).toBe(true);
  });

  it('a tenant may turn the rule off for its administrators', () => {
    expect(
      roleRequiresMfa('TENANT_ADMIN', adminMfaSettingFrom({ security: { requireMfaForAdmins: false } })),
    ).toBe(false);
  });

  it('unreadable tenant settings keep the rule on', () => {
    expect(roleRequiresMfa('TENANT_ADMIN', adminMfaSettingFrom({ nonsense: true }))).toBe(true);
  });

  it('other roles are not held at enrolment', () => {
    expect(roleRequiresMfa('LOAN_OFFICER', adminMfaSettingFrom(undefined))).toBe(false);
  });
});
