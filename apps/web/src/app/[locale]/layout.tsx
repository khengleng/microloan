import { NextIntlClientProvider } from 'next-intl';
import { getMessages } from 'next-intl/server';
import '../globals.css';
import { ToastProvider } from '@/components/ui/toast';
import { ConfirmProvider } from '@/components/ui/confirm-dialog';


export default async function LocaleLayout({
    children,
    params
}: {
    children: React.ReactNode;
    params: Promise<{ locale: string }>;
}) {
    const { locale } = await params;
    const messages = await getMessages();

    return (
        <html lang={locale}>
            <body className="font-sans antialiased bg-background text-foreground" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>
                <NextIntlClientProvider messages={messages}>
                    <ConfirmProvider>
                        <ToastProvider>
                            {children}
                        </ToastProvider>
                    </ConfirmProvider>
                </NextIntlClientProvider>
            </body>
        </html>
    );
}
