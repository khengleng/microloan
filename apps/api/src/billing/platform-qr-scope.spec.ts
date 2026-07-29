import { PlatformQrService } from './platform-qr.service';
import { getTenantContext, runAsTenant } from '../prisma/tenant-context';

/**
 * Reading the platform merchant profile from a tenant request.
 *
 * `PlatformPaymentQr` is PLATFORM_ONLY in the Prisma tenant guard, so a tenant
 * principal is denied it outright. That is right for the raw profile and wrong
 * for the two things derived from it that a tenant admin legitimately needs:
 * whether paid plans are possible, and a KHQR minted from those details.
 *
 * `/billing/plan-change` shipped without accounting for it and died with
 * "Cross-tenant access is forbidden (PlatformPaymentQr.findFirst: platform-owned
 * configuration is not readable by tenant principals)". These pin the fix so it
 * cannot regress into that message again.
 */

const ROW = {
  bakongAccountId: 'merchant@devb',
  merchantName: 'DBank',
  merchantCity: 'Phnom Penh',
  merchantCategoryCode: '6012',
};

function build(row: typeof ROW | null = ROW) {
  /** What the ambient context was at the moment of the query. */
  const seen: (string | undefined)[] = [];
  const prisma = {
    platformPaymentQr: {
      findFirst: jest.fn(async () => {
        seen.push(getTenantContext()?.mode);
        return row;
      }),
    },
  };
  const service = new PlatformQrService(prisma as never, {} as never);
  return { service, prisma, seen };
}

describe('PlatformQrService — reachable from a tenant request', () => {
  it('reads the merchant profile as system, not as the calling tenant', async () => {
    // Without this the Prisma guard rejects the query outright, because the
    // model is deliberately unreadable by tenant principals.
    const { service, seen } = build();

    const merchant = await runAsTenant('tenant-a', () => service.active());

    expect(merchant).toMatchObject({ bakongAccountId: 'merchant@devb' });
    expect(seen).toEqual(['system']);
  });

  it('answers isConfigured() for a tenant admin', async () => {
    // This is the call /billing/plan-change makes first. It used to throw.
    const { service } = build();
    await expect(
      runAsTenant('tenant-a', () => service.isConfigured()),
    ).resolves.toBe(true);
  });

  it('reports not-configured rather than throwing when no QR is uploaded', async () => {
    const original = { ...process.env };
    delete process.env.KHQR_BAKONG_ACCOUNT_ID;
    delete process.env.KHQR_MERCHANT_NAME;
    try {
      const { service } = build(null);
      await expect(
        runAsTenant('tenant-a', () => service.isConfigured()),
      ).resolves.toBe(false);
    } finally {
      process.env = original;
    }
  });

  it('resolves merchant details for minting inside a tenant request', async () => {
    // createForTenant goes through here; a plan upgrade cannot mint without it.
    const { service } = build();
    await expect(
      runAsTenant('tenant-a', () => service.resolveMerchant()),
    ).resolves.toMatchObject({ merchantName: 'DBank' });
  });

  it('still works with no ambient context at all', async () => {
    // Pre-auth signup reaches the same code path.
    const { service, seen } = build();
    await service.active();
    expect(seen).toEqual(['system']);
  });
});
