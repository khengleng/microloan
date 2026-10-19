import { ProvisioningService } from './provisioning.service';

/** Days past due in a provisioning run are counted to the tenant's business date. */
describe('ProvisioningService.run — DPD basis', () => {
  const loan = {
    id: 'loan-1',
    currency: 'USD',
    fxRateToBase: null,
    schedules: [
      {
        principalAmount: 100,
        paidPrincipal: 0,
        isPaid: false,
        dueDate: new Date('2026-01-01T00:00:00.000Z'),
      },
      {
        principalAmount: 100,
        paidPrincipal: 0,
        isPaid: false,
        dueDate: new Date('2026-02-01T00:00:00.000Z'),
      },
    ],
  };

  function build(businessDate: string | null) {
    const created: any[] = [];
    const prisma: any = {
      // The run reads and writes inside one locked transaction (D-101).
      $executeRaw: jest.fn().mockResolvedValue(1),
      tenantBusinessDate: {
        findUnique: jest.fn().mockResolvedValue(
          businessDate
            ? { businessDate: new Date(`${businessDate}T00:00:00.000Z`) }
            : null,
        ),
      },
      loan: { findMany: jest.fn().mockResolvedValue([loan]) },
      tenant: { findUnique: jest.fn().mockResolvedValue({ baseCurrency: 'USD' }) },
      provisionRun: { findFirst: jest.fn().mockResolvedValue(null) },
      $transaction: (fn: (tx: any) => unknown) =>
        fn({
          ...prisma,
          provisionRun: {
            findFirst: prisma.provisionRun.findFirst,
            // The run's provisions are written nested under it.
            create: jest.fn((args: any) => {
              created.push(...(args.data.provisions?.createMany.data ?? []));
              return { id: 'run-1', runDate: new Date() };
            }),
          },
        }),
    };
    const settings: any = {
      get: jest.fn().mockResolvedValue({
        regulatory: {
          classes: [
            { code: 'NORMAL', minDpd: 0, rate: '0.01', label: 'Normal' },
            { code: 'SPECIAL_MENTION', minDpd: 30, rate: '0.03', label: 'SM' },
            { code: 'SUBSTANDARD', minDpd: 90, rate: '0.2', label: 'SS' },
          ],
          longTermClasses: [
            { code: 'NORMAL', minDpd: 0, rate: '0.01', label: 'Normal' },
            { code: 'SPECIAL_MENTION', minDpd: 60, rate: '0.03', label: 'SM' },
            { code: 'SUBSTANDARD', minDpd: 180, rate: '0.2', label: 'SS' },
          ],
          shortTermMaxDays: 366,
        },
        accounting: { legacy: { provisionExpense: '5100', loanLossAllowance: '1290' } },
      }),
    };
    const svc = new ProvisioningService(
      prisma,
      { assertPermission: jest.fn(), actorId: () => 'u1' } as any,
      { logAction: jest.fn() } as any,
      { postEntry: jest.fn() } as any,
      settings,
    );
    return { svc, created };
  }

  const actor: any = { sub: 'u1', tenantId: 't1', role: 'TENANT_ADMIN' };

  it('counts days overdue to the business date, not today', async () => {
    const { svc, created } = build('2026-01-31');
    const r = await svc.run(actor);
    expect(r.businessDate).toBe('2026-01-31');
    // Oldest unpaid instalment due 2026-01-01 → 30 days at the business date
    // (the calendar clock, months later, would say far more).
    expect(created[0].daysOverdue).toBe(30);
    expect(String(created[0].classification)).toBe('SPECIAL_MENTION');
  });

  it('an instalment due on the business date is not yet overdue', async () => {
    const { svc, created } = build('2026-01-01');
    await svc.run(actor);
    expect(created[0].daysOverdue).toBe(0);
  });
});
