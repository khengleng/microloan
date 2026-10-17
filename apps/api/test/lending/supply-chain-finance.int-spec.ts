/* eslint-disable @typescript-eslint/no-unsafe-call -- integration fixtures: modules are required after the test environment is configured, and fixture rows come from the untyped Prisma client. */
/**
 * SUPPLY_CHAIN_FINANCE over the real HTTP API, guards and database: the
 * anchor buyer's programme limit, suppliers onboarded under maker-checker
 * with a sublimit, buyer-approved invoices paid to the supplier early at a
 * discount, the buyer paying the face at maturity — or ageing as arrears
 * when it does not — to the programme's closure with balanced books.
 *
 * Evidence for: trade.supply_chain
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

d('SUPPLY_CHAIN_FINANCE (integration)', () => {
  let f: Fixture;
  let facilityId: string;
  let loanId: string;
  let supplierId: string;
  let firstId: string;

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
    const { productId } = await activeProduct(
      f,
      'SUPPLY_CHAIN_FINANCE',
      'SCF-1',
    );
    // The anchor buyer's programme.
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

  it('suppliers are onboarded by one officer and approved by another before their invoices are taken', async () => {
    const noSupplier = await f
      .as('opsMaker')
      .post(`/lending/facilities/${facilityId}/invoices`, {
        invoiceNumber: 'X-1',
        amount: '1000',
        issueDate: '2026-02-01',
        dueDate: '2026-03-01',
      });
    expect(noSupplier.status).toBe(400);
    const s = expectOk(
      await f
        .as('opsMaker')
        .post(`/lending/facilities/${facilityId}/suppliers`, {
          name: 'Battambang Rice Mill',
          bankName: 'ACLEDA',
          accountNumber: '0001-22-333',
          sublimit: '60000',
        }),
    );
    supplierId = s.id;
    expect(s.status).toBe('PENDING');
    const pending = await f
      .as('opsMaker')
      .post(`/lending/facilities/${facilityId}/invoices`, {
        supplierId,
        invoiceNumber: 'BRM-1',
        amount: '50000',
        issueDate: '2026-02-01',
        dueDate: '2026-04-02',
      });
    expect(pending.status).toBe(409);
    expect(pending.body.code).toBe('SUPPLIER_NOT_ACTIVE');
    expect(
      (await f.as('opsMaker').post(`/lending/suppliers/${supplierId}/approve`))
        .status,
    ).toBe(403);
    expect(
      expectOk(
        await f.as('approver').post(`/lending/suppliers/${supplierId}/approve`),
      ).status,
    ).toBe('ACTIVE');
    const other = expectOk(
      await f
        .as('opsMaker')
        .post(`/lending/facilities/${facilityId}/suppliers`, {
          name: 'Kep Crab Co',
        }),
    );
    expect(
      expectOk(
        await f.as('approver').post(`/lending/suppliers/${other.id}/reject`, {
          reason: 'Failed KYC',
        }),
      ).status,
    ).toBe('REJECTED');
  });

  it('a buyer-approved invoice is paid to the supplier early at an 8% discount', async () => {
    const inv = expectOk(
      await f
        .as('opsMaker')
        .post(`/lending/facilities/${facilityId}/invoices`, {
          supplierId,
          invoiceNumber: 'BRM-1',
          amount: '50000',
          issueDate: '2026-02-01',
          dueDate: '2026-04-02',
        }),
    );
    firstId = inv.id;
    expect(inv.kind).toBe('SUPPLY_CHAIN');
    expect(inv.debtorName).toBe('Battambang Rice Mill');
    expectOk(
      await f.as('approver').post(`/lending/invoices/${firstId}/approve`),
    );
    const early = await f
      .as('opsMaker')
      .post(`/lending/invoices/${firstId}/advance`);
    expect(early.status).toBe(409);
    expect(early.body.code).toBe('ACKNOWLEDGEMENT_REQUIRED');
    expectOk(
      await f.as('opsMaker').post(`/lending/invoices/${firstId}/acknowledge`, {
        method: 'BUYER_PORTAL',
        reference: 'PAYABLE-APPROVAL-77',
      }),
    );
    const req = expectOk(
      await f.as('opsMaker').post(`/lending/invoices/${firstId}/advance`),
    );
    // 50,000 × 8% × 59 / 360 = 655.56
    expect(req.advance).toBe('50000');
    expect(req.discount).toBe('655.56');
    expect(req.paidOut).toBe('49344.44');
    expectOk(
      await f
        .as('opsChecker')
        .post(`/lending/invoices/${firstId}/advance/approve`),
    );
    expectOk(
      await f
        .as('opsChecker')
        .post(
          `/lending/invoices/${firstId}/advance/release`,
          { externalReference: 'PAY-BRM-1' },
          key('brm1'),
        ),
    );
    expect(await glNet(f, '1200', loanId)).toBe('50000.00');
    expect(await glNet(f, '2340', loanId)).toBe('-655.56');
    const events = await f.system(() =>
      f.prisma.financialEvent.findMany({
        where: { tenantId: f.t1, loanAccountId: loanId, type: 'DISBURSEMENT' },
      }),
    );
    expect(events[0].components.payee).toEqual(
      expect.objectContaining({
        type: 'SUPPLIER',
        name: 'Battambang Rice Mill',
      }),
    );
  });

  it('the supplier sublimit is respected, and the buyer pays as the debtor', async () => {
    const more = expectOk(
      await f
        .as('opsMaker')
        .post(`/lending/facilities/${facilityId}/invoices`, {
          supplierId,
          invoiceNumber: 'BRM-2',
          amount: '20000',
          issueDate: '2026-02-01',
          dueDate: '2026-04-02',
        }),
    );
    expectOk(
      await f.as('opsMaker').post(`/lending/invoices/${more.id}/acknowledge`, {
        method: 'BUYER_LETTER',
        reference: 'PA-78',
      }),
    );
    expectOk(
      await f.as('approver').post(`/lending/invoices/${more.id}/approve`),
    );
    const r = await f
      .as('opsMaker')
      .post(`/lending/invoices/${more.id}/advance`);
    expect(r.status).toBe(400);
    expect(r.body.code).toBe('SUPPLIER_SUBLIMIT');
    expectOk(
      await f.as('approver').post(`/lending/invoices/${more.id}/reject`, {
        reason: 'Over the supplier sublimit',
      }),
    );
    const asBorrower = await f
      .as('opsMaker')
      .post(
        `/lending/invoices/${firstId}/collections`,
        { source: 'BORROWER', amount: '100' },
        key('scf-b'),
      );
    expect(asBorrower.status).toBe(400);
    expect(asBorrower.body.code).toBe('BUYER_IS_DEBTOR');
  });

  it('the buyer pays the face at maturity and the whole discount is earned', async () => {
    await setBusinessDate(f, '2026-04-02');
    await runBatch(f);
    const r = expectOk(
      await f.as('opsMaker').post(
        `/lending/invoices/${firstId}/collections`,
        {
          source: 'DEBTOR',
          amount: '50000',
          externalReference: 'BUYER-PAY-1',
        },
        key('scf-pay'),
      ),
    );
    expect(r.status).toBe('SETTLED');
    expect(await glNet(f, '4530', loanId)).toBe('-655.56');
    expect(await glNet(f, '2340', loanId)).toBe('0.00');
  });

  it('a buyer that pays late ages as arrears from maturity + grace, and the programme closes once it pays', async () => {
    const inv = expectOk(
      await f
        .as('opsMaker')
        .post(`/lending/facilities/${facilityId}/invoices`, {
          supplierId,
          invoiceNumber: 'BRM-3',
          amount: '30000',
          issueDate: '2026-04-01',
          dueDate: '2026-05-02',
        }),
    );
    expectOk(
      await f.as('opsMaker').post(`/lending/invoices/${inv.id}/acknowledge`, {
        method: 'BUYER_PORTAL',
        reference: 'PA-79',
      }),
    );
    const { req } = await fund(f, inv.id, 'brm3');
    // 30 days: 30,000 × 8% × 30 / 360 = 200.00
    expect(req.discount).toBe('200');
    await setBusinessDate(f, '2026-05-08');
    await runBatch(f);
    expect((await invoiceOf(inv.id)).invoice.status).toBe('RECOURSE');
    expect((await loanOf(f, loanId)).account.daysPastDue).toBe(1);
    await setBusinessDate(f, '2026-05-12');
    await runBatch(f);
    expect((await loanOf(f, loanId)).account.daysPastDue).toBe(5);
    expectOk(
      await f.as('opsMaker').post(
        `/lending/invoices/${inv.id}/collections`,
        {
          source: 'DEBTOR',
          amount: '30000',
          externalReference: 'BUYER-LATE',
        },
        key('scf-late'),
      ),
    );
    await runBatch(f);
    expect((await loanOf(f, loanId)).account.daysPastDue).toBe(0);
    expect(await glNet(f, '4530', loanId)).toBe('-855.56');
    expectOk(
      await f
        .as('opsChecker')
        .post(`/lending/facilities/${facilityId}/receivables/close`),
    );
    expect((await loanOf(f, loanId)).account.status).toBe('CLOSED');
    expect(await journalsBalance(f, loanId)).toBe(true);
    expect(await reconciliationBreaks(f, [loanId])).toEqual([]);
  });
});
