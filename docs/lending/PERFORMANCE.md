# Lending end of day — performance

How fast end of day (EOD) runs on a realistic book, what was changed to make
it scale, and how to measure it again.

## The harness

```bash
# Seed a book into its own database (default microloan_loadtest; the name
# must contain "load" and "test"). Needs psql on PATH.
pnpm load:lending:seed --loans 50000          # --reuse-templates skips step 1 below
# Run EOD for 3 business days (through month end) on a fresh copy of it.
pnpm load:lending:run --label after --concurrency 4 --compare before
```

Code: `apps/api/test/load/` (`seed.ts`, `templates.ts`, `clone.ts`, `run.ts`,
`fingerprint.ts`). Results land in `.lending-load/<label>.json` (git-ignored).
`LENDING_LOAD_DATABASE_URL` points it at another server.

**Seeding.** About 70 template loans are built through the real HTTP API:
products approved by a checker; loans applied for, approved, booked and
disbursed; repaid on their due dates (or not) while end of day runs every day
from 5 January to 28 April; two restructured once in arrears; January–March
closed by a second person. Five families (reducing instalment, flat,
fortnightly microfinance with guarantor, solidarity group, revolving
facility with drawdowns and repayments), four disbursement cohorts, five
behaviours (on time 72 %, late 12 %, partial 8 %, never pays 8 %,
restructured 4 %), and an approved impairment policy, so every loan
provisions. Every row a template loan owns (application, decisions,
borrower or group, agreement versions, schedule, financial events, journal,
accruals, allocations, collection tasks, restructure case, audit trail,
facility) is found by following references from the loan, then streamed with
`COPY` N times with remapped ids (in columns, idempotency keys and JSON) and a
copy suffix on unique references. Each copy is thus a row-for-row copy of
what the API wrote; the seed checks that every journal entry balances, and the
runner's reconciliation reports **0 breaks**. Document files are not copied
(their rows are); nothing in EOD reads them.

| Book | Rows | Size | Seed time |
| --- | --- | --- | --- |
| 20,000 loans | 8.3 M (1.5 M events, 3.1 M journal lines) | 5.2 GB | 3.6 min |
| 50,000 loans | 20.8 M (3.7 M events, 7.7 M journal lines) | 12 GB | 18 min (before the cloner was sped up 3×) |

200,000 loans works the same way (linear: about 83 M rows, ~50 GB, ~20 min at
the measured 72 k rows/s) but was not run here, to keep the shared laptop
database usable.

**Running.** `run.ts` copies the seeded database, boots the application
context against it as the RLS-bound application role, and calls the real
scheduler (`EodSchedulerService.runTenant`: advance the business date,
auto-debit, the per-loan batch with all its hooks, month-end preparation) one
day at a time for 29 April, 30 April (month end) and 1 May. It reports
throughput, per-loan p50/p95/p99, Prisma operations per loan, connections
open and busy (sampled from `pg_stat_activity`), failures, the
reconciliation afterwards, and a **fingerprint**: a digest of every loan's
balances and state, its schedule, the financial events it gained
(type, dates, amount, components, narrative), journal totals per ledger
account, and the collection tasks, restructure cases, accrual rows and
audit events opened. `--compare` checks it against an earlier run.

## Results

Apple M4 Pro (12 cores, 24 GB), PostgreSQL 16 on the same machine, pool
`connection_limit=10`, one tenant, 3 business days including month end.

### 20,000 loans — before and after (same seeded book)

| | Before | After, 1 at a time | After, default (4) | After, 8 |
| --- | --- | --- | --- | --- |
| Batch time per day | 177 s | 107 s | **37 s** | 27.5 s |
| Throughput | 113 loans/s | 185 loans/s | **544 loans/s** | 729 loans/s |
| Per loan p50 / p95 | 8.7 / 12.5 ms | 5.1 / 7.5 ms | 7.2 / 9.7 ms | 10.6 / 14.7 ms |
| Prisma operations per loan | 30.7 | 16.5 | 16.5 | 16.5 |
| Connections busy (max / avg) | 3 / 1.0 | 3 / 1.0 | 5 / 3.7 | 9 / 6.9 |
| Month-end preparation | **failed** (reconciliation errors, 27 s) | 17 s, prepared | 17 s, prepared | 17 s, prepared |
| Reconciliation afterwards | **error**: 65,533 bind variables | 0 breaks, 12.6 s | 0 breaks, 12.8 s | 0 breaks, 12.6 s |
| Total for 3 days | 556 s | 342 s | **127 s** | 99 s |
| Failed loans | 0 | 0 | 0 | 0 |
| Fingerprint vs before | — | identical | identical | identical |

Per-loan time rises with concurrency (more loans share the database), but
throughput rises 4.8× at the default and 6.4× at 8.

### 50,000 loans — before

Measured on the original code before the index was added: **1.03 s per
loan** (340 loans in 352 s), i.e. about **14 hours per business day**. The
cause was the balanced-journal constraint trigger: at commit it sums each
inserted line's entry by `entryId`, which had no index — a parallel
sequential scan of 7.7 M lines, ~300 ms per line, two or more lines per
loan per day. With only the index added (original code): 518 s per day
(97 loans/s, 10.3 ms per loan), month end another 80 s and then failing
(reconciliation reads two queries per loan, then the trial balance exceeds
PostgreSQL's bind-parameter limit at about 24,000 journal entries — it
failed on the 300-loan test book already).

At 20,000 loans the same before/after code ran at 113 → 544 loans/s, so a
50,000-loan day is about 1.5 minutes at the default concurrency (from about
9 minutes with the index alone, and 14 hours without it).

## What changed (D-050 … D-053)

Measured first, with Prisma operation counts per loan (30.7 before):

1. **Index `LendingJournalLine(entryId)`** (migration
   `20261019001600_lending_eod_scale`) — the dominant cost at scale, above.
2. **Bounded concurrency.** `LENDING_EOD_CONCURRENCY` loans at once (default
   4, capped at pool size − 2: one connection holds the scheduler's advisory
   lock all run, one is left for the rest of the instance). Each loan is
   still its own transaction with its `FOR UPDATE` lock and compare-and-set;
   failures are reported in account order.
3. **N+1 removed in the per-loan path** (30.7 → 16.5 operations per loan):
   - authorization context (feature flags, flag rules, ABAC policies, FX —
     5 queries) shared by the run's loans while the authorization version,
     still read in every loan's transaction, is unchanged (≤ 30 s);
   - ledger accounts: committed account ids remembered per tenant, so a
     posting no longer upserts the whole chart and re-reads it (2 queries per
     posting);
   - period lock: an entry date found open is not re-checked per loan within
     a run (the database trigger still guards every posting);
   - restructure-monitoring policy read once per run;
   - the agreement row is not re-read (its foreign key guarantees it); live
     and restructured schedule lines come back in one query;
   - open instalments are counted only when a loan could close;
   - the facility minimum-payment hook does not look up a facility for a
     TERM loan (none can exist).
4. **Month end and reconciliation batched.** Reconciliation reads mappings
   (latest agreement version per agreement, one `DISTINCT ON` query), unpaid
   schedule principal (one `GROUP BY`) and facility movements (500 loans per
   query) in bulk; the trial balance is summed in the database per currency.
   This also fixes the bind-parameter failure that stopped month-end close
   and `GET /lending/ops/reconciliation` beyond ~24,000 journal entries.
5. **One connection pool per process.** Three modules registered their own
   `PrismaService`, each opening a pool of `connection_limit` (Prisma default
   CPUs × 2 + 1): an instance could hold up to four pools. They now use the
   global one.

No whole loan is skipped: every active loan accrues interest daily, so none
is provably idle (D-053).

## Correctness

- The fingerprint of the before run and of all three after runs is
  identical on the 20,000-loan book (0 loans differ; events, journal totals,
  collection and restructuring work equal).
- Full integration suite green after the change (48 suites, 540 tests,
  tenant wall strict, last), unit suite green.

## Sizing

- Default `LENDING_EOD_CONCURRENCY=4` with `connection_limit=10`. Raising it
  to 8 gained another 35 % here; beyond the database's cores it stops
  helping. Keep `instances × connection_limit` under `max_connections`.
- Watch `lending_eod_run_duration_seconds`, `lending_eod_loan_duration_seconds`
  and `prisma_pool_connections_busy` (OPERATIONS.md → Monitoring).

## Limits

- One tenant per run; tenants are still processed one after another.
- Measured on a laptop with the database on the same machine; network
  round trips to a remote database raise per-loan time, which concurrency
  hides better than it hurts.
- The templates are a mix of five families; cards, BNPL, leases, trade,
  syndication and floating-rate loans are not in the seeded book (their
  hooks are gated off for the families seeded).
