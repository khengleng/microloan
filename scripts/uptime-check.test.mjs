// node --test scripts/uptime-check.test.mjs — the uptime workflow's decisions (D-152).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decide, isUp } from './uptime-check.mjs';

const now = new Date(Date.UTC(2030, 0, 1, 12, 0));
const hoursAgo = (h) => new Date(now.getTime() - h * 3_600_000).toISOString();
const down = [{ name: 'API readiness', url: 'https://api.test/v1/health/ready', error: 'HTTP 503' }];

test('2xx and 3xx are up; 4xx and 5xx are not', () => {
  assert.equal(isUp(200), true);
  assert.equal(isUp(302), true);
  assert.equal(isUp(404), false);
  assert.equal(isUp(503), false);
});

test('down with no open issue opens one; up with none does nothing', () => {
  assert.deepEqual(decide({ failures: down, issue: null, now, remindHours: 6 }), { action: 'open' });
  assert.deepEqual(decide({ failures: [], issue: null, now, remindHours: 6 }), { action: 'none' });
});

test('still down: a reminder at most every remindHours', () => {
  const issue = (h) => ({ number: 7, lastActivityAt: hoursAgo(h), url: 'u' });
  assert.deepEqual(decide({ failures: down, issue: issue(1), now, remindHours: 6 }), { action: 'none' });
  assert.deepEqual(decide({ failures: down, issue: issue(6), now, remindHours: 6 }), { action: 'remind' });
});

test('up again with an open issue closes it (the "recovered" e-mail)', () => {
  assert.deepEqual(
    decide({ failures: [], issue: { number: 7, lastActivityAt: hoursAgo(0.1), url: 'u' }, now, remindHours: 6 }),
    { action: 'close' },
  );
});
