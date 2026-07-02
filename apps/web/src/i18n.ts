import { getRequestConfig } from 'next-intl/server';

const locales = ['en', 'km'] as const;
const defaultLocale = 'en';

export default getRequestConfig(async ({ requestLocale }) => {
    // next-intl provides the active locale from the `[locale]` route segment
    // (set by the middleware). The previous code read a non-existent `X-Locale`
    // header, so it always fell back to 'en' and the language never switched.
    const requested = await requestLocale;
    const locale =
        requested && (locales as readonly string[]).includes(requested)
            ? requested
            : defaultLocale;

    return {
        locale,
        messages: (await import(`../messages/${locale}.json`)).default,
    };
});
