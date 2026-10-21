/* eslint-disable @typescript-eslint/no-unsafe-call -- integration fixtures: fixture rows come from the untyped API responses. */
/**
 * Repayments to the lender's static KHQR code (DECISIONS D-160…D-165):
 *
 *  - the codes: proposed by one person (generated, or read from the bank's
 *    payload / image), approved by another; static, no amount;
 *  - the borrower's "I have paid": a pending claim, no money posted;
 *  - staff receipts: recorded by one person, verified by another;
 *  - statement imports: exact matches posted, the rest to suspense, a bank
 *    reference applied once across all three paths;
 *  - tenant isolation of the new tables.
 */
import { JwtService } from '@nestjs/jwt';
import * as qrcode from 'qrcode';
import { lending } from '@microloan/shared';
import * as XLSX from 'xlsx';
import { borrowerJwtSecret } from '../../src/borrower-portal/borrower-jwt';
import { KhqrCodesService } from '../../src/lending/payments/khqr/khqr-codes.service';
import { LendingPrisma } from '../../src/lending/common/lending-prisma';
import { runAsTenant } from '../../src/prisma/tenant-context';
import {
  Fixture,
  TEST_DB,
  bootstrap,
  expectOk,
  grant,
  key,
  lendingSettings,
} from './harness';
import { activeProduct, originateAndDisburse, standardRoles } from './setup';

const d = TEST_DB ? describe : describe.skip;

const MERCHANT = {
  bakongAccountId: 'test_lender@devb',
  merchantName: 'Test Lender',
  merchantCity: 'Phnom Penh',
};

d('KHQR static repayments (integration)', () => {
  let f: Fixture;
  let productId: string;
  const loans: Record<
    string,
    { id: string; reference: string; borrowerId: string }
  > = {};
  const PHONE_LOCAL = `012${Date.now().toString().slice(-6)}`;
  const ref = (p: string) => `${p}${key('').replace(/[^0-9a-z]/gi, '')}`;
  let claimRef: string;
  let staffRef: string;
  let unknownRef: string;

  const loan = async (id: string) =>
    expectOk(await f.as('opsMaker').get(`/lending/loans/${id}`));
  const repayments = async (id: string) =>
    (await loan(id)).events.filter((e: any) => e.type === 'REPAYMENT');
  const owedFirst = async (id: string) => {
    const l = (await loan(id)).schedule.find(
      (x: any) => x.number === 1 && x.status !== 'SUPERSEDED',
    );
    const n = (k: string) => Number(l[k] ?? 0);
    return (
      n('principalDue') +
      n('interestDue') +
      n('feeDue') +
      n('taxDue') +
      n('penaltyDue') -
      n('principalPaid') -
      n('interestPaid') -
      n('feePaid') -
      n('taxPaid') -
      n('penaltyPaid')
    ).toFixed(2);
  };
  const portal = (borrowerId: string, tenantId = f.t1) => {
    const token = new JwtService({
      secret: borrowerJwtSecret(),
    }).sign(
      { sub: borrowerId, typ: 'borrower', tenantId },
      { expiresIn: '1h' },
    );
    return {
      get: (url: string) =>
        f.http().get(`/v1${url}`).set('Authorization', `Bearer ${token}`),
      post: (url: string, body: unknown) =>
        f
          .http()
          .post(`/v1${url}`)
          .set('Authorization', `Bearer ${token}`)
          .send(body as object),
    };
  };
  const reconcileLedger = async () => {
    const rec = expectOk(
      await f.as('finance').get('/lending/ops/reconciliation'),
    );
    expect(rec.breaks).toEqual([]);
    expect(rec.trialBalanceBalanced).toBe(true);
  };

  beforeAll(async () => {
    f = await bootstrap();
    await standardRoles(f);
    // khqr.manage: finance (FINANCE_OFFICER); the approver of a code holds
    // tenant_settings.approve (RISK_COMPLIANCE).
    await grant(f, f.t1, 'admin2', 'RISK_COMPLIANCE');
    // A tenant administrator (no home branch) sets up a branch's code.
    await grant(f, f.t1, 'admin1', 'TENANT_ADMIN');
    ({ productId } = await activeProduct(
      f,
      'PERSONAL_INSTALMENT',
      'PL-KHQR',
      (c) => {
        c.repayment.allocation.excessHandling = 'ADVANCE';
      },
    ));
    const terms = {
      principal: '3000',
      numberOfInstalments: 6,
      disbursementDate: '2026-01-05',
    };
    for (const name of ['claim', 'staff', 'phone', 'remark', 'held']) {
      const r = await originateAndDisburse(
        f,
        productId,
        terms,
        name === 'phone' ? { borrowerOver: { phone: PHONE_LOCAL } } : {},
      );
      const l = await loan(r.loanId);
      loans[name] = {
        id: r.loanId,
        reference: l.account.reference,
        borrowerId: r.borrowerId,
      };
    }
    expectOk(
      await f
        .as('finance')
        .post('/lending/ops/business-date', { businessDate: '2026-01-20' }),
    );
  }, 240_000);
  afterAll(async () => f?.app.close());

  // ── Codes ────────────────────────────────────────────────────────────────

  it('a static code is proposed by one person and approved by another; it has POI 11 and no amount', async () => {
    expect(
      (
        await f.as('nobody').post('/lending/khqr/codes', {
          currency: 'USD',
          mode: 'GENERATE',
          ...MERCHANT,
          reason: 'set up repayments',
        })
      ).status,
    ).toBe(403);
    const proposed = expectOk(
      await f.as('finance').post('/lending/khqr/codes', {
        currency: 'USD',
        mode: 'GENERATE',
        ...MERCHANT,
        reason: 'set up repayments',
      }),
    );
    expect(proposed.status).toBe('PENDING');
    expect(proposed.source).toBe('GENERATED');
    expect(proposed.payload.startsWith('000201010211')).toBe(true);
    const tags = lending.parseTlvBlock(proposed.payload.slice(0, -8));
    expect(tags['54']).toBeUndefined();
    expect(tags['53']).toBe('840');
    expect(proposed.image).toMatch(/^data:image\/png;base64,/);
    // One waiting proposal per slot; the maker cannot approve their own.
    expect(
      (
        await f.as('finance').post('/lending/khqr/codes', {
          currency: 'USD',
          mode: 'GENERATE',
          ...MERCHANT,
          reason: 'again',
        })
      ).status,
    ).toBe(409);
    expect(
      (
        await f
          .as('finance')
          .post(`/lending/khqr/codes/${proposed.id}/decision`, {
            approve: true,
          })
      ).status,
    ).toBe(403);
    const approved = expectOk(
      await f
        .as('admin2')
        .post(`/lending/khqr/codes/${proposed.id}/decision`, { approve: true }),
    );
    expect(approved.status).toBe('ACTIVE');
    const list = expectOk(await f.as('opsMaker').get('/lending/khqr/codes'));
    expect(list.active.map((c: any) => c.id)).toEqual([proposed.id]);
    const audit = await f.system(() =>
      f.prisma.auditEvent.findMany({
        where: { tenantId: f.t1, resourceId: proposed.id },
        select: { action: true, actorId: true },
      }),
    );
    expect(audit.map((a: any) => a.action).sort()).toEqual(
      expect.arrayContaining(['khqr.approve', 'khqr.propose']),
    );
    const active = await f.app
      .get(LendingPrisma)
      .tenantTx(f.t1, (tx: any) =>
        f.app.get(KhqrCodesService).hasActiveStaticKhqr(tx, f.t1),
      );
    expect(active).toEqual({ active: true, currencies: ['USD'] });
  });

  it("an uploaded code is read and checked: the bank's payload and a PNG of it are accepted, a dynamic code is refused", async () => {
    const khr = lending.buildStaticKhqrPayload(MERCHANT, 'KHR');
    const dynamic = lending.buildKhqrPayload(MERCHANT, {
      amount: 10,
      currency: 'USD',
      billNumber: 'X1',
    });
    const refused = await f.as('finance').post('/lending/khqr/codes/preview', {
      currency: 'USD',
      payload: dynamic,
    });
    expect(refused.status).toBe(400);
    expect(JSON.stringify(refused.body)).toMatch(/dynamic/);
    const png = await qrcode.toDataURL(khr, { width: 300, margin: 2 });
    const preview = expectOk(
      await f
        .as('finance')
        .post('/lending/khqr/codes/preview', { currency: 'KHR', image: png }),
    );
    expect(preview).toMatchObject({ decoded: true, payload: khr });
    const p = expectOk(
      await f.as('finance').post('/lending/khqr/codes', {
        currency: 'KHR',
        mode: 'UPLOAD',
        image: png,
        bankName: 'Test Bank',
        accountNumber: '000111222',
        reason: 'riel code from the bank',
      }),
    );
    expect(p).toMatchObject({
      source: 'UPLOADED_PAYLOAD',
      payload: khr,
      bakongAccountId: MERCHANT.bakongAccountId,
    });
    expectOk(
      await f
        .as('admin2')
        .post(`/lending/khqr/codes/${p.id}/decision`, { approve: true }),
    );
    // A branch's own code is preferred for its loans.
    const branch = expectOk(
      await f.as('admin1').post('/lending/khqr/codes', {
        currency: 'USD',
        branchId: f.b2,
        mode: 'GENERATE',
        bakongAccountId: 'test_siemreap@devb',
        merchantName: 'Test Lender SR',
        merchantCity: 'Siem Reap',
        reason: 'branch code',
      }),
    );
    expect(branch.branchId).toBe(f.b2);
  });

  // ── The borrower's "I have paid" ─────────────────────────────────────────

  it('the portal shows the code and the loan reference; a claim posts no money', async () => {
    const b = portal(loans.claim.borrowerId);
    const view = expectOk(await b.get(`/borrower/loans/${loans.claim.id}`));
    expect(view.howToPay.reference).toBe(loans.claim.reference);
    expect(view.howToPay.code.bakongAccountId).toBe(MERCHANT.bakongAccountId);
    expect(view.howToPay.code.image).toMatch(/^data:image\/png;base64,/);
    const codes = expectOk(await b.get('/borrower/payment-qr'));
    expect(codes.map((c: any) => c.currency).sort()).toEqual(['KHR', 'USD']);
    const card = await b.get(
      `/borrower/loans/${loans.claim.id}/how-to-pay?lang=km`,
    );
    expect(card.status).toBe(200);
    expect(card.headers['content-type']).toMatch(/application\/pdf/);

    const before = (await repayments(loans.claim.id)).length;
    claimRef = ref('HASH');
    const screenshot = (
      await qrcode.toBuffer('receipt', { type: 'png' })
    ).toString('base64');
    const claim = expectOk(
      await b.post(`/lending/portal/loans/${loans.claim.id}/khqr-claims`, {
        amount: '75.00',
        currency: 'USD',
        paidAt: '2026-01-19T09:30:00+07:00',
        bankRef: claimRef,
        payerName: 'Sok Dara',
        screenshot: {
          fileName: 'receipt.png',
          mimeType: 'image/png',
          contentBase64: screenshot,
        },
      }),
    );
    expect(claim).toMatchObject({
      status: 'PENDING',
      source: 'PORTAL_CLAIM',
      valueDate: '2026-01-19',
      makerType: 'CUSTOMER',
    });
    expect(claim.screenshotDocumentId).toBeTruthy();
    expect((await repayments(loans.claim.id)).length).toBe(before);
    // Not on another borrower's loan; not twice for the same transfer.
    expect(
      (
        await b.post(`/lending/portal/loans/${loans.staff.id}/khqr-claims`, {
          amount: '5.00',
          currency: 'USD',
          paidAt: '2026-01-19T09:30:00+07:00',
          bankRef: ref('OTHER'),
        })
      ).status,
    ).toBeGreaterThanOrEqual(403);
    const dup = await b.post(
      `/lending/portal/loans/${loans.claim.id}/khqr-claims`,
      {
        amount: '75.00',
        currency: 'USD',
        paidAt: '2026-01-19T09:30:00+07:00',
        bankRef: claimRef.toLowerCase(),
      },
    );
    expect(dup.status).toBe(409);
    const after = expectOk(await b.get(`/borrower/loans/${loans.claim.id}`));
    expect(after.howToPay.claims[0]).toMatchObject({
      status: 'PENDING',
      amount: '75',
    });
  });

  // ── Staff receipts ───────────────────────────────────────────────────────

  it('a staff receipt needs a second person: the recorder cannot verify it; the verifier posts it with channel KHQR', async () => {
    staffRef = ref('FT');
    const r = expectOk(
      await f
        .as('opsMaker')
        .post(`/lending/loans/${loans.staff.id}/khqr-receipts`, {
          amount: '60.00',
          currency: 'USD',
          paidAt: '2026-01-20T08:00:00+07:00',
          bankRef: staffRef,
          payerName: 'Sok Dara',
        }),
    );
    expect(r).toMatchObject({ status: 'PENDING', source: 'STAFF' });
    expect((await repayments(loans.staff.id)).length).toBe(0);
    expect(
      (
        await f
          .as('opsMaker')
          .post(`/lending/khqr/receipts/${r.id}/verify`, {}, key('v'))
      ).status,
    ).toBe(403);
    const queue = expectOk(
      await f.as('opsChecker').get('/lending/khqr/receipts?status=PENDING'),
    );
    expect(queue.receipts.map((x: any) => x.id)).toEqual(
      expect.arrayContaining([r.id]),
    );
    const event = expectOk(
      await f
        .as('opsChecker')
        .post(`/lending/khqr/receipts/${r.id}/verify`, {}, key('v')),
    );
    expect(event.type).toBe('REPAYMENT');
    const posted = await repayments(loans.staff.id);
    expect(posted).toHaveLength(1);
    expect(posted[0].components.channel).toBe('KHQR');
    expect(posted[0].components.khqr.receipt).toBe(r.reference);
    // The same transfer cannot be recorded again, by staff or by the borrower.
    expect(
      (
        await f
          .as('opsMaker')
          .post(`/lending/loans/${loans.staff.id}/khqr-receipts`, {
            amount: '60.00',
            currency: 'USD',
            paidAt: '2026-01-20T08:00:00+07:00',
            bankRef: staffRef,
          })
      ).status,
    ).toBe(409);
    expect(
      (
        await portal(loans.staff.borrowerId).post(
          `/lending/portal/loans/${loans.staff.id}/khqr-claims`,
          {
            amount: '60.00',
            currency: 'USD',
            paidAt: '2026-01-20T08:00:00+07:00',
            bankRef: staffRef,
          },
        )
      ).status,
    ).toBe(409);
    await reconcileLedger();
  });

  // ── Statement import ─────────────────────────────────────────────────────

  it('a statement import posts exact matches, confirms the claim, holds the rest in suspense and refuses duplicates', async () => {
    unknownRef = ref('UNK');
    const instalment = await owedFirst(loans.phone.id);
    const remarkRef = ref('RMK');
    const phoneRef = ref('PHN');
    const csv = [
      'Account statement — test',
      'Transaction Date,Reference No,Description,Sender Name,From Account,Debit,Credit,Currency',
      `19/01/2026,${claimRef},loan payment,SOK DARA,,,75.00,USD`,
      `19/01/2026,${remarkRef},pay ${loans.remark.reference.toLowerCase()} thanks,SOK DARA,,,40.00,USD`,
      `19/01/2026,${phoneRef},january,,+855 ${PHONE_LOCAL.slice(1)},,${instalment},USD`,
      `19/01/2026,${unknownRef},for my aunt,NOBODY KNOWN,,,12.50,USD`,
      `20/01/2026,${staffRef},,SOK DARA,,,60.00,USD`,
      `20/01/2026,FEE000001,bank fee,,,1.00,,USD`,
    ].join('\n');
    const dry = expectOk(
      await f.as('opsMaker').post('/lending/khqr/statements', {
        fileName: 'statement.csv',
        content: csv,
        mapping: 'GENERIC',
        dryRun: true,
      }),
    );
    expect(dry.lines.map((l: any) => l.proposed)).toEqual([
      'POST',
      'POST',
      'POST',
      'SUSPENSE',
      'DUPLICATE',
    ]);
    expect(dry.lines.map((l: any) => l.rule)).toEqual([
      'BANK_REFERENCE',
      'LOAN_REFERENCE',
      'INSTALMENT_AMOUNT',
      null,
      null,
    ]);
    expect((await repayments(loans.remark.id)).length).toBe(0);

    const imported = expectOk(
      await f.as('opsMaker').post('/lending/khqr/statements', {
        fileName: 'statement.csv',
        content: csv,
        mapping: 'GENERIC',
      }),
    );
    expect(imported.replayed).toBe(false);
    expect(imported.file).toMatchObject({
      kind: 'KHQR_STATEMENT',
      channel: 'KHQR',
      lineCount: 5,
      postedCount: 3,
      suspenseCount: 1,
      duplicateCount: 1,
    });
    expect(imported.skipped).toEqual([
      { lineNo: 8, reason: 'no amount received' },
    ]);
    const byRef = (r: string) =>
      imported.lines.find((l: any) => l.channelTxnId === r);
    expect(byRef(claimRef).loanReference).toBe(loans.claim.reference);
    expect(byRef(remarkRef).loanReference).toBe(loans.remark.reference);
    expect(byRef(phoneRef).loanReference).toBe(loans.phone.reference);
    expect(byRef(unknownRef).outcome).toBe('SUSPENSE');
    expect(byRef(staffRef).outcome).toBe('DUPLICATE');
    // The claim is confirmed by the statement: posted once, by the bank statement.
    const claimed = await repayments(loans.claim.id);
    expect(claimed).toHaveLength(1);
    expect(Number(claimed[0].amount)).toBe(75);
    const receipt = await f.system(() =>
      f.prisma.khqrReceipt.findFirst({
        where: { tenantId: f.t1, bankRefKey: lending.bankRefKey(claimRef) },
      }),
    );
    expect(receipt).toMatchObject({
      status: 'POSTED',
      decidedBy: 'system:bank-statement',
    });
    expect(await repayments(loans.staff.id)).toHaveLength(1);
    // The same file again: the first import, nothing applied twice.
    const again = expectOk(
      await f.as('opsMaker').post('/lending/khqr/statements', {
        fileName: 'statement-again.csv',
        content: csv,
        mapping: 'GENERIC',
      }),
    );
    expect(again.replayed).toBe(true);
    expect(await repayments(loans.claim.id)).toHaveLength(1);
    // The daily reconciliation lists the KHQR channel.
    const rec = expectOk(
      await f
        .as('opsMaker')
        .get(
          '/lending/payment-channels/reconciliation?date=2026-01-19&channel=KHQR',
        ),
    );
    expect(rec.channels[0].channel).toBe('KHQR');
    expect(rec.channels[0].breaks).toHaveLength(1);
    await reconcileLedger();
  });

  it('a receipt for a transfer held in suspense is linked to it: verifying applies the money from suspense', async () => {
    const r = expectOk(
      await f
        .as('opsMaker')
        .post(`/lending/loans/${loans.held.id}/khqr-receipts`, {
          amount: '12.50',
          currency: 'USD',
          paidAt: '2026-01-19T12:00:00+07:00',
          bankRef: unknownRef,
          payerName: 'Nobody Known',
        }),
    );
    expect(r.unidentifiedPaymentId).toBeTruthy();
    expectOk(
      await f
        .as('opsChecker')
        .post(`/lending/khqr/receipts/${r.id}/verify`, {}, key('v')),
    );
    const held = await f.system(() =>
      f.prisma.unidentifiedPayment.findFirst({
        where: { tenantId: f.t1, id: r.unidentifiedPaymentId },
      }),
    );
    expect(held.status).toBe('MATCHED');
    const posted = await repayments(loans.held.id);
    expect(posted).toHaveLength(1);
    expect(posted[0].components.channel).toBe('KHQR');
    await reconcileLedger();
  });

  it('with auto-posting off, a matched line waits in suspense as a receipt for a second person', async () => {
    await lendingSettings(f, f.t1, {
      payments: { khqr: { statementAutoPost: false } },
    });
    const lineRef = ref('HOLD');
    const imported = expectOk(
      await f.as('opsMaker').post('/lending/khqr/statements', {
        fileName: 'held.csv',
        content: `date,amount,currency,reference,remark\n2026-01-20,33.00,USD,${lineRef},${loans.remark.reference}\n`,
        mapping: 'GENERIC',
      }),
    );
    expect(imported.file.suspenseCount).toBe(1);
    const before = (await repayments(loans.remark.id)).length;
    const waiting = expectOk(
      await f
        .as('opsChecker')
        .get(`/lending/khqr/receipts?status=PENDING&source=STATEMENT`),
    ).receipts.find((x: any) => x.bankRef === lineRef);
    expect(waiting.loanReference).toBe(loans.remark.reference);
    expect(
      (
        await f
          .as('opsMaker')
          .post(`/lending/khqr/receipts/${waiting.id}/verify`, {}, key('v'))
      ).status,
    ).toBe(403);
    expectOk(
      await f
        .as('opsChecker')
        .post(`/lending/khqr/receipts/${waiting.id}/verify`, {}, key('v')),
    );
    expect((await repayments(loans.remark.id)).length).toBe(before + 1);
    await lendingSettings(f, f.t1, {});
    await reconcileLedger();
  });

  it('a rejected claim posts nothing and frees the reference; a bad file is refused whole', async () => {
    const b = portal(loans.phone.borrowerId);
    const c = expectOk(
      await b.post(`/lending/portal/loans/${loans.phone.id}/khqr-claims`, {
        amount: '9.00',
        currency: 'USD',
        paidAt: '2026-01-20T10:00:00+07:00',
        bankRef: ref('TYPO'),
      }),
    );
    const rejected = expectOk(
      await f.as('opsChecker').post(`/lending/khqr/receipts/${c.id}/reject`, {
        reason: 'not on the bank statement',
      }),
    );
    expect(rejected.status).toBe('REJECTED');
    const view = expectOk(await b.get(`/borrower/loans/${loans.phone.id}`));
    expect(
      view.howToPay.claims.find((x: any) => x.reference === c.reference),
    ).toMatchObject({ status: 'REJECTED', note: 'not on the bank statement' });
    const bad = await f.as('opsMaker').post('/lending/khqr/statements', {
      fileName: 'bad.csv',
      content: 'date,amount,currency,reference\n31/02/2026,10,USD,REF000001\n',
      mapping: 'GENERIC',
    });
    expect(bad.status).toBe(400);
    expect(bad.body.code).toBe('FILE_INVALID');
  });

  it('a spreadsheet (XLSX) statement is read like a CSV one, dates as spreadsheet dates', async () => {
    const xref = ref('XLS');
    const sheet = XLSX.utils.aoa_to_sheet([
      ['Trx Date', 'Amount', 'Ccy', 'Transaction ID', 'Remark'],
      [new Date(Date.UTC(2026, 0, 20)), 8.25, 'USD', xref, 'no reference'],
    ]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, sheet, 'Statement');
    const contentBase64 = XLSX.write(wb, { type: 'base64', bookType: 'xlsx' });
    const imported = expectOk(
      await f.as('opsMaker').post('/lending/khqr/statements', {
        fileName: 'statement.xlsx',
        contentBase64,
        mapping: 'GENERIC',
      }),
    );
    expect(imported.lines).toHaveLength(1);
    expect(imported.lines[0]).toMatchObject({
      channelTxnId: xref,
      valueDate: '2026-01-20',
      amount: '8.25',
      outcome: 'SUSPENSE',
    });
  });

  // ── Tenant isolation ─────────────────────────────────────────────────────

  it("another tenant sees none of this tenant's codes or receipts, through the API or raw SQL", async () => {
    await grant(f, f.t2, 't2admin', 'LOAN_OPS_CHECKER');
    const codes = expectOk(await f.as('t2admin').get('/lending/khqr/codes'));
    expect(codes.active).toEqual([]);
    const queue = expectOk(await f.as('t2admin').get('/lending/khqr/receipts'));
    expect(queue.receipts).toEqual([]);
    const someReceipt = await f.system(() =>
      f.prisma.khqrReceipt.findFirst({ where: { tenantId: f.t1 } }),
    );
    expect(
      (
        await f
          .as('t2admin')
          .post(`/lending/khqr/receipts/${someReceipt.id}/reject`, {
            reason: 'cross tenant',
          })
      ).status,
    ).toBe(404);
    for (const table of ['KhqrCode', 'KhqrReceipt']) {
      const seen = await runAsTenant(f.t2, () =>
        f.prisma.$queryRawUnsafe(
          `SELECT id FROM "${table}" WHERE "tenantId" = $1`,
          f.t1,
        ),
      );
      expect(seen).toEqual([]);
    }
    // The borrower of another tenant cannot claim on this tenant's loan.
    expect(
      (
        await portal(loans.claim.borrowerId, f.t2).post(
          `/lending/portal/loans/${loans.claim.id}/khqr-claims`,
          {
            amount: '1.00',
            currency: 'USD',
            paidAt: '2026-01-20T10:00:00+07:00',
            bankRef: ref('X'),
          },
        )
      ).status,
    ).toBeGreaterThanOrEqual(401);
  });
});
