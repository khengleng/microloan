"use client";

import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useParams, usePathname, useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { X } from 'lucide-react';
import { learning } from '@microloan/shared';
import { useLearning } from '@/lib/learning';

/**
 * Guided tours (D-090): a compact engine over the portal's own screens.
 *
 * A step highlights the element carrying its `data-tour` id with a spotlight
 * that glides from one target to the next, and shows a popover with Back /
 * Next / Skip (arrow keys, Enter and Esc work too). A "click" step waits for
 * the person to click the highlighted element; the tour then follows into
 * the dialog or page that opens. A target that never appears — hidden by
 * permissions, renamed, or an empty list — is skipped. Animations stop when
 * the system asks for reduced motion. The tour lives in the app shell, so it
 * survives client-side navigation; nothing is kept outside React state.
 */

interface ActiveTour {
    tour: learning.TourDefinition;
    index: number;
    /** +1 moving forward, -1 moving back: the way to skip a missing step. */
    direction: 1 | -1;
    /** The previous step navigated or opened something: wait longer for the target. */
    patient: boolean;
}

interface TourValue {
    start: (tourId: string, opts?: { navigate?: boolean }) => void;
    stop: () => void;
    activeTourId: string | null;
}

const TourContext = createContext<TourValue>({ start: () => undefined, stop: () => undefined, activeTourId: null });
export const useTour = () => useContext(TourContext);

const PATIENT_MS = 5000;
const QUICK_MS = 1500;
const POLL_MS = 120;
const GAP = 10;
const PAD = 6;

function usePrefersReducedMotion(): boolean {
    const [reduced, setReduced] = useState(false);
    useEffect(() => {
        const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
        const update = () => setReduced(mq.matches);
        update();
        mq.addEventListener('change', update);
        return () => mq.removeEventListener('change', update);
    }, []);
    return reduced;
}

/** The first element with this id that is actually on screen (not hidden, not slid off-canvas). */
function findTarget(id: string): HTMLElement | null {
    const all = document.querySelectorAll<HTMLElement>(`[data-tour="${CSS.escape(id)}"]`);
    for (const el of all) {
        const r = el.getBoundingClientRect();
        if (r.width <= 0 || r.height <= 0) continue;
        if (r.right <= 0 || r.left >= window.innerWidth) continue;
        const style = window.getComputedStyle(el);
        if (style.visibility === 'hidden' || style.display === 'none') continue;
        return el;
    }
    return null;
}

interface Box { top: number; left: number; width: number; height: number }
const sameBox = (a: Box | null, b: Box | null) =>
    !!a && !!b && Math.abs(a.top - b.top) < 0.5 && Math.abs(a.left - b.left) < 0.5 && Math.abs(a.width - b.width) < 0.5 && Math.abs(a.height - b.height) < 0.5;

export function TourProvider({ children }: { children: React.ReactNode }) {
    const router = useRouter();
    const { locale } = useParams<{ locale: string }>();
    const pathname = usePathname() || '';
    const { record } = useLearning();
    const [active, setActive] = useState<ActiveTour | null>(null);

    const stop = useCallback(() => setActive(null), []);

    const start = useCallback((tourId: string, opts: { navigate?: boolean } = {}) => {
        const tour = learning.TOUR_BY_ID[tourId];
        if (!tour) return;
        const base = `/${locale ?? 'en'}`;
        const here = pathname.slice(base.length) || '/';
        if (opts.navigate !== false && !learning.tourMatchesPath(tour, here) && here !== tour.startPath) router.push(`${base}${tour.startPath}`);
        setActive({ tour, index: 0, direction: 1, patient: true });
    }, [locale, pathname, router]);

    const finish = useCallback((tour: learning.TourDefinition) => {
        setActive(null);
        for (const lesson of learning.lessonsForTour(tour.id)) void record(lesson.id, { event: 'TOUR_COMPLETED' }).catch(() => undefined);
    }, [record]);

    const value = useMemo(() => ({ start, stop, activeTourId: active?.tour.id ?? null }), [start, stop, active?.tour.id]);
    return (
        <TourContext.Provider value={value}>
            {children}
            {active && <TourOverlay key={active.tour.id} active={active} setActive={setActive} onFinish={finish} onClose={stop} />}
        </TourContext.Provider>
    );
}

function TourOverlay({ active, setActive, onFinish, onClose }: {
    active: ActiveTour;
    setActive: React.Dispatch<React.SetStateAction<ActiveTour | null>>;
    onFinish: (tour: learning.TourDefinition) => void;
    onClose: () => void;
}) {
    const t = useTranslations('Learning.tour');
    const reduced = usePrefersReducedMotion();
    const { tour, index, direction, patient } = active;
    const step = tour.steps[index];
    const last = index === tour.steps.length - 1;
    const [box, setBox] = useState<Box | null>(null);
    const [searching, setSearching] = useState(!!step.target);
    const [viewport, setViewport] = useState({ w: 0, h: 0 });
    const popRef = useRef<HTMLDivElement>(null);
    const [popSize, setPopSize] = useState({ w: 340, h: 180 });

    const go = useCallback((delta: 1 | -1, opts: { patient?: boolean } = {}) => {
        setActive((a) => {
            if (!a) return a;
            const next = a.index + delta;
            if (next >= a.tour.steps.length) { queueMicrotask(() => onFinish(a.tour)); return a; }
            // Nothing earlier to show (the first steps are missing): go forward again.
            if (next < 0) return a.index + 1 < a.tour.steps.length ? { ...a, index: a.index + 1, direction: 1, patient: false } : a;
            return { ...a, index: next, direction: delta, patient: !!opts.patient };
        });
    }, [setActive, onFinish]);

    // Find the target, waiting for it to appear; skip the step if it never does.
    useEffect(() => {
        setBox(null);
        if (!step.target) { setSearching(false); return; }
        setSearching(true);
        const id = step.target;
        // Poll a fixed number of times rather than against the clock.
        let attemptsLeft = Math.ceil((patient ? PATIENT_MS : QUICK_MS) / POLL_MS);
        let timer: ReturnType<typeof setTimeout> | undefined;
        const look = () => {
            const el = findTarget(id);
            if (el) {
                const r = el.getBoundingClientRect();
                if (r.top < 0 || r.bottom > window.innerHeight) el.scrollIntoView({ block: 'center', inline: 'nearest', behavior: reduced ? 'auto' : 'smooth' });
                setSearching(false);
                return;
            }
            if (--attemptsLeft <= 0) { go(direction); return; }
            timer = setTimeout(look, POLL_MS);
        };
        look();
        return () => { if (timer) clearTimeout(timer); };
        // eslint-disable-next-line react-hooks/exhaustive-deps -- re-run per step only
    }, [tour.id, index]);

    // Follow the target as the page scrolls, resizes or re-renders.
    useEffect(() => {
        if (!step.target || searching) return;
        const id = step.target;
        let raf = 0;
        let missing = 0;
        const measure = () => {
            const el = findTarget(id);
            setViewport((v) => (v.w === window.innerWidth && v.h === window.innerHeight ? v : { w: window.innerWidth, h: window.innerHeight }));
            if (el) {
                missing = 0;
                const r = el.getBoundingClientRect();
                const next = { top: r.top - PAD, left: r.left - PAD, width: r.width + PAD * 2, height: r.height + PAD * 2 };
                setBox((b) => (sameBox(b, next) ? b : next));
            } else if (++missing > 90) {
                // Gone for ~1.5 s (the page changed): move on rather than point at nothing.
                go(direction === -1 ? -1 : 1, { patient: true });
                return;
            }
            raf = requestAnimationFrame(measure);
        };
        raf = requestAnimationFrame(measure);
        return () => cancelAnimationFrame(raf);
    }, [step.target, searching, go, direction]);

    useEffect(() => {
        if (step.target) return;
        const update = () => setViewport({ w: window.innerWidth, h: window.innerHeight });
        update();
        window.addEventListener('resize', update);
        return () => window.removeEventListener('resize', update);
    }, [step.target]);

    // "Do it" steps: advance when the highlighted element is clicked.
    useEffect(() => {
        if (step.action !== 'click' || !step.target || searching) return;
        const sel = `[data-tour="${CSS.escape(step.target)}"]`;
        const onClick = (e: MouseEvent) => {
            const el = e.target instanceof Element ? e.target.closest(sel) : null;
            if (el) setTimeout(() => go(1, { patient: true }), 0);
        };
        document.addEventListener('click', onClick, true);
        return () => document.removeEventListener('click', onClick, true);
    }, [step.action, step.target, searching, go]);

    // Keyboard: arrows and Enter move, Esc ends — but never while typing in a field.
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            const el = document.activeElement;
            const typing = el instanceof HTMLElement && (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName)) && !popRef.current?.contains(el);
            if (e.key === 'Escape') { onClose(); return; }
            if (typing) return;
            if (e.key === 'ArrowRight' || (e.key === 'Enter' && popRef.current?.contains(el))) { e.preventDefault(); go(1); }
            else if (e.key === 'ArrowLeft') { e.preventDefault(); go(-1); }
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [go, onClose]);

    // Clicks on the popover must not count as "outside" for an open dialog
    // (which would close it) nor be pulled back by its focus trap.
    useEffect(() => {
        const el = popRef.current;
        if (!el) return;
        const stopIt = (e: Event) => e.stopPropagation();
        const events = ['pointerdown', 'mousedown', 'touchstart', 'focusin', 'focusout'];
        for (const ev of events) el.addEventListener(ev, stopIt);
        return () => { for (const ev of events) el.removeEventListener(ev, stopIt); };
    }, []);

    useLayoutEffect(() => {
        const el = popRef.current;
        if (!el) return;
        const r = el.getBoundingClientRect();
        setPopSize((s) => (Math.abs(s.w - r.width) < 1 && Math.abs(s.h - r.height) < 1 ? s : { w: r.width, h: r.height }));
    });

    if (typeof document === 'undefined') return null;

    const vw = viewport.w || (typeof window !== 'undefined' ? window.innerWidth : 1024);
    const vh = viewport.h || (typeof window !== 'undefined' ? window.innerHeight : 768);
    const narrow = vw < 640;
    const highlighted = !!step.target && !searching && !!box;
    const pop = popoverPosition(highlighted ? box : null, step.placement ?? 'auto', popSize, vw, vh, narrow);
    const transition = reduced ? 'none' : 'top 320ms cubic-bezier(.4,0,.2,1), left 320ms cubic-bezier(.4,0,.2,1), width 320ms cubic-bezier(.4,0,.2,1), height 320ms cubic-bezier(.4,0,.2,1), opacity 200ms';
    const spot: Box = highlighted ? box! : { top: vh / 2, left: vw / 2, width: 0, height: 0 };

    return createPortal(
        <div className="fixed inset-0 z-[1000] pointer-events-none" aria-live="polite">
            <div
                aria-hidden="true"
                className="fixed rounded-lg ring-2 ring-[#635BFF] ring-offset-2 ring-offset-transparent"
                style={{
                    top: spot.top, left: spot.left, width: spot.width, height: spot.height,
                    boxShadow: '0 0 0 9999px rgba(15, 23, 42, 0.55)',
                    transition,
                    opacity: highlighted || !step.target ? 1 : 0.6,
                }}
            />
            <div
                ref={popRef}
                role="dialog"
                aria-modal="false"
                aria-labelledby="tour-step-title"
                aria-describedby="tour-step-body"
                className="fixed pointer-events-auto bg-white rounded-lg shadow-2xl border border-[#E3E8EE] p-4 text-[#1A1F36]"
                style={{
                    top: pop.top, left: pop.left, width: pop.width,
                    transition: reduced ? 'none' : 'top 320ms cubic-bezier(.4,0,.2,1), left 320ms cubic-bezier(.4,0,.2,1)',
                }}
            >
                <div key={`${tour.id}-${index}`} className={reduced ? '' : 'animate-in fade-in slide-in-from-bottom-1 duration-300'}>
                    <div className="flex items-start justify-between gap-3">
                        <p className="text-[11px] font-bold uppercase tracking-wider text-[#635BFF]">
                            {tour.title} · {t('stepOf', { step: index + 1, total: tour.steps.length })}
                        </p>
                        <button type="button" onClick={onClose} aria-label={t('skip')} title={t('skip')} className="text-[#697386] hover:text-[#1A1F36] -mt-1 -mr-1 p-1 rounded">
                            <X size={15} />
                        </button>
                    </div>
                    <h2 id="tour-step-title" className="mt-1 text-[15px] font-bold">{step.title}</h2>
                    <p id="tour-step-body" className="mt-1 text-[13px] leading-relaxed text-[#3C4257]">{searching ? t('looking') : step.body}</p>
                    {step.action === 'click' && !searching && (
                        <p className="mt-2 text-[12px] font-semibold text-[#3F38D9] inline-flex items-center gap-1.5">
                            <span className={`inline-block w-2 h-2 rounded-full bg-[#635BFF] ${reduced ? '' : 'animate-pulse'}`} aria-hidden="true" />
                            {t('clickToContinue')}
                        </p>
                    )}
                    <div className="mt-3 h-1 rounded-full bg-[#E3E8EE] overflow-hidden" aria-hidden="true">
                        <div className="h-full bg-[#635BFF]" style={{ width: `${((index + 1) / tour.steps.length) * 100}%`, transition: reduced ? 'none' : 'width 300ms' }} />
                    </div>
                    <div className="mt-3 flex items-center justify-between gap-2">
                        <button type="button" onClick={onClose} className="text-[12px] font-semibold text-[#697386] hover:text-[#1A1F36]">{t('skip')}</button>
                        <div className="flex gap-2">
                            {index > 0 && (
                                <button type="button" onClick={() => go(-1)} className="px-3 py-1.5 text-[13px] font-semibold rounded border border-[#E3E8EE] bg-white hover:bg-slate-50">{t('back')}</button>
                            )}
                            <button
                                type="button"
                                autoFocus
                                onClick={() => (last ? onFinish(tour) : go(1))}
                                className="px-3 py-1.5 text-[13px] font-semibold rounded bg-[#635BFF] text-white hover:bg-[#5249e6]"
                            >
                                {last ? t('done') : step.action === 'click' ? t('skipStep') : t('next')}
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </div>,
        document.body,
    );
}

/** Where the popover goes: beside the target, inside the viewport; a bottom sheet on phones. */
function popoverPosition(target: Box | null, placement: NonNullable<learning.TourStep['placement']>, size: { w: number; h: number }, vw: number, vh: number, narrow: boolean) {
    const width = Math.min(360, vw - 32);
    if (narrow) {
        const h = size.h || 180;
        const below = target && target.top + target.height / 2 < vh / 2;
        return { width, left: 16, top: below ? vh - h - 16 : 16 };
    }
    if (!target) return { width, left: (vw - width) / 2, top: Math.max(16, (vh - (size.h || 180)) / 2) };
    const h = size.h || 180;
    const fits = {
        bottom: target.top + target.height + GAP + h <= vh - 8,
        top: target.top - GAP - h >= 8,
        right: target.left + target.width + GAP + width <= vw - 8,
        left: target.left - GAP - width >= 8,
    };
    const order: ('bottom' | 'top' | 'right' | 'left')[] = placement === 'auto'
        ? ['bottom', 'top', 'right', 'left']
        : [placement, 'bottom', 'top', 'right', 'left'];
    const side = order.find((s) => fits[s]) ?? 'bottom';
    const clampX = (x: number) => Math.min(Math.max(16, x), vw - width - 16);
    const clampY = (y: number) => Math.min(Math.max(16, y), vh - h - 16);
    switch (side) {
        case 'bottom': return { width, left: clampX(target.left), top: clampY(target.top + target.height + GAP) };
        case 'top': return { width, left: clampX(target.left), top: clampY(target.top - GAP - h) };
        case 'right': return { width, left: clampX(target.left + target.width + GAP), top: clampY(target.top) };
        default: return { width, left: clampX(target.left - GAP - width), top: clampY(target.top) };
    }
}
