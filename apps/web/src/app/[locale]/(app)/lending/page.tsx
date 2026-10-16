import { redirect } from 'next/navigation';

export default async function LendingIndex({ params }: { params: Promise<{ locale: string }> }) {
    const { locale } = await params;
    redirect(`/${locale}/lending/catalogue`);
}
