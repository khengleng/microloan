import { ConflictException, Global, Injectable, Module } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { evaluateFlag } from '../lending/policy/flags';
import { FLAG_DEFINITIONS } from '../lending/policy/catalogue';

/** The tenant flag that freezes the legacy loan book (DECISIONS D-047, D-097). */
export const LEGACY_READONLY_FLAG = 'lending.legacy_loans.readonly';

/**
 * Everything the freeze refuses. Reading loans, schedules, repayments,
 * receipts, statements, exports and payoff quotes, and moving a loan to the
 * lending platform with the loan-book migration, stay open.
 */
export type LegacyOperation =
  | 'create'
  | 'disburse'
  | 'repayment'
  | 'settlement'
  | 'reversal'
  | 'write-off'
  | 'restructure'
  | 'provisioning'
  | 'penalty';

export const LEGACY_FROZEN_OPERATIONS: readonly LegacyOperation[] = [
  'create',
  'disburse',
  'repayment',
  'settlement',
  'reversal',
  'write-off',
  'restructure',
  'provisioning',
  'penalty',
];

const WHAT: Record<LegacyOperation, string> = {
  create: 'New loans',
  disburse: 'Disbursements',
  repayment: 'Repayments',
  settlement: 'Early settlements',
  reversal: 'Repayment reversals',
  'write-off': 'Write-offs',
  restructure: 'Restructures',
  provisioning: 'Provisioning runs',
  penalty: 'Late penalties',
};

/** Where the work is done instead (web routes; the API refuses the legacy one). */
export const LEGACY_FREEZE_LINKS = {
  lending: '/lending/loans',
  applications: '/lending/applications',
  migration: '/lending/migration',
} as const;

export interface LegacyLoanStatus {
  readonly: boolean;
  /** Which precedence step decided it (DEFAULT, TENANT_RULE, …). */
  source: string;
  message: string;
  /** What is refused while read-only (empty when the book is open). */
  frozenOperations: LegacyOperation[];
}

const READONLY_MESSAGE =
  'The original loan module is read-only: its loans can be viewed, exported and moved to the lending platform, but no money is moved here any more. Service loans in Lending › Loans and move running loans across with the loan-book migration (Lending › Migration).';

/**
 * Consolidation gate for the legacy loan stack (D-047, extended by D-097).
 *
 * While `lending.legacy_loans.readonly` is on for a tenant — the default for
 * every tenant — no legacy operation that moves money or changes a balance
 * runs: new loans, disbursements, repayments, settlements, reversals,
 * write-offs, restructures, provisioning runs and the late-penalty job.
 * A tenant opts out with a TENANT rule that switches the flag off, proposed
 * by one administrator and approved by another (Lending › Access & policy ›
 * Flags).
 */
@Injectable()
export class LegacyLoanGate {
  constructor(private readonly prisma: PrismaService) {}

  async status(tenantId: string | null | undefined): Promise<LegacyLoanStatus> {
    if (!tenantId)
      return {
        readonly: false,
        source: 'NO_TENANT',
        message: '',
        frozenOperations: [],
      };
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
    // The catalogue row is written at boot; until it exists the code's
    // definition applies, so a missing row never opens the book.
    const fallback = FLAG_DEFINITIONS.find(
      (f) => f.key === LEGACY_READONLY_FLAG,
    );
    const entries = flags.length
      ? flags.map((f) => ({
          key: f.key,
          sensitive: f.sensitive,
          defaultEnabled: f.defaultEnabled,
        }))
      : fallback
        ? [
            {
              key: fallback.key,
              sensitive: fallback.sensitive,
              defaultEnabled: fallback.defaultEnabled,
            },
          ]
        : [];
    const evaluation = evaluateFlag(
      LEGACY_READONLY_FLAG,
      { channel: 'STAFF_PORTAL' },
      {
        catalogue: new Map(entries.map((e) => [e.key, e])),
        platformRules,
        tenantRules,
      },
    );
    return {
      readonly: evaluation.enabled,
      source: evaluation.source,
      message: evaluation.enabled ? READONLY_MESSAGE : '',
      frozenOperations: evaluation.enabled ? [...LEGACY_FROZEN_OPERATIONS] : [],
    };
  }

  /** True while the tenant's legacy book is frozen. */
  async isFrozen(tenantId: string | null | undefined): Promise<boolean> {
    return (await this.status(tenantId)).readonly;
  }

  /** Refuse a legacy money operation while the book is read-only (409 LEGACY_LOANS_READONLY). */
  async assertOpen(
    tenantId: string | null | undefined,
    what: LegacyOperation,
  ): Promise<void> {
    const s = await this.status(tenantId);
    if (!s.readonly) return;
    throw new ConflictException({
      message: `${WHAT[what]} are closed in the original loan module, which is read-only. ${
        what === 'create'
          ? 'Create the loan in the lending platform (Lending › Applications).'
          : 'Move the loan to the lending platform with the loan-book migration (Lending › Migration) and service it in Lending › Loans.'
      }`,
      code: 'LEGACY_LOANS_READONLY',
      flag: LEGACY_READONLY_FLAG,
      operation: what,
      links: LEGACY_FREEZE_LINKS,
    });
  }
}

/** One gate for every legacy module (loans, repayments, provisioning, penalties, restructures). */
@Global()
@Module({
  providers: [LegacyLoanGate],
  exports: [LegacyLoanGate],
})
export class LegacyLoanGateModule {}
