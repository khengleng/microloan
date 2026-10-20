import { NextIntlClientProvider } from 'next-intl';
import { getMessages } from 'next-intl/server';
import { DashboardLayout } from './app-shell';

/**
 * The signed-in app reaches nearly every message namespace, so it gets the
 * whole catalogue here; the [locale] layout above sends only the few the
 * public pages share (src/i18n-namespaces.ts). The client shell (sidebar,
 * providers) lives in app-shell.tsx.
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
    const messages = await getMessages();
    return (
        <NextIntlClientProvider messages={messages}>
            <DashboardLayout>{children}</DashboardLayout>
        </NextIntlClientProvider>
    );
}
