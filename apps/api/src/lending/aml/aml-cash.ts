import type { Prisma } from '@microloan/db';
import type { Tx } from '../common/lending-prisma';
import { decStr, toLocalDate } from '../common/util';

/** A posted repayment or disbursement with the channel the money moved through. */
export interface ChannelledEvent {
  id: string;
  loanAccountId: string;
  borrowerId: string;
  type: 'REPAYMENT' | 'DISBURSEMENT';
  businessDate: string;
  currency: string;
  /** Repayment: the amount received. Disbursement: the net amount paid out. */
  amount: string;
  /** null when no channel was recorded (an older posting, or one made without it). */
  channel: string | null;
}

/**
 * Posted repayments and disbursements (not reversed) with their payment
 * channel (DECISIONS D-121), from what the platform records:
 *
 *  - the `channel` recorded on the event (a teller repayment or a
 *    disbursement records it when given);
 *  - the channel of the imported settlement or payroll file line that
 *    posted it (MOBILE, QR, WALLET, AGENT, PAYROLL);
 *  - the channel of the unidentified receipt it was matched from
 *    (BRANCH_CASH, BANK_TRANSFER, …).
 */
export async function channelledEvents(
  tx: Tx,
  tenantId: string,
  where: Prisma.FinancialEventWhereInput,
): Promise<ChannelledEvent[]> {
  const events = await tx.financialEvent.findMany({
    where: {
      ...where,
      tenantId,
      type: { in: ['REPAYMENT', 'DISBURSEMENT'] },
      status: 'POSTED',
      loanAccountId: { not: null },
    },
    select: {
      id: true,
      loanAccountId: true,
      type: true,
      businessDate: true,
      amount: true,
      currency: true,
      components: true,
      loanAccount: { select: { borrowerId: true } },
    },
    orderBy: [{ businessDate: 'asc' }, { createdAt: 'asc' }],
  });
  const recorded = (c: unknown) => {
    const v = (c as { channel?: unknown } | null)?.channel;
    return typeof v === 'string' && v ? v : null;
  };
  const unknownIds = events
    .filter((e) => !recorded(e.components))
    .map((e) => e.id);
  const [lines, matches] = unknownIds.length
    ? await Promise.all([
        tx.channelFileLine.findMany({
          where: { tenantId, financialEventId: { in: unknownIds } },
          select: { financialEventId: true, channel: true },
        }),
        tx.unidentifiedPaymentMatch.findMany({
          where: { tenantId, financialEventId: { in: unknownIds } },
          select: {
            financialEventId: true,
            payment: { select: { channel: true } },
          },
        }),
      ])
    : [[], []];
  const viaFile = new Map(lines.map((l) => [l.financialEventId, l.channel]));
  const viaReceipt = new Map(
    matches.map((m) => [m.financialEventId, m.payment.channel]),
  );
  return events.map((e) => {
    const components = e.components as { netDisbursement?: string } | null;
    return {
      id: e.id,
      loanAccountId: e.loanAccountId!,
      borrowerId: e.loanAccount!.borrowerId,
      type: e.type as ChannelledEvent['type'],
      businessDate: toLocalDate(e.businessDate)!,
      currency: e.currency,
      amount:
        e.type === 'DISBURSEMENT' && components?.netDisbursement
          ? String(components.netDisbursement)
          : decStr(e.amount),
      channel:
        recorded(e.components) ??
        viaFile.get(e.id) ??
        viaReceipt.get(e.id) ??
        null,
    };
  });
}
