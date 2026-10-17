import { lending } from '@microloan/shared';
import type { Tx } from '../common/lending-prisma';
import { fromLocalDate } from '../common/util';

/**
 * Set up the covenants a product configures on a loan being booked (LT-16).
 * The first test of each falls one period after the booking date.
 */
export async function createConfiguredCovenants(
  tx: Tx,
  input: {
    tenantId: string;
    loanAccountId: string;
    covenants: lending.ProductConfig['covenants'];
    startDate: string;
    actorId: string;
  },
): Promise<number> {
  const list = input.covenants ?? [];
  if (!list.length) return 0;
  await tx.loanCovenant.createMany({
    data: list.map((c) => ({
      tenantId: input.tenantId,
      loanAccountId: input.loanAccountId,
      type: c.type,
      threshold: c.threshold,
      frequencyMonths: c.frequencyMonths,
      nextTestOn: fromLocalDate(
        lending.addMonths(input.startDate, c.frequencyMonths),
      ),
      description: c.description.slice(0, 500),
      createdBy: input.actorId,
    })),
  });
  return list.length;
}
