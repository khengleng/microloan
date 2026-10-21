"use client";

import { useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { ArrowRight, CheckCircle2, CircleDashed, CircleSlash, HelpCircle, Info, Lock, RefreshCw } from 'lucide-react';
import api from '@/lib/api';
import { useWorkspace } from '@/lib/workspace';
import { useToast } from '@/components/ui/toast';
import { Btn, Card, ErrorBox, Spinner, TextInput } from '../ui';
import { useAction, useApi } from '../useAsync';
import { fmtDateTime } from '../format';
import { SetupImports } from './SetupImports';

export type SetupItemStatus = 'DONE' | 'TODO' | 'BLOCKED' | 'NOT_APPLICABLE' | 'NOT_CHECKED' | 'INFO';

export interface SetupItem {
    key: string;
    section: string;
    href: string;
    waivable: boolean;
    status: SetupItemStatus;
    reasons: { code: string; message: string; params?: Record<string, string | number> }[];
    facts: Record<string, unknown>;
    waiver: { reason: string; markedBy: string; markedAt: string } | null;
}

export interface SetupProgress { total: number; done: number; todo: number; blocked: number; percent: number; complete: boolean }

export interface SetupStatusResponse { items: SetupItem[]; progress: SetupProgress; generatedAt: string }

const SECTIONS = ['organisation', 'people', 'operations', 'accounting', 'products', 'compliance', 'channels', 'training'];

const STATUS_STYLE: Record<SetupItemStatus, { cls: string; Icon: typeof CheckCircle2 }> = {
    DONE: { cls: 'bg-emerald-50 text-emerald-800 border-emerald-200', Icon: CheckCircle2 },
    TODO: { cls: 'bg-amber-50 text-amber-900 border-amber-200', Icon: CircleDashed },
    BLOCKED: { cls: 'bg-rose-50 text-rose-800 border-rose-200', Icon: Lock },
    NOT_APPLICABLE: { cls: 'bg-slate-50 text-slate-600 border-slate-200', Icon: CircleSlash },
    NOT_CHECKED: { cls: 'bg-slate-50 text-slate-600 border-slate-200', Icon: HelpCircle },
    INFO: { cls: 'bg-[#F0F5FF] text-[#3A4161] border-[#C9D7FF]', Icon: Info },
};

/** The translated text of a reason, by its code; the API's English text when the code is new. */
export function useReasonText() {
    const t = useTranslations('GoLiveSetup.reasons');
    return (r: SetupItem['reasons'][number]) => (t.has(r.code) ? t(r.code, r.params ?? {}) : r.message);
}

/**
 * The go-live setup checklist (D-171…D-175): what a new lender still has to
 * configure before its first loan, computed by the API from what is really
 * set up. Each item links to the screen where it is done.
 */
export function GoLiveSetupView() {
    const t = useTranslations('GoLiveSetup');
    const { can } = useWorkspace();
    const { data, error, loading, reload } = useApi<SetupStatusResponse>('/lending/setup/status');
    if (!data) return error ? <ErrorBox error={error} /> : <Spinner />;
    const p = data.progress;
    const bySection = SECTIONS.map((s) => ({ section: s, items: data.items.filter((i) => i.section === s) })).filter((s) => s.items.length);
    return (
        <div className="space-y-5">
            <Card
                title={p.complete ? t('progress.completeTitle') : t('progress.title')}
                subtitle={t('progress.subtitle')}
                actions={<Btn size="sm" onClick={reload} busy={loading}><RefreshCw size={13} /> {t('refresh')}</Btn>}
            >
                <div data-testid="setup-progress" className="space-y-2">
                    <div className="flex items-baseline justify-between gap-3">
                        <span className="text-[28px] font-extrabold tabular-nums text-[#1A1F36]">{p.percent}%</span>
                        <span className="text-[13px] text-[#697386]">{t('progress.counts', { done: p.done, total: p.total, todo: p.todo, blocked: p.blocked })}</span>
                    </div>
                    <div className="h-2 rounded-full bg-slate-100 overflow-hidden" role="progressbar" aria-valuenow={p.percent} aria-valuemin={0} aria-valuemax={100} aria-label={t('progress.title')}>
                        <div className={`h-full ${p.complete ? 'bg-emerald-500' : 'bg-[#635BFF]'}`} style={{ width: `${p.percent}%` }} />
                    </div>
                    <p className="text-[12px] text-[#697386]">{t('progress.asOf', { at: fmtDateTime(data.generatedAt) })}</p>
                </div>
            </Card>

            {bySection.map(({ section, items }) => (
                <Card key={section} title={t(`sections.${section}`)} bodyClass="p-0">
                    <ul>
                        {items.map((i) => <SetupItemRow key={i.key} item={i} canManage={can('tenant_setup.manage')} onChanged={reload} />)}
                    </ul>
                </Card>
            ))}

            <SetupImports onDone={reload} />
        </div>
    );
}

function SetupItemRow({ item, canManage, onChanged }: { item: SetupItem; canManage: boolean; onChanged: () => void }) {
    const t = useTranslations('GoLiveSetup');
    const reasonText = useReasonText();
    const { locale } = useParams();
    const { showToast } = useToast();
    const { busy, error, run, clearError } = useAction();
    const [marking, setMarking] = useState(false);
    const [reason, setReason] = useState('');
    const { cls, Icon } = STATUS_STYLE[item.status];

    const mark = async () => {
        const r = await run('mark', () => api.put(`/lending/setup/items/${item.key}/not-applicable`, { reason: reason.trim() }));
        if (r) { showToast(t('markedToast'), 'success'); setMarking(false); setReason(''); onChanged(); }
    };
    const clear = async () => {
        const r = await run('clear', () => api.delete(`/lending/setup/items/${item.key}/not-applicable`));
        if (r) { showToast(t('clearedToast'), 'success'); onChanged(); }
    };
    const facts = item.facts as { timeZone?: string; schedule?: string; businessDate?: string | null };

    return (
        <li data-testid={`setup-item-${item.key}`} data-status={item.status} className="px-5 py-3.5 border-b border-[#E3E8EE] last:border-0">
            <div className="flex flex-wrap items-start gap-3">
                <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded border text-[11px] font-bold whitespace-nowrap ${cls}`}>
                    <Icon size={12} aria-hidden /> {t(`status.${item.status}`)}
                </span>
                <div className="min-w-0 flex-1">
                    <p className="text-[14px] font-semibold text-[#1A1F36]">{t(`items.${item.key}.title`)}</p>
                    <p className="text-[12.5px] text-[#697386]">{t(`items.${item.key}.help`)}</p>
                    {item.reasons.length > 0 && (
                        <ul className="mt-1.5 space-y-0.5">
                            {item.reasons.map((r, n) => <li key={n} className="text-[12.5px] text-[#3C4257]">• {reasonText(r)}</li>)}
                        </ul>
                    )}
                    {item.key === 'business_date' && facts.timeZone && (
                        <p className="mt-1 text-[12px] text-[#697386]">{t('eodFacts', { timeZone: facts.timeZone, schedule: facts.schedule ?? '' })}</p>
                    )}
                    {item.waiver && (
                        <p className="mt-1 text-[12px] text-slate-600">{t('waiver', { reason: item.waiver.reason, at: fmtDateTime(item.waiver.markedAt) })}</p>
                    )}
                    {marking && (
                        <div className="mt-2 flex flex-wrap items-center gap-2">
                            <div className="min-w-[240px] flex-1">
                                <TextInput value={reason} onChange={setReason} placeholder={t('reasonPlaceholder')} aria-label={t('reasonLabel')} maxLength={500} />
                            </div>
                            <Btn size="sm" variant="primary" busy={busy === 'mark'} disabled={reason.trim().length < 5} onClick={mark}>{t('save')}</Btn>
                            <Btn size="sm" onClick={() => { setMarking(false); clearError(); }}>{t('cancel')}</Btn>
                        </div>
                    )}
                    {error && <div className="mt-2"><ErrorBox error={error} onDismiss={clearError} /></div>}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                    {item.waivable && canManage && item.status === 'NOT_APPLICABLE' && (
                        <Btn size="sm" busy={busy === 'clear'} onClick={clear}>{t('clear')}</Btn>
                    )}
                    {item.waivable && canManage && !marking && !['DONE', 'NOT_APPLICABLE'].includes(item.status) && (
                        <Btn size="sm" onClick={() => setMarking(true)}>{t('markNotApplicable')}</Btn>
                    )}
                    <Link href={`/${locale}${item.href}`} className="inline-flex items-center gap-1 px-2.5 py-1 rounded border border-[#E3E8EE] text-[12.5px] font-semibold text-[#635BFF] hover:bg-[#F0F5FF]">
                        {t('open')} <ArrowRight size={12} />
                    </Link>
                </div>
            </div>
        </li>
    );
}
