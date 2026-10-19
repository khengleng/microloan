import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { HelpView } from '@/components/help/HelpView';
import { guidePage, guideTitle } from '@/components/help/guide-data';
import { resolveGuideSlug } from '@/lib/user-guide';

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
    const { slug } = await params;
    return { title: guideTitle(resolveGuideSlug(slug) ?? '') };
}

/**
 * One chapter of the user guide. A renamed chapter redirects to its new name;
 * an unknown one to the contents.
 */
export default async function HelpChapterPage({ params }: { params: Promise<{ locale: string; slug: string }> }) {
    const { locale, slug } = await params;
    const current = resolveGuideSlug(slug);
    if (!current) redirect(`/${locale}/help`);
    if (current !== slug) redirect(`/${locale}/help/${current}`);
    const page = guidePage(locale, current);
    if (!page) redirect(`/${locale}/help`);
    return <HelpView {...page} />;
}
