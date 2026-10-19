import { ConflictException } from '@nestjs/common';
import {
  LEGACY_FROZEN_OPERATIONS,
  LEGACY_READONLY_FLAG,
  LegacyLoanGate,
} from './legacy-loan-gate';

/** D-097: the original loan module is read-only unless a tenant opts out. */
describe('LegacyLoanGate', () => {
  const build = (opts: {
    flagRow?: boolean;
    defaultEnabled?: boolean;
    tenantRules?: any[];
  }) => {
    const prisma: any = {
      featureFlag: {
        findMany: jest.fn().mockResolvedValue(
          opts.flagRow === false
            ? []
            : [
                {
                  key: LEGACY_READONLY_FLAG,
                  sensitive: true,
                  defaultEnabled: opts.defaultEnabled ?? true,
                },
              ],
        ),
      },
      platformFlagRule: { findMany: jest.fn().mockResolvedValue([]) },
      flagRule: {
        findMany: jest.fn().mockResolvedValue(opts.tenantRules ?? []),
      },
    };
    return new LegacyLoanGate(prisma);
  };
  const optOut = {
    id: 'r1',
    flagKey: LEGACY_READONLY_FLAG,
    scopeType: 'TENANT',
    scopeValue: null,
    enabled: false,
    emergency: false,
    priority: 100,
    status: 'ACTIVE',
    effectiveFrom: new Date(Date.now() - 1000),
    effectiveTo: null,
  };

  it('is read-only by default and lists what is closed', async () => {
    const s = await build({}).status('t1');
    expect(s.readonly).toBe(true);
    expect(s.source).toBe('DEFAULT');
    expect(s.frozenOperations).toEqual([...LEGACY_FROZEN_OPERATIONS]);
    expect(s.message).toMatch(/migration/);
  });

  it('stays read-only when the catalogue row has not been written yet', async () => {
    expect((await build({ flagRow: false }).status('t1')).readonly).toBe(true);
  });

  it('opens for a tenant with an active rule switching it off', async () => {
    const s = await build({ tenantRules: [optOut] }).status('t1');
    expect(s.readonly).toBe(false);
    expect(s.source).toBe('TENANT_RULE');
    expect(s.frozenOperations).toEqual([]);
  });

  it.each(LEGACY_FROZEN_OPERATIONS.map((o) => [o]))(
    'refuses %s with 409 LEGACY_LOANS_READONLY and the way forward',
    async (op) => {
      const err = await build({})
        .assertOpen('t1', op)
        .catch((e: unknown) => e);
      expect(err).toBeInstanceOf(ConflictException);
      const body = (err as ConflictException).getResponse() as any;
      expect(body.code).toBe('LEGACY_LOANS_READONLY');
      expect(body.operation).toBe(op);
      expect(body.links.migration).toBe('/lending/migration');
      expect(body.message).toMatch(/read-only/);
    },
  );

  it('lets every operation through for a tenant that opted out', async () => {
    const gate = build({ tenantRules: [optOut] });
    for (const op of LEGACY_FROZEN_OPERATIONS)
      await expect(gate.assertOpen('t1', op)).resolves.toBeUndefined();
  });
});
