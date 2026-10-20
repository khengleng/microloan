import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { lending } from '@microloan/shared';
import type { Adapter } from '../integrations/adapters';
import { LendingPrisma, Tx } from '../common/lending-prisma';
import { AuditEventService } from '../common/audit-event.service';
import {
  LendingActor,
  concurrentModification,
  requireTenant,
} from '../common/util';
import { PolicyService } from '../policy/policy.service';
import { tenantResource } from '../policy/resources';
import { decryptField, encryptField } from '../../common/field-crypto';
import {
  resolvePublicEndpoint,
  UnsafeEndpointError,
} from '../../common/outbound-http';

/**
 * External alternative-data providers (DECISIONS D-078): interfaces only.
 *
 * Smartphone-data scoring (CredoLab-style), mobile-operator data (Smart,
 * Cellcard, Metfone-style) and e-wallet transaction data each sit behind an
 * adapter, following integrations/adapters.ts. This build ships no adapter
 * implementation and no mock: a provider is usable only when the tenant has
 * an ACTIVE configuration (credentials field-encrypted, activated by a second
 * administrator) AND an implementation for its provider code is registered
 * below. Until then every source reports why it is unusable and the feature
 * store records the input as missing — nothing is ever fabricated.
 */

export const PROVIDER_SOURCES = [
  'SMARTPHONE_DATA',
  'TELCO_DATA',
  'EWALLET_DATA',
] as const;
export type ProviderSource = (typeof PROVIDER_SOURCES)[number];

/** What every provider is told: whose data, under which consent. */
export interface ProviderSubject {
  tenantId: string;
  borrowerId: string;
  /** The consent grant in force; providers must log it with the request. */
  consentId: string;
  /** The borrower's phone (telco, wallet look-ups); decrypted by the caller. */
  phone: string | null;
}

export interface ProviderConnection {
  providerCode: string;
  /**
   * Vetted when saved and when approved (public internet only, D-144). An
   * adapter must still call it through common/outbound-http.ts
   * (postToPublicEndpoint), which resolves once and pins the connection to
   * the vetted address (D-145) — never with a bare fetch.
   */
  endpointUrl: string;
  /** Decrypted only in memory, for the duration of one call. */
  credentials: string;
}

/** Smartphone-data scoring (device metadata collected by the provider's SDK with consent). */
export interface SmartphoneDataAdapter extends Adapter {
  readonly source: 'SMARTPHONE_DATA';
  score(
    subject: ProviderSubject,
  ): Promise<{ score: number; reference: string; scoredAt: string }>;
}

/** Mobile-operator data: tenure, top-ups and usage, summarised as a score. */
export interface TelcoDataAdapter extends Adapter {
  readonly source: 'TELCO_DATA';
  score(
    subject: ProviderSubject,
  ): Promise<{ score: number; reference: string; scoredAt: string }>;
}

/** E-wallet transaction data: how many recent months the wallet was active. */
export interface EwalletDataAdapter extends Adapter {
  readonly source: 'EWALLET_DATA';
  activity(
    subject: ProviderSubject,
  ): Promise<{ monthsActive: number; reference: string; observedAt: string }>;
}

export type AltDataProviderAdapter =
  | SmartphoneDataAdapter
  | TelcoDataAdapter
  | EwalletDataAdapter;

/**
 * Adapter implementations shipped in this build, by provider code. Empty:
 * every provider requires an integration (capabilities.ts). A real adapter is
 * added here, built from its connection; it must declare isMock = false.
 */
const IMPLEMENTATIONS: Readonly<
  Record<string, (c: ProviderConnection) => AltDataProviderAdapter>
> = Object.freeze({});

export type ProviderAvailability =
  | { usable: true; adapter: AltDataProviderAdapter; configId: string }
  | {
      usable: false;
      reason: 'NOT_CONFIGURED' | 'NO_ADAPTER_IMPLEMENTATION';
      message: string;
    };

@Injectable()
export class AltDataProvidersService {
  constructor(
    private readonly lp: LendingPrisma,
    private readonly policy: PolicyService,
    private readonly audit: AuditEventService,
  ) {}

  private access(tenantId: string, makers: string[] = [], id = 'access') {
    return tenantResource(tenantId, 'ACCESS', id, makers);
  }

  /** Whether a source can be used now, and its adapter when it can. */
  async availability(
    tx: Tx,
    tenantId: string,
    source: ProviderSource,
  ): Promise<ProviderAvailability> {
    const cfg = await tx.altDataProviderConfig.findFirst({
      where: { tenantId, source, status: 'ACTIVE' },
    });
    if (!cfg)
      return {
        usable: false,
        reason: 'NOT_CONFIGURED',
        message: `No ${source} provider is configured for this organisation.`,
      };
    const build = IMPLEMENTATIONS[cfg.providerCode];
    if (!build)
      return {
        usable: false,
        reason: 'NO_ADAPTER_IMPLEMENTATION',
        message: `Provider ${cfg.providerCode} is configured but this platform has no adapter for it yet.`,
      };
    const adapter = build({
      providerCode: cfg.providerCode,
      endpointUrl: cfg.endpointUrl,
      credentials: decryptField(cfg.credentials) ?? '',
    });
    if (adapter.isMock || adapter.source !== source)
      return {
        usable: false,
        reason: 'NO_ADAPTER_IMPLEMENTATION',
        message: `Provider ${cfg.providerCode} has no real ${source} adapter.`,
      };
    return { usable: true, adapter, configId: cfg.id };
  }

  async list(actor: LendingActor) {
    const tenantId = requireTenant(actor);
    await this.policy.enforce(
      actor,
      'alt_data.provider.read',
      this.access(tenantId),
    );
    return this.lp.tenantTx(tenantId, async (tx) => {
      const rows = await tx.altDataProviderConfig.findMany({
        where: { tenantId },
        orderBy: { createdAt: 'desc' },
      });
      const sources: {
        source: ProviderSource;
        capability: string;
        usable: boolean;
        reason: string | null;
        message: string;
      }[] = [];
      for (const source of PROVIDER_SOURCES) {
        const a = await this.availability(tx, tenantId, source);
        sources.push({
          source,
          capability: CAPABILITY_BY_SOURCE[source],
          usable: a.usable,
          reason: a.usable ? null : a.reason,
          message: a.usable ? 'Available' : a.message,
        });
      }
      return {
        sources,
        implementedProviders: Object.keys(IMPLEMENTATIONS),
        configurations: rows.map((r) => this.view(r)),
      };
    });
  }

  /** Propose a provider connection; a second administrator activates it. */
  async configure(
    actor: LendingActor,
    body: {
      source: ProviderSource;
      providerCode: string;
      endpointUrl: string;
      credentials: string;
    },
  ) {
    const tenantId = requireTenant(actor);
    await this.policy.enforce(
      actor,
      'alt_data.provider.manage',
      this.access(tenantId),
    );
    let url: URL;
    try {
      url = new URL(body.endpointUrl);
    } catch {
      throw new BadRequestException('endpointUrl is not a URL.');
    }
    if (url.protocol !== 'https:' || url.username || url.password)
      throw new BadRequestException(
        'Provider endpoints must use https and carry no credentials in the URL.',
      );
    await this.assertPublic(url);
    return this.lp.tenantTx(tenantId, async (tx) => {
      const row = await tx.altDataProviderConfig.create({
        data: {
          tenantId,
          source: body.source,
          providerCode: body.providerCode,
          endpointUrl: url.toString(),
          credentials: encryptField(body.credentials)!,
          makerId: actor.id,
        },
      });
      await this.audit.write(
        {
          actor,
          action: 'alt_data.provider.manage',
          resourceType: 'AltDataProviderConfig',
          resourceId: row.id,
          outcome: 'SUCCESS',
          details: {
            source: body.source,
            providerCode: body.providerCode,
            endpoint: url.origin,
          },
        },
        tx,
      );
      return this.view(row);
    });
  }

  async decide(
    actor: LendingActor,
    id: string,
    body: { approve: boolean; comment?: string },
  ) {
    const tenantId = requireTenant(actor);
    return this.lp.tenantTx(tenantId, async (tx) => {
      const row = await tx.altDataProviderConfig.findFirst({
        where: { id, tenantId },
      });
      if (!row) throw new NotFoundException('Provider configuration not found');
      await this.policy.enforce(
        actor,
        'alt_data.provider.approve',
        this.access(tenantId, [row.makerId], row.id),
        tx,
      );
      if (row.status !== 'PENDING')
        throw new ConflictException(
          `This configuration is ${row.status.toLowerCase()}.`,
        );
      // Vetted again on approval: the name may resolve elsewhere by now.
      if (body.approve) await this.assertPublic(new URL(row.endpointUrl));
      if (body.approve)
        await tx.altDataProviderConfig.updateMany({
          where: { tenantId, source: row.source, status: 'ACTIVE' },
          data: { status: 'DISABLED' },
        });
      const res = await tx.altDataProviderConfig.updateMany({
        where: { id, tenantId, status: 'PENDING' },
        data: {
          status: body.approve ? 'ACTIVE' : 'REJECTED',
          checkerId: actor.id,
          decidedAt: new Date(),
        },
      });
      if (res.count !== 1)
        throw concurrentModification('This provider configuration');
      await this.audit.write(
        {
          actor,
          action: 'alt_data.provider.approve',
          resourceType: 'AltDataProviderConfig',
          resourceId: id,
          outcome: 'SUCCESS',
          details: { approve: body.approve, comment: body.comment },
        },
        tx,
      );
      return this.view(
        (await tx.altDataProviderConfig.findFirst({
          where: { id, tenantId },
        }))!,
      );
    });
  }

  /** Provider endpoints must be on the public internet (D-144). */
  private async assertPublic(url: URL) {
    try {
      await resolvePublicEndpoint(url);
    } catch (e) {
      if (e instanceof UnsafeEndpointError)
        throw new BadRequestException(
          e.message.replace(/^The endpoint/, 'Provider endpoints'),
        );
      throw e;
    }
  }

  private view<T extends { credentials: string }>(r: T) {
    const { credentials: _c, ...rest } = r;
    return { ...rest, credentialsSet: !!_c };
  }
}

/** The capability each source is reported under (capabilities.ts). */
export const CAPABILITY_BY_SOURCE: Record<ProviderSource, string> = {
  SMARTPHONE_DATA: 'altdata.provider_smartphone',
  TELCO_DATA: 'altdata.provider_telco',
  EWALLET_DATA: 'altdata.provider_ewallet',
};

/** Variables each provider feeds, for the feature store. */
export const PROVIDER_VARIABLES: Record<string, ProviderSource> = {
  smartphoneScore: 'SMARTPHONE_DATA',
  telcoScore: 'TELCO_DATA',
  ewalletMonthsActive: 'EWALLET_DATA',
};

/** Keep the source list in step with the shared vocabulary. */
export function isProviderSource(s: string): s is ProviderSource {
  return (
    (PROVIDER_SOURCES as readonly string[]).includes(s) &&
    (lending.ALT_DATA_SOURCES as readonly string[]).includes(s)
  );
}
