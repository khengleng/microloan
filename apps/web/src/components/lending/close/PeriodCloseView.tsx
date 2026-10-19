"use client";

import { ReactNode, useMemo, useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import {
    AlertTriangle, ArrowRight, CalendarCheck2, CheckCircle2, ChevronLeft, ChevronRight, CircleDashed,
    Clock3, Lock, LockOpen, PlayCircle, XCircle,
} from 'lucide-react';
import api from '@/lib/api';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { useToast } from '@/components/ui/toast';
import { LendingShell, useLendingHref } from '../LendingShell';
import { Btn, Card, Disclosure, Empty, ErrorBox, Field, Spinner, Table, TextArea, td, tdR, th, thR } from '../ui';
import { useAction, useApi } from '../useAsync';
import { MoneyCell } from '../MoneyCell';
import { fmtDateTime } from '../format';
import { Person } from '../People';

/* ── API shapes ──────────────────────────────────────────────────────────── */

type Can = { allowed: boolean; reason: string };
type MonthStatus = 'OPEN' | 'PENDING' | 'CLOSED' | 'REOPEN_PENDING' | 'CURRENT' | 'FUTURE' | 'NO_ACTIVITY';

interface Overview {
    businessDate: string;
    lastEndOfDay: string | null;
    lastEndOfDayFailures: number;
    firstActivity: string | null;
    year: number;
    months: { month: number; label: string; start: string; end: string; status: MonthStatus; preparedBy: string | null; approvedBy: string | null; closedAt: string | null; reopenCount: number; warnings: number }[];
    yearClose: { status: string; preparedBy: string | null; approvedBy: string | null; closedAt: string | null; closingEventIds: string[] };
    lastClosed: { year: number; month: number; label: string } | null;
    permissions: { prepare: Can; approve: Can };
}

interface Check { code: string; label: string; status: 'PASS' | 'WARN' | 'FAIL'; detail: string; link?: string }
interface LogEntry { id: string; action: string; actorId: string; comment: string; createdAt: string }
interface Snapshot {
    takenAt: string;
    trialBalance: { currency: string; accountCode: string; name: string; type: string; debit: string; credit: string }[];
    month: Record<string, { disbursed: string; collected: string; writtenOff: string; income: string; expense: string; netIncome: string }>;
    portfolio: Record<string, { activeLoans: number; principalOutstanding: string; interestReceivable: string; allowance: string; par30: string; par30Ratio: string; par90Ratio: string; buckets: Record<string, number> }>;
}
interface MonthDetail {
    year: number; month: number; label: string; start: string; end: string;
    status: 'OPEN' | 'PENDING' | 'CLOSED' | 'REOPEN_PENDING';
    preparedBy: string | null; preparedAt: string | null; approvedBy: string | null; closedAt: string | null;
    reopenReason: string; reopenRequestedBy: string | null;
    checks: Check[]; ready: boolean; snapshot: Snapshot; snapshotIsPreview: boolean; log: LogEntry[];
    permissions: { prepare: Can; approve: Can };
}
interface YearClosing { currency: string; income: string; expense: string; netIncome: string; accounts: { accountCode: string; name: string; type: string; balance: string }[] }
interface YearView {
    year: number; status: string; preparedBy: string | null; approvedBy: string | null; closedAt: string | null; closingEventIds: string[];
    checks: Check[]; ready: boolean; closing: YearClosing[]; log: LogEntry[];
    /** Where the year's result is carried (tenant lending settings). */
    retainedEarningsAccount?: string;
    permissions: { prepare: Can; approve: Can };
}

/* ── Presentation helpers ────────────────────────────────────────────────── */

/** The person (by email) or the automatic end-of-day close. */
function Who({ id }: { id: string | null }) {
    const t = useTranslations('LendingClose');
    if (id === 'system:period-close') return <>{t('automatic')}</>;
    return <Person id={id} />;
}

const TILE: Record<MonthStatus, { icon: typeof Lock; cls: string }> = {
    CLOSED: { icon: Lock, cls: 'border-emerald-200 bg-emerald-50 text-emerald-800' },
    PENDING: { icon: Clock3, cls: 'border-amber-300 bg-amber-50 text-amber-900' },
    REOPEN_PENDING: { icon: LockOpen, cls: 'border-amber-300 bg-amber-50 text-amber-900' },
    OPEN: { icon: PlayCircle, cls: 'border-[#C9D7FF] bg-[#F0F5FF] text-[#4B45C6]' },
    CURRENT: { icon: CircleDashed, cls: 'border-[#E3E8EE] bg-white text-[#3C4257]' },
    FUTURE: { icon: CircleDashed, cls: 'border-dashed border-[#E3E8EE] bg-white text-[#AAB7C4]' },
    NO_ACTIVITY: { icon: CircleDashed, cls: 'border-dashed border-[#E3E8EE] bg-[#F7FAFC] text-[#AAB7C4]' },
};

const LOG_ACTIONS = ['PREPARED', 'APPROVED', 'REJECTED', 'REOPEN_REQUESTED', 'REOPENED', 'REOPEN_REJECTED'];

function CheckIcon({ status }: { status: Check['status'] }) {
    if (status === 'PASS') return <CheckCircle2 size={16} className="text-emerald-600 shrink-0" />;
    if (status === 'WARN') return <AlertTriangle size={16} className="text-amber-500 shrink-0" />;
    return <XCircle size={16} className="text-red-600 shrink-0" />;
}

function Checklist({ checks }: { checks: Check[] }) {
    const t = useTranslations('LendingClose');
    const href = useLendingHref();
    return (
        <ul className="divide-y divide-[#F0F2F5] rounded-md border border-[#E3E8EE]">
            {checks.map((c) => (
                <li key={c.code} className="flex items-start gap-3 px-3 py-2.5">
                    <CheckIcon status={c.status} />
                    <div className="min-w-0 flex-1">
                        <div className="text-[13px] font-medium text-[#1A1F36]">{c.label}</div>
                        <div className="text-[12px] text-[#697386]">{c.detail}</div>
                    </div>
                    {c.link && c.status !== 'PASS' && (
                        <Link href={href(c.link)} className="inline-flex shrink-0 items-center gap-1 text-[12px] font-semibold text-[#635BFF] hover:underline">
                            {t('fix')} <ArrowRight size={12} />
                        </Link>
                    )}
                </li>
            ))}
        </ul>
    );
}

function Stepper({ steps }: { steps: { label: string; done: boolean; active: boolean; sub?: ReactNode }[] }) {
    return (
        <ol data-tour="close-stepper" className="flex flex-col gap-3 sm:flex-row sm:items-start sm:gap-0">
            {steps.map((s, i) => (
                <li key={s.label} className="flex flex-1 items-start gap-2 sm:flex-col sm:items-center sm:text-center">
                    <div className="flex items-center sm:w-full">
                        <span className={`hidden h-px flex-1 sm:block ${i === 0 ? 'invisible' : steps[i - 1].done ? 'bg-emerald-400' : 'bg-[#E3E8EE]'}`} />
                        <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full border text-[12px] font-bold ${s.done ? 'border-emerald-500 bg-emerald-500 text-white' : s.active ? 'border-[#635BFF] bg-[#F0F5FF] text-[#635BFF]' : 'border-[#E3E8EE] bg-white text-[#AAB7C4]'}`}>
                            {s.done ? <CheckCircle2 size={15} /> : i + 1}
                        </span>
                        <span className={`hidden h-px flex-1 sm:block ${i === steps.length - 1 ? 'invisible' : s.done ? 'bg-emerald-400' : 'bg-[#E3E8EE]'}`} />
                    </div>
                    <div className="sm:mt-1.5 sm:px-1">
                        <div className={`text-[12px] font-semibold ${s.active ? 'text-[#1A1F36]' : 'text-[#697386]'}`}>{s.label}</div>
                        {s.sub && <div className="text-[11px] text-[#8792A2]">{s.sub}</div>}
                    </div>
                </li>
            ))}
        </ol>
    );
}

function Kpi({ label, value, currency, tone }: { label: string; value: string; currency?: string; tone?: 'good' | 'bad' }) {
    return (
        <div className="rounded-md border border-[#E3E8EE] bg-white p-3">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-[#8792A2]">{label}</div>
            <div className={`mt-1 text-[16px] font-bold tabular-nums ${tone === 'bad' ? 'text-red-600' : tone === 'good' ? 'text-emerald-700' : 'text-[#1A1F36]'}`}>
                {currency ? <MoneyCell value={value} currency={currency} /> : value}
            </div>
        </div>
    );
}

function History({ log }: { log: LogEntry[] }) {
    const t = useTranslations('LendingClose');
    if (!log.length) return null;
    return (
        <ol className="space-y-2 border-l border-[#E3E8EE] pl-4">
            {log.map((l) => (
                <li key={l.id} className="relative text-[12px]">
                    <span className="absolute -left-[21px] top-1 h-2.5 w-2.5 rounded-full border-2 border-white bg-[#635BFF]" />
                    <span className="font-semibold text-[#1A1F36]">{LOG_ACTIONS.includes(l.action) ? t(`log.${l.action}`) : l.action}</span>
                    <span className="text-[#697386]"> · <Who id={l.actorId} /> · {fmtDateTime(l.createdAt)}</span>
                    {l.comment && <div className="text-[#3C4257]">“{l.comment}”</div>}
                </li>
            ))}
        </ol>
    );
}

function SnapshotPanel({ s, preview }: { s: Snapshot; preview: boolean }) {
    const t = useTranslations('LendingClose');
    const currencies = Array.from(new Set([...Object.keys(s.month ?? {}), ...Object.keys(s.portfolio ?? {})])).sort();
    if (!currencies.length) return <Empty>{t('noPostings')}</Empty>;
    return (
        <div className="space-y-4">
            <p className="text-[12px] text-[#697386]">
                {preview ? t('livePreview') : t('frozenAt', { at: fmtDateTime(s.takenAt) })}
            </p>
            {currencies.map((ccy) => {
                const m = s.month?.[ccy];
                const p = s.portfolio?.[ccy];
                const par30 = p ? Number(p.par30Ratio) * 100 : 0;
                return (
                    <div key={ccy} className="space-y-2">
                        <div className="text-[12px] font-bold text-[#3C4257]">{ccy}</div>
                        <div className="grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-6">
                            <Kpi label={t('kpi.disbursed')} value={m?.disbursed ?? '0'} currency={ccy} />
                            <Kpi label={t('kpi.collected')} value={m?.collected ?? '0'} currency={ccy} />
                            <Kpi label={t('kpi.netIncome')} value={m?.netIncome ?? '0'} currency={ccy} tone={Number(m?.netIncome ?? 0) < 0 ? 'bad' : 'good'} />
                            <Kpi label={t('kpi.principalOutstanding')} value={p?.principalOutstanding ?? '0'} currency={ccy} />
                            <Kpi label={t('kpi.par30')} value={`${par30.toFixed(2)}%`} tone={par30 > 5 ? 'bad' : undefined} />
                            <Kpi label={t('kpi.allowance')} value={p?.allowance ?? '0'} currency={ccy} />
                        </div>
                    </div>
                );
            })}
            <Disclosure summary={t('trialBalance', { count: s.trialBalance.length })}>
                <Table>
                    <thead>
                        <tr className="border-b border-[#E3E8EE] bg-[#F7FAFC]">
                            <th className={th}>{t('col.ccy')}</th><th className={th}>{t('col.code')}</th><th className={th}>{t('col.account')}</th><th className={thR}>{t('col.debit')}</th><th className={thR}>{t('col.credit')}</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-[#F0F2F5]">
                        {s.trialBalance.map((r) => (
                            <tr key={`${r.currency}-${r.accountCode}`}>
                                <td className={td}>{r.currency}</td>
                                <td className={`${td} font-mono text-[12px]`}>{r.accountCode}</td>
                                <td className={td}>{r.name}</td>
                                <td className={tdR}><MoneyCell value={r.debit} /></td>
                                <td className={tdR}><MoneyCell value={r.credit} /></td>
                            </tr>
                        ))}
                    </tbody>
                </Table>
            </Disclosure>
        </div>
    );
}

/* ── Month detail ────────────────────────────────────────────────────────── */

function MonthPanel({ year, month, onChanged }: { year: number; month: number; onChanged: () => void }) {
    const t = useTranslations('LendingClose');
    const confirm = useConfirm();
    const { showToast } = useToast();
    const detail = useApi<MonthDetail>(`/lending/ops/periods/${year}/${month}`);
    const { busy, error, run, clearError } = useAction();
    const [comment, setComment] = useState('');
    const [reopenReason, setReopenReason] = useState('');
    const [showReopen, setShowReopen] = useState(false);
    const d = detail.data;

    const done = (msg: string) => { showToast(msg, 'success'); setComment(''); setReopenReason(''); setShowReopen(false); detail.reload(); onChanged(); };

    if (detail.loading && !d) return <Card><Spinner /></Card>;
    if (detail.error && !d) return <Card><ErrorBox error={detail.error} /></Card>;
    if (!d) return null;

    const fails = d.checks.filter((c) => c.status === 'FAIL').length;
    const warns = d.checks.filter((c) => c.status === 'WARN').length;
    const prepared = d.status !== 'OPEN';
    const locked = d.status === 'CLOSED' || d.status === 'REOPEN_PENDING';

    const prepare = async () => {
        if (warns && !(await confirm({ title: t('month.prepareTitle', { label: d.label }), message: t('month.prepareWarnings', { count: warns }), confirmLabel: t('month.prepare') }))) return;
        if (await run('prepare', () => api.post(`/lending/ops/periods/${year}/${month}/prepare`, comment.trim() ? { comment: comment.trim() } : {}))) done(t('preparedToast', { label: d.label }));
    };
    const decide = async (approve: boolean) => {
        const ok = await confirm({
            title: approve ? t('month.lockTitle', { label: d.label }) : t('sendBackTitle', { label: d.label }),
            message: approve
                ? t('month.lockBody', { start: d.start, end: d.end })
                : t('month.sendBackBody'),
            confirmLabel: approve ? t('month.approveLock') : t('sendBack'),
            variant: approve ? 'default' : 'danger',
        });
        if (!ok) return;
        if (await run('decide', () => api.post(`/lending/ops/periods/${year}/${month}/decision`, { approve, ...(comment.trim() ? { comment: comment.trim() } : {}) }))) done(approve ? t('month.lockedToast', { label: d.label }) : t('sentBackToast', { label: d.label }));
    };
    const requestReopen = async () => {
        if (await run('reopen', () => api.post(`/lending/ops/periods/${year}/${month}/reopen`, { reason: reopenReason.trim() }))) done(t('month.reopenRequestedToast'));
    };
    const decideReopen = async (approve: boolean) => {
        const ok = await confirm({
            title: approve ? t('month.reopenTitle', { label: d.label }) : t('month.refuseReopen'),
            message: approve ? t('month.reopenBody', { start: d.start, end: d.end }) : t('month.staysLocked', { label: d.label }),
            confirmLabel: approve ? t('month.reopen') : t('month.keepLocked'),
            variant: approve ? 'danger' : 'default',
        });
        if (!ok) return;
        if (await run('reopen-decision', () => api.post(`/lending/ops/periods/${year}/${month}/reopen-decision`, { approve }))) done(approve ? t('month.reopenedToast', { label: d.label }) : t('month.reopenRefusedToast'));
    };

    const steps = [
        { label: t('step.monthEnds'), done: d.checks.find((c) => c.code === 'BUSINESS_DATE')?.status === 'PASS', active: false, sub: d.end },
        { label: t('step.checksPass'), done: fails === 0, active: !prepared, sub: fails ? t('step.toFix', { count: fails }) : warns ? t('step.warnings', { count: warns }) : t('step.allClear') },
        { label: t('step.prepared'), done: prepared, active: d.status === 'OPEN' && fails === 0, sub: d.preparedBy ? <Who id={d.preparedBy} /> : t('step.finance') },
        { label: t('step.approvedLocked'), done: locked, active: d.status === 'PENDING', sub: d.approvedBy ? <Who id={d.approvedBy} /> : t('step.secondPerson') },
    ];

    return (
        <Card
            title={<span className="flex items-center gap-2">{d.label} {locked ? <Lock size={15} className="text-emerald-600" /> : null}</span>}
            subtitle={`${d.start} to ${d.end}`}
            actions={<Btn size="sm" variant="ghost" onClick={detail.reload}>{t('refresh')}</Btn>}
        >
            <div className="space-y-5">
                <Stepper steps={steps} />

                {d.status === 'PENDING' && (
                    <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-[13px] text-amber-900">
                        {t.rich('month.pendingNote', { who: () => <Who id={d.preparedBy} />, at: d.preparedAt ? fmtDateTime(d.preparedAt) : '—' })}
                    </div>
                )}
                {d.status === 'REOPEN_PENDING' && (
                    <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-[13px] text-amber-900">
                        {t.rich('month.reopenPendingNote', { who: () => <Who id={d.reopenRequestedBy} />, reason: d.reopenReason })}
                    </div>
                )}
                {d.status === 'CLOSED' && (
                    <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-[13px] text-emerald-800">
                        {t.rich('month.closedNote', { who: () => <Who id={d.approvedBy} />, at: d.closedAt ? fmtDateTime(d.closedAt) : '—' })}
                    </div>
                )}

                <section data-tour="close-checks" className="space-y-2">
                    <h3 className="text-[13px] font-bold text-[#1A1F36]">{t('month.checks')}</h3>
                    <Checklist checks={d.checks} />
                </section>

                <section data-tour="close-snapshot" className="space-y-2">
                    <h3 className="text-[13px] font-bold text-[#1A1F36]">{t('month.snapshot')}</h3>
                    <SnapshotPanel s={d.snapshot} preview={d.snapshotIsPreview} />
                </section>

                <section className="space-y-3 border-t border-[#E3E8EE] pt-4">
                    {(d.status === 'OPEN' || d.status === 'PENDING') && (
                        <Field label={t('comment')} hint={t('commentHint')}>
                            <TextArea value={comment} onChange={setComment} rows={2} maxLength={500} />
                        </Field>
                    )}
                    <div className="flex flex-wrap gap-2">
                        {d.status === 'OPEN' && (
                            <Btn data-tour="close-prepare" variant="primary" onClick={prepare} busy={busy === 'prepare'}
                                disabled={!d.permissions.prepare.allowed || fails > 0}
                                reason={!d.permissions.prepare.allowed ? d.permissions.prepare.reason : fails ? t('month.fixFirst') : undefined}>
                                <CalendarCheck2 size={14} /> {t('month.prepare')}
                            </Btn>
                        )}
                        {d.status === 'PENDING' && (
                            <>
                                <Btn data-tour="close-approve" variant="primary" onClick={() => decide(true)} busy={busy === 'decide'} disabled={!d.permissions.approve.allowed} reason={d.permissions.approve.reason || undefined}>
                                    <Lock size={14} /> {t('month.approveLock')}
                                </Btn>
                                <Btn variant="danger" onClick={() => decide(false)} disabled={!d.permissions.approve.allowed || busy === 'decide'} reason={d.permissions.approve.reason || undefined}>{t('sendBack')}</Btn>
                            </>
                        )}
                        {d.status === 'CLOSED' && !showReopen && (
                            <Btn onClick={() => setShowReopen(true)} disabled={!d.permissions.prepare.allowed} reason={d.permissions.prepare.reason || undefined}>
                                <LockOpen size={14} /> {t('month.requestReopen')}
                            </Btn>
                        )}
                        {d.status === 'REOPEN_PENDING' && (
                            <>
                                <Btn variant="danger" onClick={() => decideReopen(true)} busy={busy === 'reopen-decision'} disabled={!d.permissions.approve.allowed} reason={d.permissions.approve.reason || undefined}>{t('month.approveReopen')}</Btn>
                                <Btn onClick={() => decideReopen(false)} disabled={!d.permissions.approve.allowed || busy === 'reopen-decision'} reason={d.permissions.approve.reason || undefined}>{t('month.keepLocked')}</Btn>
                            </>
                        )}
                    </div>
                    {showReopen && (
                        <div className="space-y-2 rounded-md border border-[#E3E8EE] p-3">
                            <Field label={t('month.reopenWhy')} hint={t('month.reopenHint')}>
                                <TextArea value={reopenReason} onChange={setReopenReason} rows={2} maxLength={500} />
                            </Field>
                            <div className="flex gap-2">
                                <Btn variant="primary" onClick={requestReopen} busy={busy === 'reopen'} disabled={reopenReason.trim().length < 10}>{t('month.requestReopen')}</Btn>
                                <Btn variant="ghost" onClick={() => setShowReopen(false)}>{t('cancel')}</Btn>
                            </div>
                        </div>
                    )}
                    <ErrorBox error={error} onDismiss={clearError} />
                </section>

                {d.log.length > 0 && (
                    <section className="space-y-2">
                        <h3 className="text-[13px] font-bold text-[#1A1F36]">{t('history')}</h3>
                        <History log={d.log} />
                    </section>
                )}
            </div>
        </Card>
    );
}

/* ── Year end ────────────────────────────────────────────────────────────── */

function YearPanel({ year, monthsClosed, monthsRequired, onChanged }: { year: number; monthsClosed: number; monthsRequired: number; onChanged: () => void }) {
    const t = useTranslations('LendingClose');
    const confirm = useConfirm();
    const { showToast } = useToast();
    const v = useApi<YearView>(`/lending/ops/years/${year}`);
    const { busy, error, run, clearError } = useAction();
    const y = v.data;
    if (v.loading && !y) return <Card><Spinner /></Card>;
    if (!y) return v.error ? <Card><ErrorBox error={v.error} /></Card> : null;

    const done = (m: string) => { showToast(m, 'success'); v.reload(); onChanged(); };
    const prepare = async () => {
        if (await run('prepare', () => api.post(`/lending/ops/years/${year}/prepare`, {}))) done(t('preparedToast', { label: String(year) }));
    };
    const decide = async (approve: boolean) => {
        const ok = await confirm({
            title: approve ? t('year.closeTitle', { year }) : t('sendBackTitle', { label: String(year) }),
            message: approve
                ? t('year.closeBody', { year, account: y.retainedEarningsAccount ?? '—' })
                : t('year.sendBackBody'),
            confirmLabel: approve ? t('year.approveClose') : t('sendBack'),
            variant: approve ? 'warning' : 'danger',
        });
        if (!ok) return;
        if (await run('decide', () => api.post(`/lending/ops/years/${year}/decision`, { approve }))) done(approve ? t('year.closedToast', { year }) : t('sentBackToast', { label: String(year) }));
    };
    const pct = monthsRequired ? Math.round((monthsClosed / monthsRequired) * 100) : 0;

    return (
        <Card
            title={<span className="flex items-center gap-2">{t('year.title', { year })} {y.status === 'CLOSED' && <Lock size={15} className="text-emerald-600" />}</span>}
            subtitle={t('year.subtitle', { account: y.retainedEarningsAccount ?? '—' })}
        >
            <div className="space-y-5">
                <div>
                    <div className="mb-1 flex justify-between text-[12px] text-[#697386]">
                        <span>{t('monthsClosed')}</span><span className="font-semibold text-[#1A1F36]">{t('xOfY', { x: monthsClosed, y: monthsRequired })}</span>
                    </div>
                    <div className="h-2 overflow-hidden rounded-full bg-[#F0F2F5]">
                        <div className="h-full rounded-full bg-emerald-500 transition-all" style={{ width: `${pct}%` }} />
                    </div>
                </div>
                <Checklist checks={y.checks} />
                <section className="space-y-2">
                    <h3 className="text-[13px] font-bold text-[#1A1F36]">{y.status === 'CLOSED' ? t('year.journalPosted') : t('year.journalPreview')}</h3>
                    {!y.closing.length ? <Empty>{t('year.noIncome', { year })}</Empty> : y.closing.map((c) => (
                        <div key={c.currency} className="space-y-2">
                            <div className="grid grid-cols-3 gap-2">
                                <Kpi label={t('year.income', { currency: c.currency })} value={c.income} currency={c.currency} />
                                <Kpi label={t('year.expense')} value={c.expense} currency={c.currency} />
                                <Kpi label={t('year.net')} value={c.netIncome} currency={c.currency} tone={Number(c.netIncome) < 0 ? 'bad' : 'good'} />
                            </div>
                            <Disclosure summary={t('year.accountsZeroed', { count: c.accounts.length })}>
                                <Table>
                                    <thead><tr className="border-b border-[#E3E8EE] bg-[#F7FAFC]"><th className={th}>{t('col.code')}</th><th className={th}>{t('col.account')}</th><th className={th}>{t('col.type')}</th><th className={thR}>{t('col.yearBalance')}</th></tr></thead>
                                    <tbody className="divide-y divide-[#F0F2F5]">
                                        {c.accounts.map((a) => (
                                            <tr key={a.accountCode}><td className={`${td} font-mono text-[12px]`}>{a.accountCode}</td><td className={td}>{a.name}</td><td className={td}>{a.type.toLowerCase()}</td><td className={tdR}><MoneyCell value={a.balance} currency={c.currency} /></td></tr>
                                        ))}
                                    </tbody>
                                </Table>
                            </Disclosure>
                        </div>
                    ))}
                </section>
                <div className="flex flex-wrap gap-2 border-t border-[#E3E8EE] pt-4">
                    {y.status === 'OPEN' && (
                        <Btn variant="primary" onClick={prepare} busy={busy === 'prepare'} disabled={!y.permissions.prepare.allowed || !y.ready}
                            reason={!y.permissions.prepare.allowed ? y.permissions.prepare.reason : !y.ready ? t('year.monthsFirst') : undefined}>
                            <CalendarCheck2 size={14} /> {t('year.prepare')}
                        </Btn>
                    )}
                    {y.status === 'PENDING' && (
                        <>
                            <Btn variant="primary" onClick={() => decide(true)} busy={busy === 'decide'} disabled={!y.permissions.approve.allowed} reason={y.permissions.approve.reason || undefined}>
                                <Lock size={14} /> {t('year.approveCloseYear', { year })}
                            </Btn>
                            <Btn variant="danger" onClick={() => decide(false)} disabled={!y.permissions.approve.allowed || busy === 'decide'} reason={y.permissions.approve.reason || undefined}>{t('sendBack')}</Btn>
                        </>
                    )}
                    {y.status === 'CLOSED' && <span className="text-[13px] text-emerald-700">{t.rich('year.closedBy', { who: () => <Who id={y.approvedBy} />, at: y.closedAt ? fmtDateTime(y.closedAt) : '—' })}</span>}
                </div>
                <ErrorBox error={error} onDismiss={clearError} />
                {y.log.length > 0 && <History log={y.log} />}
            </div>
        </Card>
    );
}

/* ── Page ────────────────────────────────────────────────────────────────── */

export function PeriodCloseView() {
    const t = useTranslations('LendingClose');
    const tn = useTranslations('Workspace.nav');
    const [year, setYear] = useState<number | null>(null);
    const [selected, setSelected] = useState<number | 'YEAR' | null>(null);
    const o = useApi<Overview>(`/lending/ops/periods${year ? `?year=${year}` : ''}`);
    const data = o.data;

    // Open on the month that needs attention: awaiting approval first, then the oldest one to close.
    const attention = useMemo(() => {
        if (!data) return null;
        const pick = data.months.find((m) => m.status === 'PENDING' || m.status === 'REOPEN_PENDING')
            ?? data.months.find((m) => m.status === 'OPEN')
            ?? data.months.find((m) => m.status === 'CURRENT');
        return pick?.month ?? null;
    }, [data]);
    const shown = selected ?? attention;

    const stats = useMemo(() => {
        if (!data) return null;
        // Months before the first posting have nothing to close.
        const relevant = data.firstActivity ? data.months.filter((m) => m.status !== 'NO_ACTIVITY') : [];
        return {
            closed: data.months.filter((m) => m.status === 'CLOSED').length,
            required: relevant.length,
            pending: data.months.filter((m) => m.status === 'PENDING' || m.status === 'REOPEN_PENDING').length,
            toClose: data.months.filter((m) => m.status === 'OPEN').length,
        };
    }, [data]);

    const next = useMemo(() => {
        if (!data) return null;
        const pending = data.months.find((m) => m.status === 'PENDING');
        if (pending) return { text: t('next.pending', { label: pending.label, year: data.year }), month: pending.month };
        const reopen = data.months.find((m) => m.status === 'REOPEN_PENDING');
        if (reopen) return { text: t('next.reopen', { label: reopen.label, year: data.year }), month: reopen.month };
        const open = data.months.find((m) => m.status === 'OPEN');
        if (open) return { text: t('next.open', { label: open.label, year: data.year }), month: open.month };
        return null;
    }, [data, t]);

    return (
        <LendingShell title={tn('periodClose')} subtitle={t('subtitle')}>
            {o.error && <ErrorBox error={o.error} />}
            {!data ? <Spinner /> : (
                <>
                    <div className="flex flex-wrap items-center justify-between gap-3">
                        <div className="flex items-center gap-1">
                            <Btn size="sm" variant="ghost" onClick={() => { setYear(data.year - 1); setSelected(null); }} aria-label={t('prevYear')}><ChevronLeft size={16} /></Btn>
                            <span className="min-w-[4rem] text-center text-[18px] font-bold text-[#1A1F36]">{data.year}</span>
                            <Btn size="sm" variant="ghost" onClick={() => { setYear(data.year + 1); setSelected(null); }} aria-label={t('nextYear')}><ChevronRight size={16} /></Btn>
                        </div>
                        <div data-tour="close-status" className="flex flex-wrap gap-2 text-[12px]">
                            <span className="rounded-full border border-[#E3E8EE] bg-white px-2.5 py-1 text-[#3C4257]">{t.rich('businessDate', { date: data.businessDate, b: (c) => <b>{c}</b> })}</span>
                            <span className={`rounded-full border px-2.5 py-1 ${data.lastEndOfDayFailures ? 'border-red-200 bg-red-50 text-red-700' : 'border-[#E3E8EE] bg-white text-[#3C4257]'}`}>
                                {t.rich('lastEod', { date: data.lastEndOfDay ?? t('notYet'), b: (c) => <b>{c}</b> })}{data.lastEndOfDayFailures ? ` · ${t('failedCount', { count: data.lastEndOfDayFailures })}` : ''}
                            </span>
                            {data.lastClosed && <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-emerald-800">{t.rich('lastClosed', { label: data.lastClosed.label, b: (c) => <b>{c}</b> })}</span>}
                        </div>
                    </div>

                    {next && (
                        <button data-tour="close-next-step" type="button" onClick={() => setSelected(next.month)} className="flex w-full items-center justify-between gap-3 rounded-lg border border-[#C9D7FF] bg-[#F0F5FF] px-4 py-3 text-left hover:bg-[#E6EEFF]">
                            <span className="flex items-center gap-2 text-[13px] font-semibold text-[#4B45C6]"><Clock3 size={16} /> {t('nextStep', { text: next.text })}</span>
                            <ArrowRight size={16} className="text-[#4B45C6]" />
                        </button>
                    )}

                    {stats && (
                        <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
                            <Kpi label={t('monthsClosed')} value={`${stats.closed}`} />
                            <Kpi label={t('tile.PENDING')} value={`${stats.pending}`} tone={stats.pending ? 'bad' : undefined} />
                            <Kpi label={t('readyToClose')} value={`${stats.toClose}`} />
                            <Kpi label={t('yearEnd')} value={data.yearClose.status === 'CLOSED' ? t('tile.CLOSED') : data.yearClose.status === 'PENDING' ? t('tile.PENDING') : t('open')} tone={data.yearClose.status === 'CLOSED' ? 'good' : undefined} />
                        </div>
                    )}

                    <div data-tour="close-months" className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
                        {data.months.map((m) => {
                            const tile = TILE[m.status];
                            const Icon = tile.icon;
                            const active = shown === m.month;
                            const clickable = m.status !== 'FUTURE';
                            return (
                                <button
                                    key={m.month}
                                    type="button"
                                    disabled={!clickable}
                                    onClick={() => setSelected(m.month)}
                                    className={`rounded-lg border p-3 text-left transition-shadow ${tile.cls} ${active ? 'ring-2 ring-[#635BFF] ring-offset-1' : ''} ${clickable ? 'hover:shadow-md' : 'cursor-default'}`}
                                >
                                    <div className="flex items-center justify-between">
                                        <span className="text-[13px] font-bold">{m.label.slice(0, 3)}</span>
                                        <Icon size={15} />
                                    </div>
                                    <div className="mt-1 text-[11px] font-semibold">{t(`tile.${m.status}`)}</div>
                                    {m.warnings > 0 && m.status !== 'CLOSED' && <div className="text-[11px]">{t('step.warnings', { count: m.warnings })}</div>}
                                    {m.reopenCount > 0 && <div className="text-[11px] opacity-80">{t('reopenedTimes', { count: m.reopenCount })}</div>}
                                </button>
                            );
                        })}
                        <button
                            type="button"
                            onClick={() => setSelected('YEAR')}
                            className={`col-span-2 rounded-lg border p-3 text-left sm:col-span-3 lg:col-span-6 ${data.yearClose.status === 'CLOSED' ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : data.yearClose.status === 'PENDING' ? 'border-amber-300 bg-amber-50 text-amber-900' : 'border-[#E3E8EE] bg-white text-[#3C4257]'} ${shown === 'YEAR' ? 'ring-2 ring-[#635BFF] ring-offset-1' : ''} hover:shadow-md`}
                        >
                            <div className="flex items-center justify-between">
                                <span className="text-[13px] font-bold">{t('yearEndYear', { year: data.year })}</span>
                                {data.yearClose.status === 'CLOSED' ? <Lock size={15} /> : <CalendarCheck2 size={15} />}
                            </div>
                            <div className="mt-1 text-[11px] font-semibold">
                                {data.yearClose.status === 'CLOSED' ? t('yearClosedTile') : data.yearClose.status === 'PENDING' ? t('tile.PENDING') : t('monthsClosedOf', { x: stats?.closed ?? 0, y: stats?.required ?? 0 })}
                            </div>
                        </button>
                    </div>

                    {shown === 'YEAR'
                        ? <YearPanel year={data.year} monthsClosed={stats?.closed ?? 0} monthsRequired={stats?.required ?? 12} onChanged={o.reload} />
                        : shown
                            ? <MonthPanel key={`${data.year}-${shown}`} year={data.year} month={shown} onChanged={o.reload} />
                            : <Card><Empty>{t('pickMonth')}</Empty></Card>}
                </>
            )}
        </LendingShell>
    );
}
