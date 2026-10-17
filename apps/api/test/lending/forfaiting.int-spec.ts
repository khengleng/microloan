/**
 * FORFAITING over the real HTTP API, guards and database: avalised bills
 * of exchange and promissory notes bought without recourse at a discount
 * rate for the days to maturity plus grace, the discount earned day by day,
 * the face collected at maturity, and a defaulted instrument written off as
 * the lender's loss — to the programme's closure with balanced books.
 *
 * Evidence for: trade.forfaiting
 */
import {
  Fixture,
  TEST_DB,
  authority,
  bootstrap,
  expectOk,
  key,
} from './harness';
import { activeProduct, standardRoles } from './setup';
import {
  bookProgramme,
  enableFlag,
  fund,
  glNet,
  journalsBalance,
  loanOf,
  reconciliationBreaks,
  runBatch,
  setBusinessDate,
} from './trade-helpers';

const d = TEST_DB ? describe : describe.skip;

d('FORFAITING (integration)', () => {
  let f: Fixture;
  let facilityId: string;
  let loanId: string;
  let noteId: string;
  let billId: string;

  beforeAll(async () => {
    f = await bootstrap();
    await standardRoles(f);
    await authority(
      f,
      f.t1,
      'opsChecker',
      'facility.drawdown.approve',
      'USD',
      '1000000',
    );
    for (const flag of [
      'lending.revolving.drawdown',
      'lending.trade.receivables_purchase',
    ])
      await enableFlag(f, flag);
    await setBusinessDate(f, '2026-02-02');
    const { productId } = await activeProduct(f, 'FORFAITING', 'FFT-1');
    ({ facilityId, loanId } = await bookProgramme(
      f,
      productId,
      '200000',
      '2026-02-02',
    ));
  }, 90_000);
  afterAll(async () => f?.app.close());

  const invoiceOf = async (id: string) =>
    expectOk(await f.as('opsMaker').get(`/lending/invoices/${id}`));

  it('an instrument must be named, and avalised before it is bought', async () => {
    const bad = await f
      .as('opsMaker')
      .post(`/lending/facilities/${facilityId}/invoices`, {
        debtorName: 'Saigon Importers JSC',
        invoiceNumber: 'PN-1',
        amount: '100000',
        issueDate: '2026-02-01',
        dueDate: '2026-05-02',
      });
    expect(bad.status).toBe(400);
    const note = expectOk(
      await f
        .as('opsMaker')
        .post(`/lending/facilities/${facilityId}/invoices`, {
          debtorName: 'Saigon Importers JSC',
          invoiceNumber: 'PN-1',
          amount: '100000',
          issueDate: '2026-02-01',
          dueDate: '2026-05-02',
          instrumentType: 'PROMISSORY_NOTE',
        }),
    );
    noteId = note.id;
    expect(note.kind).toBe('FORFAITING');
    expect(note.receivable.recourse).toBe('NONE');
    expectOk(
      await f.as('approver').post(`/lending/invoices/${noteId}/approve`),
    );
    const early = await f
      .as('opsMaker')
      .post(`/lending/invoices/${noteId}/advance`);
    expect(early.status).toBe(409);
    expect(early.body.code).toBe('ACKNOWLEDGEMENT_REQUIRED');
    // The aval names the guaranteeing bank.
    expect(
      (
        await f.as('opsMaker').post(`/lending/invoices/${noteId}/acknowledge`, {
          method: 'AVAL_ON_INSTRUMENT',
          reference: 'AVAL-77',
        })
      ).status,
    ).toBe(400);
    expectOk(
      await f.as('opsMaker').post(`/lending/invoices/${noteId}/acknowledge`, {
        method: 'AVAL_ON_INSTRUMENT',
        reference: 'AVAL-77',
        guarantorName: 'Bank for Foreign Trade of Vietnam',
      }),
    );
  });

  it('the note is bought at a 7% straight discount for 89 days to maturity + 3 days grace', async () => {
    const req = expectOk(
      await f.as('opsMaker').post(`/lending/invoices/${noteId}/advance`),
    );
    // 100,000 × 7% × 92 / 360 = 1,788.89
    expect(req.advance).toBe('100000');
    expect(req.discount).toBe('1788.89');
    expect(req.paidOut).toBe('98211.11');
    expect(
      (
        await f
          .as('opsMaker')
          .post(`/lending/invoices/${noteId}/advance/approve`)
      ).status,
    ).toBe(403);
    expectOk(
      await f
        .as('opsChecker')
        .post(`/lending/invoices/${noteId}/advance/approve`),
    );
    const released = expectOk(
      await f
        .as('opsChecker')
        .post(
          `/lending/invoices/${noteId}/advance/release`,
          { externalReference: 'BANK-PN1' },
          key('pn1'),
        ),
    );
    expect(released.paidOut).toBe('98211.11');
    expect(await glNet(f, '1200', loanId)).toBe('100000.00');
    expect(await glNet(f, '1000', loanId)).toBe('-98211.11');
    expect(await glNet(f, '2340', loanId)).toBe('-1788.89');
    expect((await loanOf(f, loanId)).account.principalOutstanding).toBe(
      '100000',
    );
  });

  it('the seller owes nothing on bought paper; the discount is earned day by day', async () => {
    const r = await f
      .as('opsMaker')
      .post(
        `/lending/invoices/${noteId}/collections`,
        { source: 'BORROWER', amount: '10' },
        key('fft-b'),
      );
    expect(r.status).toBe(400);
    expect(r.body.code).toBe('WITHOUT_RECOURSE');
    await setBusinessDate(f, '2026-03-04');
    await runBatch(f);
    // 30 of 89 days: 1,788.89 × 30 / 89 = 603.00
    const inv = await invoiceOf(noteId);
    expect(inv.invoice.receivable.discountEarned).toBe('603');
    expect(await glNet(f, '4530', loanId)).toBe('-603.00');
    expect(await glNet(f, '2340', loanId)).toBe('-1185.89');
  });

  it('a bill unpaid at maturity + collection grace defaults with the lender and is written off under maker-checker', async () => {
    const bill = expectOk(
      await f
        .as('opsMaker')
        .post(`/lending/facilities/${facilityId}/invoices`, {
          debtorName: 'Bangkok Machinery PLC',
          invoiceNumber: 'BE-2',
          amount: '50000',
          issueDate: '2026-03-04',
          dueDate: '2026-04-03',
          instrumentType: 'BILL_OF_EXCHANGE',
          guarantorName: 'Siam Commercial Bank',
        }),
    );
    billId = bill.id;
    expectOk(
      await f.as('opsMaker').post(`/lending/invoices/${billId}/acknowledge`, {
        method: 'SEPARATE_GUARANTEE',
        reference: 'GTEE-9',
      }),
    );
    const { req } = await fund(f, billId, 'be2');
    // 30 days + 3 grace: 50,000 × 7% × 33 / 360 = 320.83
    expect(req.discount).toBe('320.83');
    await setBusinessDate(f, '2026-04-14');
    await runBatch(f);
    const inv = await invoiceOf(billId);
    expect(inv.invoice.status).toBe('DEFAULTED');
    expect(inv.invoice.receivable.discountEarned).toBe('320.83');
    expect((await loanOf(f, loanId)).account.daysPastDue).toBe(0);
    const task = expectOk(
      await f.as('opsMaker').post(`/lending/invoices/${billId}/write-offs`, {
        reason: 'Drawee and avalising bank refused payment',
      }),
    );
    expect(task.amount).toBe('50000');
    expect(
      (
        await f
          .as('opsMaker')
          .post(
            `/lending/invoices/${billId}/write-offs/${task.id}/decision`,
            { approve: true },
            key('self'),
          )
      ).status,
    ).toBe(403);
    expectOk(
      await f
        .as('opsChecker')
        .post(
          `/lending/invoices/${billId}/write-offs/${task.id}/decision`,
          { approve: true },
          key('be2-wo'),
        ),
    );
    expect(await glNet(f, '5500', loanId)).toBe('50000.00');
    expect(await reconciliationBreaks(f, [loanId])).toEqual([]);
  });

  it('the obligor pays the face at maturity: all the discount is earned and the programme closes', async () => {
    await setBusinessDate(f, '2026-05-02');
    const r = expectOk(
      await f.as('opsMaker').post(
        `/lending/invoices/${noteId}/collections`,
        {
          source: 'DEBTOR',
          amount: '100000',
          externalReference: 'MATURITY-PN1',
        },
        key('pn1-col'),
      ),
    );
    expect(r.toAdvance).toBe('100000');
    expect(r.status).toBe('SETTLED');
    expect((await invoiceOf(noteId)).invoice.receivable.discountEarned).toBe(
      '1788.89',
    );
    expect(await glNet(f, '4530', loanId)).toBe('-2109.72');
    expect(await glNet(f, '2340', loanId)).toBe('0.00');
    expect(await glNet(f, '1200', loanId)).toBe('0.00');
    const closed = expectOk(
      await f
        .as('opsChecker')
        .post(`/lending/facilities/${facilityId}/receivables/close`),
    );
    expect(closed.status).toBe('CLOSED');
    expect((await loanOf(f, loanId)).account.status).toBe('CLOSED');
    expect(await journalsBalance(f, loanId)).toBe(true);
    expect(await reconciliationBreaks(f, [loanId])).toEqual([]);
  });
});
