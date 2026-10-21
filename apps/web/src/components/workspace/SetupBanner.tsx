"use client";

import { useState } from 'react';
import Link from 'next/link';
import { useParams, usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { ListChecks, X } from 'lucide-react';
import { useWorkspace } from '@/lib/workspace';
import { useApi } from '@/components/lending/useAsync';

const DISMISS_KEY = 'goLiveSetupBannerDismissed';

function readDismissed(): boolean {
    try { return typeof window !== 'undefined' && sessionStorage.getItem(DISMISS_KEY) === '1'; } catch { return false; }
}

/**
 * First-run banner for tenant administrators (D-171): until the go-live
 * setup checklist is complete, every page says how far it is and links to
 * it. Hidden on the checklist itself; "Later" hides it for this browser
 * session only.
 */
export function SetupBanner() {
    const t = useTranslations('GoLiveSetup.banner');
    const { locale } = useParams();
    const pathname = usePathname() || '';
    const { can, isPlatform } = useWorkspace();
    const show = !isPlatform && can('tenant_setup.manage');
    // Read once; nothing renders before the status arrives, so server and browser agree.
    const [dismissed, setDismissed] = useState(readDismissed);
    const onSetup = pathname.endsWith('/lending/setup');
    const { data } = useApi<{ progress: { percent: number; complete: boolean; done: number; total: number } }>(show && !dismissed && !onSetup ? '/lending/setup/status' : null);
    if (!show || dismissed || onSetup || !data || data.progress.complete) return null;
    const p = data.progress;
    return (
        <div data-testid="setup-banner" className="flex items-start gap-2 px-5 py-2 text-[13px] bg-[#F0F5FF] text-[#3A4161] border-b border-[#C9D7FF]" role="status">
            <ListChecks size={15} className="mt-0.5 flex-shrink-0" />
            <p className="flex-1">
                <b>{t('title')}</b> {t('body', { percent: p.percent, done: p.done, total: p.total })}{' '}
                <Link href={`/${locale}/lending/setup`} className="font-bold underline">{t('open')}</Link>
            </p>
            <button
                type="button"
                onClick={() => { try { sessionStorage.setItem(DISMISS_KEY, '1'); } catch { /* private mode: hide for this page only */ } setDismissed(true); }}
                className="inline-flex items-center gap-1 text-[12px] font-semibold hover:underline"
            >
                <X size={13} /> {t('later')}
            </button>
        </div>
    );
}
