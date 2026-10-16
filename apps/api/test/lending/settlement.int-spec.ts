/* eslint-disable @typescript-eslint/no-unsafe-call -- integration fixtures: modules are required after the test environment is configured, and fixture rows come from the untyped Prisma client. */
/**
 * Negotiated settlement and recovery after write-off (Phase 2).
 *
 * Evidence for: servicing.negotiated_settlement, servicing.recovery_after_write_off
 */
import {
  Fixture,
  TEST_DB,
  authority,
  bootstrap,
  expectOk,
  grant,
} from './harness';
import { activeProduct, originateAndDisburse, standardRoles } from './setup';
import { lending } from '@microloan/shared';

const d = TEST_DB ? describe : describe.skip;

d('Settlement and recovery (integration)', () => {
  let f: Fixture;

  beforeAll(async () => {
    f = await bootstrap();
    await standardRoles(f);
    await grant(f, f.t1, 'approver2', 'RESTRUCTURE_COMMITTEE');
    await authority(
      f,
      f.t1,
      'approver2',
      'loan.settlement.negotiate',
      'USD',
      '1000000',
    );
    await authority(
      f,
      f.t1,
      'approver2',
      'loan.settlement.negotiate_principal',
      'USD',
      '1000000',
    );
  }, 60_000);
  afterAll(async () => f?.app.close());

  async function setBusinessDate(target: string) {
    let current = expectOk(
      await f.as('finance').get('/lending/ops/business-date'),
    ).businessDate as string;
    while (lending.compareDates(current, target) < 0) {
      const step = lending.addDays(current, 31);
      const next = lending.compareDates(step, target) > 0 ? target : step;
      expectOk(
        await f
          .as('finance')
          .post('/lending/ops/business-date', { businessDate: next }),
      );
      current = next;
    }
    return current;
  }

  /** A product that may settle for less, waiving charges only. */
  const chargesOnly = (code: string) =>
    activeProduct(f, 'PERSONAL_INSTALMENT', code, (c: any) => {
      c.restructuring.allowNegotiatedSettlement = true;
      c.restructuring.allowedOptions = ['CHARGE_WAIVER', 'TERM_EXTENSION'];
      c.operations.writeOffMinDpd = 180;
    });

  /** A product that may also forgive principal. */
  const withPrincipal = (code: string) =>
    activeProduct(f, 'PERSONAL_INSTALMENT', code, (c: any) => {
      c.restructuring.allowNegotiatedSettlement = true;
      c.restructuring.allowedOptions = [
        'CHARGE_WAIVER',
        'PRINCIPAL_FORGIVENESS',
        'TERM_EXTENSION',
      ];
      c.operations.writeOffMinDpd = 180;
    });

  const loan = (id: string) => f.as('opsMaker').get(`/lending/loans/${id}`);

  describe('negotiated settlement', () => {
    let loanId: string;

    beforeAll(async () => {
      await setBusinessDate('2026-01-05');
      const { productId } = await withPrincipal('NS-STD');
      const r = await originateAndDisburse(f, productId, {
        principal: '5000',
        numberOfInstalments: 12,
        disbursementDate: '2026-01-05',
      });
      loanId = r.loanId;
    }, 60_000);

    it('quotes what a settlement gives up without posting anything', async () => {
      const q = expectOk(
        await f
          .as('opsMaker')
          .get(
            `/lending/loans/${loanId}/negotiated-settlement-quote?agreedAmount=4500`,
          ),
      );
      expect(q.settlement.fullAmount).toBe('5000');
      expect(q.settlement.concession).toBe('500');
      expect(q.settlement.forgivesPrincipal).toBe(true);
      expect(q.note).toMatch(/Quote only/);
      // Nothing moved.
      expect(expectOk(await loan(loanId)).account.status).toBe('ACTIVE');
    });

    it('refuses an amount that is not actually a concession', async () => {
      const r = await f
        .as('opsMaker')
        .get(
          `/lending/loans/${loanId}/negotiated-settlement-quote?agreedAmount=5000`,
        );
      expect(r.status).toBe(400);
      expect(r.body.message).toMatch(/settle the loan in full instead/);
    });

    it('needs a reason', async () => {
      const r = await f
        .as('approver2')
        .post(
          `/lending/loans/${loanId}/negotiated-settlement`,
          { agreedAmount: '4500', reason: '' },
          'settle-noreason',
        );
      expect(r.status).toBe(400);
    });

    it('refuses someone without the authority to forgive principal', async () => {
      const r = await f
        .as('opsMaker')
        .post(
          `/lending/loans/${loanId}/negotiated-settlement`,
          { agreedAmount: '4500', reason: 'Borrower emigrated' },
          'settle-wrongrole',
        );
      expect(r.status).toBe(403);
    });

    it('closes the loan and posts the concession as an expense', async () => {
      const r = expectOk(
        await f.as('approver2').post(
          `/lending/loans/${loanId}/negotiated-settlement`,
          {
            agreedAmount: '4500',
            reason: 'Borrower emigrated; best recovery available',
          },
          'settle-ok',
        ),
      );
      expect(r.settlement.concession).toBe('500');
      expect(r.settlement.forgivesPrincipal).toBe(true);

      const l = expectOk(await loan(loanId));
      expect(l.account.status).toBe('CLOSED');
      expect(l.account.principalOutstanding).toBe('0');

      const event = l.events.find((e: any) => e.type === 'SETTLEMENT');
      const lines = event.journal.lines
        .map(
          (x: any) => `${x.accountCode}:${Number(x.debit)}:${Number(x.credit)}`,
        )
        .sort();
      // Cash 4,500 in, 500 to principal-forgiveness expense, 5,000 off the
      // receivable: the loss is in the ledger, not implied by a vanished balance.
      expect(lines).toEqual(['1000:4500:0', '1200:0:5000', '5110:500:0']);
    });

    it('cannot be settled twice', async () => {
      const r = await f
        .as('approver2')
        .post(
          `/lending/loans/${loanId}/negotiated-settlement`,
          { agreedAmount: '100', reason: 'Again' },
          'settle-twice',
        );
      expect(r.status).toBe(409);
      expect(r.body.message).toMatch(/Loan is CLOSED/);
    });

    it('reconciles after the concession', async () => {
      const rec = expectOk(
        await f.as('finance').get('/lending/ops/reconciliation'),
      );
      expect(rec.breaks).toEqual([]);
      expect(rec.trialBalanceBalanced).toBe(true);
    });
  });

  describe('a product that may only waive charges', () => {
    let loanId: string;

    beforeAll(async () => {
      const { productId } = await chargesOnly('NS-CHG');
      const r = await originateAndDisburse(f, productId, {
        principal: '5000',
        numberOfInstalments: 12,
        disbursementDate: '2026-01-05',
      });
      loanId = r.loanId;
    }, 60_000);

    it('refuses a settlement that would reach into principal', async () => {
      const r = await f
        .as('approver2')
        .post(
          `/lending/loans/${loanId}/negotiated-settlement`,
          { agreedAmount: '4000', reason: 'Attempted haircut' },
          'settle-chg-refuse',
        );
      expect(r.status).toBe(400);
      expect(r.body.message).toMatch(
        /would forgive PRINCIPAL, which the terms do not permit/,
      );
    });

    it('is refused outright on a product that does not allow settlement', async () => {
      const { productId } = await activeProduct(
        f,
        'PERSONAL_INSTALMENT',
        'NS-OFF',
      );
      const other = await originateAndDisburse(f, productId, {
        principal: '2000',
        numberOfInstalments: 12,
        disbursementDate: '2026-01-05',
      });
      const r = await f
        .as('approver2')
        .post(
          `/lending/loans/${other.loanId}/negotiated-settlement`,
          { agreedAmount: '1500', reason: 'Not permitted' },
          'settle-off',
        );
      expect(r.status).toBe(400);
      expect(r.body.message).toMatch(/does not permit negotiated settlement/);
    });
  });

  describe('recovery after write-off', () => {
    let loanId: string;

    beforeAll(async () => {
      const { productId } = await chargesOnly('REC-STD');
      const r = await originateAndDisburse(f, productId, {
        principal: '3000',
        numberOfInstalments: 12,
        disbursementDate: '2026-01-05',
      });
      loanId = r.loanId;
      // Write the loan off.
      const task = expectOk(
        await f.as('opsMaker').post(`/lending/loans/${loanId}/write-offs`, {
          reason: 'Unrecoverable',
        }),
      );
      expectOk(
        await f
          .as('opsChecker')
          .post(
            `/lending/loans/${loanId}/write-offs/${task.id}/decision`,
            { approve: true },
            `writeoff-${loanId.slice(0, 10)}`,
          ),
      );
    }, 60_000);

    it('starts from a written-off loan with no balance', async () => {
      const l = expectOk(await loan(loanId));
      expect(l.account.status).toBe('WRITTEN_OFF');
      expect(l.account.principalOutstanding).toBe('0');
    });

    it('posts a recovery to income without reviving the loan', async () => {
      const r = expectOk(
        await f.as('finance').post(
          `/lending/loans/${loanId}/recoveries`,
          {
            amount: '1000',
            note: 'Partial recovery through collections agent',
          },
          'recovery-one',
        ),
      );
      expect(r.recovery.allocations).toEqual([
        { component: 'PRINCIPAL', amount: '1000' },
      ]);
      expect(r.recovery.fullyRecovered).toBe(false);

      const l = expectOk(await loan(loanId));
      // Recovering part of a loss does not make the loan perform again.
      expect(l.account.status).toBe('WRITTEN_OFF');
      const event = l.events.find((e: any) => e.type === 'RECOVERY');
      const lines = event.journal.lines
        .map(
          (x: any) => `${x.accountCode}:${Number(x.debit)}:${Number(x.credit)}`,
        )
        .sort();
      expect(lines).toEqual(['1000:1000:0', '4300:0:1000']);
    });

    it('continues where the last recovery stopped', async () => {
      const r = expectOk(
        await f
          .as('finance')
          .post(
            `/lending/loans/${loanId}/recoveries`,
            { amount: '500' },
            'recovery-two',
          ),
      );
      expect(r.recovery.recoveredToDate).toBe('1500');
    });

    it('refuses a recovery larger than what is still written off', async () => {
      const r = await f
        .as('finance')
        .post(
          `/lending/loans/${loanId}/recoveries`,
          { amount: '99999' },
          'recovery-toomuch',
        );
      expect(r.status).toBe(400);
      expect(r.body.message).toMatch(/still written off/);
    });

    it('replays on the same idempotency key rather than double-posting', async () => {
      const body = { amount: '100' };
      expectOk(
        await f
          .as('finance')
          .post(`/lending/loans/${loanId}/recoveries`, body, 'recovery-idem'),
      );
      const again = expectOk(
        await f
          .as('finance')
          .post(`/lending/loans/${loanId}/recoveries`, body, 'recovery-idem'),
      );
      expect(again.replayed).toBe(true);
      const l = expectOk(await loan(loanId));
      expect(l.events.filter((e: any) => e.type === 'RECOVERY')).toHaveLength(
        3,
      );
    });

    it('refuses a recovery on a loan that is not written off', async () => {
      const { productId } = await chargesOnly('REC-ACTIVE');
      const other = await originateAndDisburse(f, productId, {
        principal: '1000',
        numberOfInstalments: 12,
        disbursementDate: '2026-01-05',
      });
      const r = await f
        .as('finance')
        .post(
          `/lending/loans/${other.loanId}/recoveries`,
          { amount: '100' },
          'recovery-active',
        );
      // The action is only permitted in WRITTEN_OFF, so the guard refuses it.
      expect([400, 403, 409]).toContain(r.status);
    });

    it('reconciles with recoveries posted', async () => {
      const rec = expectOk(
        await f.as('finance').get('/lending/ops/reconciliation'),
      );
      expect(rec.breaks).toEqual([]);
      expect(rec.trialBalanceBalanced).toBe(true);
    });

    it('records recoveries in the audit trail', async () => {
      const audit = expectOk(
        await f
          .as('admin1')
          .get(
            `/lending/ops/audit?action=loan.recovery.post&resourceId=${loanId}`,
          ),
      );
      expect(audit.data.length).toBeGreaterThanOrEqual(3);
    });
  });
});
