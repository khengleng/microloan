import { NextIntlClientProvider } from 'next-intl';
import { getLocale, getMessages } from 'next-intl/server';
import { Kantumruy_Pro } from 'next/font/google';
import { ToastProvider } from '@/components/ui/toast';
import { ConfirmProvider } from '@/components/ui/confirm-dialog';
import { ClarityProvider } from '@/components/ClarityProvider';
import { SHELL_NAMESPACES, pickMessages } from '@/i18n-namespaces';

/*
 * Khmer web font. Self-hosted by next/font (no request to Google at runtime,
 * so the CSP's font-src 'self' holds). Kantumruy Pro rather than Noto Sans
 * Khmer: it was drawn for screen UI (open counters, clear subscripts at small
 * sizes) and ships as one variable file (weights 100–700, ~57 KB for the
 * Khmer subset), so every weight the UI uses costs a single download.
 * `preload: false`: the @font-face carries a Khmer unicode-range, so
 * the browser downloads it only when a page renders Khmer — English pages
 * never fetch it. Latin text keeps the existing Arial stack (globals.css puts
 * Arial first under :lang(km); Arial has no Khmer glyphs, so those fall through
 * to this font).
 */
const khmer = Kantumruy_Pro({
    subsets: ['khmer'],
    weight: 'variable',
    display: 'swap',
    preload: false,
    variable: '--font-khmer',
    fallback: ['Khmer UI', 'Khmer Sangam MN', 'Noto Sans Khmer', 'Leelawadee UI', 'sans-serif'],
});

export default async function LocaleLayout({
    children,
}: {
    children: React.ReactNode;
    params: Promise<{ locale: string }>;
}) {
    // The supported locale src/i18n.ts resolved (unknown segments fall back to
    // 'en'), so <html lang> never echoes an arbitrary path segment.
    const locale = await getLocale();
    // Only what the shell's providers and the landing page read; each route
    // segment below adds its own namespaces (src/i18n-namespaces.ts), so the
    // whole catalogue is not serialised into every page.
    const messages = pickMessages(await getMessages(), SHELL_NAMESPACES);

    return (
        <html lang={locale} className={khmer.variable}>
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
