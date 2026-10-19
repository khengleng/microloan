import { Injectable, NotFoundException } from '@nestjs/common';
import { lending } from '@microloan/shared';
import type { Prisma } from '@microloan/db';
import type { Tx } from '../common/lending-prisma';
import { AuditEventService } from '../common/audit-event.service';
import { BusinessDateService } from '../common/business-date.service';
import { D, LendingActor, fromLocalDate } from '../common/util';
import { TenantSettingsService } from '../../tenant-settings/tenant-settings.service';
import { channelledEvents } from './aml-cash';

/** Applications still in play count towards the product-type factor. */
const OPEN_APPLICATION = ['DRAFT', 'SUBMITTED', 'RECOMMENDED', 'APPROVED'];

/**
 * Customer risk rating (DECISIONS D-120): LOW / MEDIUM / HIGH from the
 * factors and weights in the tenant's lending settings (`aml.risk`) —
 * politically exposed person, nationality, occupation or business type,
 * the product types borrowed, and cash intensity (the share of repayments
 * made in cash, or a cash-intensive occupation). The rating, its factors
 * and the next periodic review date are kept on the customer and every
 * rating is in the audit trail.
 */
@Injectable()
export class AmlRiskService {
  constructor(
    private readonly audit: AuditEventService,
    private readonly businessDate: BusinessDateService,
    private readonly settings: TenantSettingsService,
  ) {}

  async rateInTx(
    tx: Tx,
    tenantId: string,
    borrowerId: string,
    actor: Pick<LendingActor, 'id' | 'type' | 'tenantId'>,
  ) {
    const b = await tx.borrower.findFirst({
      where: { id: borrowerId, tenantId },
      select: {
        id: true,
        pep: true,
        nationality: true,
        occupation: true,
        amlRiskRating: true,
      },
    });
    if (!b) throw new NotFoundException('Customer not found');
    const s = (await this.settings.get(tenantId, tx)).aml;
    const asOf = await this.businessDate.get(tenantId, tx);

    const [loans, apps] = await Promise.all([
      tx.loanAccount.findMany({
        where: { tenantId, borrowerId, status: { not: 'CLOSED' } },
        select: { familyCode: true },
      }),
      tx.application.findMany({
        where: { tenantId, borrowerId, status: { in: OPEN_APPLICATION } },
        select: { productId: true },
      }),
    ]);
    const products = apps.length
      ? await tx.lendingProduct.findMany({
          where: { tenantId, id: { in: apps.map((a) => a.productId) } },
          select: { familyCode: true },
        })
      : [];
    const productFamilies = [
      ...new Set([
        ...loans.map((l) => l.familyCode),
        ...products.map((p) => p.familyCode),
      ]),
    ];

    const since = lending.addDays(asOf, -s.risk.cashLookbackDays);
    const repayments = (
      await channelledEvents(tx, tenantId, {
        type: 'REPAYMENT',
        loanAccount: { borrowerId },
        businessDate: { gte: fromLocalDate(since) },
      })
    ).filter((e) => e.type === 'REPAYMENT');
    const total = repayments.reduce((t, e) => t.plus(e.amount), D(0));
    const cash = repayments
      .filter(
        (e) => e.channel && s.ctr.cashChannels.includes(e.channel as never),
      )
      .reduce((t, e) => t.plus(e.amount), D(0));
    const cashShare = total.gt(0)
      ? cash.div(total).toDecimalPlaces(4).toString()
      : null;

    const result = lending.rateCustomerRisk(
      {
        pep: b.pep,
        nationality: b.nationality,
        occupation: b.occupation,
        productFamilies,
        cashShare,
      },
      s.risk,
    );
    const nextReview = lending.nextAmlReviewDate(
      asOf,
      result.rating,
      s.risk.reviewMonths,
    );
    await tx.borrower.update({
      where: { id: borrowerId },
      data: {
        amlRiskRating: result.rating,
        amlRiskScore: result.score,
        amlRiskFactors: result.factors as unknown as Prisma.InputJsonValue,
        amlRiskRatedAt: new Date(),
        amlNextReviewOn: fromLocalDate(nextReview),
      },
    });
    await this.audit.write(
      {
        actor,
        action: 'aml.risk.rate',
        resourceType: 'Borrower',
        resourceId: borrowerId,
        outcome: 'SUCCESS',
        details: {
          rating: result.rating,
          previous: b.amlRiskRating,
          score: result.score,
          factors: result.factors.filter((f) => f.present).map((f) => f.code),
          nextReview,
        },
      },
      tx,
    );
    return { ...result, nextReview, previous: b.amlRiskRating };
  }
}
