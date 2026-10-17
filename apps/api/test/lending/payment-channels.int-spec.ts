/* eslint-disable @typescript-eslint/no-unsafe-call -- integration fixtures: fixture rows come from the untyped API responses. */
/**
 * Payment channels: auto-debit under a mandate (UC-16), mobile / QR / wallet /
 * agent settlement files (UC-18), employer payroll files (UC-19) and payments
 * in another currency (UC-21). One timeline, one tenant:
 *
 *   2026-01-05  loans disbursed, mandates set up
 *   2026-02-05  first instalments due: end of day collects them; files and an
 *               FX payment arrive
 *   2026-02-06+ the failed debit is retried until the policy gives up
 */
import { Fixture, TEST_DB, bootstrap, expectOk, key } from './harness';
import { activeProduct, originateAndDisburse, standardRoles } from './setup';

const d = TEST_DB ? describe : describe.skip;

const HEADER = 'reference,loan_ref,amount,currency,value_date,channel_txn_id';

d('Payment channels (integration)', () => {
  let f: Fixture;
  const loans: Record<string, { id: string; reference: string }> = {};
  let goodMandate: string;
  let settlementFileId: string;
  let importedEventId: string;
  let beforeImport: any;
  const NATIONAL_ID = `N${Date.now().toString().slice(-8)}`;
  const tx = (p: string) => `${p}-${key('tx')}`;

  const loan = async (id: string) =>
    expectOk(await f.as('opsMaker').get(`/lending/loans/${id}`));
  const dueOf = async (id: string, n = 1) => {
    const l = (await loan(id)).schedule.find(
      (x: any) => x.number === n && x.status !== 'SUPERSEDED',
    );
    return (Number(l.principalDue) + Number(l.interestDue)).toFixed(2);
  };
  const reconcileLedger = async () => {
    const rec = expectOk(
      await f.as('finance').get('/lending/ops/reconciliation'),
    );
    expect(rec.breaks).toEqual([]);
    expect(rec.trialBalanceBalanced).toBe(true);
  };
  const setDate = async (businessDate: string) =>
    expectOk(
      await f
        .as('finance')
        .post('/lending/ops/business-date', { businessDate }),
    );
  const runBatch = async () => {
    const r = expectOk(await f.as('finance').post('/lending/loans/batch/run'));
    expect(r.failed).toEqual([]);
    return r;
  };
  const outbox = (topic: string) =>
    f.system(() =>
      f.prisma.outboxMessage.findMany({
        where: { tenantId: f.t1, topic },
        orderBy: { createdAt: 'asc' },
      }),
    );

  beforeAll(async () => {
    f = await bootstrap();
    await standardRoles(f);
    const { productId } = await activeProduct(
      f,
      'PERSONAL_INSTALMENT',
      'PL-CHAN',
      (c) => {
        c.repayment.allocation.excessHandling = 'ADVANCE';
      },
    );
    const terms = {
      principal: '3000',
      numberOfInstalments: 6,
      disbursementDate: '2026-01-05',
    };
    for (const name of ['debit', 'broke', 'wallet', 'payroll', 'fx']) {
      const r = await originateAndDisburse(
        f,
        productId,
        terms,
        name === 'payroll' ? { borrowerOver: { idNumber: NATIONAL_ID } } : {},
      );
      loans[name] = {
        id: r.loanId,
        reference: (await loan(r.loanId)).account.reference,
      };
    }
  }, 180_000);
  afterAll(async () => f?.app.close());

  // ── UC-16 ───────────────────────────────────────────────────────────────

  it('UC-16: a mandate is recorded per loan, one active at a time, with the account number masked', async () => {
    const body = {
      mandateReference: `DD-${key('m')}`.slice(0, 60),
      bankCode: 'ABA',
      accountNumber: '0001234567',
      accountName: 'Sok Dara',
      consentDate: '2026-01-05',
    };
    const m = expectOk(
      await f
        .as('opsMaker')
        .post(`/lending/loans/${loans.debit.id}/mandates`, body),
    );
    goodMandate = m.id;
    expect(m.status).toBe('ACTIVE');
    expect(m.accountNumber).toMatch(/4567$/);
    expect(m.accountNumber).not.toContain('000123');
    const second = await f
      .as('opsMaker')
      .post(`/lending/loans/${loans.debit.id}/mandates`, {
        ...body,
        mandateReference: `DD-${key('m2')}`.slice(0, 60),
      });
    expect(second.status).toBe(409);
    // Consent cannot be in the future; a read-only officer cannot set one up.
    expect(
      (
        await f
          .as('opsMaker')
          .post(`/lending/loans/${loans.broke.id}/mandates`, {
            ...body,
            mandateReference: `DD-${key('m3')}`.slice(0, 60),
            consentDate: '2026-03-01',
          })
      ).status,
    ).toBe(400);
    expect(
      (
        await f.as('nobody').post(`/lending/loans/${loans.broke.id}/mandates`, {
          ...body,
          mandateReference: `DD-${key('m4')}`.slice(0, 60),
        })
      ).status,
    ).toBe(403);
    expectOk(
      await f.as('opsMaker').post(`/lending/loans/${loans.broke.id}/mandates`, {
        ...body,
        mandateReference: `DD-${key('m5')}`.slice(0, 60),
        // The mock bank refuses accounts ending in 000 for insufficient funds.
        accountNumber: '0009870000',
      }),
    );
    // Retry policy: two attempts per due date, a day apart (configurable).
    expectOk(
      await f.as('finance').put('/lending/payment-channels/settings', {
        fxSpreadBps: 50,
        fxMaxRateAgeDays: 0,
        autoDebitMaxAttempts: 2,
        autoDebitRetryDays: 1,
      }),
    );
    const view = expectOk(
      await f.as('opsMaker').get(`/lending/loans/${loans.debit.id}/mandates`),
    );
    expect(view.mandates).toHaveLength(1);
    expect(view.attempts).toEqual([]);
  });

  it('UC-16: on the due date the end-of-day batch collects the instalment and posts it as a repayment', async () => {
    const due = await dueOf(loans.debit.id);
    await setDate('2026-02-05');
    await runBatch();
    const after = await loan(loans.debit.id);
    expect(after.schedule.find((x: any) => x.number === 1).status).toBe('PAID');
    expect(after.account.daysPastDue).toBe(0);
    const ev = after.events.find((e: any) => e.type === 'REPAYMENT');
    expect(Number(ev.amount).toFixed(2)).toBe(due);
    expect(ev.components.channel.type).toBe('AUTO_DEBIT');
    expect(ev.actorId).toBe('system:auto-debit');
    const view = expectOk(
      await f.as('opsMaker').get(`/lending/loans/${loans.debit.id}/mandates`),
    );
    expect(view.attempts).toHaveLength(1);
    expect(view.attempts[0]).toMatchObject({
      status: 'SUCCEEDED',
      attemptNo: 1,
      dueDate: '2026-02-05',
      financialEventId: ev.id,
    });
    // Running the batch again the same day does not debit twice.
    await runBatch();
    expect(
      expectOk(
        await f.as('opsMaker').get(`/lending/loans/${loans.debit.id}/mandates`),
      ).attempts,
    ).toHaveLength(1);
    await reconcileLedger();
  });

  it('UC-16: a refused debit is recorded, a failure notice is queued, and it is retried per the policy', async () => {
    const view = expectOk(
      await f.as('opsMaker').get(`/lending/loans/${loans.broke.id}/mandates`),
    );
    expect(view.attempts).toHaveLength(1);
    expect(view.attempts[0]).toMatchObject({
      status: 'FAILED',
      failureCode: 'INSUFFICIENT_FUNDS',
      nextRetryDate: '2026-02-06',
    });
    expect(
      (await loan(loans.broke.id)).schedule.find((x: any) => x.number === 1)
        .status,
    ).toBe('DUE');
    const notices = await outbox('lending.auto_debit.failed');
    expect(notices).toHaveLength(1);
    expect(notices[0].payload).toMatchObject({
      loanAccountId: loans.broke.id,
      failureCode: 'INSUFFICIENT_FUNDS',
      final: false,
    });
  });

  // ── UC-18 ───────────────────────────────────────────────────────────────

  const settlement = (lines: string[]) =>
    [HEADER + ',payer_name', ...lines].join('\n');
  let fileLines: string[];

  it('UC-18: a wallet settlement file posts matched lines and sends unmatched ones to suspense', async () => {
    beforeImport = (await loan(loans.wallet.id)).account;
    const due = await dueOf(loans.wallet.id);
    fileLines = [
      `W1,${loans.wallet.reference},${due},USD,2026-02-05,${tx('W')},Sok Dara`,
      `W2,LN-DOES-NOT-EXIST,12.00,USD,2026-02-05,${tx('W')},Unknown payer`,
      `W3,,8.00,USD,2026-02-05,${tx('W')},`,
    ];
    const r = expectOk(
      await f
        .as('opsMaker')
        .post('/lending/payment-channels/settlement-files', {
          channel: 'WALLET',
          fileName: 'wing-2026-02-05.csv',
          content: settlement(fileLines),
        }),
    );
    settlementFileId = r.file.id;
    expect(r.replayed).toBe(false);
    expect(r.file).toMatchObject({
      lineCount: 3,
      postedCount: 1,
      suspenseCount: 2,
      duplicateCount: 0,
    });
    expect(r.lines.map((l: any) => l.outcome)).toEqual([
      'POSTED',
      'SUSPENSE',
      'SUSPENSE',
    ]);
    expect(r.lines[1].reason).toMatch(/No loan with reference/);
    importedEventId = r.lines[0].financialEventId;
    const after = await loan(loans.wallet.id);
    expect(after.schedule.find((x: any) => x.number === 1).status).toBe('PAID');
    const ev = after.events.find((e: any) => e.id === importedEventId);
    expect(ev.components.channel).toMatchObject({
      type: 'SETTLEMENT',
      channel: 'WALLET',
    });
    // Unmatched money is on the books in suspense, never dropped.
    const sus = expectOk(await f.as('opsMaker').get('/lending/suspense'));
    const held = sus.payments.filter((p: any) =>
      r.lines.some((l: any) => l.unidentifiedPaymentId === p.id),
    );
    expect(held.map((p: any) => p.amount).sort()).toEqual(['12', '8']);
    expect(held.every((p: any) => p.channel === 'MOBILE')).toBe(true);
    await reconcileLedger();
  });

  it('UC-18: the same file sent again is ignored', async () => {
    const r = expectOk(
      await f
        .as('opsMaker')
        .post('/lending/payment-channels/settlement-files', {
          channel: 'WALLET',
          fileName: 'wing-2026-02-05 (resent).csv',
          // Same content with Windows line endings: the same file.
          content: settlement(fileLines).replace(/\n/g, '\r\n'),
        }),
    );
    expect(r.replayed).toBe(true);
    expect(r.file.id).toBe(settlementFileId);
    const events = (await loan(loans.wallet.id)).events.filter(
      (e: any) => e.type === 'REPAYMENT',
    );
    expect(events).toHaveLength(1);
  });

  it('UC-18: a line already imported in an earlier file is ignored as a duplicate', async () => {
    const r = expectOk(
      await f
        .as('opsMaker')
        .post('/lending/payment-channels/settlement-files', {
          channel: 'WALLET',
          fileName: 'wing-2026-02-05-b.csv',
          content: settlement([
            fileLines[0],
            // Same transaction id, different amount: flagged, nothing applied.
            fileLines[2].replace(',8.00,', ',9.00,'),
          ]),
        }),
    );
    expect(r.lines.map((l: any) => l.outcome)).toEqual([
      'DUPLICATE',
      'DUPLICATE',
    ]);
    expect(r.lines[0].conflicting).toBe(false);
    expect(r.lines[1].conflicting).toBe(true);
    expect(
      (await loan(loans.wallet.id)).events.filter(
        (e: any) => e.type === 'REPAYMENT',
      ),
    ).toHaveLength(1);
  });

  it('UC-18: a file with a malformed line is refused whole, with every error listed', async () => {
    const res = await f
      .as('opsMaker')
      .post('/lending/payment-channels/settlement-files', {
        channel: 'QR',
        fileName: 'bad.csv',
        content: settlement([
          `Q1,${loans.wallet.reference},1.005,USD,2026-02-05,${tx('Q')},`,
          `Q2,${loans.wallet.reference},5,USD,2026-02-09,${tx('Q')},`,
        ]),
      });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('FILE_INVALID');
    expect(res.body.issues.map((i: any) => i.path)).toEqual([
      'line 2',
      'line 3',
    ]);
    const files = expectOk(
      await f.as('opsMaker').get('/lending/payment-channels/files?channel=QR'),
    );
    expect(files).toEqual([]);
  });

  it('UC-18: a line the loan refuses goes to suspense with the reason, leaving the loan untouched', async () => {
    const before = await loan(loans.payroll.id);
    const r = expectOk(
      await f.as('opsMaker').post('/lending/payment-channels/settlement-files', {
        channel: 'MOBILE',
        fileName: 'mobile-overpayment.csv',
        // Far more than the loan owes: an advance that large is refused (D-007).
        content: settlement([
          `M1,${loans.payroll.reference},99999.00,USD,2026-02-05,${tx('M')},`,
        ]),
      }),
    );
    expect(r.lines[0].outcome).toBe('SUSPENSE');
    expect(r.lines[0].reason).toMatch(/refused the payment/);
    const after = await loan(loans.payroll.id);
    expect(after.events).toHaveLength(before.events.length);
    expect(after.account).toEqual(before.account);
    await reconcileLedger();
  });

  it('UC-18: a service account may push a settlement file', async () => {
    const sa = expectOk(
      await f.as('admin2').post('/lending/access/service-accounts', {
        name: 'Agent network feed',
        scopes: ['loan.repayment.post'],
      }),
    );
    const res = await f
      .http()
      .post('/v1/lending/integrations/settlement-files')
      .set('X-Service-Key', sa.key)
      .send({
        channel: 'AGENT',
        fileName: 'agents.csv',
        content: settlement([`A1,,3.00,USD,2026-02-05,${tx('A')},Agent 17`]),
      });
    expect(res.status).toBe(201);
    expect(res.body.lines[0].outcome).toBe('SUSPENSE');
    const readOnly = expectOk(
      await f.as('admin2').post('/lending/access/service-accounts', {
        name: 'Reporting',
        scopes: ['loan.read'],
      }),
    );
    const refused = await f
      .http()
      .post('/v1/lending/integrations/settlement-files')
      .set('X-Service-Key', readOnly.key)
      .send({
        channel: 'AGENT',
        fileName: 'agents-2.csv',
        content: settlement([`A2,,3.00,USD,2026-02-05,${tx('A')},`]),
      });
    expect(refused.status).toBe(403);
  });

  // ── UC-19 ───────────────────────────────────────────────────────────────

  it('UC-19: a payroll remittance finds the loan by national id or loan reference, and summarises per employer', async () => {
    const due = await dueOf(loans.payroll.id);
    const r = expectOk(
      await f.as('opsMaker').post('/lending/payment-channels/payroll-files', {
        employer: 'Angkor Garments',
        period: '2026-02',
        currency: 'USD',
        valueDate: '2026-02-05',
        fileName: 'angkor-2026-02.csv',
        content: [
          'employee_ref,national_id,loan_ref,amount',
          `E-001,${NATIONAL_ID},,${due}`,
          'E-002,UNKNOWN-ID,,15.00',
        ].join('\n'),
      }),
    );
    expect(r.lines.map((l: any) => l.outcome)).toEqual(['POSTED', 'SUSPENSE']);
    // The national id itself is not kept on the line, only its last digits.
    expect(JSON.stringify(r)).not.toContain(NATIONAL_ID);
    const ev = (await loan(loans.payroll.id)).events.find(
      (e: any) => e.id === r.lines[0].financialEventId,
    );
    expect(ev.components.payer).toMatchObject({
      name: 'Angkor Garments',
      relationship: 'EMPLOYER',
      reference: 'E-001',
    });
    const summary = expectOk(
      await f
        .as('opsMaker')
        .get(
          '/lending/payment-channels/payroll-summary?employer=Angkor%20Garments',
        ),
    );
    expect(summary).toHaveLength(1);
    expect(summary[0]).toMatchObject({ period: '2026-02', employees: 2 });
    expect(summary[0].totals[0]).toMatchObject({
      currency: 'USD',
      posted: String(Number(due)),
      suspenseOpen: '15',
      difference: '0',
    });
    expect(summary[0].breaks.map((b: any) => b.kind)).toEqual([
      'UNMATCHED_IN_SUSPENSE',
    ]);
    await reconcileLedger();
  });

  // ── Reconciliation and reversal ─────────────────────────────────────────

  it('UC-18: the daily reconciliation lists unmatched suspense as breaks, and shows zero breaks once it is matched', async () => {
    const rec = async () =>
      expectOk(
        await f
          .as('finance')
          .get(
            '/lending/payment-channels/reconciliation?date=2026-02-05&channel=WALLET',
          ),
      ).channels[0];
    const before = await rec();
    expect(before.totals[0]).toMatchObject({
      currency: 'USD',
      fileTotal: String(
        (Math.round(Number(fileLines[0].split(',')[2]) * 100) + 2000) / 100,
      ),
      suspenseOpen: '20',
      difference: '0',
      duplicates: 2,
    });
    expect(before.breaks.map((b: any) => b.kind).sort()).toEqual([
      'CONFLICTING_DUPLICATE',
      'UNMATCHED_IN_SUSPENSE',
      'UNMATCHED_IN_SUSPENSE',
    ]);
    // Operations identify the payers and match the money to their loans.
    const file = expectOk(
      await f
        .as('opsMaker')
        .get(`/lending/payment-channels/files/${settlementFileId}`),
    );
    for (const l of file.lines.filter((x: any) => x.outcome === 'SUSPENSE'))
      expectOk(
        await f
          .as('opsMaker')
          .post(
            `/lending/suspense/${l.unidentifiedPaymentId}/matches`,
            { loanId: loans.debit.id, amount: l.amount },
            key('match'),
          ),
      );
    const after = await rec();
    expect(after.totals[0]).toMatchObject({
      suspenseOpen: '0',
      suspenseMatched: '20',
      difference: '0',
    });
    // The conflicting repeat stays a break until the channel confirms it.
    expect(after.breaks.map((b: any) => b.kind)).toEqual([
      'CONFLICTING_DUPLICATE',
    ]);
    // A file with nothing left to chase reconciles with zero breaks.
    const agent = expectOk(
      await f
        .as('finance')
        .get(
          '/lending/payment-channels/reconciliation?date=2026-02-05&channel=AGENT',
        ),
    ).channels[0];
    const held = agent.breaks[0];
    expect(held.kind).toBe('UNMATCHED_IN_SUSPENSE');
    const line = expectOk(
      await f
        .as('opsMaker')
        .get(`/lending/payment-channels/files/${held.fileId}`),
    ).lines[0];
    expectOk(
      await f
        .as('opsMaker')
        .post(
          `/lending/suspense/${line.unidentifiedPaymentId}/matches`,
          { loanId: loans.debit.id, amount: line.amount },
          key('match'),
        ),
    );
    const clean = expectOk(
      await f
        .as('finance')
        .get(
          '/lending/payment-channels/reconciliation?date=2026-02-05&channel=AGENT',
        ),
    ).channels[0];
    expect(clean.breaks).toEqual([]);
    expect(clean.totals[0].difference).toBe('0');
    await reconcileLedger();
  });

  it('UC-18: reversing an imported payment restores the balances and shows as a break', async () => {
    const res = await f
      .as('opsMaker')
      .post(
        `/lending/loans/${loans.wallet.id}/events/${importedEventId}/reverse`,
        { reason: 'Wallet provider recalled the payment' },
        key('rev'),
      );
    // The importer is the maker; a different person reverses.
    expect(res.status).toBe(403);
    expectOk(
      await f
        .as('opsChecker')
        .post(
          `/lending/loans/${loans.wallet.id}/events/${importedEventId}/reverse`,
          { reason: 'Wallet provider recalled the payment' },
          key('rev'),
        ),
    );
    const after = (await loan(loans.wallet.id)).account;
    for (const k of [
      'principalOutstanding',
      'feesReceivable',
      'penaltyReceivable',
      'advanceBalance',
    ])
      expect(after[k]).toBe(beforeImport[k]);
    // Interest has accrued to 5 Feb since; the reversal puts back what was paid.
    expect(
      (await loan(loans.wallet.id)).schedule.find((x: any) => x.number === 1)
        .status,
    ).toBe('DUE');
    const rec = expectOk(
      await f
        .as('finance')
        .get(
          '/lending/payment-channels/reconciliation?date=2026-02-05&channel=WALLET',
        ),
    ).channels[0];
    expect(rec.breaks.map((b: any) => b.kind).sort()).toEqual([
      'CONFLICTING_DUPLICATE',
      'REVERSED',
    ]);
    expect(rec.totals[0].difference).toBe('0');
    await reconcileLedger();
  });

  // ── UC-21 ───────────────────────────────────────────────────────────────

  it('UC-21: a payment in riel on a dollar loan is converted at the bank rate, with the rate on the event and the FX gain posted', async () => {
    await f.system(() =>
      f.prisma.exchangeRate.create({
        data: {
          tenantId: f.t1,
          fromCurrency: 'USD',
          toCurrency: 'KHR',
          rate: '4100',
          effectiveDate: new Date(Date.UTC(2026, 1, 5)),
        },
      }),
    );
    const quote = expectOk(
      await f
        .as('opsMaker')
        .get(
          `/lending/loans/${loans.fx.id}/fx-quote?amount=410000&currency=KHR`,
        ),
    );
    expect(quote.conversion).toMatchObject({
      converted: '99.5',
      midValue: '100',
      gainLoss: '0.5',
      spreadBps: 50,
    });
    const k = key('fx');
    const body = {
      amount: '410000',
      currency: 'KHR',
      externalReference: 'KHR-CASH-7',
    };
    const ev = expectOk(
      await f
        .as('opsMaker')
        .post(`/lending/loans/${loans.fx.id}/fx-repayments`, body, k),
    );
    expect(ev.type).toBe('REPAYMENT');
    expect(ev.amount).toBe('99.5');
    expect(ev.components.fx).toMatchObject({
      amount: '410000',
      from: 'KHR',
      to: 'USD',
      bankRate: '0.000242682926829',
      midRate: '0.000243902439024',
      converted: '99.5',
      gainLoss: '0.5',
    });
    expect(ev.components.fx.rate.rateDate).toBe('2026-02-05');
    // Idempotent on the key.
    const replay = expectOk(
      await f
        .as('opsMaker')
        .post(`/lending/loans/${loans.fx.id}/fx-repayments`, body, k),
    );
    expect(replay.replayed).toBe(true);
    const view = await loan(loans.fx.id);
    const rep = view.events.find((e: any) => e.id === ev.id);
    const line = (code: string, side: 'debit' | 'credit') =>
      rep.journal.lines
        .filter((l: any) => l.accountCode === code)
        .reduce((s: number, l: any) => s + Number(l[side]), 0);
    expect(rep.journal.currency).toBe('USD');
    expect(line('1050', 'debit')).toBeCloseTo(100, 2);
    expect(line('4400', 'credit')).toBeCloseTo(0.5, 2);
    const receipt = view.events.find((e: any) => e.type === 'FX_RECEIPT');
    expect(receipt.currency).toBe('KHR');
    expect(receipt.journal.currency).toBe('KHR');
    expect(
      receipt.journal.lines.find((l: any) => l.accountCode === '1000').debit,
    ).toBe('410000');
    expect(
      receipt.journal.lines.find((l: any) => l.accountCode === '1050').credit,
    ).toBe('410000');
    await reconcileLedger();
  });

  it('UC-21: a cross-currency payment is refused when no rate is published for its value date', async () => {
    const res = await f
      .as('opsMaker')
      .post(
        `/lending/loans/${loans.fx.id}/fx-repayments`,
        { amount: '41000', currency: 'KHR', valueDate: '2026-02-04' },
        key('fx'),
      );
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('FX_RATE_MISSING');
    const same = await f
      .as('opsMaker')
      .post(
        `/lending/loans/${loans.fx.id}/fx-repayments`,
        { amount: '10', currency: 'USD' },
        key('fx'),
      );
    expect(same.status).toBe(400);
  });

  // ── UC-16 retries over the following days ───────────────────────────────

  it('UC-16: the failed debit is retried the next day and stops at the attempt limit', async () => {
    await setDate('2026-02-06');
    await runBatch();
    let attempts = expectOk(
      await f.as('opsMaker').get(`/lending/loans/${loans.broke.id}/mandates`),
    ).attempts;
    expect(attempts.map((a: any) => [a.attemptNo, a.status])).toEqual([
      [2, 'FAILED'],
      [1, 'FAILED'],
    ]);
    expect(attempts[0].nextRetryDate).toBeNull();
    const notices = await outbox('lending.auto_debit.failed');
    expect(notices).toHaveLength(2);
    expect(notices[1].payload).toMatchObject({ attemptNo: 2, final: true });
    await setDate('2026-02-07');
    await runBatch();
    attempts = expectOk(
      await f.as('opsMaker').get(`/lending/loans/${loans.broke.id}/mandates`),
    ).attempts;
    expect(attempts).toHaveLength(2);
    // Tenant-wide view for operations.
    const all = expectOk(
      await f
        .as('opsMaker')
        .get('/lending/payment-channels/auto-debit/attempts?status=FAILED'),
    );
    expect(all.every((a: any) => a.status === 'FAILED')).toBe(true);
    expect(
      all.some((a: any) => a.loanReference === loans.broke.reference),
    ).toBe(true);
  });

  it('UC-16: a revoked mandate is not collected on the next due date', async () => {
    expectOk(
      await f
        .as('opsMaker')
        .post(
          `/lending/loans/${loans.debit.id}/mandates/${goodMandate}/revoke`,
          { reason: 'Borrower switched to cash payments' },
        ),
    );
    const again = await f
      .as('opsMaker')
      .post(`/lending/loans/${loans.debit.id}/mandates/${goodMandate}/revoke`, {
        reason: 'Again',
      });
    expect(again.status).toBe(409);
    await setDate('2026-03-05');
    await runBatch();
    const view = expectOk(
      await f.as('opsMaker').get(`/lending/loans/${loans.debit.id}/mandates`),
    );
    expect(view.mandates[0].status).toBe('REVOKED');
    expect(view.attempts).toHaveLength(1);
    await reconcileLedger();
  });
});
