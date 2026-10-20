/**
 * Message namespaces sent to the browser, per route segment.
 *
 * The full catalogue is large (the Khmer file alone is ~0.8 MB), and every
 * message handed to <NextIntlClientProvider> is serialised into the page's
 * HTML. So the [locale] layout sends only the namespaces its own providers
 * read, and each public route segment adds just what its screens use; the
 * signed-in app — which reaches nearly every namespace — gets them all in
 * (app)/layout.tsx.
 *
 * src/i18n-namespaces.test.mjs walks each route's import graph
 * (scripts/i18n-namespaces.mjs) and fails if a list misses a namespace a
 * component reads, so keep these in step when a screen starts using another
 * namespace.
 */

/** Read by app/[locale]/layout.tsx's providers (confirm dialog, toasts) and the landing page (app/[locale]/page.tsx, which has no segment of its own). */
export const SHELL_NAMESPACES = ['Common', 'Home'] as const;

/** Added by each public route segment's layout.tsx. */
export const ROUTE_NAMESPACES = {
    login: ['Auth'],
    register: ['Auth', 'Register'],
    'forgot-password': ['Auth'],
    'reset-password': ['Auth'],
    signup: ['Auth', 'Register'],
    portal: ['LendingDocuments', 'LendingPortal', 'LendingRestructure', 'LendingShared', 'LendingUi', 'Portal', 'Status'],
} as const satisfies Record<string, readonly string[]>;

export type PublicRoute = keyof typeof ROUTE_NAMESPACES;

/** The subset of `messages` a client tree needs. */
export function pickMessages<M extends Record<string, unknown>>(messages: M, namespaces: readonly string[]): Partial<M> {
    const out: Record<string, unknown> = {};
    for (const ns of namespaces) if (ns in messages) out[ns] = messages[ns];
    return out as Partial<M>;
}
