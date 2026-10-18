"use client";

import { useState } from 'react';
import {
    CheckCircle2, ChevronLeft, ChevronRight, Download, Eye, FileCheck2, FilePlus2, Send, ShieldCheck, Undo2, XCircle,
} from 'lucide-react';
import api from '@/lib/api';
import { useTranslations } from 'next-intl';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { useToast } from '@/components/ui/toast';
import { LendingShell } from '../LendingShell';
import { StatusBadge } from '../StatusBadge';
import { ActionPanel, Btn, Card, Disclosure, Empty, ErrorBox, Field, KV, Notice, Spinner, Table, Tabs, TextInput, td, tdR, th, thR } from '../ui';
import { useAction, useApi } from '../useAsync';
import { fmtDateTime, fmtMoney, fmtRate } from '../format';
import { Person } from '../People';

/* ── API shapes ──────────────────────────────────────────────────────────── */

type Can = { allowed: boolean; reason: string };
type Row = Record<string, string | number>;
interface Column { key: string; label: string; kind: 'text' | 'amount' | 'count' | 'ratio' | 'percent' }
interface ReturnTable { code: string; title: string; description: string; columns: Column[]; rows: Row[]; totals: Row[]; notes?: string[] }
interface Reconciliation {
    currency: string; stack: 'LENDING' | 'LEGACY' | 'TOTAL'; measure: 'PRINCIPAL' | 'ALLOWANCE';
    loans: string; ledger: string; frozen: string | null; migrated: string; difference: string; status: 'MATCHED' | 'BREAK'; accounts: string;
}
interface Content {
    schema: string; tenant: string;
    period: { year: number; month: number; start: string; end: string; label: string };
    basis: 'CLOSED_PERIOD' | 'LIVE_PREVIEW'; attributesAsOf: string; currencies: string[]; rateCapPct: string;
    tables: ReturnTable[]; reconciliation: Reconciliation[];
    checks: { code: string; label: string; passed: boolean; detail: string }[];
    warnings: string[];
    version?: number; amends?: { id: string; version: number } | null;
}
interface VersionSummary {
    id: string; month: number; version: number; status: string; generatedBy: string; generatedAt: string;
    submissionRequestedBy: string | null; submittedBy: string | null; submittedAt: string | null; submissionReference: string;
    supersededById: string | null; contentHash: string;
}
interface Overview {
    year: number; businessDate: string;
    months: { month: number; label: string; periodStatus: string; closedAt: string | null; current: VersionSummary | null; versions: VersionSummary[] }[];
    permissions: { prepare: Can; submit: Can };
}
interface StoredReturn extends VersionSummary {
    year: number; label: string; basis: string; content: Content; hashVerified: boolean; comment: string;
    submissionRequestedAt: string | null;
    permissions: { requestSubmission: Can; submit: Can };
}

const who = (id: string | null | undefined) => <Person id={id} />;

/* ── Generic table rendering ─────────────────────────────────────────────── */

function Cell({ col, value, strong }: { col: Column; value: string | number | undefined; strong?: boolean }) {
    const v = value === undefined || value === null ? '' : String(value);
    const cls = `${col.kind === 'text' ? td : tdR} ${strong ? 'font-bold text-[#1A1F36]' : ''}`;
    let text = v;
    if (col.kind === 'amount') text = v === '' ? '—' : fmtMoney(v);
    else if (col.kind === 'ratio') text = v === '' ? '' : fmtRate(v, 2);
    else if (col.kind === 'percent') text = v === '' ? '' : `${v}%`;
    else if (col.kind === 'count') text = v === '' ? '' : fmtMoney(v);
    return <td className={cls}>{text}</td>;
}

function ReturnTableView({ table, currency }: { table: ReturnTable; currency: string }) {
    const rows = table.rows.filter((r) => r.currency === currency);
    const totals = table.totals.filter((r) => r.currency === currency);
    const cols = table.columns.filter((c) => c.key !== 'currency');
    const t = useTranslations('LendingRegulatory.returns');
    if (!rows.length && !totals.length) return <Empty>{t('noLoansInTable', { currency })}</Empty>;
    return (
        <Table>
            <thead className="bg-[#F7FAFC] border-b border-[#E3E8EE]">
                <tr>{cols.map((c) => <th key={c.key} className={c.kind === 'text' ? th : thR}>{c.label}</th>)}</tr>
            </thead>
            <tbody className="divide-y divide-[#F0F2F5]">
                {rows.map((r, i) => (
                    <tr key={i} className={r.aboveCap === 'Yes' && Number(r.loans) > 0 ? 'bg-red-50' : ''}>
                        {cols.map((c) => <Cell key={c.key} col={c} value={r[c.key]} />)}
                    </tr>
                ))}
            </tbody>
            {totals.length > 0 && (
                <tfoot className="border-t-2 border-[#E3E8EE] bg-[#F7FAFC]">
                    {totals.map((r, i) => (
                        <tr key={i}>{cols.map((c) => <Cell key={c.key} col={c} value={r[c.key]} strong />)}</tr>
                    ))}
                </tfoot>
            )}
        </Table>
    );
}

function ReconciliationView({ rows, currency }: { rows: Reconciliation[]; currency: string }) {
    const t = useTranslations('LendingRegulatory.returns');
    const list = rows.filter((r) => r.currency === currency);
    const anyMigrated = list.some((r) => r.migrated && !/^0(\.0+)?$/.test(r.migrated));
    const anyFrozen = list.some((r) => r.frozen !== null);
    return (
        <Table>
            <thead className="bg-[#F7FAFC] border-b border-[#E3E8EE]">
                <tr>
                    <th className={th}>{t('colMeasure')}</th><th className={th}>{t('colBook')}</th><th className={th}>{t('colAccounts')}</th>
                    <th className={thR}>{t('colLoans')}</th><th className={thR}>{t('colLedger')}</th>
                    {anyFrozen && <th className={thR}>{t('colFrozen')}</th>}
                    {anyMigrated && <th className={thR}>{t('colMigrated')}</th>}
                    <th className={thR}>{t('colDifference')}</th><th className={th}>{t('colStatus')}</th>
                </tr>
            </thead>
            <tbody className="divide-y divide-[#F0F2F5]">
                {list.map((r, i) => {
                    const total = r.stack === 'TOTAL';
                    return (
                        <tr key={i} className={total ? 'bg-[#F7FAFC] font-bold' : ''}>
                            <td className={td}>{r.measure === 'PRINCIPAL' ? t('principalOutstanding') : t('lossAllowance')}</td>
                            <td className={td}>{t(`stack.${r.stack}`)}</td>
                            <td className={`${td} font-mono text-[12px]`}>{r.accounts || '—'}</td>
                            <td className={tdR}>{fmtMoney(r.loans)}</td>
                            <td className={tdR}>{fmtMoney(r.ledger)}</td>
                            {anyFrozen && <td className={tdR}>{r.frozen === null ? '—' : fmtMoney(r.frozen)}</td>}
                            {anyMigrated && <td className={tdR}>{fmtMoney(r.migrated)}</td>}
                            <td className={`${tdR} ${r.status === 'BREAK' ? 'text-red-600 font-semibold' : ''}`}>{fmtMoney(r.difference)}</td>
                            <td className={td}>
                                {r.status === 'MATCHED'
                                    ? <span className="inline-flex items-center gap-1 text-[12px] font-semibold text-emerald-700"><CheckCircle2 size={14} /> {t('ties')}</span>
                                    : <span className="inline-flex items-center gap-1 text-[12px] font-semibold text-red-600"><XCircle size={14} /> {t('break')}</span>}
                            </td>
                        </tr>
                    );
                })}
            </tbody>
        </Table>
    );
}

/** The body of a return — stored or preview. */
function ReturnBody({ content, csvHref }: { content: Content; csvHref?: (table?: string) => string }) {
    const t = useTranslations('LendingRegulatory.returns');
    const [currency, setCurrency] = useState(content.currencies[0] ?? 'USD');
    const [tab, setTab] = useState(content.tables[0]?.code ?? 'PORTFOLIO');
    const table = content.tables.find((x) => x.code === tab);
    const breaks = content.reconciliation.filter((r) => r.status === 'BREAK').length;
    const failed = content.checks.filter((c) => !c.passed);
    const portfolio = content.tables.find((x) => x.code === 'PORTFOLIO')?.totals.find((r) => r.currency === currency);
    const par = content.tables.find((x) => x.code === 'PAR')?.totals.find((r) => r.currency === currency);
    const cls = content.tables.find((x) => x.code === 'CLASSIFICATION')?.totals.find((r) => r.currency === currency);
    return (
        <div className="space-y-4">
            {content.warnings.map((w, i) => <Notice key={i} tone="warn">{w}</Notice>)}
            {content.currencies.length === 0 && <Empty>{t('noLoansNoPostings')}</Empty>}
            {content.currencies.length > 0 && (
                <>
                    <div className="flex flex-wrap items-center gap-2">
                        <span className="text-[12px] font-semibold text-[#697386]">{t('currency')}</span>
                        {content.currencies.map((c) => (
                            <button key={c} type="button" onClick={() => setCurrency(c)}
                                className={`px-2.5 py-1 rounded text-[12px] font-bold border ${c === currency ? 'border-[#635BFF] bg-[#F0F5FF] text-[#635BFF]' : 'border-[#E3E8EE] bg-white text-[#4F566B]'}`}>
                                {c}
                            </button>
                        ))}
                        <span className="text-[12px] text-[#8792A2]">{t('neverAdded')}</span>
                    </div>

                    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                        {[
                            [t('principalOutstanding'), portfolio ? `${currency} ${fmtMoney(String(portfolio.principal))}` : '—', t('loansCount', { count: Number(portfolio?.loans ?? 0) })],
                            [t('provisionRequired'), cls ? `${currency} ${fmtMoney(String(cls.provisionRequired))}` : '—', cls ? t('allowanceHeld', { amount: fmtMoney(String(cls.allowance)) }) : ''],
                            ['PAR 30', par ? fmtRate(String(par.par30Ratio), 2) : '—', par ? `${currency} ${fmtMoney(String(par.par30))}` : ''],
                            [t('ledger'), breaks ? t('breaks', { count: breaks }) : t('tiesToLedger'), breaks ? t('seeReconciliation') : t('bothBooks')],
                        ].map(([k, v, sub], i) => (
                            <div key={k} className={`rounded-lg border px-4 py-3 ${i === 3 ? (breaks ? 'border-red-200 bg-red-50' : 'border-emerald-200 bg-emerald-50') : 'border-[#E3E8EE] bg-white'}`}>
                                <div className="text-[11px] font-bold uppercase tracking-wide text-[#8792A2]">{k}</div>
                                <div className="text-[18px] font-bold text-[#1A1F36] tabular-nums mt-0.5">{v}</div>
                                <div className="text-[12px] text-[#697386]">{sub}</div>
                            </div>
                        ))}
                    </div>

                    <Card title={t('reconTitle')} subtitle={t('reconSubtitle')}
                        actions={csvHref && <a href={csvHref('RECONCILIATION')} className="inline-flex items-center gap-1 text-[12px] font-semibold text-[#635BFF] hover:underline"><Download size={12} /> CSV</a>}
                        bodyClass="p-0">
                        <ReconciliationView rows={content.reconciliation} currency={currency} />
                    </Card>

                    <Card title={t('returnTables')} bodyClass="p-0"
                        actions={csvHref && table && <a href={csvHref(table.code)} className="inline-flex items-center gap-1 text-[12px] font-semibold text-[#635BFF] hover:underline"><Download size={12} /> {t('tableCsv')}</a>}>
                        <div className="px-4 pt-2">
                            <Tabs tabs={content.tables.map((x) => ({ value: x.code, label: x.title.replace('Portfolio by ', 'By ').replace('Loan portfolio by currency', 'Portfolio') }))} value={tab} onChange={setTab} />
                        </div>
                        {table && (
                            <div>
                                <p className="px-5 py-3 text-[12px] text-[#697386]">{table.description}</p>
                                <ReturnTableView table={table} currency={currency} />
                                {table.notes?.map((n, i) => <p key={i} className="px-5 py-2 text-[12px] text-[#8792A2] italic">{n}</p>)}
                            </div>
                        )}
                    </Card>

                    <Disclosure summary={failed.length ? t('checksFailed', { failed: failed.length, total: content.checks.length }) : t('checksPassed', { total: content.checks.length })} defaultOpen={failed.length > 0}>
                        <ul className="divide-y divide-[#F0F2F5] rounded-md border border-[#E3E8EE] bg-white">
                            {content.checks.map((c) => (
                                <li key={c.code} className="flex items-start gap-2 px-3 py-2 text-[12px]">
                                    {c.passed ? <CheckCircle2 size={14} className="text-emerald-600 shrink-0 mt-0.5" /> : <XCircle size={14} className="text-red-600 shrink-0 mt-0.5" />}
                                    <span className="font-medium text-[#1A1F36]">{c.label}</span>
                                    <span className="text-[#697386]">— {c.detail}</span>
                                </li>
                            ))}
                        </ul>
                    </Disclosure>
                </>
            )}
        </div>
    );
}

/* ── A stored return ─────────────────────────────────────────────────────── */

function StoredReturnView({ id, onChanged, onOpen }: { id: string; onChanged: () => void; onOpen: (id: string) => void }) {
    const { data, error, loading, reload } = useApi<StoredReturn>(`/lending/regulatory/returns/${id}`);
    const t = useTranslations('LendingRegulatory.returns');
    const act = useAction();
    const confirm = useConfirm();
    const { showToast } = useToast();
    const [reference, setReference] = useState('');
    const [comment, setComment] = useState('');
    const [deciding, setDeciding] = useState(false);
    if (loading && !data) return <Spinner />;
    if (error) return <ErrorBox error={error} />;
    if (!data) return null;
    const r = data;
    const done = () => { reload(); onChanged(); };
    const csvHref = (table?: string) => `/api/proxy/lending/regulatory/returns/${r.id}/export.csv${table ? `?table=${table}` : ''}`;
    const failed = r.content.checks.filter((c) => !c.passed).length;

    const request = async () => {
        if (!(await confirm({ title: t('sendTitle', { label: r.label }), message: t('sendMessage'), confirmLabel: t('sendForSubmission') }))) return;
        const res = await act.run('request', () => api.post(`/lending/regulatory/returns/${r.id}/request-submission`, {}));
        if (res) { showToast(t('sent'), 'success'); done(); }
    };
    const decide = async (approve: boolean) => {
        const res = await act.run(approve ? 'submit' : 'reject', () => api.post(`/lending/regulatory/returns/${r.id}/decision`, {
            approve, ...(reference.trim() ? { reference: reference.trim() } : {}), ...(comment.trim() ? { comment: comment.trim() } : {}),
        }));
        if (res) { showToast(approve ? t('submittedToast') : t('sentBack'), 'success'); setDeciding(false); done(); }
    };

    const steps = [
        { label: t('stepGenerated'), done: true, sub: <>{who(r.generatedBy)} · {fmtDateTime(r.generatedAt)}</> },
        { label: t('sendForSubmission'), done: r.status === 'PENDING_SUBMISSION' || r.status === 'SUBMITTED', sub: r.submissionRequestedBy ? who(r.submissionRequestedBy) : t('byPreparer') },
        { label: t('stepSubmitted'), done: r.status === 'SUBMITTED', sub: r.submittedBy ? <>{who(r.submittedBy)} · {fmtDateTime(r.submittedAt)}</> : t('bySecond') },
    ];

    return (
        <Card
            title={<span className="flex items-center gap-2">{t('storedTitle', { label: r.label, version: r.version })} <StatusBadge status={r.status} /></span>}
            subtitle={t('storedSubtitle', { date: r.content.attributesAsOf, tenant: r.content.tenant })}
            actions={
                <div className="flex gap-2">
                    <a href={csvHref()} className="inline-flex items-center gap-1.5 rounded font-semibold shadow-sm text-[13px] px-3.5 py-1.5 bg-white hover:bg-slate-50 text-[#3C4257] border border-[#E3E8EE]"><Download size={14} /> CSV</a>
                    <a href={`/api/proxy/lending/regulatory/returns/${r.id}/export.xlsx`} className="inline-flex items-center gap-1.5 rounded font-semibold shadow-sm text-[13px] px-3.5 py-1.5 bg-white hover:bg-slate-50 text-[#3C4257] border border-[#E3E8EE]"><Download size={14} /> Excel</a>
                </div>
            }
        >
            <div className="space-y-4">
                <ErrorBox error={act.error} onDismiss={act.clearError} />
                <ol className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                    {steps.map((s, i) => (
                        <li key={s.label} className={`rounded-md border px-3 py-2 ${s.done ? 'border-emerald-200 bg-emerald-50' : 'border-[#E3E8EE] bg-white'}`}>
                            <div className="flex items-center gap-1.5 text-[12px] font-bold text-[#1A1F36]">
                                {s.done ? <CheckCircle2 size={14} className="text-emerald-600" /> : <span className="h-4 w-4 rounded-full border border-[#AAB7C4] text-[10px] flex items-center justify-center text-[#8792A2]">{i + 1}</span>}
                                {s.label}
                            </div>
                            <div className="text-[11px] text-[#697386] mt-0.5">{s.sub}</div>
                        </li>
                    ))}
                </ol>

                {r.status === 'SUPERSEDED' && r.supersededById && (
                    <Notice tone="info" title={t('superseded')}>{t('supersededBody')} <button type="button" className="underline font-semibold" onClick={() => onOpen(r.supersededById!)}>{t('openCurrent')}</button></Notice>
                )}
                {r.status === 'SUBMITTED' && r.supersededById && (
                    <Notice tone="warn" title={t('amended')}>{t('amendedBody')} <button type="button" className="underline font-semibold" onClick={() => onOpen(r.supersededById!)}>{t('openIt')}</button></Notice>
                )}
                {r.content.amends && (
                    <Notice tone="warn" title={t('amendment')}>{t('amendmentBody', { version: r.content.amends.version })}</Notice>
                )}

                {r.status === 'DRAFT' && (
                    <div className="flex flex-wrap items-center gap-2">
                        <Btn variant="primary" onClick={() => void request()} busy={act.busy === 'request'}
                            disabled={!r.permissions.requestSubmission.allowed || failed > 0}
                            reason={failed > 0 ? t('doesNotTie') : r.permissions.requestSubmission.reason}>
                            <Send size={14} /> {t('sendForSubmission')}
                        </Btn>
                        <span className="text-[12px] text-[#697386]">{t('secondThen')}</span>
                    </div>
                )}
                {r.status === 'PENDING_SUBMISSION' && !deciding && (
                    <div className="flex flex-wrap items-center gap-2">
                        <Btn variant="primary" onClick={() => setDeciding(true)} disabled={!r.permissions.submit.allowed} reason={r.permissions.submit.reason}>
                            <ShieldCheck size={14} /> {t('reviewSubmit')}
                        </Btn>
                        {!r.permissions.submit.allowed && <span className="text-[12px] text-[#697386]">{r.permissions.submit.reason || t('waitingSecond')}</span>}
                    </div>
                )}
                {r.status === 'PENDING_SUBMISSION' && deciding && (
                    <ActionPanel title={t('submitTitle')} onClose={() => setDeciding(false)}>
                        <p className="text-[12px] text-[#697386]">{t('submitIntro')}</p>
                        <div className="grid sm:grid-cols-2 gap-3">
                            <Field label={t('filingReference')} hint={t('filingReferenceHint')}>
                                <TextInput value={reference} onChange={setReference} placeholder={t('filingPlaceholder')} />
                            </Field>
                            <Field label={t('comment')}>
                                <TextInput value={comment} onChange={setComment} placeholder={t('commentPlaceholder')} />
                            </Field>
                        </div>
                        <div className="flex gap-2">
                            <Btn variant="primary" busy={act.busy === 'submit'} onClick={() => void decide(true)}><FileCheck2 size={14} /> {t('submit')}</Btn>
                            <Btn variant="danger" busy={act.busy === 'reject'} onClick={() => void decide(false)}><Undo2 size={14} /> {t('sendBack')}</Btn>
                        </div>
                    </ActionPanel>
                )}
                {r.status === 'SUBMITTED' && (
                    <KV cols={4} items={[
                        [t('submittedBy'), who(r.submittedBy)],
                        [t('submittedAt'), fmtDateTime(r.submittedAt)],
                        [t('filingReference'), r.submissionReference || '—'],
                        [t('contentHash'), <span key="h" className="font-mono text-[11px]">{r.contentHash.slice(0, 16)}… {r.hashVerified ? '✓' : '✗'}</span>],
                    ]} />
                )}
                {!r.hashVerified && <Notice tone="danger" title={t('integrity')}>{t('integrityBody')}</Notice>}

                <ReturnBody content={r.content} csvHref={csvHref} />
            </div>
        </Card>
    );
}

/* ── Page ────────────────────────────────────────────────────────────────── */

export function RegulatoryReturnsView() {
    const t = useTranslations('LendingRegulatory.returns');
    const [year, setYear] = useState<number | null>(null);
    const { data, error, loading, reload } = useApi<Overview>(`/lending/regulatory/returns${year ? `?year=${year}` : ''}`);
    const [selected, setSelected] = useState<{ kind: 'stored'; id: string } | { kind: 'preview'; month: number } | null>(null);
    const act = useAction();
    const { showToast } = useToast();
    const y = data?.year ?? year ?? new Date().getFullYear();
    const preview = useApi<{ content: Content; periodStatus: string }>(
        selected?.kind === 'preview' ? `/lending/regulatory/preview?year=${y}&month=${selected.month}` : null,
    );

    const generate = async (month: number) => {
        const res = await act.run(`gen-${month}`, () => api.post<{ id: string; version: number }>('/lending/regulatory/returns', { year: y, month }));
        if (res) {
            showToast(t('generated', { version: res.data.version }), 'success');
            reload();
            setSelected({ kind: 'stored', id: res.data.id });
        }
    };

    return (
        <LendingShell
            title="Regulatory returns"
            subtitle="Monthly NBC returns covering the lending platform and the legacy loans: classification and provisioning, PAR, portfolio breakdowns, write-offs, largest borrowers and rates, reconciled to the ledger."
            actions={
                <div className="flex items-center gap-1">
                    <Btn size="sm" variant="ghost" onClick={() => setYear(y - 1)}><ChevronLeft size={14} /></Btn>
                    <span className="text-[14px] font-bold text-[#1A1F36] w-12 text-center">{y}</span>
                    <Btn size="sm" variant="ghost" onClick={() => setYear(y + 1)}><ChevronRight size={14} /></Btn>
                </div>
            }
        >
            <ErrorBox error={error ?? act.error} onDismiss={act.clearError} />
            <Notice tone="info">
                {t.rich('intro', { b: (chunks) => <b>{chunks}</b> })}
            </Notice>
            {loading && !data ? <Spinner /> : data && (
                <Card title={t('monthsOf', { year: data.year })} subtitle={t('businessDate', { date: data.businessDate })} bodyClass="p-0">
                    <Table>
                        <thead className="bg-[#F7FAFC] border-b border-[#E3E8EE]">
                            <tr><th className={th}>{t('colMonth')}</th><th className={th}>{t('colMonthClose')}</th><th className={th}>{t('colReturn')}</th><th className={th}>{t('colVersions')}</th><th className={th}>{t('colLastActivity')}</th><th className={thR}></th></tr>
                        </thead>
                        <tbody className="divide-y divide-[#F0F2F5]">
                            {data.months.map((m) => {
                                const closed = m.periodStatus === 'CLOSED';
                                const pending = m.current?.status === 'PENDING_SUBMISSION';
                                const isSel = (selected?.kind === 'stored' && m.versions.some((v) => v.id === selected.id)) || (selected?.kind === 'preview' && selected.month === m.month);
                                return (
                                    <tr key={m.month} className={isSel ? 'bg-[#F8F9FF]' : ''}>
                                        <td className={`${td} font-semibold text-[#1A1F36]`}>{m.label}</td>
                                        <td className={td}><StatusBadge status={m.periodStatus} /></td>
                                        <td className={td}>{m.current ? <span className="flex items-center gap-1.5"><StatusBadge status={m.current.status} /> <span className="text-[12px] text-[#697386]">v{m.current.version}</span></span> : <span className="text-[12px] text-[#AAB7C4]">{t('none')}</span>}</td>
                                        <td className={td}>
                                            <div className="flex flex-wrap gap-1">
                                                {m.versions.map((v) => (
                                                    <button key={v.id} type="button" onClick={() => setSelected({ kind: 'stored', id: v.id })}
                                                        className="text-[11px] font-semibold px-1.5 py-0.5 rounded border border-[#E3E8EE] hover:border-[#635BFF] text-[#4F566B]" title={v.status}>
                                                        v{v.version}
                                                    </button>
                                                ))}
                                            </div>
                                        </td>
                                        <td className={`${td} text-[12px] text-[#697386]`}>
                                            {m.current?.submittedAt ? t('lastSubmitted', { when: fmtDateTime(m.current.submittedAt) }) : m.current ? t('lastGenerated', { when: fmtDateTime(m.current.generatedAt) }) : m.closedAt ? t('lastClosed', { when: fmtDateTime(m.closedAt) }) : ''}
                                        </td>
                                        <td className={`${tdR}`}>
                                            <div className="flex justify-end gap-1.5">
                                                {m.current && <Btn size="sm" onClick={() => setSelected({ kind: 'stored', id: m.current!.id })}><Eye size={13} /> {t('open')}</Btn>}
                                                {closed && (
                                                    <Btn size="sm" variant={m.current ? 'secondary' : 'primary'} busy={act.busy === `gen-${m.month}`}
                                                        disabled={!data.permissions.prepare.allowed || pending}
                                                        reason={pending ? t('versionWaiting') : data.permissions.prepare.reason}
                                                        onClick={() => void generate(m.month)}>
                                                        <FilePlus2 size={13} /> {m.current ? t('newVersion') : t('generate')}
                                                    </Btn>
                                                )}
                                                {!closed && <Btn size="sm" variant="ghost" onClick={() => setSelected({ kind: 'preview', month: m.month })}><Eye size={13} /> {t('preview')}</Btn>}
                                            </div>
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </Table>
                </Card>
            )}

            {selected?.kind === 'stored' && (
                <StoredReturnView key={selected.id} id={selected.id} onChanged={reload} onOpen={(id) => setSelected({ kind: 'stored', id })} />
            )}
            {selected?.kind === 'preview' && (
                <Card title={t('previewTitle', { label: preview.data?.content.period.label ?? '' })} subtitle={t('previewSubtitle')}>
                    {preview.loading ? <Spinner /> : preview.error ? <ErrorBox error={preview.error} /> : preview.data && <ReturnBody content={preview.data.content} />}
                </Card>
            )}
        </LendingShell>
    );
}
