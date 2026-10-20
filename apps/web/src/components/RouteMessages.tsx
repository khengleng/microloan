import { NextIntlClientProvider } from 'next-intl';
import { getMessages } from 'next-intl/server';
import { ROUTE_NAMESPACES, SHELL_NAMESPACES, pickMessages, type PublicRoute } from '@/i18n-namespaces';

/**
 * Server wrapper for a public route segment's layout: hands its client
 * components only the namespaces that segment uses (see src/i18n-namespaces.ts),
 * instead of the whole catalogue.
 */
export async function RouteMessages({ route, children }: { route: PublicRoute; children: React.ReactNode }) {
    const messages = await getMessages();
    return (
        <NextIntlClientProvider messages={pickMessages(messages, [...SHELL_NAMESPACES, ...ROUTE_NAMESPACES[route]])}>
            {children}
        </NextIntlClientProvider>
    );
}
