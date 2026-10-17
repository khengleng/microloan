import { ConflictException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { evaluateFlag } from '../lending/policy/flags';

/** The tenant flag that closes the legacy loan book to new business (DECISIONS D-047). */
export const LEGACY_READONLY_FLAG = 'lending.legacy_loans.readonly';

export interface LegacyLoanStatus {
  readonly: boolean;
  /** Which precedence step decided it (DEFAULT, TENANT_RULE, …). */
  source: string;
  message: string;
}

/**
 * Consolidation gate for the legacy loan stack.
 *
 * When `lending.legacy_loans.readonly` is on for a tenant, no new legacy loan
 * can be created and no legacy loan can be disbursed; repayments, payoff,
 * write-off and the reading of existing legacy loans are untouched. The flag
 * is changed like every lending flag: proposed by one administrator and
 * approved by another (Lending › Access & policy › Flags).
 */
@Injectable()
export class LegacyLoanGate {
  constructor(private readonly prisma: PrismaService) {}

  async status(tenantId: string | null | undefined): Promise<LegacyLoanStatus> {
    if (!tenantId) return { readonly: false, source: 'NO_TENANT', message: '' };
    const [flags, platformRules, tenantRules] = await Promise.all([
      this.prisma.featureFlag.findMany({
        where: { key: LEGACY_READONLY_FLAG },
      }),
      this.prisma.platformFlagRule.findMany({
        where: { flagKey: LEGACY_READONLY_FLAG, status: 'ACTIVE' },
      }),
      this.prisma.flagRule.findMany({
        where: { tenantId, flagKey: LEGACY_READONLY_FLAG, status: 'ACTIVE' },
      }),
    ]);
    const evaluation = evaluateFlag(
      LEGACY_READONLY_FLAG,
      { channel: 'STAFF_PORTAL' },
      {
        catalogue: new Map(
          flags.map((f) => [
            f.key,
            {
              key: f.key,
              sensitive: f.sensitive,
              defaultEnabled: f.defaultEnabled,
            },
          ]),
        ),
        platformRules,
        tenantRules,
      },
    );
    return {
      readonly: evaluation.enabled,
      source: evaluation.source,
      message: evaluation.enabled
        ? 'Legacy loans are read-only for new business. Create and disburse new loans in the lending platform (Lending › Applications); repayments and payoff of existing legacy loans continue here.'
        : '',
    };
  }

  /** Refuse new legacy business while the book is read-only. */
  async assertOpen(
    tenantId: string | null | undefined,
    what: 'create' | 'disburse',
  ): Promise<void> {
    const s = await this.status(tenantId);
    if (!s.readonly) return;
    throw new ConflictException({
      message:
        what === 'create'
          ? 'New legacy loans are closed: create the loan in the lending platform (Lending › Applications).'
          : 'Legacy disbursements are closed: book and disburse the loan in the lending platform.',
      code: 'LEGACY_LOANS_READONLY',
      flag: LEGACY_READONLY_FLAG,
    });
  }
}
