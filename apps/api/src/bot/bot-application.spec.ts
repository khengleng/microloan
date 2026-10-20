// The bot imports telegraf/openai; only the pure helpers and the application gate are exercised here.
jest.mock('otplib', () => ({ verify: jest.fn(), generateSecret: jest.fn() }));

import { BotService, CHAT_APPLICATIONS_PAUSED, loanSummary } from './bot.service';

const day = (offset: number) => new Date(Date.UTC(2030, 0, 1 + offset));
const line = (offset: number, due: string, paid = '0') => ({
  dueDate: day(offset),
  principalDue: due,
  interestDue: '0',
  feeDue: '0',
  taxDue: '0',
  penaltyDue: '0',
  principalPaid: paid,
  interestPaid: '0',
  feePaid: '0',
  taxPaid: '0',
  penaltyPaid: '0',
});

describe('Telegram bot on the lending platform (D-155)', () => {
  function bot(allow: boolean) {
    const prisma: any = { borrower: { findFirst: jest.fn() }, loanAccount: { findMany: jest.fn() } };
    const settings: any = { get: jest.fn(async () => ({ telegramBot: { allowLoanApplications: allow } })) };
    return { svc: new BotService(prisma, {} as any, settings), prisma };
  }

  it('applications by chat are off unless the tenant turned them on', async () => {
    const { svc } = bot(false);
    const res = JSON.parse(await svc.handleOriginateLoan('t1'));
    expect(res.error).toMatch(/not available/);
  });

  it('with the setting on, the chat says applying is paused and records nothing', async () => {
    const { svc, prisma } = bot(true);
    const res = JSON.parse(await svc.handleOriginateLoan('t1'));
    expect(res.error).toBe(CHAT_APPLICATIONS_PAUSED);
    expect(prisma.borrower.findFirst).not.toHaveBeenCalled();
    expect(prisma.loanAccount.findMany).not.toHaveBeenCalled();
  });

  it('summarises a lending loan: balance, overdue on the business date and the next instalment', () => {
    const s = loanSummary(
      {
        reference: 'LN-1',
        status: 'ACTIVE',
        currency: 'USD',
        bookedPrincipal: '1000',
        principalOutstanding: '700',
        interestReceivable: '12.5',
        feesReceivable: '0',
        penaltyReceivable: '2.5',
        daysPastDue: 3,
        instalments: [line(-40, '100', '100'), line(-3, '100', '40'), line(27, '100')],
      },
      day(0).toISOString().slice(0, 10),
    );
    expect(s).toMatchObject({
      balance: '715.00',
      amountOverdue: '60.00',
      nextPaymentAmount: '100.00',
      nextPaymentDueDate: day(27).toISOString().slice(0, 10),
    });
  });
});
