import {
  currentBatch,
  eodConcurrency,
  oncePerRun,
  runInBatchScope,
} from './batch-scope';

const url = (n: number) =>
  `postgresql://u@h:5432/db?connection_limit=${n}&schema=public`;

describe('eodConcurrency', () => {
  it('defaults to 4 within a pool that allows it', () => {
    expect(eodConcurrency({ DATABASE_URL: url(10) })).toBe(4);
  });
  it('takes LENDING_EOD_CONCURRENCY', () => {
    expect(
      eodConcurrency({ DATABASE_URL: url(20), LENDING_EOD_CONCURRENCY: '8' }),
    ).toBe(8);
  });
  it('never exceeds the pool minus two (scheduler lock + headroom)', () => {
    expect(
      eodConcurrency({ DATABASE_URL: url(10), LENDING_EOD_CONCURRENCY: '32' }),
    ).toBe(8);
    expect(eodConcurrency({ DATABASE_URL: url(4) })).toBe(2);
    expect(eodConcurrency({ DATABASE_URL: url(2) })).toBe(1);
    expect(eodConcurrency({ DATABASE_URL: url(1) })).toBe(1);
  });
  it('ignores a value that is not a positive integer', () => {
    for (const v of ['0', '-3', 'x', '2.5', ''])
      expect(
        eodConcurrency({ DATABASE_URL: url(10), LENDING_EOD_CONCURRENCY: v }),
      ).toBe(4);
  });
});

describe('batch scope', () => {
  it('shares a tenant read within one run, and only for that tenant', async () => {
    let reads = 0;
    const read = async () => ++reads;
    await runInBatchScope('t1', '2026-01-05', async () => {
      expect(currentBatch('t1')).toBeDefined();
      expect(currentBatch('t2')).toBeUndefined();
      const [a, b] = await Promise.all([
        oncePerRun('t1', 'k', read),
        oncePerRun('t1', 'k', read),
      ]);
      expect([a, b]).toEqual([1, 1]);
      expect(await oncePerRun('t2', 'k', read)).toBe(2);
    });
    // Outside a run every call reads.
    expect(await oncePerRun('t1', 'k', read)).toBe(3);
    expect(currentBatch('t1')).toBeUndefined();
  });

  it('does not remember a failed read', async () => {
    let n = 0;
    await runInBatchScope('t1', '2026-01-05', async () => {
      await expect(
        oncePerRun('t1', 'k', () => Promise.reject(new Error('boom'))),
      ).rejects.toThrow('boom');
      await new Promise((r) => setImmediate(r));
      expect(await oncePerRun('t1', 'k', async () => ++n)).toBe(1);
    });
  });
});
