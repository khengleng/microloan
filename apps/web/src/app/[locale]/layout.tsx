import { NextIntlClientProvider } from 'next-intl';
import { getMessages } from 'next-intl/server';
import { Noto_Sans_Khmer, Urbanist } from 'next/font/google';
import '../globals.css';
import { ToastProvider } from '@/components/ui/toast';
import { ConfirmProvider } from '@/components/ui/confirm-dialog';

const notoSansKhmer = Noto_Sans_Khmer({ subsets: ['khmer', 'latin'], weight: ['400', '500', '700'], variable: '--font-khmer' });
const urbanist = Urbanist({ subsets: ['latin'], weight: ['400', '500', '600', '700', '800'], variable: '--font-urbanist' });

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
            <body className={`${urbanist.variable} ${notoSansKhmer.variable} font-sans antialiased bg-[#F8FAFC] text-slate-900`}>
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
