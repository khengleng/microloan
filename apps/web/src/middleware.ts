import createMiddleware from 'next-intl/middleware';

export default createMiddleware({
    locales: ['en', 'km'],
    defaultLocale: 'en'
});

export const config = {
    // Match only internationalized pathnames
    matcher: ['/', '/(km|en)/:path*']
};
