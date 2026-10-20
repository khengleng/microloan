"use client";

import { useMemo, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import api from '@/lib/api';
import { useWorkspace } from '@/lib/workspace';
import { useToast } from '@/components/ui/toast';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { StatusBadge } from '../StatusBadge';
import { ImpairmentTab } from './ImpairmentTab';
import { LendingSettingsTab } from './LendingSettingsTab';
import { OperationalAlertsCard } from './OperationalAlertsCard';
import { ActionPanel, Btn, Card, Checkbox, Empty, ErrorBox, Field, KV, Notice, SelectInput, Spinner, Table, Tabs, TextInput, td, th } from '../ui';
import { qs, useAction, useApi } from '../useAsync';
import { fmtDateTime, fmtRate, percentToFraction } from '../format';
import type { BatchResult, BusinessDate, CalendarHoliday, HolidayCalendar, IntegrationsStatus, RateObservation } from './types';
import { addDaysIso } from '../useBusinessDate';

type Tab = 'date' | 'rates' | 'calendars' | 'impairment' | 'settings' | 'integrations';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const CODE_RE = /^[A-Z0-9_]{2,20}$/;
const SIGNED_DEC_RE = /^-?\d+(\.\d+)?$/;
const ISO_DAYS: { n: number; label: string }[] = [
    { n: 1, label: 'mon' }, { n: 2, label: 'tue' }, { n: 3, label: 'wed' }, { n: 4, label: 'thu' },
    { n: 5, label: 'fri' }, { n: 6, label: 'sat' }, { n: 7, label: 'sun' },
];
/** The API refuses a step of more than this many days (BusinessDateService.advance). */
const MAX_ADVANCE_DAYS = 31;

/* ── Business date & end of day ──────────────────────────────────────────── */

function BusinessDateTab() {
    const t = useTranslations('LendingOps');
    const { can } = useWorkspace();
    const { showToast } = useToast();
    const confirm = useConfirm();
    const bd = useApi<BusinessDate>('/lending/ops/business-date');
    const [next, setNext] = useState('');
    const [runAfter, setRunAfter] = useState(true);
    const [note, setNote] = useState<string | null>(null);
    const [result, setResult] = useState<BatchResult | null>(null);
    const { busy, error, run, clearError } = useAction();
    const current = bd.data?.businessDate;
    // The business date only ever moves forward, at most MAX_ADVANCE_DAYS at a time.
    const minNext = current ? addDaysIso(current, 1) : undefined;
    const maxNext = current ? addDaysIso(current, MAX_ADVANCE_DAYS) : undefined;
    const nextErr = next && DATE_RE.test(next) && minNext && maxNext
        ? (next < minNext ? t('date.notForward', { current: current ?? '' }) : next > maxNext ? t('date.tooFar', { days: MAX_ADVANCE_DAYS }) : undefined)
        : undefined;
    const canAdvance = can('business_date.manage');
    const canBatch = can('servicing.batch.run');

    const runBatch = async () => {
        const res = await run('batch', () => api.post<BatchResult>('/lending/loans/batch/run', {}));
        if (res) {
            setResult(res.data);
            setNote(null);
            const failed = Array.isArray(res.data.failed) ? res.data.failed.length : 0;
            showToast(t('date.batchToast', { date: res.data.businessDate, processed: res.data.processed, failed }), failed ? 'error' : 'success');
        }
    };

    const advance = async () => {
        if (!DATE_RE.test(next) || nextErr) return;
        const ok = await confirm({
            title: t('date.confirmTitle'),
            message: `${t('date.confirmBody', { from: current ?? '—', to: next })}${runAfter && canBatch ? ` ${t('date.confirmBatchAfter')}` : ''}`,
            confirmLabel: runAfter && canBatch ? t('date.advanceAndRun') : t('date.advance'),
            variant: 'warning',
        });
        if (!ok) return;
        const res = await run('date', () => api.post<BusinessDate>('/lending/ops/business-date', { businessDate: next }));
        if (!res) return;
        showToast(t('date.nowToast', { date: res.data.businessDate }), 'success');
        setNext('');
        setResult(null);
        setNote(res.data.note ?? null);
        bd.reload();
        if (runAfter && canBatch) await runBatch();
    };

    const confirmBatch = async () => {
        const ok = await confirm({
            title: t('date.batchTitle'),
            message: t('date.batchBody', { date: current ?? '—' }),
            confirmLabel: t('date.runBatch'),
        });
        if (ok) await runBatch();
    };

    const failed = result && Array.isArray(result.failed) ? result.failed : [];

    return (
        <div className="space-y-5">
            <Card title={t('date.title')} subtitle={t('date.subtitle')}>
                <div className="flex flex-wrap items-end gap-5">
                    <div data-tour="eod-current-date">
                        <p className="text-[11px] font-bold uppercase tracking-wide text-[#8792A2]">{t('date.current')}</p>
                        <p className="text-2xl font-bold text-[#1A1F36] tabular-nums">{bd.loading && !bd.data ? '…' : current ?? '—'}</p>
                    </div>
                    {canAdvance && (
                        <>
                            <Field label={t('date.advanceTo')} error={nextErr} hint={minNext && maxNext ? t('date.window', { from: minNext, to: maxNext }) : undefined}>
                                <TextInput data-tour="eod-advance-to" type="date" value={next} onChange={setNext} min={minNext} max={maxNext} className="w-44" />
                            </Field>
                            {canBatch && <div data-tour="eod-run-after" className="pb-1.5"><Checkbox checked={runAfter} onChange={setRunAfter} label={t('date.runAfter')} /></div>}
                            <Btn data-tour="eod-advance" variant="primary" onClick={advance} busy={busy === 'date'} disabled={!DATE_RE.test(next) || !!nextErr || !!busy} reason={!next ? t('date.pickFirst') : undefined}>{t('date.advance')}</Btn>
                        </>
                    )}
                    {canBatch && <Btn data-tour="eod-run-batch" onClick={confirmBatch} busy={busy === 'batch'} disabled={!!busy}>{t('date.runBatchLong')}</Btn>}
                    {!canAdvance && !canBatch && <p className="text-[12px] text-[#697386] pb-1.5">{t('date.readOnly')}</p>}
                </div>
                <div className="mt-3 space-y-2">
                    <ErrorBox error={bd.error} />
                    <ErrorBox error={error} onDismiss={clearError} />
                    {note && <Notice tone="warn" title={t('date.notRunYet')}>{t('date.notRunYetBody')}</Notice>}
                </div>
            </Card>

            {result && (
                <Card title={t('date.resultTitle')} subtitle={t('date.resultSubtitle', { date: result.businessDate })}>
                    <div data-tour="eod-result" className="space-y-4">
                        <KV cols={3} items={[
                            [t('date.businessDate'), <span key="d" className="tabular-nums">{result.businessDate}</span>],
                            [t('date.processed'), <span key="p" className="tabular-nums font-bold text-emerald-700">{result.processed}</span>],
                            [t('date.failed'), <span key="f" className={`tabular-nums font-bold ${failed.length ? 'text-red-600' : 'text-[#AAB7C4]'}`}>{failed.length}</span>],
                        ]} />
                        {failed.length > 0 ? (
                            <Table>
                                <thead>
                                    <tr className="border-b border-[#E3E8EE] bg-[#F7FAFC]"><th className={th}>{t('date.loan')}</th><th className={th}>{t('date.error')}</th></tr>
                                </thead>
                                <tbody className="divide-y divide-[#F0F2F5]">
                                    {failed.map((f) => (
                                        <tr key={f.id}>
                                            <td className={`${td} font-mono text-[12px] whitespace-nowrap`}>{f.id}</td>
                                            <td className={`${td} text-red-700`}>{f.error}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </Table>
                        ) : (
                            <Notice tone="success">{t('date.allProcessed')}</Notice>
                        )}
                    </div>
                </Card>
            )}
        </div>
    );
}

/* ── Benchmark rates ─────────────────────────────────────────────────────── */

function AddRateForm({ initialCode, onDone, onClose }: { initialCode: string; onDone: () => void; onClose: () => void }) {
    const t = useTranslations('LendingOps');
    const { showToast } = useToast();
    const { busy, error, run, clearError } = useAction();
    const [benchmarkCode, setCode] = useState(initialCode);
    const [observationDate, setDate] = useState('');
    const [ratePct, setRatePct] = useState('');
    const [source, setSource] = useState('');

    const codeErr = benchmarkCode && !CODE_RE.test(benchmarkCode) ? t('codeRule') : undefined;
    const rateErr = ratePct && !SIGNED_DEC_RE.test(ratePct.trim()) ? t('rates.rateRule') : undefined;
    const fraction = ratePct && !rateErr ? percentToFraction(ratePct) : '';
    const ok = CODE_RE.test(benchmarkCode) && DATE_RE.test(observationDate) && !!fraction && source.trim().length >= 2;

    const submit = async () => {
        if (!ok) return;
        const body = { benchmarkCode, observationDate, rate: fraction, source: source.trim() };
        const res = await run('rate', () => api.post('/lending/ops/rates', body));
        if (res) {
            showToast(t('rates.recordedToast', { code: benchmarkCode, rate: fmtRate(fraction), date: observationDate }), 'success');
            setDate('');
            setRatePct('');
            onDone();
        }
    };

    return (
        <ActionPanel title={t('rates.recordTitle')} onClose={onClose}>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                <Field label={t('rates.code')} error={codeErr} hint={t('rates.codeHint')}>
                    <TextInput value={benchmarkCode} onChange={(v) => setCode(v.toUpperCase())} maxLength={20} className="font-mono" />
                </Field>
                <Field label={t('rates.observationDate')}>
                    <TextInput type="date" value={observationDate} onChange={setDate} />
                </Field>
                <Field label={t('rates.ratePct')} error={rateErr} hint={fraction ? t('rates.sentAs', { value: fraction }) : t('rates.rateHint')}>
                    <TextInput value={ratePct} onChange={setRatePct} inputMode="decimal" />
                </Field>
                <Field label={t('rates.source')} hint={t('rates.sourceHint')}>
                    <TextInput value={source} onChange={setSource} maxLength={120} />
                </Field>
            </div>
            <p className="text-[11px] text-[#697386]">{t('rates.historyNote')}</p>
            <ErrorBox error={error} onDismiss={clearError} />
            <Btn variant="primary" onClick={submit} busy={busy === 'rate'} disabled={!ok}>{t('rates.record')}</Btn>
        </ActionPanel>
    );
}

function RatesTab() {
    const t = useTranslations('LendingOps');
    const { can } = useWorkspace();
    const [code, setCode] = useState('');
    const [adding, setAdding] = useState(false);
    const all = useApi<RateObservation[]>('/lending/ops/rates');
    const { data, error, loading, reload } = useApi<RateObservation[]>(`/lending/ops/rates${qs({ benchmarkCode: code })}`);
    const codes = useMemo(() => Array.from(new Set((all.data ?? []).map((r) => r.benchmarkCode))).sort(), [all.data]);
    const grouped = useMemo(() => {
        const m = new Map<string, RateObservation[]>();
        for (const r of data ?? []) m.set(r.benchmarkCode, [...(m.get(r.benchmarkCode) ?? []), r]);
        return Array.from(m.entries()).sort(([a], [b]) => a.localeCompare(b));
    }, [data]);

    return (
        <div className="space-y-5">
            {adding && <AddRateForm initialCode={code} onClose={() => setAdding(false)} onDone={() => { reload(); all.reload(); }} />}
            <Card
                title={t('rates.title')}
                subtitle={t('rates.subtitle')}
                actions={
                    <>
                        <div className="w-44"><SelectInput value={code} onChange={setCode} placeholder={t('rates.all')} options={codes} /></div>
                        {!adding && can('rate_observation.manage') && <Btn variant="primary" onClick={() => setAdding(true)}><Plus size={14} /> {t('rates.add')}</Btn>}
                    </>
                }
                bodyClass="p-0"
            >
                {loading && !data ? <Spinner /> : error ? <div className="p-4"><ErrorBox error={error} /></div> : !grouped.length ? <Empty>{t('rates.none')}</Empty> : (
                    <div className="divide-y divide-[#E3E8EE]">
                        {grouped.map(([bm, rows]) => (
                            <div key={bm}>
                                <div className="flex items-center justify-between px-5 py-2.5 bg-[#F7FAFC]">
                                    <p className="font-mono text-[13px] font-bold text-[#1A1F36]">{bm}</p>
                                    <p className="text-[12px] text-[#697386]">{t.rich('rates.latest', { rate: fmtRate(rows[0].rate), date: rows[0].observationDate, count: rows.length, b: (c) => <b className="tabular-nums text-[#1A1F36]">{c}</b> })}</p>
                                </div>
                                <Table>
                                    <thead>
                                        <tr className="border-b border-[#E3E8EE]">
                                            <th className={th}>{t('rates.effectiveDate')}</th><th className={`${th} text-right`}>{t('rates.rate')}</th><th className={th}>{t('rates.fraction')}</th>
                                            <th className={th}>{t('rates.source')}</th><th className={th}>{t('rates.recorded')}</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-[#F0F2F5]">
                                        {rows.map((r) => (
                                            <tr key={r.id}>
                                                <td className={`${td} tabular-nums whitespace-nowrap`}>{r.observationDate}</td>
                                                <td className={`${td} text-right tabular-nums font-semibold`}>{fmtRate(r.rate)}</td>
                                                <td className={`${td} font-mono text-[12px] text-[#697386]`}>{r.rate}</td>
                                                <td className={`${td} text-[12px]`}>{r.source}</td>
                                                <td className={`${td} text-[12px] whitespace-nowrap`}>{fmtDateTime(r.createdAt)}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </Table>
                            </div>
                        ))}
                    </div>
                )}
            </Card>
        </div>
    );
}

/* ── Holiday calendars ───────────────────────────────────────────────────── */

function CalendarForm({ existing, onDone, onClose }: { existing: HolidayCalendar | null; onDone: () => void; onClose: () => void }) {
    const t = useTranslations('LendingOps');
    const { showToast } = useToast();
    const { busy, error, run, clearError } = useAction();
    const [code, setCode] = useState(existing?.code ?? '');
    const [name, setName] = useState(existing?.name ?? '');
    const [weekendDays, setWeekendDays] = useState<number[]>(existing?.weekendDays ?? [6, 7]);
    const [holidays, setHolidays] = useState<CalendarHoliday[]>(existing ? existing.holidays.map((h) => ({ date: h.date, name: h.name })) : []);
    const [newDate, setNewDate] = useState('');
    const [newName, setNewName] = useState('');

    const codeErr = code && !CODE_RE.test(code) ? t('codeRule') : undefined;
    const removedExisting = existing ? existing.holidays.filter((h) => !holidays.some((x) => x.date === h.date)) : [];
    const dupDate = holidays.some((h) => h.date === newDate);
    const ok = CODE_RE.test(code) && name.trim().length > 0 && holidays.every((h) => DATE_RE.test(h.date) && h.name.trim());

    const toggleDay = (n: number) => setWeekendDays((d) => (d.includes(n) ? d.filter((x) => x !== n) : [...d, n].sort()));
    const addHoliday = () => {
        if (!DATE_RE.test(newDate) || !newName.trim() || dupDate) return;
        setHolidays((h) => [...h, { date: newDate, name: newName.trim() }].sort((a, b) => a.date.localeCompare(b.date)));
        setNewDate('');
        setNewName('');
    };

    const submit = async () => {
        if (!ok) return;
        const body = { code, name: name.trim(), weekendDays, holidays: holidays.map((h) => ({ date: h.date, name: h.name.trim().slice(0, 80) })) };
        const res = await run('cal', () => api.post('/lending/ops/calendars', body));
        if (res) {
            showToast(t('calendars.savedToast', { code }), 'success');
            onDone();
        }
    };

    return (
        <ActionPanel title={existing ? t('calendars.updateTitle', { code: existing.code }) : t('calendars.newTitle')} onClose={onClose}>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <Field label={t('calendars.code')} error={codeErr} hint={existing ? t('calendars.codeFixed') : t('calendars.codeHint')}>
                    <TextInput value={code} onChange={(v) => setCode(v.toUpperCase())} maxLength={20} disabled={!!existing} className="font-mono" />
                </Field>
                <Field label={t('calendars.name')} className="sm:col-span-2">
                    <TextInput value={name} onChange={setName} maxLength={80} />
                </Field>
            </div>
            <div>
                <p className="text-[12px] font-semibold text-[#3C4257] mb-1">{t('calendars.weekendDays')}</p>
                <div className="flex flex-wrap gap-3">
                    {ISO_DAYS.map((d) => <Checkbox key={d.n} checked={weekendDays.includes(d.n)} onChange={() => toggleDay(d.n)} label={t(`days.${d.label}`)} />)}
                </div>
            </div>
            <div>
                <p className="text-[12px] font-semibold text-[#3C4257] mb-1">{t('calendars.holidaysCount', { count: holidays.length })}</p>
                {holidays.length > 0 && (
                    <div className="max-h-64 overflow-auto border border-[#E3E8EE] rounded bg-white mb-2">
                        <Table>
                            <tbody className="divide-y divide-[#F0F2F5]">
                                {holidays.map((h, i) => (
                                    <tr key={h.date}>
                                        <td className={`${td} tabular-nums whitespace-nowrap w-32`}>{h.date}</td>
                                        <td className={td}>
                                            <TextInput value={h.name} maxLength={80} onChange={(v) => setHolidays((all) => all.map((x, k) => (k === i ? { ...x, name: v } : x)))} />
                                        </td>
                                        <td className={`${td} w-10`}>
                                            <button type="button" title={t('calendars.remove')} className="text-[#8792A2] hover:text-red-600" onClick={() => setHolidays((all) => all.filter((_, k) => k !== i))}><Trash2 size={14} /></button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </Table>
                    </div>
                )}
                <div className="flex flex-wrap items-end gap-2">
                    <Field label={t('calendars.date')} error={dupDate ? t('calendars.alreadyListed') : undefined}><TextInput type="date" value={newDate} onChange={setNewDate} className="w-44" /></Field>
                    <Field label={t('calendars.holidayName')} className="flex-1 min-w-48"><TextInput value={newName} onChange={setNewName} maxLength={80} /></Field>
                    <Btn onClick={addHoliday} disabled={!DATE_RE.test(newDate) || !newName.trim() || dupDate}><Plus size={14} /> {t('calendars.add')}</Btn>
                </div>
            </div>
            {removedExisting.length > 0 && (
                <Notice tone="warn" title={t('calendars.noRemoveTitle')}>
                    {t('calendars.noRemoveBody', { dates: removedExisting.map((h) => h.date).join(', ') })}
                </Notice>
            )}
            <ErrorBox error={error} onDismiss={clearError} />
            <Btn variant="primary" onClick={submit} busy={busy === 'cal'} disabled={!ok}>{existing ? t('calendars.save') : t('calendars.create')}</Btn>
        </ActionPanel>
    );
}

function CalendarsTab() {
    const t = useTranslations('LendingOps');
    const { can } = useWorkspace();
    const canManage = can('business_date.manage');
    const { data, error, loading, reload } = useApi<HolidayCalendar[]>('/lending/ops/calendars');
    const [editing, setEditing] = useState<HolidayCalendar | 'new' | null>(null);
    const dayLabel = (n: number) => { const d = ISO_DAYS.find((x) => x.n === n); return d ? t(`days.${d.label}`) : String(n); };

    return (
        <div className="space-y-5">
            {editing && (
                <CalendarForm
                    key={editing === 'new' ? 'new' : editing.id}
                    existing={editing === 'new' ? null : editing}
                    onClose={() => setEditing(null)}
                    onDone={() => { setEditing(null); reload(); }}
                />
            )}
            <Card
                title={t('calendars.title')}
                subtitle={t('calendars.subtitle')}
                actions={!editing && canManage && <Btn variant="primary" onClick={() => setEditing('new')}><Plus size={14} /> {t('calendars.new')}</Btn>}
                bodyClass="p-0"
            >
                {loading && !data ? <Spinner /> : error ? <div className="p-4"><ErrorBox error={error} /></div> : !data?.length ? <Empty>{t('calendars.none')}</Empty> : (
                    <div className="divide-y divide-[#E3E8EE]">
                        {data.map((c) => (
                            <div key={c.id} className="px-5 py-3.5 space-y-2">
                                <div className="flex flex-wrap items-start justify-between gap-2">
                                    <div>
                                        <p className="text-[13px] font-semibold text-[#1A1F36]"><span className="font-mono">{c.code}</span> — {c.name}</p>
                                        <p className="text-[12px] text-[#697386]">{t('calendars.summary', { weekend: c.weekendDays.length ? c.weekendDays.map(dayLabel).join(', ') : t('calendars.noWeekend'), count: c.holidays.length })}</p>
                                    </div>
                                    {canManage && <Btn size="sm" onClick={() => setEditing(c)} disabled={!!editing}>{t('calendars.edit')}</Btn>}
                                </div>
                                {c.holidays.length > 0 && (
                                    <div className="flex flex-wrap gap-1.5">
                                        {c.holidays.map((h) => (
                                            <span key={h.date} className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded border border-[#E3E8EE] bg-[#F7FAFC] text-[11px]">
                                                <span className="tabular-nums font-semibold text-[#1A1F36]">{h.date}</span>
                                                <span className="text-[#697386]">{h.name}</span>
                                            </span>
                                        ))}
                                    </div>
                                )}
                            </div>
                        ))}
                    </div>
                )}
            </Card>
        </div>
    );
}

/* ── Integrations ────────────────────────────────────────────────────────── */

const ADAPTER_KEYS = ['payments', 'kyc', 'creditBureau', 'notifications', 'externalAccounting', 'documents'];

function IntegrationsTab() {
    const t = useTranslations('LendingOps');
    const { data, error, loading } = useApi<IntegrationsStatus>('/lending/ops/integrations');
    const rows = Object.entries(data ?? {});
    const mocks = rows.filter(([, a]) => !a.real);
    const unusable = rows.filter(([, a]) => !a.usable);

    return (
        <div className="space-y-4">
            {mocks.length > 0 && (
                <Notice tone={unusable.length ? 'danger' : 'warn'} title={t('integrations.mocksTitle', { mocks: mocks.length, total: rows.length })}>
                    {t('integrations.mocksBody')}
                    {unusable.length > 0 && ` ${t('integrations.mocksRefused')}`}
                </Notice>
            )}
            <Card title={t('integrations.title')} subtitle={t('integrations.subtitle')} bodyClass="p-0">
                {loading && !data ? <Spinner /> : error ? <div className="p-4"><ErrorBox error={error} /></div> : !rows.length ? <Empty>{t('integrations.none')}</Empty> : (
                    <Table>
                        <thead>
                            <tr className="border-b border-[#E3E8EE] bg-[#F7FAFC]">
                                <th className={th}>{t('integrations.capability')}</th><th className={th}>{t('integrations.adapter')}</th><th className={th}>{t('integrations.kind')}</th><th className={th}>{t('integrations.usable')}</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-[#F0F2F5]">
                            {rows.map(([key, a]) => (
                                <tr key={key} className={a.real ? '' : 'bg-amber-50/40'}>
                                    <td className={`${td} font-semibold text-[#1A1F36]`}>{ADAPTER_KEYS.includes(key) ? t(`integrations.adapters.${key}`) : key}</td>
                                    <td className={`${td} font-mono text-[12px]`}>{a.name}</td>
                                    <td className={td}>
                                        {a.real
                                            ? <span className="inline-flex items-center px-1.5 py-0.5 rounded border text-[11px] font-bold tracking-wide bg-emerald-50 text-emerald-700 border-emerald-200">{t('integrations.real')}</span>
                                            : <span className="inline-flex items-center px-1.5 py-0.5 rounded border text-[11px] font-bold tracking-wide bg-amber-50 text-amber-800 border-amber-300">{t('integrations.mock')}</span>}
                                    </td>
                                    <td className={td}><StatusBadge status={a.usable ? 'YES' : 'NO'} /></td>
                                </tr>
                            ))}
                        </tbody>
                    </Table>
                )}
            </Card>
        </div>
    );
}

/** Lending operations: business date / end of day, benchmark rates, calendars, impairment, lending settings, integrations. */
export function OperationsView() {
    const t = useTranslations('LendingOps');
    const [tab, setTab] = useState<Tab>('date');
    return (
        <div className="space-y-5">
            <OperationalAlertsCard />
            <Tabs<Tab>
                value={tab}
                onChange={setTab}
                tabs={[
                    { value: 'date', label: t('tabs.date') },
                    { value: 'rates', label: t('tabs.rates') },
                    { value: 'calendars', label: t('tabs.calendars') },
                    { value: 'impairment', label: t('tabs.impairment') },
                    { value: 'settings', label: t('tabs.settings') },
                    { value: 'integrations', label: t('tabs.integrations') },
                ]}
            />
            {tab === 'date' && <BusinessDateTab />}
            {tab === 'rates' && <RatesTab />}
            {tab === 'calendars' && <CalendarsTab />}
            {tab === 'impairment' && <ImpairmentTab />}
            {tab === 'settings' && <LendingSettingsTab />}
            {tab === 'integrations' && <IntegrationsTab />}
        </div>
    );
}
