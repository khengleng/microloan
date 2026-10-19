import { BadRequestException } from '@nestjs/common';
import { TenantsService } from './tenants.service';
import { AuthzService } from '../authz/authz.service';

/** Platform administration: plans on Register New Org, and the payment gate on Reactivate. */
describe('TenantsService — plans and reactivation', () => {
  const platform: any = { sub: 'p1', role: 'SUPERADMIN', tenantId: null, branchId: null, permissions: [] };
  let prisma: any;
  let planTiers: any;
  let service: TenantsService;

  beforeEach(() => {
    prisma = {
      tenant: {
        findUnique: jest.fn(),
        update: jest.fn().mockImplementation(({ data }: any) => ({ id: 't1', ...data })),
        create: jest.fn().mockImplementation(({ data }: any) => ({ id: 't1', ...data })),
      },
      user: { findUnique: jest.fn().mockResolvedValue(null), create: jest.fn() },
      $transaction: (fn: any) => fn(prisma),
    };
    planTiers = {
      requireSelectable: jest.fn().mockImplementation(async (name: string) => {
        if (name !== 'PROFESSIONAL' && name !== 'FREE')
          throw new BadRequestException(`Unknown plan "${name}"`);
        return { name };
      }),
      defaultTier: jest.fn().mockResolvedValue({ name: 'FREE' }),
    };
    const audit: any = { logSecurityEvent: jest.fn() };
    service = new TenantsService(prisma, audit, new AuthzService(audit), planTiers);
  });

  it('Reactivate refuses an organisation still waiting for its plan payment', async () => {
    prisma.tenant.findUnique.mockResolvedValue({ status: 'PENDING_PAYMENT' });
    await expect(service.setStatus(platform, 't1', 'ACTIVE')).rejects.toThrow(/plan payment/);
    expect(prisma.tenant.update).not.toHaveBeenCalled();
  });

  it('Reactivate still restores a suspended organisation', async () => {
    prisma.tenant.findUnique.mockResolvedValue({ status: 'SUSPENDED' });
    const t = await service.setStatus(platform, 't1', 'ACTIVE');
    expect(t.status).toBe('ACTIVE');
  });

  it('a pending-payment organisation can still be suspended', async () => {
    prisma.tenant.findUnique.mockResolvedValue({ status: 'PENDING_PAYMENT' });
    const t = await service.setStatus(platform, 't1', 'SUSPENDED');
    expect(t.status).toBe('SUSPENDED');
  });

  it('an edit cannot activate a pending-payment organisation either', async () => {
    prisma.tenant.findUnique.mockResolvedValue({ status: 'PENDING_PAYMENT', plan: 'FREE' });
    await expect(service.update(platform, 't1', { status: 'ACTIVE' })).rejects.toThrow(/plan payment/);
    await expect(service.update(platform, 't1', { status: 'PENDING_PAYMENT' })).rejects.toThrow(/ACTIVE or SUSPENDED/);
  });

  it('Register New Org stores the chosen plan, and refuses an unknown one', async () => {
    const t = await service.create(platform, { name: 'Org', plan: 'PROFESSIONAL' });
    expect(prisma.tenant.create.mock.calls[0][0].data.plan).toBe('PROFESSIONAL');
    expect(t.plan).toBe('PROFESSIONAL');
    await expect(service.create(platform, { name: 'Org', plan: 'GOLD' })).rejects.toThrow(/Unknown plan/);
  });

  it('a plan change must name a tier on offer', async () => {
    prisma.tenant.findUnique.mockResolvedValue({ status: 'ACTIVE', plan: 'FREE' });
    await expect(service.update(platform, 't1', { plan: 'GOLD' })).rejects.toThrow(/Unknown plan/);
    const t = await service.update(platform, 't1', { plan: 'PROFESSIONAL' });
    expect(t.plan).toBe('PROFESSIONAL');
  });
});
