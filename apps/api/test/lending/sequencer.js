/**
 * Runs the tenant-wall suite last, so the other suites have created a victim
 * row of every kind (facilities, groups, restructure cases…) for it to
 * attack. Everything else runs in a stable, alphabetical order.
 *
 * Implements Jest's sequencer interface directly: pnpm does not expose
 * @jest/test-sequencer to this package.
 */
class WallLastSequencer {
  sort(tests) {
    const last = (t) => (t.path.includes('tenant-wall') ? 1 : 0);
    return [...tests].sort(
      (a, b) => last(a) - last(b) || a.path.localeCompare(b.path),
    );
  }

  shard(tests) {
    return tests;
  }

  allFailedTests(tests) {
    return tests;
  }

  cacheResults() {}
}

module.exports = WallLastSequencer;
