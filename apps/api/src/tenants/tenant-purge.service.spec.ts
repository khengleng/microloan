import { ConflictException } from '@nestjs/common';
import { TenantPurgeService } from './tenant-purge.service';

/** Tenant purge guard rails (D-131). */
const DAY = 86_400_000;

function build(opts: {
  deletedDaysAgo?: number | null;
  archive?: boolean;
  approved?: boolean;
  legalHold?: boolean;
  closedDaysAgo?: number;
}) {
  const deletedAt =
    opts.deletedDaysAgo === null || opts.deletedDaysAgo === undefined
      ? null
      : new Date(Date.now() - opts.deletedDaysAgo * DAY);
  const tx: any = {
    $executeRawUnsafe: jest.fn(),
    auditLog: { deleteMany: jest.fn() },
    loanInteraction: { deleteMany: jest.fn() },
    repayment: { deleteMany: jest.fn() },
    repaymentSchedule: { deleteMany: jest.fn() },
    collateral: { deleteMany: jest.fn() },
    guarantor: { deleteMany: jest.fn() },
    document: { deleteMany: jest.fn() },
    loan: { deleteMany: jest.fn() },
    borrower: { deleteMany: jest.fn() },
    user: { deleteMany: jest.fn() },
    loanPolicy: { deleteMany: jest.fn() },
    loanProduct: { deleteMany: jest.fn() },
    tenant: { delete: jest.fn() },
  };
  const longAgo = new Date(Date.now() - 10 * 365 * DAY);
  const prisma: any = {
    tenant: { findUnique: jest.fn(async () => ({ id: 't1', name: 'Acme', status: 'SUSPENDED', deletedAt })) },
    tenantArchive: {
      findFirst: jest.fn(async () =>
        opts.archive ? { id: 'ar1', sha256: 'a'.repeat(64), storageKey: 'platform/tenant-archives/t1/x.json' } : null,
      ),
    },
    documentRetentionRule: { findMany: jest.fn(async () => []) },
    borrower: { findMany: jest.fn(async () => [{ id: 'b1', createdAt: longAgo }]) },
    application: { findMany: jest.fn(async () => []) },
    loanAccount: {
      findMany: jest.fn(async () =>
        opts.closedDaysAgo === undefined
          ? []
          : [{ id: 'la1', borrowerId: 'b1', status: 'CLOSED', closedAt: new Date(Date.now() - opts.closedDaysAgo * DAY) }],
      ),
    },
    loan: { findMany: jest.fn(async () => []) },
    customerDocument: {
      findMany: jest.fn(async () => [
        { id: 'd1', borrowerId: 'b1', category: 'KYC', typeCode: 'NATIONAL_ID', createdAt: longAgo, legalHold: !!opts.legalHold },
      ]),
    },
    $transaction: jest.fn(async (fn: any) => fn(tx)),
  };
  const approvals: any = {
    findOpen: jest.fn(async () => (opts.approved ? { id: 'pa1', status: 'APPROVED', makerId: 'sa1', checkerId: 'sa2' } : null)),
    markExecuted: jest.fn(),
    secondApproverAvailable: jest.fn(async () => true),
    open: jest.fn(async (p: any) => ({ id: 'pa1', status: 'PENDING', ...p })),
  };
  const storage: any = { deleteTenantFiles: jest.fn(async () => 3), storage: jest.fn() };
  const audit = { logSecurityEvent: jest.fn() };
  const service = new TenantPurgeService(prisma, audit as any, approvals, storage);
  return { service, prisma, approvals, storage, tx, audit };
}

const sa = (sub = 'sa1') => ({ sub, role: 'SUPERADMIN', tenantId: null, amr: 'mfa', mfaAt: Math.floor(Date.now() / 1000) });
const codeOf = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e: any) {
    return e.getResponse?.().code ?? e.message;
  }
  return 'resolved';
};

describe('TenantPurgeService', () => {
  it('refuses inside the grace period, even with an archive and approval', async () => {
    const { service, storage, tx } = build({ deletedDaysAgo: 5, archive: true, approved: true });
    expect(await codeOf(service.purge(sa(), 't1'))).toBe('TENANT_PURGE_GRACE');
    expect(storage.deleteTenantFiles).not.toHaveBeenCalled();
    expect(tx.tenant.delete).not.toHaveBeenCalled();
  });

  it('refuses without an erasure request', async () => {
    const { service } = build({ deletedDaysAgo: null, archive: true, approved: true });
    await expect(service.purge(sa(), 't1')).rejects.toThrow(/Request erasure/);
  });

  it('refuses without a second super-administrator approval', async () => {
    const { service } = build({ deletedDaysAgo: 40, archive: true, approved: false });
    expect(await codeOf(service.purge(sa(), 't1'))).toBe('TENANT_PURGE_NOT_APPROVED');
  });

  it('refuses without an archive written after the erasure request', async () => {
    const { service } = build({ deletedDaysAgo: 40, archive: false, approved: true });
    expect(await codeOf(service.purge(sa(), 't1'))).toBe('TENANT_PURGE_NO_ARCHIVE');
    expect(await codeOf(service.requestPurge(sa(), 't1'))).toBe('TENANT_PURGE_NO_ARCHIVE');
  });

  it('refuses while a document is under legal hold', async () => {
    const { service } = build({ deletedDaysAgo: 40, archive: true, approved: true, legalHold: true });
    expect(await codeOf(service.purge(sa(), 't1'))).toBe('TENANT_PURGE_BLOCKED');
  });

  it('refuses inside the AML retention period after the relationship ended', async () => {
    const { service } = build({ deletedDaysAgo: 40, archive: true, approved: true, closedDaysAgo: 365 });
    const blockers = await service.blockers('t1');
    expect(blockers.withinRetention).toBeGreaterThan(0);
    expect(blockers.retainUntil).not.toBeNull();
    await expect(service.purge(sa(), 't1')).rejects.toBeInstanceOf(ConflictException);
  });

  it('purges once every condition holds: files first, then rows, and the request is marked executed', async () => {
    const { service, storage, tx, approvals, audit } = build({ deletedDaysAgo: 40, archive: true, approved: true });
    const res = await service.purge(sa('sa2'), 't1');
    expect(res.filesDeleted).toBe(3);
    expect(storage.deleteTenantFiles).toHaveBeenCalledWith('t1');
    expect(tx.tenant.delete).toHaveBeenCalledWith({ where: { id: 't1' } });
    expect(approvals.markExecuted).toHaveBeenCalledWith('pa1', tx);
    expect(audit.logSecurityEvent).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'TENANT_HARD_DELETE', newValue: expect.objectContaining({ archiveSha256: 'a'.repeat(64), approvedBy: 'sa2' }) }),
    );
  });

  it('when stored files cannot be deleted, nothing is removed from the database', async () => {
    const { service, storage, tx } = build({ deletedDaysAgo: 40, archive: true, approved: true });
    storage.deleteTenantFiles.mockRejectedValue(new Error('S3 down'));
    await expect(service.purge(sa(), 't1')).rejects.toThrow(/stored files/);
    expect(tx.tenant.delete).not.toHaveBeenCalled();
  });

  it('a purge request needs a recent authenticator code', async () => {
    const { service } = build({ deletedDaysAgo: 40, archive: true });
    expect(await codeOf(service.requestPurge({ ...sa(), mfaAt: 1 }, 't1'))).toBe('MFA_STEP_UP_REQUIRED');
  });
});
