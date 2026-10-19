import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { lending } from '@microloan/shared';
import type { Prisma } from '@microloan/db';
import { LedgerService } from '../../ledger/ledger.service';
import { LendingPrisma } from '../common/lending-prisma';
import { AuditEventService } from '../common/audit-event.service';
import {
  LendingActor,
  concurrentModification,
  requireTenant,
} from '../common/util';
import { PolicyService } from '../policy/policy.service';
import { tenantResource } from '../policy/resources';
import { TenantSettingsService } from '../../tenant-settings/tenant-settings.service';

type Json = Prisma.InputJsonValue;
type LedgerType = 'ASSET' | 'LIABILITY' | 'EQUITY' | 'INCOME' | 'EXPENSE';
const LEDGER_ACCOUNT_TYPES: LedgerType[] = [
  'ASSET',
  'LIABILITY',
  'EQUITY',
  'INCOME',
  'EXPENSE',
];

/**
 * The lender's own operating parameters (TenantLendingSettings, DECISIONS
 * D-071). Finance proposes a complete version; a different user approves it;
 * one version is in force and approving a new one retires the old. Until one
 * is approved every value is its documented default — the constant the code
 * used before these were settings.
 */
@Injectable()
export class LendingSettingsService {
  constructor(
    private readonly lp: LendingPrisma,
    private readonly policy: PolicyService,
    private readonly audit: AuditEventService,
    private readonly ledger: LedgerService,
    private readonly settings: TenantSettingsService,
  ) {}

  // ── Chart of accounts ─────────────────────────────────────────────────────

  /** The tenant's ledger accounts (the default chart is provisioned first). */
  async accounts(actor: LendingActor) {
    const tenantId = requireTenant(actor);
    await this.policy.enforce(
      actor,
      'accounting.read',
      tenantResource(tenantId),
    );
    return this.lp.tenantTx(tenantId, async (tx) => {
      await this.ledger.ensureChartOfAccounts(tenantId, tx);
      return tx.ledgerAccount.findMany({
        where: { tenantId },
        select: {
          id: true,
          code: true,
          name: true,
          type: true,
          isActive: true,
        },
        orderBy: { code: 'asc' },
      });
    });
  }

  /**
   * Add an account to the chart, so the lending settings can name it (e.g. a
   * separate income account). Adding one posts nothing and changes no
   * existing posting rule — those change only through approved settings —
   * so finance (tenant_settings.manage) adds it alone; it is audited.
   */
  async createAccount(
    actor: LendingActor,
    body: { code: string; name: string; type: string },
  ) {
    const tenantId = requireTenant(actor);
    const code = (body.code ?? '').trim().toUpperCase();
    const name = (body.name ?? '').trim();
    if (!/^[0-9A-Z][0-9A-Z.-]{1,15}$/.test(code))
      throw new BadRequestException(
        'Account code must be 2–16 of 0–9, A–Z, . or -, starting with a letter or digit.',
      );
    if (name.length < 2)
      throw new BadRequestException('An account needs a name.');
    if (!LEDGER_ACCOUNT_TYPES.includes(body.type as LedgerType))
      throw new BadRequestException(
        `Account type must be one of ${LEDGER_ACCOUNT_TYPES.join(', ')}.`,
      );
    return this.lp.tenantTx(tenantId, async (tx) => {
      await this.policy.enforce(
        actor,
        'tenant_settings.manage',
        tenantResource(tenantId),
        tx,
      );
      await this.ledger.ensureChartOfAccounts(tenantId, tx);
      if (await tx.ledgerAccount.findFirst({ where: { tenantId, code } }))
        throw new ConflictException(`Account ${code} is already in the chart.`);
      const a = await tx.ledgerAccount.create({
        data: {
          tenantId,
          code,
          name: name.slice(0, 120),
          type: body.type as LedgerType,
        },
        select: {
          id: true,
          code: true,
          name: true,
          type: true,
          isActive: true,
        },
      });
      await this.audit.write(
        {
          actor,
          action: 'accounting.account_create',
          resourceType: 'LedgerAccount',
          resourceId: a.id,
          outcome: 'SUCCESS',
          details: { code: a.code, name: a.name, type: a.type },
        },
        tx,
      );
      return a;
    });
  }

  async list(actor: LendingActor) {
    const tenantId = requireTenant(actor);
    await this.policy.enforce(
      actor,
      'tenant_settings.read',
      tenantResource(tenantId),
    );
    return this.lp.tenantTx(tenantId, async (tx) => {
      const versions = await tx.tenantLendingSettings.findMany({
        where: { tenantId },
        orderBy: { version: 'desc' },
      });
      return {
        active: versions.find((v) => v.status === 'ACTIVE') ?? null,
        versions,
        /** What applies now: the version in force over the defaults. */
        effective: await this.settings.get(tenantId, tx),
        defaults: lending.defaultTenantLendingSettings(),
      };
    });
  }

  async propose(
    actor: LendingActor,
    body: { settings: unknown; reason?: string },
  ) {
    const tenantId = requireTenant(actor);
    await this.policy.enforce(
      actor,
      'tenant_settings.manage',
      tenantResource(tenantId),
    );
    const parsed = lending.tenantLendingSettingsSchema.safeParse(
      body.settings ?? {},
    );
    if (!parsed.success)
      throw new BadRequestException({
        message: 'The lending settings are not valid.',
        code: 'INVALID_TENANT_SETTINGS',
        issues: parsed.error.issues.map((i) => ({
          path: ['settings', ...i.path].join('.'),
          message: i.message,
        })),
      });
    const settings = parsed.data;
    const issues = lending
      .validateTenantLendingSettings(settings)
      .map((message) => ({ path: 'settings', message }));
    return this.lp.tenantTx(tenantId, async (tx) => {
      // Every account named must be in this tenant's chart, or postings to
      // it would fail at the worst moment (a year-end close, a receipt).
      await this.ledger.ensureChartOfAccounts(tenantId, tx);
      const codes = lending.settingsAccountCodes(settings);
      const known = await tx.ledgerAccount.findMany({
        where: { tenantId, code: { in: codes } },
        select: { id: true, code: true },
      });
      const have = new Set(known.map((a) => a.code));
      for (const c of codes)
        if (!have.has(c))
          issues.push({
            path: 'settings.accounting',
            message: `Ledger account ${c} is not in the chart of accounts.`,
          });
      if (issues.length)
        throw new BadRequestException({
          message: 'The lending settings are not valid.',
          code: 'INVALID_TENANT_SETTINGS',
          issues,
        });
      const last = await tx.tenantLendingSettings.findFirst({
        where: { tenantId },
        orderBy: { version: 'desc' },
      });
      const row = await tx.tenantLendingSettings.create({
        data: {
          tenantId,
          version: (last?.version ?? 0) + 1,
          settings: settings as unknown as Json,
          makerId: actor.id,
          reason: (body.reason ?? '').slice(0, 500),
        },
      });
      await this.audit.write(
        {
          actor,
          action: 'tenant_settings.manage',
          resourceType: 'TenantLendingSettings',
          resourceId: row.id,
          outcome: 'SUCCESS',
          details: { version: row.version },
        },
        tx,
      );
      return row;
    });
  }

  async decide(
    actor: LendingActor,
    id: string,
    body: { approve: boolean; comment?: string },
  ) {
    const tenantId = requireTenant(actor);
    return this.lp.tenantTx(tenantId, async (tx) => {
      const row = await tx.tenantLendingSettings.findFirst({
        where: { id, tenantId },
      });
      if (!row) throw new NotFoundException('Lending settings not found');
      await this.policy.enforce(
        actor,
        'tenant_settings.approve',
        tenantResource(tenantId, 'TENANT', tenantId, [row.makerId]),
        tx,
      );
      if (body.approve)
        await tx.tenantLendingSettings.updateMany({
          where: { tenantId, status: 'ACTIVE' },
          data: { status: 'RETIRED' },
        });
      const res = await tx.tenantLendingSettings.updateMany({
        where: { id, tenantId, status: 'PENDING' },
        data: {
          status: body.approve ? 'ACTIVE' : 'REJECTED',
          checkerId: actor.id,
          decidedAt: new Date(),
          reason: body.comment?.slice(0, 500) ?? row.reason,
        },
      });
      if (res.count !== 1) throw concurrentModification('These settings');
      await this.audit.write(
        {
          actor,
          action: 'tenant_settings.approve',
          resourceType: 'TenantLendingSettings',
          resourceId: id,
          outcome: 'SUCCESS',
          details: { approve: body.approve, version: row.version },
        },
        tx,
      );
      return tx.tenantLendingSettings.findFirst({ where: { id, tenantId } });
    });
  }
}
