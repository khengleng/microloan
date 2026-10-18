import type { Metadata } from 'next';
import { HelpView } from '@/components/help/HelpView';
import { guidePage, guideTitle } from '@/components/help/guide-data';

export function generateMetadata(): Metadata {
    return { title: guideTitle('') };
}

/** The user guide's contents (docs/user-guide/README.md). Open to every signed-in user. */
export default async function HelpContentsPage({ params }: { params: Promise<{ locale: string }> }) {
    const { locale } = await params;
    const page = guidePage(locale, '');
    return page ? <HelpView {...page} /> : null;
}
