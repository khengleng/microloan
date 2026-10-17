"use client";

import { useMemo, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import api from '@/lib/api';
import { useToast } from '@/components/ui/toast';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { StatusBadge } from '../StatusBadge';
import { ActionPanel, Btn, Card, Checkbox, Empty, ErrorBox, Field, KV, Notice, SelectInput, Spinner, Table, Tabs, TextInput, td, th } from '../ui';
import { qs, useAction, useApi } from '../useAsync';
import { fmtDateTime, fmtRate, percentToFraction } from '../format';
import type { BatchResult, BusinessDate, CalendarHoliday, HolidayCalendar, IntegrationsStatus, RateObservation } from './types';

type Tab = 'date' | 'rates' | 'calendars' | 'integrations';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const CODE_RE = /^[A-Z0-9_]{2,20}$/;
const SIGNED_DEC_RE = /^-?\d+(\.\d+)?$/;
const ISO_DAYS: { n: number; label: string }[] = [
    { n: 1, label: 'Mon' }, { n: 2, label: 'Tue' }, { n: 3, label: 'Wed' }, { n: 4, label: 'Thu' },
    { n: 5, label: 'Fri' }, { n: 6, label: 'Sat' }, { n: 7, label: 'Sun' },
];

/* ── Business date & end of day ──────────────────────────────────────────── */

function BusinessDateTab() {
    const { showToast } = useToast();
    const confirm = useConfirm();
    const bd = useApi<BusinessDate>('/lending/ops/business-date');
    const [next, setNext] = useState('');
    const [runAfter, setRunAfter] = useState(true);
    const [note, setNote] = useState<string | null>(null);
    const [result, setResult] = useState<BatchResult | null>(null);
    const { busy, error, run, clearError } = useAction();
    const current = bd.data?.businessDate;

    const runBatch = async () => {
        const res = await run('batch', () => api.post<BatchResult>('/lending/loans/batch/run', {}));
        if (res) {
            setResult(res.data);
            setNote(null);
            const failed = Array.isArray(res.data.failed) ? res.data.failed.length : 0;
            showToast(`End of day for ${res.data.businessDate}: ${res.data.processed} processed${failed ? `, ${failed} failed` : ''}`, failed ? 'error' : 'success');
        }
    };

    const advance = async () => {
        if (!DATE_RE.test(next)) return;
        const backwards = !!current && next < current;
        const ok = await confirm({
            title: 'Advance business date',
            message: `Move the business date from ${current ?? '—'} to ${next}?${backwards ? ' This is EARLIER than the current date.' : ''} It drives accrual, value-date checks and delinquency for every loan.${runAfter ? ' The end-of-day batch runs straight after.' : ''}`,
            confirmLabel: runAfter ? 'Advance & run end of day' : 'Advance date',
            variant: 'warning',
        });
        if (!ok) return;
        const res = await run('date', () => api.post<BusinessDate>('/lending/ops/business-date', { businessDate: next }));
        if (!res) return;
        showToast(`Business date is now ${res.data.businessDate}`, 'success');
        setNext('');
        setResult(null);
        setNote(res.data.note ?? null);
        bd.reload();
        if (runAfter) await runBatch();
    };

    const confirmBatch = async () => {
        const ok = await confirm({
            title: 'Run end-of-day batch',
            message: `Accrue interest, apply due rate resets, assess penalties and recompute delinquency for every active loan in your scope as of ${current ?? 'the business date'}?`,
            confirmLabel: 'Run batch',
        });
        if (ok) await runBatch();
    };

    const failed = result && Array.isArray(result.failed) ? result.failed : [];

    return (
        <div className="space-y-5">
            <Card title="Business date" subtitle="The tenant's accounting date. It only moves when someone advances it here.">
                <div className="flex flex-wrap items-end gap-5">
                    <div>
                        <p className="text-[11px] font-bold uppercase tracking-wide text-[#8792A2]">Current business date</p>
                        <p className="text-2xl font-bold text-[#1A1F36] tabular-nums">{bd.loading && !bd.data ? '…' : current ?? '—'}</p>
                    </div>
                    <Field label="Advance to">
                        <TextInput type="date" value={next} onChange={setNext} className="w-44" />
                    </Field>
                    <div className="pb-1.5"><Checkbox checked={runAfter} onChange={setRunAfter} label="Run end of day after advancing" /></div>
                    <Btn variant="primary" onClick={advance} busy={busy === 'date'} disabled={!DATE_RE.test(next) || !!busy} reason={!next ? 'Pick a date first' : undefined}>Advance date</Btn>
                    <Btn onClick={confirmBatch} busy={busy === 'batch'} disabled={!!busy}>Run end-of-day batch</Btn>
                </div>
                <div className="mt-3 space-y-2">
                    <ErrorBox error={bd.error} />
                    <ErrorBox error={error} onDismiss={clearError} />
                    {note && <Notice tone="warn" title="End of day not run yet">{note}</Notice>}
                </div>
            </Card>

            {result && (
                <Card title="End-of-day result" subtitle={`Batch for business date ${result.businessDate}`}>
                    <div className="space-y-4">
                        <KV cols={3} items={[
                            ['Business date', <span key="d" className="tabular-nums">{result.businessDate}</span>],
                            ['Loans processed', <span key="p" className="tabular-nums font-bold text-emerald-700">{result.processed}</span>],
                            ['Loans failed', <span key="f" className={`tabular-nums font-bold ${failed.length ? 'text-red-600' : 'text-[#AAB7C4]'}`}>{failed.length}</span>],
                        ]} />
                        {failed.length > 0 ? (
                            <Table>
                                <thead>
                                    <tr className="border-b border-[#E3E8EE] bg-[#F7FAFC]"><th className={th}>Loan</th><th className={th}>Error</th></tr>
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
                            <Notice tone="success">Every loan in scope was processed. Each loan runs in its own transaction, so a re-run only catches up what is left.</Notice>
                        )}
                    </div>
                </Card>
            )}
        </div>
    );
}

/* ── Benchmark rates ─────────────────────────────────────────────────────── */

function AddRateForm({ initialCode, onDone, onClose }: { initialCode: string; onDone: () => void; onClose: () => void }) {
    const { showToast } = useToast();
    const { busy, error, run, clearError } = useAction();
    const [benchmarkCode, setCode] = useState(initialCode);
    const [observationDate, setDate] = useState('');
    const [ratePct, setRatePct] = useState('');
    const [source, setSource] = useState('');

    const codeErr = benchmarkCode && !CODE_RE.test(benchmarkCode) ? 'A–Z, 0–9 and _ (2–20 chars).' : undefined;
    const rateErr = ratePct && !SIGNED_DEC_RE.test(ratePct.trim()) ? 'A percentage, e.g. 5.25 or -0.1' : undefined;
    const fraction = ratePct && !rateErr ? percentToFraction(ratePct) : '';
    const ok = CODE_RE.test(benchmarkCode) && DATE_RE.test(observationDate) && !!fraction && source.trim().length >= 2;

    const submit = async () => {
        if (!ok) return;
        const body = { benchmarkCode, observationDate, rate: fraction, source: source.trim() };
        const res = await run('rate', () => api.post('/lending/ops/rates', body));
        if (res) {
            showToast(`${benchmarkCode} ${fmtRate(fraction)} recorded for ${observationDate}`, 'success');
            setDate('');
            setRatePct('');
            onDone();
        }
    };

    return (
        <ActionPanel title="Record benchmark observation" onClose={onClose}>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                <Field label="Benchmark code" error={codeErr} hint="e.g. SOFR, KHR_REF_3M">
                    <TextInput value={benchmarkCode} onChange={(v) => setCode(v.toUpperCase())} maxLength={20} className="font-mono" />
                </Field>
                <Field label="Observation date">
                    <TextInput type="date" value={observationDate} onChange={setDate} />
                </Field>
                <Field label="Rate (%)" error={rateErr} hint={fraction ? `Sent as ${fraction}` : 'Percent; stored as a fraction'}>
                    <TextInput value={ratePct} onChange={setRatePct} inputMode="decimal" />
                </Field>
                <Field label="Source" hint="Publisher / reference (2–120 chars)">
                    <TextInput value={source} onChange={setSource} maxLength={120} />
                </Field>
            </div>
            <p className="text-[11px] text-[#697386]">Observations are history: a date can be recorded once per benchmark and is never edited, so every reset stays auditable.</p>
            <ErrorBox error={error} onDismiss={clearError} />
            <Btn variant="primary" onClick={submit} busy={busy === 'rate'} disabled={!ok}>Record observation</Btn>
        </ActionPanel>
    );
}

function RatesTab() {
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
                title="Benchmark rates"
                subtitle="Floating-rate loans re-price from the latest observation on or before each reset date. Latest 200 observations shown."
                actions={
                    <>
                        <div className="w-44"><SelectInput value={code} onChange={setCode} placeholder="All benchmarks" options={codes} /></div>
                        {!adding && <Btn variant="primary" onClick={() => setAdding(true)}><Plus size={14} /> Add observation</Btn>}
                    </>
                }
                bodyClass="p-0"
            >
                {loading && !data ? <Spinner /> : error ? <div className="p-4"><ErrorBox error={error} /></div> : !grouped.length ? <Empty>No benchmark observations recorded.</Empty> : (
                    <div className="divide-y divide-[#E3E8EE]">
                        {grouped.map(([bm, rows]) => (
                            <div key={bm}>
                                <div className="flex items-center justify-between px-5 py-2.5 bg-[#F7FAFC]">
                                    <p className="font-mono text-[13px] font-bold text-[#1A1F36]">{bm}</p>
                                    <p className="text-[12px] text-[#697386]">latest <b className="tabular-nums text-[#1A1F36]">{fmtRate(rows[0].rate)}</b> effective {rows[0].observationDate} · {rows.length} observation{rows.length === 1 ? '' : 's'}</p>
                                </div>
                                <Table>
                                    <thead>
                                        <tr className="border-b border-[#E3E8EE]">
                                            <th className={th}>Effective date</th><th className={`${th} text-right`}>Rate</th><th className={th}>Fraction</th>
                                            <th className={th}>Source</th><th className={th}>Recorded</th>
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
    const { showToast } = useToast();
    const { busy, error, run, clearError } = useAction();
    const [code, setCode] = useState(existing?.code ?? '');
    const [name, setName] = useState(existing?.name ?? '');
    const [weekendDays, setWeekendDays] = useState<number[]>(existing?.weekendDays ?? [6, 7]);
    const [holidays, setHolidays] = useState<CalendarHoliday[]>(existing ? existing.holidays.map((h) => ({ date: h.date, name: h.name })) : []);
    const [newDate, setNewDate] = useState('');
    const [newName, setNewName] = useState('');

    const codeErr = code && !CODE_RE.test(code) ? 'A–Z, 0–9 and _ (2–20 chars).' : undefined;
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
            showToast(`Calendar ${code} saved`, 'success');
            onDone();
        }
    };

    return (
        <ActionPanel title={existing ? `Update calendar ${existing.code}` : 'New holiday calendar'} onClose={onClose}>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <Field label="Code" error={codeErr} hint={existing ? 'The code identifies the calendar' : 'e.g. KH'}>
                    <TextInput value={code} onChange={(v) => setCode(v.toUpperCase())} maxLength={20} disabled={!!existing} className="font-mono" />
                </Field>
                <Field label="Name" className="sm:col-span-2">
                    <TextInput value={name} onChange={setName} maxLength={80} />
                </Field>
            </div>
            <div>
                <p className="text-[12px] font-semibold text-[#3C4257] mb-1">Weekend days</p>
                <div className="flex flex-wrap gap-3">
                    {ISO_DAYS.map((d) => <Checkbox key={d.n} checked={weekendDays.includes(d.n)} onChange={() => toggleDay(d.n)} label={d.label} />)}
                </div>
            </div>
            <div>
                <p className="text-[12px] font-semibold text-[#3C4257] mb-1">Holidays ({holidays.length})</p>
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
                                            <button type="button" title="Remove" className="text-[#8792A2] hover:text-red-600" onClick={() => setHolidays((all) => all.filter((_, k) => k !== i))}><Trash2 size={14} /></button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </Table>
                    </div>
                )}
                <div className="flex flex-wrap items-end gap-2">
                    <Field label="Date" error={dupDate ? 'Already listed' : undefined}><TextInput type="date" value={newDate} onChange={setNewDate} className="w-44" /></Field>
                    <Field label="Holiday name" className="flex-1 min-w-48"><TextInput value={newName} onChange={setNewName} maxLength={80} /></Field>
                    <Btn onClick={addHoliday} disabled={!DATE_RE.test(newDate) || !newName.trim() || dupDate}><Plus size={14} /> Add</Btn>
                </div>
            </div>
            {removedExisting.length > 0 && (
                <Notice tone="warn" title="Removing holidays is not supported by the API">
                    Saving adds and renames holidays but never deletes them; {removedExisting.map((h) => h.date).join(', ')} will remain on the calendar.
                </Notice>
            )}
            <ErrorBox error={error} onDismiss={clearError} />
            <Btn variant="primary" onClick={submit} busy={busy === 'cal'} disabled={!ok}>{existing ? 'Save calendar' : 'Create calendar'}</Btn>
        </ActionPanel>
    );
}

function CalendarsTab() {
    const { data, error, loading, reload } = useApi<HolidayCalendar[]>('/lending/ops/calendars');
    const [editing, setEditing] = useState<HolidayCalendar | 'new' | null>(null);
    const dayLabel = (n: number) => ISO_DAYS.find((d) => d.n === n)?.label ?? String(n);

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
                title="Holiday calendars"
                subtitle="Non-business days used to roll due dates."
                actions={!editing && <Btn variant="primary" onClick={() => setEditing('new')}><Plus size={14} /> New calendar</Btn>}
                bodyClass="p-0"
            >
                {loading && !data ? <Spinner /> : error ? <div className="p-4"><ErrorBox error={error} /></div> : !data?.length ? <Empty>No holiday calendars defined.</Empty> : (
                    <div className="divide-y divide-[#E3E8EE]">
                        {data.map((c) => (
                            <div key={c.id} className="px-5 py-3.5 space-y-2">
                                <div className="flex flex-wrap items-start justify-between gap-2">
                                    <div>
                                        <p className="text-[13px] font-semibold text-[#1A1F36]"><span className="font-mono">{c.code}</span> — {c.name}</p>
                                        <p className="text-[12px] text-[#697386]">Weekend: {c.weekendDays.length ? c.weekendDays.map(dayLabel).join(', ') : 'none'} · {c.holidays.length} holiday{c.holidays.length === 1 ? '' : 's'}</p>
                                    </div>
                                    <Btn size="sm" onClick={() => setEditing(c)} disabled={!!editing}>Edit</Btn>
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

const ADAPTER_LABELS: Record<string, string> = {
    payments: 'Payments',
    kyc: 'KYC / identity',
    creditBureau: 'Credit bureau',
    notifications: 'Notifications',
    externalAccounting: 'External accounting',
    documents: 'Document storage',
};

function IntegrationsTab() {
    const { data, error, loading } = useApi<IntegrationsStatus>('/lending/ops/integrations');
    const rows = Object.entries(data ?? {});
    const mocks = rows.filter(([, a]) => !a.real);
    const unusable = rows.filter(([, a]) => !a.usable);

    return (
        <div className="space-y-4">
            {mocks.length > 0 && (
                <Notice tone={unusable.length ? 'danger' : 'warn'} title={`${mocks.length} of ${rows.length} adapters are mocks`}>
                    Mock adapters simulate the external system: no money moves, no identity is checked and no bureau is queried.
                    {unusable.length > 0 && ' In production mocks are refused, so messages through them stay pending rather than being marked sent.'}
                </Notice>
            )}
            <Card title="Integration adapters" subtitle="Which external system each capability is wired to." bodyClass="p-0">
                {loading && !data ? <Spinner /> : error ? <div className="p-4"><ErrorBox error={error} /></div> : !rows.length ? <Empty>No adapters reported.</Empty> : (
                    <Table>
                        <thead>
                            <tr className="border-b border-[#E3E8EE] bg-[#F7FAFC]">
                                <th className={th}>Capability</th><th className={th}>Adapter</th><th className={th}>Kind</th><th className={th}>Usable here</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-[#F0F2F5]">
                            {rows.map(([key, a]) => (
                                <tr key={key} className={a.real ? '' : 'bg-amber-50/40'}>
                                    <td className={`${td} font-semibold text-[#1A1F36]`}>{ADAPTER_LABELS[key] ?? key}</td>
                                    <td className={`${td} font-mono text-[12px]`}>{a.name}</td>
                                    <td className={td}>
                                        {a.real
                                            ? <span className="inline-flex items-center px-1.5 py-0.5 rounded border text-[11px] font-bold tracking-wide bg-emerald-50 text-emerald-700 border-emerald-200">REAL</span>
                                            : <span className="inline-flex items-center px-1.5 py-0.5 rounded border text-[11px] font-bold tracking-wide bg-amber-50 text-amber-800 border-amber-300">MOCK</span>}
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

/** Lending operations: business date / end of day, benchmark rates, calendars, integrations. */
export function OperationsView() {
    const [tab, setTab] = useState<Tab>('date');
    return (
        <div className="space-y-5">
            <Tabs<Tab>
                value={tab}
                onChange={setTab}
                tabs={[
                    { value: 'date', label: 'Business date & end of day' },
                    { value: 'rates', label: 'Benchmark rates' },
                    { value: 'calendars', label: 'Holiday calendars' },
                    { value: 'integrations', label: 'Integrations' },
                ]}
            />
            {tab === 'date' && <BusinessDateTab />}
            {tab === 'rates' && <RatesTab />}
            {tab === 'calendars' && <CalendarsTab />}
            {tab === 'integrations' && <IntegrationsTab />}
        </div>
    );
}
