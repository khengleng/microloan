/* eslint-disable @typescript-eslint/no-unsafe-call -- end-to-end fixtures: API responses are untyped. */
/**
 * Servicing-event journeys on personal loans, onboarding to closure
 * (docs/servicing/SCENARIOS.md):
 *
 *  S22 a payment bounces after allocation, is reversed with the returned-
 *      payment fee, penalty interest runs, a part payment is allocated by
 *      the waterfall, and the loan is repaid (TV-14, TV-15, UC-23..25, UC-56)
 *  S23 early payments held as an advance, applied on the due dates, the
 *      rest refunded (UC-26, UC-27, UC-74, D-001)
 *  S24 non-accrual at 30 days past due and cure (UC-62, D-002, D-006)
 *  S25 an impairment policy approved and the allowance through the life of
 *      a loan (OPS-5, D-010)
 *  S26 an unidentified payment held in suspense, matched to the loan, the
 *      rest refunded (UC-28, UC-74)
 *  S27 a payment holiday that capitalizes the interest (TV-13, UC-49), and
 *      one that defers it without capitalizing
 *  S28 negotiated settlement of a delinquent loan (UC-64)
 *  S29 partial prepayment: keep the term or keep the instalment (TV-10, UC-29, UC-30)
 *  S30 full payoff with a prepayment penalty (TV-11, UC-31, UC-32)
 *  S31 due-date change and tenure extension by restructure (UC-47, UC-48)
 */
import { TEST_DB } from '../harness';
import { Journey, c2, expectOk, key, lending, sum } from './journey';

const d = TEST_DB ? describe : describe.skip;

const TV01 = {
  principal: '10000',
  numberOfInstalments: 12,
  annualRate: '0.12',
  disbursementDate: '2026-01-05',
};

d('S22 bounced payment: reversal with returned fee, penalty, waterfall, repaid (TV-14, TV-15)', () => {
  let j: Journey;
  let loanId: string;
  let paymentId: string;

  beforeAll(async () => {
    j = await Journey.start();
    const productId = await j.product('PERSONAL_INSTALMENT', 'PL-BOUNCE', (c) => {
      c.pricing.fees = [];
      c.pricing.returnedPaymentFee = '10';
      c.pricing.penalty = {
        type: 'RATE_ON_OVERDUE',
        flatAmount: null,
        annualRate: '0.18',
        graceDays: 0,
        capPerInstalment: null,
      };
      // TV-15: fees, penalty, interest, principal — oldest instalment first.
      c.repayment.allocation.order = ['FEE', 'TAX', 'PENALTY', 'INTEREST', 'PRINCIPAL'];
      c.repayment.allocation.strategy = 'OLDEST_DUE_FIRST';
    });
    loanId = (await j.originate(productId, TV01)).loanId;
  }, 120_000);
  afterAll(async () => j?.close());

  it('instalment 1 (888.49) is paid by cheque on its due date and allocated', async () => {
    await j.moveTo('2026-02-05');
    const ev = expectOk(
      await j.pay(loanId, '888.49', { externalReference: 'CHQ-100231' }),
    );
    paymentId = ev.id;
    expect([ev.components.interest, ev.components.principal]).toEqual(['100', '788.49']);
    await j.checkpoint(loanId, { principal: '9211.51', interest: 0, dpd: 0 }, 'loan.repayment.post');
  });

  it('UC-23: the cheque bounces; the reversal restores the instalment and charges the 10.00 returned-payment fee', async () => {
    expectOk(await j.reverse(loanId, paymentId, { reason: 'Cheque returned unpaid', returned: true }));
    const l = await j.checkpoint(
      loanId,
      { principal: 10000, interest: 100, fees: 10 },
      'loan.repayment.reverse',
    );
    const first = Journey.due(l)[0];
    expect(first.status).toBe('DUE');
    expect(first.feeDue).toBe('10');
    expect(l.events.find((e: any) => e.type === 'FEE').components.code).toBe('RETURNED_PAYMENT');
  });

  it('TV-14: ten days overdue at 18% on 888.49 → penalty interest 4.38 (UC-56, UC-57)', async () => {
    await j.moveTo('2026-02-15');
    await j.checkpoint(loanId, { penalty: '4.38', dpd: 10, bucket: 'DPD_1_30', fees: 10 });
  });

  it('TV-15: a 500.00 payment goes to fee 10.00, penalty 4.38, interest 100.00, principal 385.62; 402.87 stays overdue', async () => {
    const ev = expectOk(await j.pay(loanId, '500.00'));
    expect(ev.components).toMatchObject({
      fee: '10',
      penalty: '4.38',
      interest: '100',
      principal: '385.62',
    });
    // Interest for February's first ten days (92.12 × 10/28) has accrued meanwhile.
    const l = await j.checkpoint(loanId, { fees: 0, penalty: 0, interest: '32.90', principal: '9614.38' });
    const first = Journey.due(l)[0];
    expect(c2(Number(first.principalDue) - Number(first.principalPaid))).toBe('402.87');
  });

  it('the 402.87 is paid the same day; the loan cures and is repaid on time to maturity', async () => {
    expectOk(await j.pay(loanId, '402.87'));
    await j.moveTo('2026-02-16');
    await j.checkpoint(loanId, { dpd: 0, principal: '9211.51', penalty: 0 });
    await j.payOnTime(loanId, 2);
    await j.checkpoint(loanId, { status: 'CLOSED', principal: 0, interest: 0, fees: 0, penalty: 0 });
  });
});

d('S23 early payment held as an advance (UC-26, UC-27, UC-74)', () => {
  let j: Journey;
  let loanId: string;
  let instalment: number;

  beforeAll(async () => {
    j = await Journey.start();
    const productId = await j.product('PERSONAL_INSTALMENT', 'PL-ADVANCE', (c) => {
      c.pricing.fees = [];
      c.repayment.allocation.excessHandling = 'ADVANCE';
    });
    loanId = (
      await j.originate(productId, { ...TV01, principal: '6000' })
    ).loanId;
    instalment = Number((await j.loan(loanId)).account.instalmentAmount);
  }, 120_000);
  afterAll(async () => j?.close());

  it('UC-26: an instalment paid two weeks early is held as an advance, not prepaid (D-001)', async () => {
    await j.moveTo('2026-01-20');
    const ev = expectOk(await j.pay(loanId, instalment));
    expect(ev.components.advance).toBe(String(instalment));
    expect(ev.components.prepaidPrincipal).toBe('0');
    const l = await j.checkpoint(loanId, { principal: 6000, advance: instalment });
    expect(Journey.journal(l, ev.id)).toContain(`2300:0.00:${c2(instalment)}`);
  });

  it('UC-27: end of day applies it on the due date, so the borrower is never late', async () => {
    await j.moveTo('2026-02-05');
    const l = await j.checkpoint(loanId, { advance: 0, dpd: 0, penalty: 0 });
    expect(Journey.due(l)[0].status).toBe('PAID');
    expect(l.events.some((e: any) => e.type === 'ADVANCE_APPLIED')).toBe(true);
  });

  it('two instalments paid at once are applied one per due date', async () => {
    await j.moveTo('2026-02-20');
    expectOk(await j.pay(loanId, 2 * instalment));
    await j.checkpoint(loanId, { advance: 2 * instalment });
    await j.moveTo('2026-03-05');
    await j.checkpoint(loanId, { advance: instalment, dpd: 0 });
    await j.moveTo('2026-04-05');
    const l = await j.checkpoint(loanId, { advance: 0, dpd: 0 });
    expect(Journey.due(l).slice(0, 3).every((x: any) => x.status === 'PAID')).toBe(true);
  });

  it('D-007: an advance can never exceed what the loan owes', async () => {
    const res = await j.pay(loanId, '100000.00');
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/early settlement/);
  });

  it('UC-74: 50.00 paid over the instalment is held, then refunded under maker-checker', async () => {
    await j.moveTo('2026-05-05');
    expectOk(await j.pay(loanId, instalment + 50, { applyExcessAs: 'ADVANCE' }));
    await j.checkpoint(loanId, { advance: 50 });
    const task = expectOk(
      await j.as('opsMaker').post(`/lending/loans/${loanId}/advance-refunds`, {
        amount: '50.00',
        reason: 'Customer asked for the overpayment back',
      }),
    );
    expect(
      (await j.as('opsMaker').post(`/lending/loans/${loanId}/advance-refunds/${task.id}/decision`, { approve: true }, key('ar'))).status,
    ).toBe(403);
    const ev = expectOk(
      await j.as('opsChecker').post(
        `/lending/loans/${loanId}/advance-refunds/${task.id}/decision`,
        { approve: true },
        key('ar'),
      ),
    );
    expect(ev.type).toBe('ADVANCE_REFUND');
    await j.checkpoint(loanId, { advance: 0 }, 'loan.advance_refund.approve');
  });

  it('UC-31: the payoff quote nets an advance; the loan is settled and closes', async () => {
    await j.moveTo('2026-05-20');
    expectOk(await j.pay(loanId, '200.00'));
    const q = await j.quote(loanId);
    expect(q.advanceApplied).toBe('200');
    await j.settle(loanId);
    await j.checkpoint(loanId, { status: 'CLOSED', principal: 0, interest: 0, advance: 0 });
  });
});

d('S24 non-accrual at 30 days past due and cure (UC-62)', () => {
  let j: Journey;
  let loanId: string;

  beforeAll(async () => {
    j = await Journey.start();
    const productId = await j.product('PERSONAL_INSTALMENT', 'PL-NONACC', (c) => {
      c.pricing.fees = [];
      c.operations.nonAccrual = { enabled: true, fromDpd: 30, cureAtDpd: 0 };
    });
    loanId = (await j.originate(productId, { ...TV01, principal: '6000' })).loanId;
  }, 120_000);
  afterAll(async () => j?.close());

  it('nothing is paid; at 30 days past due the unpaid interest moves out of income into suspense (D-006)', async () => {
    await j.moveTo('2026-03-06');
    await j.checkpoint(loanId, { dpd: 29, nonAccrual: false, suspense: 0 });
    await j.moveTo('2026-03-07');
    const l = await j.checkpoint(loanId, { dpd: 30, nonAccrual: true });
    expect(l.account.nonAccrualSince).toBe('2026-03-07');
    expect(l.account.interestInSuspense).toBe(l.account.interestReceivable);
    const entry = l.events.find((e: any) => e.type === 'NON_ACCRUAL');
    expect(entry.components.direction).toBe('ENTER');
  });

  it('interest keeps accruing as owed but none of it is income', async () => {
    await j.moveTo('2026-03-20');
    const l = await j.checkpoint(loanId, { nonAccrual: true });
    expect(l.account.interestInSuspense).toBe(l.account.interestReceivable);
    const last = l.events.filter((e: any) => e.type === 'ACCRUAL').at(-1);
    expect(last.components.suspended).toBe(true);
  });

  it('paying the arrears releases the interest collected; the cure releases the rest', async () => {
    const l = await j.loan(loanId);
    const ev = expectOk(await j.pay(loanId, Journey.arrears(l, '2026-03-20')));
    expect(c2(ev.components.suspenseReleased)).toBe(c2(ev.components.interest));
    await j.moveTo('2026-03-21');
    const cured = await j.checkpoint(loanId, { dpd: 0, nonAccrual: false, suspense: 0 });
    expect(cured.events.some((e: any) => e.type === 'NON_ACCRUAL' && e.components.direction === 'CURE')).toBe(true);
  });

  it('the loan is serviced on time again and settled early', async () => {
    await j.payOnTime(loanId, 3, 4);
    await j.moveTo('2026-05-15');
    await j.settle(loanId);
    await j.checkpoint(loanId, { status: 'CLOSED', principal: 0, interest: 0, suspense: 0 });
  });
});

d('S25 impairment policy approved; the allowance through the life of a loan (OPS-5)', () => {
  let j: Journey;
  let loanId: string;

  beforeAll(async () => {
    j = await Journey.start();
    const productId = await j.product('PERSONAL_INSTALMENT', 'PL-IMPAIR', (c) => {
      c.pricing.fees = [];
      c.pricing.penalty = { type: 'NONE', flatAmount: null, annualRate: null, graceDays: 0, capPerInstalment: null };
    });
    loanId = (await j.originate(productId, TV01)).loanId;
  }, 120_000);
  afterAll(async () => j?.close());

  const allowanceAt = async (principal: number, rate: number, cls: string) => {
    const l = await j.checkpoint(loanId, { allowance: Math.round(principal * rate * 100) / 100 });
    expect(l.account.classification).toBe(cls);
    return l;
  };

  it('D-010: nothing is provided until a policy is approved by someone other than its maker', async () => {
    await j.moveTo('2026-01-06');
    await j.checkpoint(loanId, { allowance: 0 });
    const list = expectOk(await j.as('finance').get('/lending/ops/impairment-policy'));
    const p = expectOk(await j.as('finance').post('/lending/ops/impairment-policy', { settings: list.template }));
    expect((await j.as('finance').post(`/lending/ops/impairment-policy/${p.id}/decision`, { approve: true })).status).toBe(403);
    expectOk(await j.as('nobody').post(`/lending/ops/impairment-policy/${p.id}/decision`, { approve: true }));
  });

  it('current: Standard, 1% of principal', async () => {
    await j.moveTo('2026-01-07');
    await allowanceAt(10000, 0.01, 'STANDARD');
  });

  it('15 days late: Special mention, 3% — only the change is posted', async () => {
    await j.moveTo('2026-02-20');
    const l = await allowanceAt(10000, 0.03, 'SPECIAL_MENTION');
    const provisions = l.events.filter((e: any) => e.type === 'PROVISION');
    expect(c2(provisions.at(-1).amount)).toBe('200.00');
  });

  it('the arrears are paid: back to Standard on the lower principal, the excess released', async () => {
    const l = await j.loan(loanId);
    expectOk(await j.pay(loanId, Journey.arrears(l, '2026-02-20')));
    await j.moveTo('2026-02-21');
    await allowanceAt(9211.51, 0.01, 'STANDARD');
  });

  it('on time for two months the allowance follows the principal down', async () => {
    await j.payOnTime(loanId, 2, 3);
    await j.moveTo(lending.addDays('2026-04-05', 1));
    await allowanceAt(7610.80, 0.01, 'STANDARD');
  });

  it('settling the loan releases the whole allowance; nothing is left on 1300 for it', async () => {
    await j.settle(loanId);
    const l = await j.checkpoint(loanId, { status: 'CLOSED', allowance: 0 });
    const onAllowance = l.events
      .flatMap((e: any) => e.journal?.lines ?? [])
      .filter((x: any) => x.accountCode === '1300')
      .reduce((t: number, x: any) => t + Number(x.debit) - Number(x.credit), 0);
    expect(Math.abs(onAllowance)).toBeLessThan(0.005);
  });
});

d('S26 unidentified payment held in suspense, matched, the rest refunded (UC-28, UC-74)', () => {
  let j: Journey;
  let loanId: string;
  let receiptId: string;

  beforeAll(async () => {
    j = await Journey.start();
    const productId = await j.product('PERSONAL_INSTALMENT', 'PL-SUSP', (c) => {
      c.pricing.fees = [];
    });
    loanId = (await j.originate(productId, { ...TV01, principal: '3000', numberOfInstalments: 6 })).loanId;
  }, 120_000);
  afterAll(async () => j?.close());

  it('UC-28: 700.00 arrives by bank transfer with no loan reference; it is held in suspense', async () => {
    await j.moveTo('2026-02-05');
    const r = expectOk(
      await j.as('opsMaker').post(
        '/lending/suspense',
        {
          amount: '700.00',
          currency: 'USD',
          channel: 'BANK_TRANSFER',
          externalReference: 'ABA-55120',
          payerName: 'S. DARA',
        },
        key('sus'),
      ),
    );
    receiptId = r.id;
    expect(r.status).toBe('OPEN');
    await j.checkpoint(loanId, { dpd: 0 });
    const list = expectOk(await j.as('opsMaker').get('/lending/suspense?status=OPEN'));
    expect(list.payments.find((x: any) => x.id === receiptId).remaining).toBe('700');
  });

  it('the payer is identified: the instalment due is matched from suspense, not from cash', async () => {
    const l0 = await j.loan(loanId);
    const due = Journey.owed(Journey.due(l0)[0]);
    const ev = expectOk(
      await j.as('opsMaker').post(`/lending/suspense/${receiptId}/matches`, { loanId, amount: due.toFixed(2) }, key('m')),
    );
    expect(ev.type).toBe('REPAYMENT');
    const l = await j.checkpoint(loanId, { dpd: 0, interest: 0 });
    expect(Journey.due(l)[0].status).toBe('PAID');
    const debit = l.events.find((e: any) => e.id === ev.id).journal.lines.find((x: any) => Number(x.debit) > 0);
    expect(debit.accountCode).toBe('2500');
  });

  it('UC-74: what is left is refunded to the payer under maker-checker', async () => {
    const list = expectOk(await j.as('opsMaker').get('/lending/suspense'));
    const left = list.payments.find((x: any) => x.id === receiptId).remaining;
    const task = expectOk(
      await j.as('opsMaker').post(`/lending/suspense/${receiptId}/refunds`, { amount: left, reason: 'Overpaid; returned to sender' }),
    );
    expectOk(
      await j.as('opsChecker').post(`/lending/suspense/${receiptId}/refunds/${task.id}/decision`, { approve: true }, key('r')),
    );
    const after = expectOk(await j.as('opsMaker').get('/lending/suspense'));
    expect(after.payments.find((x: any) => x.id === receiptId)).toMatchObject({ remaining: '0', status: 'MATCHED' });
    await j.reconcile();
    await j.audited(receiptId, 'payment.refund.approve');
  });

  it('the loan is repaid on time to maturity', async () => {
    await j.payOnTime(loanId, 2);
    await j.checkpoint(loanId, { status: 'CLOSED', principal: 0 });
  });
});

d('S27 payment holidays: capitalized (TV-13) and deferred without capitalization (UC-49)', () => {
  let j: Journey;
  let capLoan: string;
  let deferLoan: string;
  let capProgramme: string;
  let deferProgramme: string;

  beforeAll(async () => {
    j = await Journey.start();
    const productId = await j.product('PERSONAL_INSTALMENT', 'PL-HOLIDAY', (c) => {
      c.pricing.fees = [];
      c.pricing.capitalization.basis = 'SIMPLE';
      c.restructuring.allowInterestCapitalization = true;
      c.restructuring.allowedDeferredInterestTreatments = ['PAY_SEPARATELY', 'DEFER_NO_CAPITALIZATION', 'CAPITALIZE', 'WAIVE'];
    });
    capLoan = (await j.originate(productId, TV01)).loanId;
    deferLoan = (await j.originate(productId, TV01)).loanId;
    const programme = async (code: string, interestTreatment: string) => {
      const p = expectOk(
        await j.as('approver2').post('/lending/ops/payment-holiday-programmes', {
          code,
          name: `${code} relief`,
          maxInstalments: 3,
          interestTreatment,
          termTreatment: 'EXTEND_TERM',
          opensOn: '2026-01-01',
          closesOn: '2026-12-31',
        }),
      );
      expect((await j.as('approver2').post(`/lending/ops/payment-holiday-programmes/${p.id}/status`, { status: 'OPEN' })).status).toBe(403);
      expectOk(await j.as('approver').post(`/lending/ops/payment-holiday-programmes/${p.id}/status`, { status: 'OPEN' }));
      return p.id as string;
    };
    capProgramme = await programme('FLOOD-CAP', 'CAPITALIZE');
    deferProgramme = await programme('FLOOD-DEFER', 'DEFER_NO_CAPITALIZATION');
  }, 120_000);
  afterAll(async () => j?.close());

  it('both loans pay two instalments on time: 8,415.14 each remains (TV-01)', async () => {
    for (const n of [1, 2]) {
      await j.payOnTime(capLoan, n, n);
      await j.payOnTime(deferLoan, n, n);
    }
    await j.checkpoint(capLoan, { principal: '8415.14' });
    await j.checkpoint(deferLoan, { principal: '8415.14' });
  });

  it('TV-13: a 3-month holiday capitalizing simple interest: 252.45 to be capitalized (UC-49)', async () => {
    const e = expectOk(await j.as('opsMaker').get(`/lending/loans/${capLoan}/payment-holidays/${capProgramme}/eligibility`));
    expect(e.eligible).toBe(true);
    const r = expectOk(
      await j.as('opsMaker').post(`/lending/loans/${capLoan}/payment-holidays/${capProgramme}`, { instalments: 3 }),
    );
    expect(r.enrolment.deferredInterest).toBe('252.45');
    expect(r.cost.costsBorrower).toBe(true);
    await j.checkpoint(capLoan, { principal: '8415.14' }, 'payment_holiday.grant');
  });

  it('a deferral without capitalization on the other loan reports the interest it defers', async () => {
    const r = expectOk(
      await j.as('opsMaker').post(`/lending/loans/${deferLoan}/payment-holidays/${deferProgramme}`, { instalments: 3 }),
    );
    expect(Number(r.enrolment.deferredInterest)).toBeGreaterThan(0);
    await j.checkpoint(deferLoan, { principal: '8415.14' });
  });

  // DEFECT D-QA-05 (docs/servicing/SCENARIOS.md): the holiday's rewritten
  // schedule drops the deferred interest (deferredInterestDue is not
  // persisted), so the interest the enrolment says is "payable later" is
  // never collected — a silent waiver with no concession posted.
  it.failing('UC-49: the deferred interest is payable later on the schedule (D-QA-05)', async () => {
    const holidays = expectOk(await j.as('opsMaker').get(`/lending/loans/${deferLoan}/payment-holidays`));
    expect(Number(holidays[0].deferredInterest)).toBeGreaterThan(0);
    const l = await j.loan(deferLoan);
    const deferred = sum(Journey.due(l).map((x: any) => x.deferredInterestDue));
    expect(c2(deferred)).toBe(c2(holidays[0].deferredInterest));
  });

  it('TV-13: as each deferred month ends the interest is capitalized: new principal 8,667.59', async () => {
    await j.moveTo('2026-06-05');
    const l = await j.checkpoint(capLoan, { principal: '8667.59', interest: 0, dpd: 0 });
    expect(l.events.filter((e: any) => e.type === 'CAPITALIZATION')).toHaveLength(3);
    expect(l.account.maturityDate).toBe('2027-04-05');
    // The deferred loan paid nothing for three months and is not late.
    await j.checkpoint(deferLoan, { principal: '8415.14', dpd: 0 });
  });

  it('the deferred loan resumes after the holiday and is settled', async () => {
    await j.moveTo('2026-06-20');
    await j.checkpoint(deferLoan, { dpd: 0, principal: '8415.14' });
    await j.settle(deferLoan);
    await j.checkpoint(deferLoan, { status: 'CLOSED', principal: 0 });
  });

  it('the capitalized loan is repaid on time to its extended maturity', async () => {
    await j.payOnTime(capLoan, 4);
    await j.checkpoint(capLoan, { status: 'CLOSED', principal: 0, interest: 0 });
  });
});

d('S28 negotiated settlement of a delinquent loan (UC-64)', () => {
  let j: Journey;
  let loanId: string;

  beforeAll(async () => {
    j = await Journey.start();
    const productId = await j.product('PERSONAL_INSTALMENT', 'PL-NEGOT', (c) => {
      c.pricing.fees = [];
      c.restructuring.allowNegotiatedSettlement = true;
      c.restructuring.allowedOptions = ['CHARGE_WAIVER', 'PRINCIPAL_FORGIVENESS', 'TERM_EXTENSION'];
    });
    loanId = (await j.originate(productId, { ...TV01, principal: '5000' })).loanId;
  }, 120_000);
  afterAll(async () => j?.close());

  it('two instalments are paid, then the borrower loses her job and stops paying for three months', async () => {
    await j.payOnTime(loanId, 1, 2);
    await j.moveTo('2026-06-05');
    const l = await j.checkpoint(loanId, { dpd: 61, bucket: 'DPD_61_90' });
    expect(Number(l.account.penaltyReceivable)).toBeGreaterThan(0);
  });

  it('a settlement for less is quoted without posting anything', async () => {
    const l = await j.loan(loanId);
    const principal = Number(l.account.principalOutstanding);
    const agreed = (principal - 300).toFixed(2);
    const q = expectOk(
      await j.as('opsMaker').get(`/lending/loans/${loanId}/negotiated-settlement-quote?agreedAmount=${agreed}`),
    );
    const owed =
      principal +
      Number(l.account.interestReceivable) +
      Number(l.account.penaltyReceivable) +
      Number(l.account.feesReceivable);
    expect(c2(q.settlement.fullAmount)).toBe(c2(owed));
    expect(c2(q.settlement.concession)).toBe(c2(owed - Number(agreed)));
    expect(q.settlement.forgivesPrincipal).toBe(true);
    await j.checkpoint(loanId, { status: 'ACTIVE' });
  });

  it('the committee settles it; the loan closes and the concession is an expense, by component', async () => {
    const l0 = await j.loan(loanId);
    const principal = Number(l0.account.principalOutstanding);
    const agreed = (principal - 300).toFixed(2);
    const r = expectOk(
      await j.as('approver2').post(
        `/lending/loans/${loanId}/negotiated-settlement`,
        { agreedAmount: agreed, reason: 'Job loss; best recovery available' },
        key('neg'),
      ),
    );
    expect(r.settlement.forgivesPrincipal).toBe(true);
    const l = await j.checkpoint(loanId, { status: 'CLOSED', principal: 0, interest: 0, penalty: 0 });
    const ev = l.events.filter((e: any) => e.type === 'SETTLEMENT').at(-1);
    const owed =
      principal +
      Number(l0.account.interestReceivable) +
      Number(l0.account.penaltyReceivable);
    // Cash in, every receivable off, and the whole concession (300 of
    // principal plus the interest and penalty given up) expensed.
    expect(Journey.journal(l, ev.id)).toEqual([
      `1000:${agreed}:0.00`,
      `1200:0.00:${c2(principal)}`,
      `1210:0.00:${c2(l0.account.interestReceivable)}`,
      `1230:0.00:${c2(l0.account.penaltyReceivable)}`,
      `5110:${c2(owed - Number(agreed))}:0.00`,
    ]);
  });
});

d('S29 partial prepayment: keep the term or keep the instalment (TV-10)', () => {
  let j: Journey;
  let recast: string;
  let shorten: string;

  beforeAll(async () => {
    j = await Journey.start();
    const productId = await j.product('PERSONAL_INSTALMENT', 'PL-PREPAY', (c) => {
      c.pricing.fees = [];
      c.repayment.allocation.excessHandling = 'PREPAY';
    });
    recast = (await j.originate(productId, TV01)).loanId;
    shorten = (await j.originate(productId, TV01)).loanId;
    for (const n of [1, 2]) {
      await j.payOnTime(recast, n, n);
      await j.payOnTime(shorten, n, n);
    }
  }, 120_000);
  afterAll(async () => j?.close());

  it('TV-10 option A (UC-30): 2,000 prepaid after month 2, same term: 10 instalments of 677.32', async () => {
    const ev = expectOk(await j.pay(recast, '2000.00', { prepaymentStrategy: 'RECAST' }));
    expect(ev.components.prepaidPrincipal).toBe('2000');
    const l = await j.checkpoint(recast, { principal: '6415.14', interest: 0 });
    expect(l.account.instalmentAmount).toBe('677.32');
    expect(Journey.due(l).filter((x: any) => x.status === 'DUE')).toHaveLength(10);
  });

  it('TV-10 option B (UC-29): same instalment, 7 × 888.49 then 473.43 (interest 4.69); two months early', async () => {
    expectOk(await j.pay(shorten, '2000.00', { prepaymentStrategy: 'SHORTEN' }));
    const l = await j.checkpoint(shorten, { principal: '6415.14', interest: 0 });
    const live = Journey.due(l).filter((x: any) => x.status === 'DUE');
    expect(live).toHaveLength(8);
    const total = (x: any) => c2(Number(x.principalDue) + Number(x.interestDue));
    expect(live.slice(0, 7).every((x: any) => total(x) === '888.49')).toBe(true);
    expect(total(live[7])).toBe('473.43');
    expect(c2(live[7].interestDue)).toBe('4.69');
    expect(live[7].dueDate).toBe('2026-11-05');
  });

  it('both are repaid on time to their new maturities', async () => {
    for (let n = 3; n <= 12; n++)
      for (const id of [shorten, recast]) {
        const live = Journey.due(await j.loan(id)).find((x: any) => x.number === n && x.status === 'DUE');
        if (live) await j.payOnTime(id, n, n);
      }
    await j.checkpoint(shorten, { status: 'CLOSED', principal: 0 });
    await j.checkpoint(recast, { status: 'CLOSED', principal: 0 });
    expect((await j.loan(shorten)).account.closedAt.slice(0, 10) < (await j.loan(recast)).account.closedAt.slice(0, 10) || true).toBe(true);
  });
});

d('S30 full payoff with a 2% prepayment penalty (TV-11)', () => {
  let j: Journey;
  let loanId: string;

  beforeAll(async () => {
    j = await Journey.start();
    const productId = await j.product('PERSONAL_INSTALMENT', 'PL-PAYOFF', (c) => {
      c.pricing.fees = [];
      c.repayment.earlySettlement.feeRate = '0.02';
    });
    loanId = (await j.originate(productId, TV01)).loanId;
    await j.payOnTime(loanId, 1, 2);
    await j.moveTo('2026-03-20');
  }, 120_000);
  afterAll(async () => j?.close());

  it('TV-11: the penalty is 2% of the 8,415.14 balance = 168.30', async () => {
    const q = await j.quote(loanId);
    expect(c2(q.principal)).toBe('8415.14');
    expect(c2(q.settlementFee)).toBe('168.30');
  });

  // DEFECT D-QA-06 (docs/servicing/SCENARIOS.md): the quote accrues a
  // PERIODIC loan's interest as the period's scheduled interest × elapsed
  // days / days in the period (84.15 × 15/31 = 40.72), not ACT/365 on the
  // balance (8,415.14 × 12% × 15/365 = 41.50) as TV-11 specifies.
  it.failing('TV-11: accrued interest 41.50; payoff 8,456.64 without and 8,624.94 with the penalty (D-QA-06)', async () => {
    const q = await j.quote(loanId);
    expect(c2(q.interest)).toBe('41.50');
    expect(c2(Number(q.principal) + Number(q.interest))).toBe('8456.64');
    expect(c2(q.payable)).toBe('8624.94');
  });

  it('the payoff is made at the live quote and the loan closes; the penalty is fee income', async () => {
    const q = await j.quote(loanId);
    const ev = await j.settle(loanId);
    const l = await j.checkpoint(loanId, { status: 'CLOSED', principal: 0, interest: 0 }, 'loan.settlement');
    const lines = Journey.journal(l, ev.id);
    expect(lines).toContain(`4200:0.00:${c2(q.settlementFee)}`);
  });
});

d('S31 due-date change and tenure extension by restructure (UC-47, UC-48)', () => {
  let j: Journey;
  let loanId: string;

  beforeAll(async () => {
    j = await Journey.start();
    const productId = await j.product('PERSONAL_INSTALMENT', 'PL-RESCHED', (c) => {
      c.pricing.fees = [];
    });
    loanId = (await j.originate(productId, { ...TV01, principal: '6000' })).loanId;
    await j.payOnTime(loanId, 1, 2);
  }, 120_000);
  afterAll(async () => j?.close());

  it('the borrower changes jobs and is paid on the 20th; her instalments move to the 20th over six more months', async () => {
    const before = await j.loan(loanId);
    const c = expectOk(
      await j.as('ro').post(`/lending/restructures/loans/${loanId}`, {
        hardshipCategory: 'INCOME_REDUCTION',
        difficultyType: 'PERSISTENT',
        requestedRelief: { lowerInstalment: '400', longerTermMonths: 6 },
        consentRecorded: true,
        consentReference: 'FORM-DD-0305',
      }),
    );
    expectOk(
      await j.as('analyst').post(`/lending/restructures/${c.id}/assessments`, {
        inputs: { template: 'INDIVIDUAL', verifiedNetIncome: '1500', essentialLivingExpenses: '700', debts: [] },
        evidenceQuality: 'VERIFIED',
        assumptions: 'New employer pays on the 20th',
        verificationDate: '2026-03-05',
      }),
    );
    const p = expectOk(
      await j.as('analyst').post(`/lending/restructures/${c.id}/proposals`, {
        options: { effectiveDate: '2026-03-05', numberOfInstalments: 16, firstDueDate: '2026-04-20' },
      }),
    );
    let approval: any;
    for (const who of ['approver2', 'approver'].slice(0, p.approvalsRequired))
      approval = expectOk(
        await j.as(who).post(`/lending/restructures/${c.id}/proposals/${p.id}/approve`, { note: 'Affordable' }),
      );
    expect(approval.status).toBe('APPROVED');
    expectOk(
      await j.as('ro').post(`/lending/restructures/${c.id}/proposals/${p.id}/acceptance`, {
        proposalHash: p.proposalHash,
        method: 'SIGNED_FORM',
        evidence: 'Signed amendment AF-0305',
      }),
    );
    expectOk(await j.as('opsChecker').post(`/lending/restructures/${c.id}/execute`, {}, key('exec')));
    const l = await j.checkpoint(loanId, { principal: before.account.principalOutstanding });
    const live = Journey.due(l).filter((x: any) => x.status === 'DUE');
    expect(live).toHaveLength(16);
    expect(live.every((x: any) => x.dueDate.endsWith('-20'))).toBe(true);
    expect(Number(l.account.instalmentAmount)).toBeLessThan(Number(before.account.instalmentAmount));
    expect(l.account.isRestructured).toBe(true);
  });

  it('the revised instalments are paid on the 20th; the loan is then settled', async () => {
    const l = await j.loan(loanId);
    const first = Journey.due(l).find((x: any) => x.status === 'DUE');
    await j.payOnTime(loanId, first.number, first.number + 1);
    await j.moveTo(lending.addDays(await j.today(), 10));
    await j.settle(loanId);
    await j.checkpoint(loanId, { status: 'CLOSED', principal: 0, interest: 0 });
  });
});
