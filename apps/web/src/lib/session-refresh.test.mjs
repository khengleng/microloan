// Run with: pnpm --filter web test   (node:test; Node strips the TS types)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSessionRefresher } from './session-refresh.ts';

/** Two "tabs" sharing one lock and one stamp, like one browser profile. */
function browser({ status = 200 } = {}) {
    let clock = 1000;
    let stamp = 0;
    let chain = Promise.resolve();
    const calls = [];
    const shared = {
        withLock: (fn) => {
            const run = chain.then(fn);
            chain = run.then(() => undefined, () => undefined);
            return run;
        },
        readStamp: () => stamp,
        writeStamp: (at) => { stamp = at; },
        now: () => ++clock,
    };
    const tab = () => createSessionRefresher({
        ...shared,
        callRefresh: async () => {
            calls.push(clock);
            await new Promise((r) => setTimeout(r, 5));
            return status;
        },
    });
    return { tab, calls, sentNow: () => clock };
}

test('concurrent 401s in one tab share a single refresh', async () => {
    const b = browser();
    const renew = b.tab();
    const sent = b.sentNow();
    const outcomes = await Promise.all([renew(sent), renew(sent), renew(sent)]);
    assert.deepEqual(outcomes, ['refreshed', 'refreshed', 'refreshed']);
    assert.equal(b.calls.length, 1);
});

test('a second tab that waited for the lock reuses the first tab\'s refresh', async () => {
    const b = browser();
    const tabA = b.tab();
    const tabB = b.tab();
    const sent = b.sentNow(); // both requests left before anyone refreshed
    const [a, bb] = await Promise.all([tabA(sent), tabB(sent)]);
    assert.equal(a, 'refreshed');
    assert.equal(bb, 'refreshed');
    // Only one rotation: presenting the old token twice would trip reuse detection.
    assert.equal(b.calls.length, 1);
});

test('a request sent after the last renewal refreshes again', async () => {
    const b = browser();
    const renew = b.tab();
    await renew(b.sentNow());
    const later = b.sentNow() + 10;
    await renew(later);
    assert.equal(b.calls.length, 2);
});

test('a refused refresh is reported as rejected (sign out)', async () => {
    const b = browser({ status: 401 });
    assert.equal(await b.tab()(b.sentNow()), 'rejected');
    const f = browser({ status: 403 });
    assert.equal(await f.tab()(f.sentNow()), 'rejected');
});

test('an unreachable or throttled API is not a sign-out', async () => {
    for (const status of [0, 429, 502]) {
        const b = browser({ status });
        assert.equal(await b.tab()(b.sentNow()), 'unavailable');
    }
});
