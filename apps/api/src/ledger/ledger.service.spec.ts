import { BadRequestException } from '@nestjs/common';
import { JournalSource } from '@microloan/db';
import { LedgerService } from './ledger.service';
import { ACCOUNT_CODES } from './chart-of-accounts';

describe('LedgerService.postEntry (double-entry invariant)', () => {
  const accounts = [
    { id: 'a-cash', tenantId: 't1', code: ACCOUNT_CODES.CASH },
    { id: 'a-recv', tenantId: 't1', code: ACCOUNT_CODES.LOANS_RECEIVABLE },
    { id: 'a-int', tenantId: 't1', code: ACCOUNT_CODES.INTEREST_INCOME },
  ];
  let prisma: any;
  let service: LedgerService;

  beforeEach(() => {
    prisma = {
      ledgerAccount: {
        findMany: jest.fn().mockResolvedValue(accounts),
        upsert: jest.fn(),
      },
      journalEntry: {
        create: jest.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: 'e1', ...data })),
      },
    };
    const authz: any = {};
    service = new LedgerService(prisma, authz);
  });

  it('rejects an unbalanced entry', async () => {
    await expect(
      service.postEntry({
        tenantId: 't1',
        source: JournalSource.DISBURSEMENT,
        description: 'bad',
        lines: [
          { accountCode: ACCOUNT_CODES.LOANS_RECEIVABLE, debit: 100 },
          { accountCode: ACCOUNT_CODES.CASH, credit: 90 },
        ],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.journalEntry.create).not.toHaveBeenCalled();
  });

  it('rejects a line that is both debit and credit', async () => {
    await expect(
      service.postEntry({
        tenantId: 't1',
        source: JournalSource.MANUAL,
        description: 'bad',
        lines: [
          { accountCode: ACCOUNT_CODES.CASH, debit: 50, credit: 50 },
          { accountCode: ACCOUNT_CODES.LOANS_RECEIVABLE, credit: 0, debit: 0 },
        ],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('posts a balanced repayment entry and resolves account codes to ids', async () => {
    await service.postEntry({
      tenantId: 't1',
      source: JournalSource.REPAYMENT,
      description: 'repayment',
      lines: [
        { accountCode: ACCOUNT_CODES.CASH, debit: 100 },
        { accountCode: ACCOUNT_CODES.LOANS_RECEIVABLE, credit: 80 },
        { accountCode: ACCOUNT_CODES.INTEREST_INCOME, credit: 20 },
      ],
    });

    expect(prisma.journalEntry.create).toHaveBeenCalledTimes(1);
    const arg = prisma.journalEntry.create.mock.calls[0][0];
    const created = arg.data.lines.create;
    expect(created).toEqual([
      { accountId: 'a-cash', debit: 100, credit: 0 },
      { accountId: 'a-recv', debit: 0, credit: 80 },
      { accountId: 'a-int', debit: 0, credit: 20 },
    ]);
  });

  it('auto-provisions the chart of accounts when a code is missing', async () => {
    // First lookup returns nothing; ensureChartOfAccounts upserts; second returns accounts.
    prisma.ledgerAccount.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce(accounts);

    await service.postEntry({
      tenantId: 't1',
      source: JournalSource.DISBURSEMENT,
      description: 'disbursement',
      lines: [
        { accountCode: ACCOUNT_CODES.LOANS_RECEIVABLE, debit: 100 },
        { accountCode: ACCOUNT_CODES.CASH, credit: 100 },
      ],
    });

    expect(prisma.ledgerAccount.upsert).toHaveBeenCalled();
    expect(prisma.journalEntry.create).toHaveBeenCalledTimes(1);
  });
});
