/* eslint-disable @typescript-eslint/no-unsafe-call -- integration fixtures: rows come from the untyped API and Prisma client. */
/**
 * Credit reports and the in-house bureau score (DECISIONS D-176…D-181):
 * a CBC-style report per lender from its own records (lending loans and the
 * legacy archive), pulled only under the customer's consent and recorded as
 * an enquiry; the bureau score feeds the application score snapshot; the
 * report is stored append-only and rebuilds from its inputs; CBC is an
 * unusable shell; nothing crosses tenants.
 */
import { lending } from '@microloan/shared';
import {
  Fixture,
  TEST_DB,
  bootstrap,
  borrower,
  expectOk,
  grant,
  lendingSettings,
} from './harness';
import {
  activeProduct,
  docs,
  originateAndDisburse,
  standardRoles,
} from './setup';

const d = TEST_DB ? describe : describe.skip;
const day = (y: number, m: number, dd: number) => new Date(Date.UTC(y, m, dd));
const inAYear = () => new Date(Date.now() + 365 * 86_400_000).toISOString();
const terms = {
  principal: '1200',
  numberOfInstalments: 12,
  disbursementDate: '2026-01-05',
};

d('Credit reports and the in-house bureau score (integration)', () => {
  let f: Fixture;
  let productId: string;
  /** The borrower with a lending loan, two legacy loans and a guarantee. */
  let rich: string;
  let loanId: string;

  const consent = (borrowerId: string, who = 'ro') =>
    f.as(who).post(`/lending/customers/${borrowerId}/consents`, {
      source: 'CREDIT_REPORT',
      purpose: 'Credit assessment: pulling the credit report',
      method: 'RECORDED_VERBAL',
      expiresAt: inAYear(),
    });
  const pull = (
    borrowerId: string,
    who = 'analyst',
    body: Record<string, unknown> = { purpose: 'ACCOUNT_REVIEW' },
  ) => f.as(who).post(`/lending/customers/${borrowerId}/credit-reports`, body);
  const apply = async (borrowerId: string) => {
    const app = expectOk(
      await f
        .as('ro')
        .post('/lending/applications', { borrowerId, productId, terms }),
    );
    await docs(f, app.id, ['ID_DOCUMENT']);
    expectOk(await f.as('ro').post(`/lending/applications/${app.id}/submit`));
    return app.id as string;
  };
  const scores = async (appId: string) =>
    expectOk(
      await f.as('analyst').get(`/lending/applications/${appId}/scores`),
    );

  /** A legacy loan written straight to the original tables (they have no write API). */
  const legacyLoan = (
    borrowerId: string,
    tenantId: string,
    branchId: string,
    o: { status: string; start: Date; paid: number; writtenOffAt?: Date },
  ) =>
    f.system(async () => {
      const loan = await f.prisma.loan.create({
        data: {
          tenantId,
          borrowerId,
          branchId,
          principal: '600',
          annualInterestRate: '12',
          termMonths: 6,
          interestMethod: 'FLAT',
          startDate: o.start,
          status: o.status,
          writtenOffAt: o.writtenOffAt ?? null,
        },
      });
      for (let i = 0; i < 6; i++) {
        const due = new Date(o.start.getTime());
        due.setUTCMonth(due.getUTCMonth() + i + 1);
        await f.prisma.repaymentSchedule.create({
          data: {
            loanId: loan.id,
            installmentNumber: i + 1,
            dueDate: due,
            principalAmount: '100',
            interestAmount: '6',
            totalAmount: '106',
            outstandingPrincipal: String(100 * (5 - i)),
            isPaid: i < o.paid,
            paidPrincipal: i < o.paid ? '100' : '0',
            paidInterest: i < o.paid ? '6' : '0',
          },
        });
        if (i < o.paid)
          await f.prisma.repayment.create({
            data: {
              tenantId,
              loanId: loan.id,
              amount: '106',
              principalPaid: '100',
              interestPaid: '6',
              date: due,
            },
          });
      }
      return loan.id as string;
    });

  beforeAll(async () => {
    f = await bootstrap();
    await standardRoles(f);
    await grant(f, f.t1, 'checker', 'RISK_COMPLIANCE');
    ({ productId } = await activeProduct(
      f,
      'PERSONAL_INSTALMENT',
      'CR-PL',
      (c) => {
        c.pricing.fees = [];
      },
    ));
    const b = await borrower(f, f.t1, f.b1, {
      firstName: 'Chan',
      lastName: 'Bureau',
      idNumber: 'KH-CR-0001',
    });
    rich = b.id;
    ({ loanId } = await originateAndDisburse(f, productId, terms, {
      borrowerId: rich,
    }));
    // The legacy archive: one loan written off in Dec 2024, one repaid and closed.
    await legacyLoan(rich, f.t1, f.b1, {
      status: 'WRITTEN_OFF',
      start: day(2024, 5, 10),
      paid: 2,
      writtenOffAt: day(2024, 11, 15),
    });
    await legacyLoan(rich, f.t1, f.b1, {
      status: 'CLOSED',
      start: day(2023, 0, 10),
      paid: 6,
    });
    // The borrower guaranteed someone else's application.
    const other = await borrower(f, f.t1, f.b1, {
      firstName: 'Mey',
      lastName: 'Guaranteed',
    });
    const otherApp = expectOk(
      await f.as('ro').post('/lending/applications', {
        borrowerId: other.id,
        productId,
        terms,
      }),
    );
    expectOk(
      await f.as('ro').post(`/lending/applications/${otherApp.id}/guarantees`, {
        guarantorName: 'Chan Bureau',
        guarantorBorrowerId: rich,
        type: 'PERSONAL',
        amount: '500',
      }),
    );
    // Three instalments (5 Feb, 5 Mar, 5 Apr) fall due unpaid.
    for (const businessDate of [
      '2026-02-04',
      '2026-03-06',
      '2026-04-05',
      '2026-04-20',
    ]) {
      expectOk(
        await f
          .as('finance')
          .post('/lending/ops/business-date', { businessDate }),
      );
      expect(
        expectOk(await f.as('finance').post('/lending/loans/batch/run')).failed,
      ).toEqual([]);
    }
  }, 180_000);
  afterAll(async () => f?.app.close());

  it('a pull needs the customer’s CREDIT_REPORT consent and the permission', async () => {
    const res = await pull(rich);
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('CONSENT_REQUIRED');
    expect(
      await f.system(() =>
        f.prisma.creditReport.count({
          where: { tenantId: f.t1, borrowerId: rich },
        }),
      ),
    ).toBe(0);
    expectOk(await consent(rich));
    // A relationship officer reads reports but does not pull them; other branches see nothing.
    expect((await pull(rich, 'ro')).status).toBe(403);
    expectOk(await f.as('ro').get(`/lending/customers/${rich}/credit-reports`));
    expect([403, 404]).toContain(
      (await f.as('ro2').get(`/lending/customers/${rich}/credit-reports`))
        .status,
    );
    expect(
      (await f.as('opsMaker').get(`/lending/customers/${rich}/credit-reports`))
        .status,
    ).toBe(403);
  });

  it('assembles the report across lending loans, the legacy archive, guarantees and enquiries', async () => {
    const r = expectOk(await pull(rich));
    expect(r).toMatchObject({
      provider: 'INTERNAL',
      purpose: 'ACCOUNT_REVIEW',
      trigger: 'STAFF',
      requestedBy: f.users.analyst.id,
      asOf: '2026-04-20',
    });
    const c = r.content;
    expect(c.months).toHaveLength(24);
    expect(c.months[23]).toBe('2026-04');
    expect(c.facilities).toHaveLength(3);
    const term = c.facilities.find((x: any) => x.id === loanId);
    expect(term).toMatchObject({
      source: 'LENDING',
      status: 'ACTIVE',
      kind: 'TERM_LOAN',
      currency: 'USD',
    });
    const code = (fac: any, m: string) =>
      fac.history.find((h: any) => h.month === m).code;
    expect(code(term, '2025-12')).toBe('');
    expect(code(term, '2026-01')).toBe('0');
    expect(code(term, '2026-02')).toBe('1'); // 23 days at 28 Feb
    expect(code(term, '2026-03')).toBe('2'); // 54 days at 31 Mar
    expect(code(term, '2026-04')).toBe('3'); // 74 days on 20 Apr
    expect(term.currentDpd).toBe(74);
    const legacy = c.facilities.filter((x: any) => x.source === 'LEGACY');
    const wo = legacy.find((x: any) => x.status === 'WRITTEN_OFF');
    expect(wo.writtenOff).toBe(true);
    expect(code(wo, '2024-12')).toBe('W');
    expect(code(wo, '2026-04')).toBe('W');
    const closed = legacy.find((x: any) => x.status === 'CLOSED');
    expect(closed.closedOn).toBe('2023-07-10');
    expect(c.characteristics).toMatchObject({
      bureauWriteOff: true,
      bureauActiveFacilities: 1,
      bureauWorstDpd12m: 74,
    });
    expect(c.guarantees).toHaveLength(1);
    expect(c.guarantees[0]).toMatchObject({
      principalBorrower: 'Mey Guaranteed',
      amount: '500.00',
      type: 'PERSONAL',
    });
    expect(c.enquiries.some((e: any) => e.type === 'APPLICATION')).toBe(true);
    expect(
      c.enquiries.find(
        (e: any) => e.type === 'REPORT' && e.reference === r.reference,
      ),
    ).toMatchObject({ purpose: 'ACCOUNT_REVIEW', by: f.users.analyst.id });
    expect(c.totals.lenders).toBe(1);
    expect(c.totals.activeFacilities).toBe(1);
    expect(c.totals.exposure[0].currency).toBe('USD');
    // A write-off is derogatory: scored however short the lending history.
    expect(r.score).not.toBeNull();
    expect(r.score).toBeGreaterThanOrEqual(300);
    expect(r.score).toBeLessThanOrEqual(850);
    expect(c.score.adverseReasons.map((a: any) => a.code)).toContain(
      'WRITE_OFF',
    );
    // The identity summary masks the national ID.
    expect(c.subject.idNumberMasked).not.toContain('CR-0001');

    // The enquiry is audited.
    const audit = await f.system(() =>
      f.prisma.auditEvent.findMany({
        where: {
          tenantId: f.t1,
          action: 'credit_report.pull',
          resourceId: r.id,
        },
      }),
    );
    expect(audit).toHaveLength(1);
    expect(audit[0].actorId).toBe(f.users.analyst.id);

    // The printable report is filed in the customer's documents.
    expect(r.documentId).toBeTruthy();
    const library = expectOk(
      await f.as('analyst').get(`/lending/customers/${rich}/documents`),
    );
    const filed = library.documents.find((x: any) => x.id === r.documentId);
    expect(filed).toMatchObject({
      typeCode: 'CREDIT_REPORT',
      category: 'GENERATED',
    });
    const pdf = await f
      .as('analyst')
      .get(`/lending/credit-reports/${r.id}/pdf`)
      .buffer(true);
    expect(pdf.status).toBe(200);
    expect(pdf.headers['content-type']).toMatch(/application\/pdf/);
    expect(Buffer.from(pdf.body).subarray(0, 4).toString()).toBe('%PDF');
  });

  it('is stored append-only with its inputs hash, and rebuilds exactly from its inputs', async () => {
    const r = expectOk(await pull(rich));
    const full = expectOk(
      await f.as('analyst').get(`/lending/credit-reports/${r.id}`),
    );
    expect(full.integrity).toEqual({ inputsHashValid: true, reproduced: true });
    expect(full.inputsHash).toMatch(/^[0-9a-f]{64}$/);
    await expect(
      f.system(() =>
        f.prisma.creditReport.update({
          where: { id: r.id },
          data: { score: 851 },
        }),
      ),
    ).rejects.toThrow(/immutable/);
    await expect(
      f.system(() => f.prisma.creditReport.delete({ where: { id: r.id } })),
    ).rejects.toThrow(/cannot be deleted/);
    // The document link is set once and never changed.
    await expect(
      f.system(() =>
        f.prisma.creditReport.update({
          where: { id: r.id },
          data: { documentId: r.id },
        }),
      ),
    ).rejects.toThrow(/immutable/);
  });

  it('scoring an application pulls the report, records the enquiry and sets the bureau input', async () => {
    const appId = await apply(rich);
    const s = await scores(appId);
    const bureau = s.latest.inputs.features.bureauScore;
    const row = await f.system(() =>
      f.prisma.creditReport.findFirst({
        where: { tenantId: f.t1, applicationId: appId },
      }),
    );
    expect(row).toMatchObject({
      trigger: 'SCORING',
      purpose: 'NEW_APPLICATION',
      requestedBy: f.users.ro.id,
      provider: 'INTERNAL',
    });
    expect(bureau).toMatchObject({
      source: 'INTERNAL_BUREAU',
      reportId: row!.id,
      value: row!.score,
    });
    expect(bureau.consentId).toBe(row!.consentId);
    // The application being decided is listed but never counted against the borrower.
    const content = row!.content;
    expect(content.enquiries.find((e: any) => e.id === appId)).toMatchObject({
      current: true,
    });
    // STANDARD_RETAIL's bureau characteristic now scores it.
    const factor = s.latest.result.characteristics.find(
      (x: any) => x.code === 'BUREAU',
    );
    expect(factor.points).toBe(Math.floor((row!.score! - 575) * 0.4 + 0.5));
    // A re-score within the re-use window uses the same report: no new enquiry.
    expectOk(
      await f.as('analyst').post(`/lending/applications/${appId}/scores`, {}),
    );
    expect(
      await f.system(() =>
        f.prisma.creditReport.count({
          where: { tenantId: f.t1, applicationId: appId },
        }),
      ),
    ).toBe(1);
    const again = await scores(appId);
    expect(again.latest.inputs.features.bureauScore.reportId).toBe(row!.id);
    // The application page reads the same report.
    const view = expectOk(
      await f.as('analyst').get(`/lending/applications/${appId}/credit-report`),
    );
    expect(view).toMatchObject({
      forThisApplication: true,
      provider: 'INTERNAL',
    });
    expect(view.latest.id).toBe(row!.id);
  });

  it('no history means no score (NO_HISTORY), never a low one; no consent means no report', async () => {
    const fresh = await borrower(f, f.t1, f.b1, {
      firstName: 'Thin',
      lastName: 'File',
    });
    const withoutConsent = await scores(await apply(fresh.id));
    expect(withoutConsent.latest.inputs.features.bureauScore).toMatchObject({
      value: null,
      source: 'BUREAU',
    });
    expect(withoutConsent.latest.inputs.features.bureauScore.note).toMatch(
      /No consent in force for CREDIT_REPORT/,
    );
    expect(
      await f.system(() =>
        f.prisma.creditReport.count({
          where: { tenantId: f.t1, borrowerId: fresh.id },
        }),
      ),
    ).toBe(0);

    expectOk(await consent(fresh.id));
    const appId = await apply(fresh.id);
    const s = await scores(appId);
    const row = await f.system(() =>
      f.prisma.creditReport.findFirst({
        where: { tenantId: f.t1, applicationId: appId },
      }),
    );
    expect(row).toMatchObject({
      score: null,
      grade: null,
      noScoreReason: 'NO_HISTORY',
    });
    expect(s.latest.inputs.features.bureauScore).toMatchObject({
      value: null,
      source: 'INTERNAL_BUREAU',
      reportId: row!.id,
    });
    expect(s.latest.inputs.features.bureauScore.note).toMatch(/NO_HISTORY/);
    // Without a bureau score the bureau characteristic scores nothing, as before.
    expect(
      s.latest.result.characteristics.find((x: any) => x.code === 'BUREAU')
        .points,
    ).toBe(0);
  });

  it('the bureau scorecard is versioned under maker-checker like any scorecard', async () => {
    const tpl = lending.SCORECARD_TEMPLATE_BY_CODE.INTERNAL_BUREAU.definition;
    const sc = expectOk(
      await f.as('analyst').post('/lending/scorecards', {
        code: 'INTERNAL_BUREAU',
        name: 'In-house bureau score',
        templateCode: 'INTERNAL_BUREAU',
        definition: { ...tpl, baseScore: tpl.baseScore - 20 },
      }),
    );
    const v = sc.versions[0].id;
    const before = expectOk(await pull(rich));
    expectOk(
      await f.as('analyst').post(`/lending/scorecard-versions/${v}/submit`),
    );
    // The maker cannot approve their own version.
    expect(
      (await f.as('analyst').post(`/lending/scorecard-versions/${v}/approve`))
        .status,
    ).toBe(403);
    expectOk(
      await f.as('checker').post(`/lending/scorecard-versions/${v}/approve`),
    );
    expectOk(
      await f.as('checker').post(`/lending/scorecard-versions/${v}/activate`),
    );
    const after = expectOk(await pull(rich));
    expect(before.scorecardVersion).toBe(0);
    expect(after.scorecardVersion).toBe(1);
    expect(Math.max(300, before.score - 20)).toBe(after.score);
    expect(
      expectOk(await f.as('analyst').get(`/lending/credit-reports/${after.id}`))
        .integrity,
    ).toEqual({ inputsHashValid: true, reproduced: true });
  });

  it('CBC is an unusable shell: choosing it gives no report and no bureau score', async () => {
    expect(
      lending.CAPABILITIES.find((c) => c.id === 'bureau.cbc_provider')!.status,
    ).toBe('REQUIRES_INTEGRATION');
    expect(
      lending.CAPABILITIES.find((c) => c.id === 'bureau.internal_report')!
        .status,
    ).toBe('IMPLEMENTED');
    await lendingSettings(f, f.t1, {
      scoring: { creditReport: { provider: 'CBC' } },
    });
    try {
      const res = await pull(rich);
      expect(res.status).toBe(503);
      expect(res.body.code).toBe('BUREAU_NOT_CONFIGURED');
      const list = expectOk(
        await f.as('analyst').get(`/lending/customers/${rich}/credit-reports`),
      );
      expect(list).toMatchObject({
        provider: 'CBC',
        availability: {
          usable: false,
          reason: 'ON_HOLD',
          capability: 'bureau.cbc_provider',
        },
      });
      const appId = await apply(rich);
      const bureau = (await scores(appId)).latest.inputs.features.bureauScore;
      expect(bureau).toMatchObject({ value: null, source: 'BUREAU' });
      expect(bureau.note).toMatch(/on hold/);
      expect(
        await f.system(() =>
          f.prisma.creditReport.count({
            where: { tenantId: f.t1, applicationId: appId },
          }),
        ),
      ).toBe(0);
    } finally {
      await lendingSettings(f, f.t1, {});
    }
  });

  it('nothing crosses tenants: another lender’s records never appear, and its staff see nothing', async () => {
    // The same person borrows from another lender (tenant 2), with a write-off there.
    const twin = await borrower(f, f.t2, f.b3, {
      firstName: 'Chan',
      lastName: 'Bureau',
      idNumber: 'KH-CR-0001',
    });
    await legacyLoan(twin.id, f.t2, f.b3, {
      status: 'WRITTEN_OFF',
      start: day(2025, 2, 10),
      paid: 0,
      writtenOffAt: day(2025, 9, 1),
    });
    const r = expectOk(await pull(rich));
    expect(r.content.facilities).toHaveLength(3);
    const ids = new Set(r.content.facilities.map((x: any) => x.id));
    const t2Loans = await f.system(() =>
      f.prisma.loan.findMany({
        where: { tenantId: f.t2 },
        select: { id: true },
      }),
    );
    for (const l of t2Loans) expect(ids.has(l.id)).toBe(false);
    // Another tenant's administrator cannot read or pull it.
    expect([403, 404]).toContain(
      (await f.as('t2admin').get(`/lending/credit-reports/${r.id}`)).status,
    );
    expect([403, 404]).toContain(
      (await f.as('t2admin').get(`/lending/credit-reports/${r.id}/pdf`)).status,
    );
    expect([403, 404]).toContain(
      (
        await f
          .as('t2admin')
          .post(`/lending/customers/${rich}/credit-reports`, {
            purpose: 'ACCOUNT_REVIEW',
          })
      ).status,
    );
    // Row-level security: tenant 2 sees none of tenant 1's reports, even in raw SQL.
    const seen: { n: bigint }[] = await f.prisma.$transaction(
      async (tx: any) => {
        await tx.$executeRawUnsafe(
          `SELECT set_config('app.tenant_id', $1, true)`,
          f.t2,
        );
        return tx.$queryRawUnsafe(
          `SELECT count(*) AS n FROM "CreditReport" WHERE "tenantId" = $1`,
          f.t1,
        );
      },
    );
    expect(Number(seen[0].n)).toBe(0);
    const [flags]: { rls: boolean; forced: boolean }[] =
      await f.prisma.$queryRawUnsafe(
        'SELECT relrowsecurity AS rls, relforcerowsecurity AS forced FROM pg_class WHERE relname = $1',
        'CreditReport',
      );
    expect(flags).toEqual({ rls: true, forced: true });
  });
});
