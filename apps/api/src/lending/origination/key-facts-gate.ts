import { ConflictException } from '@nestjs/common';
import { lending } from '@microloan/shared';
import type { Tx } from '../common/lending-prisma';
import { concurrentModification, sha256 } from '../common/util';

/**
 * The booking gate of the key facts statement (D-123), shared by booking and
 * the statement service without a dependency between them.
 *
 * A statement discloses one version of the terms: the approved terms (the
 * disbursement date aside — booking sets it) and the contract configuration
 * composed from them. Its hash binds the customer's acceptance to exactly
 * that version, so a changed rate, amount, fee, policy or product version
 * needs a new statement and a new acceptance.
 */
export function keyFactsTermsHash(
  terms: lending.NegotiatedTerms,
  contractHash: string,
): string {
  const rest: Record<string, unknown> = { ...terms };
  delete rest.disbursementDate;
  return sha256(lending.canonicalJson({ terms: rest, contract: contractHash }));
}

export type KeyFactsBlocker =
  | { code: 'KEY_FACTS_MISSING'; message: string }
  | { code: 'KEY_FACTS_NOT_ACCEPTED'; message: string; statementId: string }
  | { code: 'KEY_FACTS_STALE'; message: string; statementId: string };

/** Why the application cannot be booked on its statement; null when it can. */
export async function keyFactsBlocker(
  tx: Tx,
  tenantId: string,
  applicationId: string,
  termsHash: string | null,
): Promise<KeyFactsBlocker | null> {
  const live = await tx.keyFactsStatement.findFirst({
    where: { tenantId, applicationId, status: { in: ['ISSUED', 'ACCEPTED'] } },
    orderBy: { version: 'desc' },
  });
  if (!live)
    return {
      code: 'KEY_FACTS_MISSING',
      message:
        'No key facts statement has been issued for the approved terms; generate it and record the customer’s acceptance before booking.',
    };
  if (termsHash !== null && live.termsHash !== termsHash)
    return {
      code: 'KEY_FACTS_STALE',
      statementId: live.id,
      message: `Key facts statement v${live.version} no longer matches the approved terms; generate a new statement and record the customer’s acceptance of it.`,
    };
  if (live.status !== 'ACCEPTED')
    return {
      code: 'KEY_FACTS_NOT_ACCEPTED',
      statementId: live.id,
      message: `The customer has not accepted key facts statement v${live.version}; record their acceptance before booking.`,
    };
  return null;
}

/** The accepted statement for these terms, or the refusal that stops the booking. */
export async function requireAcceptedKeyFacts(
  tx: Tx,
  tenantId: string,
  applicationId: string,
  termsHash: string,
): Promise<{ id: string }> {
  const blocker = await keyFactsBlocker(tx, tenantId, applicationId, termsHash);
  if (blocker)
    throw new ConflictException({
      message: blocker.message,
      code: blocker.code,
    });
  const live = await tx.keyFactsStatement.findFirst({
    where: { tenantId, applicationId, status: 'ACCEPTED', termsHash },
    select: { id: true },
  });
  return live!;
}

/** The loan was booked on this statement. */
export async function markKeyFactsBooked(
  tx: Tx,
  tenantId: string,
  statementId: string,
  loanAccountId: string,
) {
  const res = await tx.keyFactsStatement.updateMany({
    where: { id: statementId, tenantId, status: 'ACCEPTED' },
    data: { status: 'BOOKED', loanAccountId },
  });
  if (res.count !== 1) throw concurrentModification('This key facts statement');
  // The accepted statement is the loan's key facts in the customer's library.
  const row = await tx.keyFactsStatement.findFirst({
    where: { id: statementId, tenantId },
    select: { documentIds: true },
  });
  const ids = Object.values((row?.documentIds ?? {}) as Record<string, string>);
  if (ids.length)
    await tx.customerDocument.updateMany({
      where: { tenantId, id: { in: ids }, loanAccountId: null },
      data: { loanAccountId },
    });
}
