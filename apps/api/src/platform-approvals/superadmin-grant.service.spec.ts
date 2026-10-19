import { ForbiddenException } from '@nestjs/common';
import { PlatformApprovalService } from './platform-approval.service';
import { SuperadminGrantService } from './superadmin-grant.service';

/** Granting SUPERADMIN needs a second super-administrator (D-130). */
function build(superadmins: string[]) {
  const rows: any[] = [];
  const users: Record<string, any> = {
    target: { id: 'target', email: 'staff@lender.test', role: 'TENANT_ADMIN', tenantId: 't1', isActive: true },
  };
  const prisma: any = {
    user: {
      findMany: jest.fn(async () => superadmins.map((id) => ({ id }))),
      findUnique: jest.fn(async ({ where }: any) => Object.values(users).find((u) => u.email === where.email) ?? null),
      update: jest.fn(async ({ where, data }: any) => {
        Object.assign(users[where.id], data);
        return users[where.id];
      }),
    },
    refreshToken: { updateMany: jest.fn(async () => ({ count: 0 })) },
    platformApproval: {
      updateMany: jest.fn(async ({ where, data }: any) => {
        const hit = rows.filter((r) => (!where.id || r.id === where.id) && (!where.status || (typeof where.status === 'string' ? r.status === where.status : where.status.in.includes(r.status))) && (!where.expiresAt));
        hit.forEach((r) => Object.assign(r, data));
        return { count: hit.length };
      }),
      findFirst: jest.fn(async ({ where }: any) => rows.find((r) => r.subjectId === where.subjectId && where.status.in.includes(r.status)) ?? null),
      findUnique: jest.fn(async ({ where }: any) => rows.find((r) => r.id === where.id) ?? null),
      create: jest.fn(async ({ data }: any) => {
        const row = { id: `pa${rows.length + 1}`, ...data };
        rows.push(row);
        return row;
      }),
    },
    $transaction: jest.fn(async (fn: any) => fn(prisma)),
  };
  const audit = { logSecurityEvent: jest.fn() };
  const approvals = new PlatformApprovalService(prisma);
  const service = new SuperadminGrantService(prisma, audit as any, approvals);
  return { service, prisma, audit, rows, users };
}

const fresh = (sub: string) => ({ sub, role: 'SUPERADMIN', tenantId: null, amr: 'mfa', mfaAt: Math.floor(Date.now() / 1000) });

describe('SuperadminGrantService', () => {
  it('a promotion waits for a second super-administrator', async () => {
    const { service, users, rows } = build(['sa1', 'sa2']);
    const res = await service.requestPromotion(fresh('sa1'), 'staff@lender.test');
    expect(res.status).toBe('PENDING_APPROVAL');
    expect(users.target.role).toBe('TENANT_ADMIN');
    expect(rows[0]).toMatchObject({ action: 'SUPERADMIN_GRANT', status: 'PENDING', makerId: 'sa1' });
  });

  it('the requester cannot approve their own request', async () => {
    const { service } = build(['sa1', 'sa2']);
    const res = await service.requestPromotion(fresh('sa1'), 'staff@lender.test');
    await expect(service.approve(fresh('sa1'), res.approvalId)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('a second super-administrator approves; the audit names the approver as actor, not the promoted user', async () => {
    const { service, users, audit } = build(['sa1', 'sa2']);
    const res = await service.requestPromotion(fresh('sa1'), 'staff@lender.test');
    await service.approve(fresh('sa2'), res.approvalId);
    expect(users.target).toMatchObject({ role: 'SUPERADMIN', tenantId: null });
    const entry = audit.logSecurityEvent.mock.calls.map((c) => c[0]).find((e) => e.action === 'PROMOTED_TO_SUPERADMIN');
    expect(entry.actorUserId).toBe('sa2');
    expect(entry.actorUserId).not.toBe('target');
    expect(entry.newValue).toMatchObject({ requestedBy: 'sa1', approvedBy: 'sa2' });
    // The former tenant sees it in its own audit log.
    expect(entry.subjectTenantId).toBe('t1');
  });

  it('with only one super-administrator the grant proceeds on MFA and is logged loudly', async () => {
    const { service, users, audit, rows } = build(['sa1']);
    const res = await service.requestPromotion(fresh('sa1'), 'staff@lender.test');
    expect(res).toMatchObject({ status: 'EXECUTED', soleSuperadmin: true });
    expect(users.target.role).toBe('SUPERADMIN');
    expect(rows[0]).toMatchObject({ status: 'EXECUTED', payload: expect.objectContaining({ soleSuperadmin: true }) });
    expect(audit.logSecurityEvent).toHaveBeenCalledWith(expect.objectContaining({ action: 'SUPERADMIN_SOLE_APPROVER' }));
  });

  it('needs a recent authenticator code to request or approve', async () => {
    const { service } = build(['sa1', 'sa2']);
    const stale = { ...fresh('sa1'), mfaAt: 1 };
    await expect(service.requestPromotion(stale, 'staff@lender.test')).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'MFA_STEP_UP_REQUIRED' }),
    });
  });

  it('only platform super-administrators may use it', async () => {
    const { service } = build(['sa1', 'sa2']);
    await expect(
      service.requestPromotion({ ...fresh('a1'), role: 'TENANT_ADMIN', tenantId: 't1' }, 'staff@lender.test'),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});
