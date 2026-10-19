import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { LendingPrisma } from '../common/lending-prisma';
import { AuditEventService } from '../common/audit-event.service';
import { LendingActor, requireTenant } from '../common/util';
import { PolicyService } from '../policy/policy.service';
import { ServicingService } from '../servicing/servicing.service';
import { CustomerDocumentsService } from './customer-documents.service';
import { htmlLetter } from './document-rules';

/**
 * Generated documents filed in the customer library automatically (DOC-9):
 * settlement quote letters and the closure letter when a loan is settled.
 * The key facts statement is issued before the contract, from the approved
 * terms (origination/key-facts.service.ts, D-123). Other modules file their
 * own output through `CustomerDocumentsService.fileGenerated`.
 *
 * Filing never fails the business action it follows: an error is logged and
 * audited, and the action stands.
 */
@Injectable()
export class GeneratedDocumentsService {
  private readonly logger = new Logger(GeneratedDocumentsService.name);

  constructor(
    private readonly lp: LendingPrisma,
    private readonly policy: PolicyService,
    private readonly audit: AuditEventService,
    private readonly library: CustomerDocumentsService,
    private readonly servicing: ServicingService,
  ) {}

  private async loan(tenantId: string, loanAccountId: string) {
    return this.lp.tenantTx(tenantId, async (tx) => {
      const account = await tx.loanAccount.findFirst({
        where: { id: loanAccountId, tenantId },
      });
      if (!account) throw new NotFoundException('Loan not found');
      const borrower = await tx.borrower.findFirst({
        where: { id: account.borrowerId, tenantId },
        select: { id: true, firstName: true, lastName: true, branchId: true },
      });
      const existing = await tx.customerDocument.findMany({
        where: {
          tenantId,
          loanAccountId,
          category: 'GENERATED',
          status: 'ACTIVE',
        },
        select: { typeCode: true },
      });
      return {
        account,
        borrower: borrower!,
        filed: new Set(existing.map((e) => e.typeCode)),
      };
    });
  }

  private async failed(
    tenantId: string,
    loanAccountId: string,
    what: string,
    e: unknown,
  ) {
    this.logger.error(
      `Filing ${what} for ${loanAccountId} failed: ${(e as Error).message}`,
    );
    await this.audit.write({
      actor: { id: 'system:documents', type: 'SERVICE', tenantId },
      action: 'document.file_generated',
      resourceType: 'LoanAccount',
      resourceId: loanAccountId,
      outcome: 'FAILURE',
      details: { document: what, error: (e as Error).message?.slice(0, 300) },
    });
  }

  /**
   * Issue a settlement quote letter: the quote is computed (and authorised)
   * by servicing exactly as the quote screen shows it, then filed.
   */
  async issueSettlementQuote(
    actor: LendingActor,
    loanAccountId: string,
    asOf?: string,
  ) {
    const tenantId = requireTenant(actor);
    const quote = (await this.servicing.settlementQuote(
      actor,
      loanAccountId,
      asOf,
    )) as Record<string, unknown> & {
      asOf: string;
      currency: string;
      payable: string;
    };
    const { account, borrower } = await this.loan(tenantId, loanAccountId);
    await this.policy.enforce(actor, 'document.upload', {
      type: 'CUSTOMER_DOCUMENT',
      id: borrower.id,
      tenantId,
      branchId: borrower.branchId,
      ownerBorrowerId: borrower.id,
      makerIds: [],
    });
    const cur = quote.currency;
    const row = (label: string, key: string): [string, string] => [
      label,
      `${typeof quote[key] === 'string' ? quote[key] : '0'} ${cur}`,
    ];
    const body = htmlLetter(`Settlement quote — loan ${account.reference}`, [
      {
        text: `Dear ${borrower.firstName} ${borrower.lastName}, the amount needed to repay your loan in full on ${quote.asOf} is set out below. Interest continues to accrue after that date.`,
      },
      {
        rows: [
          row('Principal', 'principal'),
          row('Interest', 'interest'),
          row('Fees', 'fees'),
          row('Penalties', 'penalties'),
          row('Settlement fee', 'settlementFee'),
          row('Held on advance (deducted)', 'advanceApplied'),
          row('Amount payable', 'payable'),
        ],
      },
      {
        text:
          typeof quote.settlementFeeExplanation === 'string'
            ? quote.settlementFeeExplanation
            : '',
      },
    ]);
    const doc = await this.library.fileGenerated({
      tenantId,
      borrowerId: account.borrowerId,
      typeCode: 'SETTLEMENT_QUOTE',
      title: `Settlement quote ${account.reference} as of ${quote.asOf}`,
      mimeType: 'text/html',
      body,
      actorId: actor.id,
      loanAccountId: account.id,
    });
    return { quote, documentId: doc.id };
  }

  /** After a settlement: file the closure letter once the loan is closed. */
  async afterSettlement(actor: LendingActor, loanAccountId: string) {
    const tenantId = requireTenant(actor);
    try {
      const { account, borrower, filed } = await this.loan(
        tenantId,
        loanAccountId,
      );
      if (account.status !== 'CLOSED' || filed.has('CLOSURE_LETTER'))
        return null;
      const body = htmlLetter(`Loan closure letter — ${account.reference}`, [
        {
          text: `Dear ${borrower.firstName} ${borrower.lastName}, your loan ${account.reference} has been repaid in full and is closed${account.closedAt ? ` as of ${account.closedAt.toISOString().slice(0, 10)}` : ''}. Nothing further is owed under this loan.`,
        },
      ]);
      return await this.library.fileGenerated({
        tenantId,
        borrowerId: account.borrowerId,
        typeCode: 'CLOSURE_LETTER',
        title: `Closure letter ${account.reference}`,
        mimeType: 'text/html',
        body,
        actorId: actor.id,
        loanAccountId: account.id,
      });
    } catch (e) {
      await this.failed(tenantId, loanAccountId, 'CLOSURE_LETTER', e);
      return null;
    }
  }
}
