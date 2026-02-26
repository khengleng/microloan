import { getRequestConfig } from 'next-intl/server';
import { headers } from 'next/headers';

export default getRequestConfig(async () => {
    const headerList = await headers();
    const locale = headerList.get('X-Locale') || 'en';

    return {
        locale,
        messages: (await import(`../messages/${locale}.json`)).default
    };
});
