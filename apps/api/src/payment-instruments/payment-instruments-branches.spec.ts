import { ForbiddenException } from '@nestjs/common';
import { PaymentInstrumentsService } from './payment-instruments.service';
import { AuthzService } from '../authz/authz.service';

describe('PaymentInstrumentsService.branches', () => {
  const prisma: any = { branch: { findMany: jest.fn().mockResolvedValue([{ id: 'b1', name: 'PNH', code: 'P' }]) } };
  const svc = new PaymentInstrumentsService(prisma, new AuthzService({} as any), {} as any);

  it("lists the caller's own organisation's branches only", async () => {
    const r = await svc.branches({ sub: 'u', role: 'TENANT_ADMIN', tenantId: 't1', permissions: [] } as any);
    expect(r).toHaveLength(1);
    expect(prisma.branch.findMany.mock.calls[0][0].where).toEqual({ tenantId: 't1' });
  });

  it('needs CONFIG_UPDATE', async () => {
    await expect(
      svc.branches({ sub: 'u', role: 'LOAN_OFFICER', tenantId: 't1', permissions: [] } as any),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});
