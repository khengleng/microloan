import { BadRequestException, Injectable } from '@nestjs/common';
import { lending } from '@microloan/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { TenantSettingsService } from '../../tenant-settings/tenant-settings.service';
import { operationalConfig } from '../../config/operational-config';
import type { Tx } from './lending-prisma';

export interface RateCapInForce {
  cap: lending.ResolvedRateCap;
  policy: lending.RateCapPolicy;
}

/**
 * The interest-rate cap in force (NBC Prakas B7-017-109), resolved in one
 * place for the lending module: the lowest of the deployment's regulatory
 * ceiling (REGULATORY_MAX_ANNUAL_RATE_PCT), the lender's own cap
 * (Tenant.maxAnnualInterestRatePct) and the product version's
 * `pricing.regulatoryCapAnnualRate`, with the lender's settings for fees and
 * penalty interest (TenantLendingSettings.rateCap). DECISIONS D-102…D-109.
 *
 * Read on every call: a lowered cap applies to the next approval, booking,
 * restructure or reset on every instance.
 */
@Injectable()
export class RateCapService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: TenantSettingsService,
  ) {}

  async resolve(
    tenantId: string,
    config: Pick<lending.ProductConfig, 'pricing'> | null,
    db?: Tx,
  ): Promise<RateCapInForce> {
    const [tenant, settings] = await Promise.all([
      (db ?? this.prisma).tenant.findUnique({
        where: { id: tenantId },
        // The tenant guard checks a unique read by the row's id: select it,
        // or the row comes back as null and the lender's cap is ignored.
        select: { id: true, maxAnnualInterestRatePct: true },
      }),
      this.settings.get(tenantId, db),
    ]);
    return {
      cap: lending.resolveRateCap({
        regulatorCeiling: lending.pctToFraction(
          operationalConfig().regulatoryMaxAnnualRatePct,
        ),
        tenantCap: lending.pctToFraction(
          tenant?.maxAnnualInterestRatePct?.toString(),
        ),
        productCap: config?.pricing.regulatoryCapAnnualRate ?? null,
      }),
      policy: lending.rateCapPolicyOf(settings),
    };
  }

  /** The refusal for findings: names the cap that applied and each computed rate. */
  static refusal(
    findings: lending.RateCapFinding[],
    context: string,
  ): BadRequestException {
    return new BadRequestException({
      message: `${context}: ${findings.map((f) => f.message).join(' ')}`,
      code: 'RATE_CAP_EXCEEDED',
      findings,
    });
  }

  static assert(findings: lending.RateCapFinding[], context: string): void {
    if (findings.length) throw RateCapService.refusal(findings, context);
  }
}
