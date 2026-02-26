import { redirect } from 'next/navigation';

export default async function LocaleIndexPage({ params }: { params: Promise<{ locale: string }> }) {
    const { locale } = await params;
    redirect(`/${locale}/login`);
}
