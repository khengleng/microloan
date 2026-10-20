import type { Prisma } from '@microloan/db';

/**
 * Lock a legacy (original-module) loan for the rest of the transaction
 * (D-098). The original module has no write paths any more (D-153); the
 * loan-book migration still takes this lock before it closes a legacy loan,
 * so two migrations of one loan run one after the other.
 */
export async function lockLegacyLoan(
  tx: Prisma.TransactionClient,
  loanId: string,
  tenantId: string,
): Promise<boolean> {
  const rows = await tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM "Loan" WHERE id = ${loanId} AND "tenantId" = ${tenantId} FOR UPDATE`;
  return rows.length === 1;
}
