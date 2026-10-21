import { Injectable, NotFoundException } from '@nestjs/common';
import { LendingPrisma, Tx } from '../../common/lending-prisma';
import { BusinessDateService } from '../../common/business-date.service';
import { LendingActor, requireTenant } from '../../common/util';
import { PolicyService } from '../../policy/policy.service';
import { loadLoanState, resourceOf } from '../../servicing/loan-state';
import { TenantSettingsService } from '../../../tenant-settings/tenant-settings.service';
import { KhqrCodesService, PayableCode } from './khqr-codes.service';
import { howToPayPdf, type PayLanguage } from './how-to-pay';

/** `?lang=en|km|both` (default both: one page in each). */
export function payLanguages(lang?: string): PayLanguage[] {
  if (lang === 'en') return ['en'];
  if (lang === 'km') return ['km'];
  return ['en', 'km'];
}

export interface LoanPayInfo {
  lender: string;
  borrower: string;
  reference: string;
  currency: string;
  code: PayableCode | null;
}

/**
 * Where and how a loan is repaid (D-160): the code for the loan's branch and
 * currency, the reference to write in the remark, and the lender's name as
 * the key facts statement shows it. Used by the printable card, the
 * statement, the key facts statement, notices and the Telegram bot.
 */
@Injectable()
export class KhqrHowToPayService {
  constructor(
    private readonly lp: LendingPrisma,
    private readonly policy: PolicyService,
    private readonly businessDate: BusinessDateService,
    private readonly settings: TenantSettingsService,
    private readonly codes: KhqrCodesService,
  ) {}

  /** The card a loan officer prints and hands to the borrower. */
  async staffCard(actor: LendingActor, loanId: string, langs: PayLanguage[]) {
    const tenantId = requireTenant(actor);
    return this.lp.tenantTx(tenantId, async (tx) => {
      const state = await loadLoanState(tx, tenantId, loanId, { lock: false });
      await this.policy.enforce(
        actor,
        'payment.receipt.read',
        resourceOf(state),
        tx,
      );
      return this.card(tx, tenantId, loanId, langs);
    });
  }

  /** The same card, downloaded by the borrower for their own loan. */
  async borrowerCard(
    session: { tenantId: string; borrowerId: string },
    loanId: string,
    langs: PayLanguage[],
  ) {
    return this.lp.tenantTx(session.tenantId, async (tx) => {
      const own = await tx.loanAccount.findFirst({
        where: {
          id: loanId,
          tenantId: session.tenantId,
          borrowerId: session.borrowerId,
        },
        select: { id: true },
      });
      if (!own) throw new NotFoundException('Loan not found');
      return this.card(tx, session.tenantId, loanId, langs);
    });
  }

  private async card(
    tx: Tx,
    tenantId: string,
    loanId: string,
    langs: PayLanguage[],
  ) {
    const info = await this.forLoan(tx, tenantId, loanId);
    const pdf = await howToPayPdf(
      {
        ...info,
        qr: info.code ? await this.codes.png(info.code) : null,
        printedOn: await this.businessDate.get(tenantId, tx),
      },
      langs,
    );
    return { pdf, reference: info.reference };
  }

  /** forLoan in its own tenant transaction (statements, notices, the bot). */
  loanInfo(tenantId: string, loanId: string): Promise<LoanPayInfo> {
    return this.lp.tenantTx(tenantId, (tx) =>
      this.forLoan(tx, tenantId, loanId),
    );
  }

  /** Everything a page needs to tell the borrower how to pay one loan. */
  async forLoan(
    tx: Tx,
    tenantId: string,
    loanId: string,
  ): Promise<LoanPayInfo> {
    const loan = await tx.loanAccount.findFirst({
      where: { id: loanId, tenantId },
      select: {
        reference: true,
        currency: true,
        branchId: true,
        borrowerId: true,
      },
    });
    if (!loan) throw new NotFoundException('Loan not found');
    const borrower = await tx.borrower.findFirst({
      where: { id: loan.borrowerId, tenantId },
      select: { firstName: true, lastName: true },
    });
    return {
      lender: await this.lenderName(tx, tenantId),
      borrower: borrower ? `${borrower.firstName} ${borrower.lastName}` : '',
      reference: loan.reference,
      currency: loan.currency,
      code: await this.codes.forLoan(tx, tenantId, loan),
    };
  }

  /** The lender's name as its key facts statement shows it. */
  async lenderName(tx: Tx, tenantId: string): Promise<string> {
    const s = await this.settings.get(tenantId, tx);
    if (s.consumerProtection.lenderLegalName)
      return s.consumerProtection.lenderLegalName;
    const t = await tx.tenant.findFirst({
      where: { id: tenantId },
      select: { name: true },
    });
    return t?.name ?? '';
  }
}
