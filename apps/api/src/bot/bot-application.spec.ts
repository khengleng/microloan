// The bot imports telegraf/openai; only the pure limit check and the gate are exercised here.
jest.mock('otplib', () => ({ verify: jest.fn(), generateSecret: jest.fn() }));

import { BotService, productLimitError } from './bot.service';

describe('Telegram loan applications (D-132)', () => {
  it('checks the amount and term against the product limits', () => {
    const policy = { minPrincipal: '100', maxPrincipal: '5000', minTermMonths: 3, maxTermMonths: 24 };
    expect(productLimitError(policy, 50, 12)).toMatch(/smallest amount/);
    expect(productLimitError(policy, 6000, 12)).toMatch(/largest amount/);
    expect(productLimitError(policy, 1000, 1)).toMatch(/shortest term/);
    expect(productLimitError(policy, 1000, 36)).toMatch(/longest term/);
    expect(productLimitError(policy, 1000, 12)).toBeNull();
    expect(productLimitError({}, 1, 1)).toBeNull();
  });

  function bot(allow: boolean) {
    const prisma: any = {
      borrower: { findFirst: jest.fn(async () => ({ id: 'b1', branchId: null })) },
      loanProduct: {
        findFirst: jest.fn(async () => ({
          id: 'p1', interestMethod: 'FLAT', currency: 'USD',
          policies: [{ creditRating: 'GOOD', interestRate: '12', minPrincipal: '100', maxPrincipal: '1000', minTermMonths: 3, maxTermMonths: 12 }],
        })),
      },
      user: { findFirst: jest.fn() },
    };
    const loans: any = { create: jest.fn(), createFromChannel: jest.fn(async () => ({ id: 'l1' })) };
    const settings: any = { get: jest.fn(async () => ({ telegramBot: { allowLoanApplications: allow } })) };
    const svc = new BotService(prisma, loans, {} as any, settings);
    return { svc, prisma, loans };
  }

  it('is off unless the tenant turned it on', async () => {
    const { svc, loans } = bot(false);
    const res = JSON.parse(await svc.handleOriginateLoan('t1', 42, { principal: 500, termMonths: 6, productId: 'p1' }));
    expect(res.error).toMatch(/not available/);
    expect(loans.createFromChannel).not.toHaveBeenCalled();
  });

  it('records the application under the Telegram bot principal, never a staff account', async () => {
    const { svc, loans, prisma } = bot(true);
    const res = JSON.parse(await svc.handleOriginateLoan('t1', 42, { principal: 500, termMonths: 6, productId: 'p1' }));
    expect(res.ok).toBe(true);
    expect(loans.create).not.toHaveBeenCalled();
    expect(prisma.user.findFirst).not.toHaveBeenCalled();
    expect(loans.createFromChannel).toHaveBeenCalledWith(
      't1',
      { code: 'TELEGRAM_BOT', label: 'Telegram bot' },
      expect.objectContaining({ borrowerId: 'b1', principal: 500, termMonths: 6 }),
    );
  });

  it('refuses an amount outside the product limits', async () => {
    const { svc, loans } = bot(true);
    const res = JSON.parse(await svc.handleOriginateLoan('t1', 42, { principal: 50_000, termMonths: 6, productId: 'p1' }));
    expect(res.error).toMatch(/largest amount/);
    expect(loans.createFromChannel).not.toHaveBeenCalled();
  });

  it('refuses a non-integer term', async () => {
    const { svc } = bot(true);
    const res = JSON.parse(await svc.handleOriginateLoan('t1', 42, { principal: 500, termMonths: 2.5, productId: 'p1' }));
    expect(res.error).toMatch(/whole number/);
  });
});
