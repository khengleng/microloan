import { NextIntlClientProvider } from 'next-intl';
import { getLocale, getMessages } from 'next-intl/server';
import { ToastProvider } from '@/components/ui/toast';
import { ConfirmProvider } from '@/components/ui/confirm-dialog';
import { ClarityProvider } from '@/components/ClarityProvider';


export default async function LocaleLayout({
    children,
}: {
    children: React.ReactNode;
    params: Promise<{ locale: string }>;
}) {
    // The supported locale src/i18n.ts resolved (unknown segments fall back to
    // 'en'), so <html lang> never echoes an arbitrary path segment.
    const locale = await getLocale();
    const messages = await getMessages();

    return (
        <html lang={locale}>
            <body className="antialiased bg-background text-foreground">
                <NextIntlClientProvider messages={messages}>
                    <ConfirmProvider>
                        <ToastProvider>
                            <ClarityProvider />
                            {children}
                        </ToastProvider>
                    </ConfirmProvider>
                </NextIntlClientProvider>
            </body>
        </html>
    );
}
