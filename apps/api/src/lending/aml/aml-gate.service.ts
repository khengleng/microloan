import { BadRequestException, Injectable } from '@nestjs/common';
import type { Tx } from '../common/lending-prisma';

/** One customer who may not yet be lent to, and why. */
export interface AmlBlock {
  borrowerId: string;
  name: string;
  /** PARTY: the role they play (BORROWER, GROUP_MEMBER, GUARANTOR). */
  role: string;
  reasons: string[];
}

/** The steps the gate guards, as they read in a message. */
export type AmlGatedStep =
  | 'submitted'
  | 'approved'
  | 'booked'
  | 'disbursed'
  | 'drawn';

/**
 * The AML/CFT gate (DECISIONS D-118): an application is not submitted,
 * approved or booked, and no money is disbursed or drawn, unless every
 * customer who is a party to it — the borrower, the members of a group
 * loan, and guarantors who are on file as customers — has their identity
 * verified (KYC, two people), is AML-cleared (two people), has no watch-list
 * match awaiting compliance, and, when rated HIGH or politically exposed, has
 * approved enhanced due diligence. It applies whatever the product's
 * workflow steps say.
 *
 * It reads committed state inside the caller's transaction and depends on
 * nothing else, so origination and servicing can both call it.
 */
@Injectable()
export class AmlGateService {
  /** The customers who are parties to an application. */
  async applicationParties(
    tx: Tx,
    tenantId: string,
    app: { id: string; borrowerId: string; groupId?: string | null },
  ): Promise<Map<string, string>> {
    const parties = new Map<string, string>([[app.borrowerId, 'BORROWER']]);
    if (app.groupId) {
      const members = await tx.groupMembership.findMany({
        where: { tenantId, groupId: app.groupId, leftOn: null },
        select: { borrowerId: true },
      });
      for (const m of members)
        if (!parties.has(m.borrowerId))
          parties.set(m.borrowerId, 'GROUP_MEMBER');
    }
    const guarantors = await tx.guarantee.findMany({
      where: {
        tenantId,
        applicationId: app.id,
        guarantorBorrowerId: { not: null },
      },
      select: { guarantorBorrowerId: true },
    });
    for (const g of guarantors)
      if (g.guarantorBorrowerId && !parties.has(g.guarantorBorrowerId))
        parties.set(g.guarantorBorrowerId, 'GUARANTOR');
    return parties;
  }

  /** The customers who are parties to a booked loan or facility. */
  async loanParties(
    tx: Tx,
    tenantId: string,
    account: { id: string; borrowerId: string; applicationId: string },
  ): Promise<Map<string, string>> {
    const parties = new Map<string, string>([[account.borrowerId, 'BORROWER']]);
    const members = await tx.loanGroupMember.findMany({
      where: { tenantId, loanAccountId: account.id },
      select: { borrowerId: true },
    });
    for (const m of members)
      if (!parties.has(m.borrowerId)) parties.set(m.borrowerId, 'GROUP_MEMBER');
    const guarantors = await tx.guarantee.findMany({
      where: {
        tenantId,
        applicationId: account.applicationId,
        guarantorBorrowerId: { not: null },
      },
      select: { guarantorBorrowerId: true },
    });
    for (const g of guarantors)
      if (g.guarantorBorrowerId && !parties.has(g.guarantorBorrowerId))
        parties.set(g.guarantorBorrowerId, 'GUARANTOR');
    return parties;
  }

  /** Why each party may not be lent to yet; empty when every one may. */
  async blockers(
    tx: Tx,
    tenantId: string,
    parties: Map<string, string>,
  ): Promise<AmlBlock[]> {
    const ids = [...parties.keys()];
    if (!ids.length) return [];
    const [customers, openCases, approvedEdd] = await Promise.all([
      tx.borrower.findMany({
        where: { tenantId, id: { in: ids } },
        select: {
          id: true,
          firstName: true,
          lastName: true,
          kycStatus: true,
          amlStatus: true,
          amlRiskRating: true,
          pep: true,
        },
      }),
      tx.amlScreeningCase.findMany({
        where: {
          tenantId,
          borrowerId: { in: ids },
          status: { in: ['OPEN', 'PENDING_APPROVAL'] },
        },
        select: { borrowerId: true },
      }),
      tx.amlEddRecord.findMany({
        where: { tenantId, borrowerId: { in: ids }, status: 'APPROVED' },
        select: { borrowerId: true },
      }),
    ]);
    const open = new Set(openCases.map((c) => c.borrowerId));
    const edd = new Set(approvedEdd.map((e) => e.borrowerId));
    const out: AmlBlock[] = [];
    for (const c of customers) {
      const reasons: string[] = [];
      if (c.kycStatus !== 'VERIFIED')
        reasons.push(
          c.kycStatus === 'REJECTED'
            ? 'identity verification (KYC) was rejected'
            : 'identity (KYC) is not verified',
        );
      if (c.amlStatus === 'FLAGGED')
        reasons.push('is flagged by AML/CFT review');
      else if (c.amlStatus !== 'CLEAR')
        reasons.push(
          'has not been AML-cleared (screened and approved by two people)',
        );
      if (open.has(c.id))
        reasons.push('has a watch-list match awaiting compliance review');
      if ((c.amlRiskRating === 'HIGH' || c.pep) && !edd.has(c.id))
        reasons.push(
          c.pep
            ? 'is a politically exposed person and needs approved enhanced due diligence'
            : 'is rated HIGH risk and needs approved enhanced due diligence',
        );
      if (reasons.length)
        out.push({
          borrowerId: c.id,
          name: `${c.firstName} ${c.lastName}`.trim(),
          role: parties.get(c.id) ?? 'BORROWER',
          reasons,
        });
    }
    return out;
  }

  /** The gate's findings as the "Blocked by" list the UI shows. */
  static explain(blocks: AmlBlock[]): { layer: string; message: string }[] {
    return blocks.map((b) => ({
      layer: 'AML',
      message: `${roleLabel(b.role)} ${b.name}: ${b.reasons.join('; ')}.`,
    }));
  }

  /** Refuse the step unless every party passes. */
  async assertClear(
    tx: Tx,
    tenantId: string,
    parties: Map<string, string>,
    step: AmlGatedStep,
  ): Promise<void> {
    const blocks = await this.blockers(tx, tenantId, parties);
    if (!blocks.length) return;
    const blockedBy = AmlGateService.explain(blocks);
    throw new BadRequestException({
      message: `Customer due diligence is not complete, so this cannot be ${step}. ${blockedBy.map((b) => b.message).join(' ')}`,
      code: 'AML_CDD_INCOMPLETE',
      blockedBy,
      issues: blockedBy.map((b) => ({ path: '', message: b.message })),
    });
  }
}

function roleLabel(role: string): string {
  switch (role) {
    case 'GROUP_MEMBER':
      return 'Group member';
    case 'GUARANTOR':
      return 'Guarantor';
    default:
      return 'Borrower';
  }
}
