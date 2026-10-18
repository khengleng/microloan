"use client";

import { useEffect, useRef, useState } from 'react';
import { useParams, usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Compass } from 'lucide-react';
import { learning } from '@microloan/shared';
import { useTour } from './TourProvider';

/**
 * "Take the tour" for the page being shown, when a guided tour covers it.
 * With several tours for the page it opens a short list.
 */
export function TourButton({ compact = false }: { compact?: boolean }) {
    const t = useTranslations('Learning.tour');
    const { locale } = useParams<{ locale: string }>();
    const pathname = usePathname() || '';
    const { start, activeTourId } = useTour();
    const [open, setOpen] = useState(false);
    const ref = useRef<HTMLDivElement>(null);
    const path = pathname.slice(`/${locale ?? 'en'}`.length) || '/';
    const tours = learning.toursForPath(path);

    useEffect(() => {
        if (!open) return;
        const close = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
        const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
        document.addEventListener('mousedown', close);
        document.addEventListener('keydown', esc);
        return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', esc); };
    }, [open]);

    if (!tours.length || activeTourId) return null;
    const launch = (id: string) => { setOpen(false); start(id, { navigate: false }); };

    return (
        <div ref={ref} className="relative">
            <button
                type="button"
                data-tour="tour-button"
                onClick={() => (tours.length === 1 ? launch(tours[0].id) : setOpen((o) => !o))}
                aria-haspopup={tours.length > 1 ? 'menu' : undefined}
                aria-expanded={tours.length > 1 ? open : undefined}
                title={tours.length === 1 ? tours[0].title : t('takeTour')}
                className={`inline-flex items-center gap-1 rounded px-2 py-1 text-[12px] font-semibold text-[#635BFF] hover:bg-[#F0F5FF] ${compact ? '' : 'border border-[#E3E8EE] bg-white'}`}
            >
                <Compass size={13} aria-hidden="true" />
                <span className={compact ? 'hidden md:inline' : ''}>{t('takeTour')}</span>
            </button>
            {open && (
                <div role="menu" className="absolute right-0 mt-1 z-40 w-72 rounded-lg border border-[#E3E8EE] bg-white shadow-lg py-1">
                    {tours.map((tour) => (
                        <button
                            key={tour.id}
                            type="button"
                            role="menuitem"
                            onClick={() => launch(tour.id)}
                            className="block w-full text-left px-3 py-2 hover:bg-[#F6F8FA]"
                        >
                            <span className="block text-[13px] font-semibold text-[#1A1F36]">{tour.title}</span>
                            <span className="block text-[12px] text-[#697386]">{tour.summary}</span>
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
}
