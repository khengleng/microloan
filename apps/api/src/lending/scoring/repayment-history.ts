import { lending } from '@microloan/shared';
import type { Tx } from '../common/lending-prisma';
import { toLocalDate } from '../common/util';

/**
 * Each loan's instalments with the date each was paid in full: the latest
 * value date of a posted payment allocated to it (an instalment marked PAID
 * with no allocation — settled from an advance — counts as paid on its due
 * date). Superseded and projected lines are left out, so a restructured loan
 * is judged on the schedule it actually ran on.
 */
export async function instalmentHistories(
  tx: Tx,
  tenantId: string,
  loanIds: string[],
): Promise<Map<string, lending.InstalmentHistory[]>> {
  const out = new Map<string, lending.InstalmentHistory[]>();
  if (!loanIds.length) return out;
  const [instalments, allocations] = await Promise.all([
    tx.scheduleInstalment.findMany({
      where: {
        tenantId,
        loanAccountId: { in: loanIds },
        status: { in: ['DUE', 'PAID'] },
        projected: false,
      },
      select: {
        loanAccountId: true,
        number: true,
        dueDate: true,
        status: true,
      },
      orderBy: [{ loanAccountId: 'asc' }, { dueDate: 'asc' }],
    }),
    tx.paymentAllocation.findMany({
      where: {
        tenantId,
        loanAccountId: { in: loanIds },
        event: { status: 'POSTED' },
      },
      select: {
        loanAccountId: true,
        instalmentNumber: true,
        event: { select: { valueDate: true } },
      },
    }),
  ]);
  const lastPaid = new Map<string, string>();
  for (const a of allocations) {
    const k = `${a.loanAccountId}:${a.instalmentNumber}`;
    const d = toLocalDate(a.event.valueDate)!;
    const prev = lastPaid.get(k);
    if (!prev || lending.compareDates(d, prev) > 0) lastPaid.set(k, d);
  }
  for (const i of instalments) {
    const due = toLocalDate(i.dueDate)!;
    const paidOn =
      i.status === 'PAID'
        ? (lastPaid.get(`${i.loanAccountId}:${i.number}`) ?? due)
        : null;
    const list = out.get(i.loanAccountId) ?? [];
    list.push({ dueDate: due, paidOn });
    out.set(i.loanAccountId, list);
  }
  return out;
}
