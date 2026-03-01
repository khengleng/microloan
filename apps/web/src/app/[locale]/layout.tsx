import { NextIntlClientProvider } from 'next-intl';
import { getMessages } from 'next-intl/server';
import { Noto_Sans_Khmer } from 'next/font/google';
import '../globals.css';
import { ToastProvider } from '@/components/ui/toast';

const notoSansKhmer = Noto_Sans_Khmer({ subsets: ['khmer', 'latin'], weight: ['400', '500', '700'] });

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
            <body className={notoSansKhmer.className}>
                <NextIntlClientProvider messages={messages}>
                    <ToastProvider>
                        {children}
                    </ToastProvider>
                </NextIntlClientProvider>
            </body>
        </html>
    );
}
