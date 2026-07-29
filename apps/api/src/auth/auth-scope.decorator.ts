import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'auth:public';
export const IS_BORROWER_ROUTE_KEY = 'auth:borrower';
export const IS_ANY_AUTHENTICATED_KEY = 'auth:any-authenticated';

/**
 * Marks a route as genuinely unauthenticated — login, registration, OTP
 * request, the Stripe webhook, the load-balancer probe.
 *
 * This is the ONLY way to opt out of the global staff-JWT requirement, so
 * every anonymous entry point in the API is greppable from one symbol.
 */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

/**
 * Marks a route as authenticated by `BorrowerJwtGuard` rather than the staff
 * JWT. Kept distinct from `@Public()` so the borrower portal never reads as
 * anonymous in an audit — it is authenticated, just by a different principal.
 */
export const BorrowerRoute = () => SetMetadata(IS_BORROWER_ROUTE_KEY, true);

/**
 * Marks a route as deliberately open to any authenticated principal, for
 * self-service endpoints where the actor is the resource (`/auth/me`, MFA
 * enrolment). Distinct from omitting `@Roles()`, which is now a denial — the
 * point is that "everyone" has to be stated, not inferred from silence.
 */
export const AnyAuthenticated = () =>
  SetMetadata(IS_ANY_AUTHENTICATED_KEY, true);
