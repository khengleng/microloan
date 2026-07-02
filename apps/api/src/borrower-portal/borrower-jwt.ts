import { createHmac } from 'crypto';

/**
 * Borrower-portal tokens are cryptographically separated from staff tokens:
 * a dedicated secret is HMAC-derived from JWT_ACCESS_SECRET so a borrower token
 * can never be presented as a staff access token (and vice-versa) even though
 * no new env var is required. The `typ: 'borrower'` claim is also enforced.
 */
export function borrowerJwtSecret(): string {
  const base = process.env.JWT_ACCESS_SECRET;
  if (!base) throw new Error('JWT_ACCESS_SECRET is not set');
  return createHmac('sha256', base).update('borrower-portal-v1').digest('hex');
}

export const BORROWER_TOKEN_TTL = '2h';

export type BorrowerJwtPayload = {
  sub: string; // borrowerId
  typ: 'borrower';
  tenantId: string;
};

export type BorrowerSession = {
  borrowerId: string;
  tenantId: string;
  firstName: string;
  lastName: string;
  phone: string | null;
  kycStatus: string;
};
