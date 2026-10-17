"use client";

import { useState } from 'react';
import {
    CheckCircle2, ChevronLeft, ChevronRight, Download, Eye, FileCheck2, FilePlus2, Send, ShieldCheck, Undo2, XCircle,
} from 'lucide-react';
import api from '@/lib/api';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { useToast } from '@/components/ui/toast';
import { LendingShell } from '../LendingShell';
import { StatusBadge } from '../StatusBadge';
import { ActionPanel, Btn, Card, Disclosure, Empty, ErrorBox, Field, KV, Notice, Spinner, Table, Tabs, TextInput, td, tdR, th, thR } from '../ui';
import { useAction, useApi } from '../useAsync';
import { fmtDateTime, fmtMoney, fmtRate } from '../format';

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

const who = (id: string | null | undefined) => (id ? `User ${id.slice(0, 8)}` : '—');
const STACK: Record<string, string> = { LENDING: 'Lending platform', LEGACY: 'Legacy loans', TOTAL: 'Total' };

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
    if (!rows.length && !totals.length) return <Empty>No {currency} loans in this table.</Empty>;
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
    const list = rows.filter((r) => r.currency === currency);
    const anyMigrated = list.some((r) => r.migrated && !/^0(\.0+)?$/.test(r.migrated));
    const anyFrozen = list.some((r) => r.frozen !== null);
    return (
        <Table>
            <thead className="bg-[#F7FAFC] border-b border-[#E3E8EE]">
                <tr>
                    <th className={th}>Measure</th><th className={th}>Book</th><th className={th}>Ledger accounts</th>
                    <th className={thR}>Loans in the return</th><th className={thR}>Ledger at month end</th>
                    {anyFrozen && <th className={thR}>Frozen at close</th>}
                    {anyMigrated && <th className={thR}>Less: moved to lending</th>}
                    <th className={thR}>Difference</th><th className={th}>Status</th>
                </tr>
            </thead>
            <tbody className="divide-y divide-[#F0F2F5]">
                {list.map((r, i) => {
                    const total = r.stack === 'TOTAL';
                    return (
                        <tr key={i} className={total ? 'bg-[#F7FAFC] font-bold' : ''}>
                            <td className={td}>{r.measure === 'PRINCIPAL' ? 'Principal outstanding' : 'Loss allowance'}</td>
                            <td className={td}>{STACK[r.stack]}</td>
                            <td className={`${td} font-mono text-[12px]`}>{r.accounts || '—'}</td>
                            <td className={tdR}>{fmtMoney(r.loans)}</td>
                            <td className={tdR}>{fmtMoney(r.ledger)}</td>
                            {anyFrozen && <td className={tdR}>{r.frozen === null ? '—' : fmtMoney(r.frozen)}</td>}
                            {anyMigrated && <td className={tdR}>{fmtMoney(r.migrated)}</td>}
                            <td className={`${tdR} ${r.status === 'BREAK' ? 'text-red-600 font-semibold' : ''}`}>{fmtMoney(r.difference)}</td>
                            <td className={td}>
                                {r.status === 'MATCHED'
                                    ? <span className="inline-flex items-center gap-1 text-[12px] font-semibold text-emerald-700"><CheckCircle2 size={14} /> Ties</span>
                                    : <span className="inline-flex items-center gap-1 text-[12px] font-semibold text-red-600"><XCircle size={14} /> Break</span>}
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
    const [currency, setCurrency] = useState(content.currencies[0] ?? 'USD');
    const [tab, setTab] = useState(content.tables[0]?.code ?? 'PORTFOLIO');
    const table = content.tables.find((t) => t.code === tab);
    const breaks = content.reconciliation.filter((r) => r.status === 'BREAK').length;
    const failed = content.checks.filter((c) => !c.passed);
    const portfolio = content.tables.find((t) => t.code === 'PORTFOLIO')?.totals.find((r) => r.currency === currency);
    const par = content.tables.find((t) => t.code === 'PAR')?.totals.find((r) => r.currency === currency);
    const cls = content.tables.find((t) => t.code === 'CLASSIFICATION')?.totals.find((r) => r.currency === currency);
    return (
        <div className="space-y-4">
            {content.warnings.map((w, i) => <Notice key={i} tone="warn">{w}</Notice>)}
            {content.currencies.length === 0 && <Empty>No loans and no postings at this month end.</Empty>}
            {content.currencies.length > 0 && (
                <>
                    <div className="flex flex-wrap items-center gap-2">
                        <span className="text-[12px] font-semibold text-[#697386]">Currency</span>
                        {content.currencies.map((c) => (
                            <button key={c} type="button" onClick={() => setCurrency(c)}
                                className={`px-2.5 py-1 rounded text-[12px] font-bold border ${c === currency ? 'border-[#635BFF] bg-[#F0F5FF] text-[#635BFF]' : 'border-[#E3E8EE] bg-white text-[#4F566B]'}`}>
                                {c}
                            </button>
                        ))}
                        <span className="text-[12px] text-[#8792A2]">Amounts are never added across currencies.</span>
                    </div>

                    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                        {[
                            ['Principal outstanding', portfolio ? `${currency} ${fmtMoney(String(portfolio.principal))}` : '—', `${portfolio?.loans ?? 0} loans`],
                            ['NBC provision required', cls ? `${currency} ${fmtMoney(String(cls.provisionRequired))}` : '—', cls ? `Allowance held ${fmtMoney(String(cls.allowance))}` : ''],
                            ['PAR 30', par ? fmtRate(String(par.par30Ratio), 2) : '—', par ? `${currency} ${fmtMoney(String(par.par30))}` : ''],
                            ['Ledger', breaks ? `${breaks} break(s)` : 'Ties to the ledger', breaks ? 'See the reconciliation below' : 'Principal and allowance, both books'],
                        ].map(([k, v, sub], i) => (
                            <div key={k} className={`rounded-lg border px-4 py-3 ${i === 3 ? (breaks ? 'border-red-200 bg-red-50' : 'border-emerald-200 bg-emerald-50') : 'border-[#E3E8EE] bg-white'}`}>
                                <div className="text-[11px] font-bold uppercase tracking-wide text-[#8792A2]">{k}</div>
                                <div className="text-[18px] font-bold text-[#1A1F36] tabular-nums mt-0.5">{v}</div>
                                <div className="text-[12px] text-[#697386]">{sub}</div>
                            </div>
                        ))}
                    </div>

                    <Card title="Reconciliation to the ledger" subtitle="Principal and allowance of the loans in this return against the loans receivable and allowance balances of each book's journal at month end."
                        actions={csvHref && <a href={csvHref('RECONCILIATION')} className="inline-flex items-center gap-1 text-[12px] font-semibold text-[#635BFF] hover:underline"><Download size={12} /> CSV</a>}
                        bodyClass="p-0">
                        <ReconciliationView rows={content.reconciliation} currency={currency} />
                    </Card>

                    <Card title="Return tables" bodyClass="p-0"
                        actions={csvHref && table && <a href={csvHref(table.code)} className="inline-flex items-center gap-1 text-[12px] font-semibold text-[#635BFF] hover:underline"><Download size={12} /> This table as CSV</a>}>
                        <div className="px-4 pt-2">
                            <Tabs tabs={content.tables.map((t) => ({ value: t.code, label: t.title.replace('Portfolio by ', 'By ').replace('Loan portfolio by currency', 'Portfolio') }))} value={tab} onChange={setTab} />
                        </div>
                        {table && (
                            <div>
                                <p className="px-5 py-3 text-[12px] text-[#697386]">{table.description}</p>
                                <ReturnTableView table={table} currency={currency} />
                                {table.notes?.map((n, i) => <p key={i} className="px-5 py-2 text-[12px] text-[#8792A2] italic">{n}</p>)}
                            </div>
                        )}
                    </Card>

                    <Disclosure summary={failed.length ? `${failed.length} of ${content.checks.length} self-checks failed` : `All ${content.checks.length} self-checks passed`} defaultOpen={failed.length > 0}>
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
        if (!(await confirm({ title: `Send the ${r.label} return for submission`, message: 'A second person reviews it and submits it to the regulator. The figures cannot change from here on.', confirmLabel: 'Send for submission' }))) return;
        const res = await act.run('request', () => api.post(`/lending/regulatory/returns/${r.id}/request-submission`, {}));
        if (res) { showToast('Sent for submission', 'success'); done(); }
    };
    const decide = async (approve: boolean) => {
        const res = await act.run(approve ? 'submit' : 'reject', () => api.post(`/lending/regulatory/returns/${r.id}/decision`, {
            approve, ...(reference.trim() ? { reference: reference.trim() } : {}), ...(comment.trim() ? { comment: comment.trim() } : {}),
        }));
        if (res) { showToast(approve ? 'Return submitted' : 'Return sent back to draft', 'success'); setDeciding(false); done(); }
    };

    const steps = [
        { label: 'Generated', done: true, sub: `${who(r.generatedBy)} · ${fmtDateTime(r.generatedAt)}` },
        { label: 'Sent for submission', done: r.status === 'PENDING_SUBMISSION' || r.status === 'SUBMITTED', sub: r.submissionRequestedBy ? who(r.submissionRequestedBy) : 'By the preparer' },
        { label: 'Submitted', done: r.status === 'SUBMITTED', sub: r.submittedBy ? `${who(r.submittedBy)} · ${fmtDateTime(r.submittedAt)}` : 'By a second person' },
    ];

    return (
        <Card
            title={<span className="flex items-center gap-2">{r.label} return · version {r.version} <StatusBadge status={r.status} /></span>}
            subtitle={`Built from the closed month · loan grades as of ${r.content.attributesAsOf} · ${r.content.tenant}`}
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
                    <Notice tone="info" title="Superseded">A later version replaced this draft. <button type="button" className="underline font-semibold" onClick={() => onOpen(r.supersededById!)}>Open the current version</button></Notice>
                )}
                {r.status === 'SUBMITTED' && r.supersededById && (
                    <Notice tone="warn" title="Amended">This submitted return has a later amending version. <button type="button" className="underline font-semibold" onClick={() => onOpen(r.supersededById!)}>Open it</button></Notice>
                )}
                {r.content.amends && (
                    <Notice tone="warn" title="Amendment">This version amends submitted version {r.content.amends.version}; file it as an amendment.</Notice>
                )}

                {r.status === 'DRAFT' && (
                    <div className="flex flex-wrap items-center gap-2">
                        <Btn variant="primary" onClick={() => void request()} busy={act.busy === 'request'}
                            disabled={!r.permissions.requestSubmission.allowed || failed > 0}
                            reason={failed > 0 ? 'The return does not tie to the ledger; it cannot be submitted.' : r.permissions.requestSubmission.reason}>
                            <Send size={14} /> Send for submission
                        </Btn>
                        <span className="text-[12px] text-[#697386]">A second person then reviews and submits it.</span>
                    </div>
                )}
                {r.status === 'PENDING_SUBMISSION' && !deciding && (
                    <div className="flex flex-wrap items-center gap-2">
                        <Btn variant="primary" onClick={() => setDeciding(true)} disabled={!r.permissions.submit.allowed} reason={r.permissions.submit.reason}>
                            <ShieldCheck size={14} /> Review and submit
                        </Btn>
                        {!r.permissions.submit.allowed && <span className="text-[12px] text-[#697386]">{r.permissions.submit.reason || 'Waiting for a second person to submit it.'}</span>}
                    </div>
                )}
                {r.status === 'PENDING_SUBMISSION' && deciding && (
                    <ActionPanel title="Submit to the regulator" onClose={() => setDeciding(false)}>
                        <p className="text-[12px] text-[#697386]">Check the reconciliation and the tables below. Submit once the return has been filed, recording the regulator&apos;s acknowledgement, or send it back to the preparer.</p>
                        <div className="grid sm:grid-cols-2 gap-3">
                            <Field label="Filing reference" hint="The regulator's acknowledgement number, if any">
                                <TextInput value={reference} onChange={setReference} placeholder="e.g. NBC-2026-01-0001" />
                            </Field>
                            <Field label="Comment">
                                <TextInput value={comment} onChange={setComment} placeholder="Optional; required context when sending back" />
                            </Field>
                        </div>
                        <div className="flex gap-2">
                            <Btn variant="primary" busy={act.busy === 'submit'} onClick={() => void decide(true)}><FileCheck2 size={14} /> Submit</Btn>
                            <Btn variant="danger" busy={act.busy === 'reject'} onClick={() => void decide(false)}><Undo2 size={14} /> Send back</Btn>
                        </div>
                    </ActionPanel>
                )}
                {r.status === 'SUBMITTED' && (
                    <KV cols={4} items={[
                        ['Submitted by', who(r.submittedBy)],
                        ['Submitted at', fmtDateTime(r.submittedAt)],
                        ['Filing reference', r.submissionReference || '—'],
                        ['Content hash', <span key="h" className="font-mono text-[11px]">{r.contentHash.slice(0, 16)}… {r.hashVerified ? '✓' : '✗'}</span>],
                    ]} />
                )}
                {!r.hashVerified && <Notice tone="danger" title="Integrity">The stored content does not match its hash. Do not file this return; report it.</Notice>}

                <ReturnBody content={r.content} csvHref={csvHref} />
            </div>
        </Card>
    );
}

/* ── Page ────────────────────────────────────────────────────────────────── */

export function RegulatoryReturnsView() {
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
            showToast(`Version ${res.data.version} generated`, 'success');
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
                A return is generated from a <b>closed</b> month (Lending › Period close) and is then frozen: later activity never changes it, and a correction is a new version.
                The preparer sends it for submission; a second person submits it. Open months can be previewed.
            </Notice>
            {loading && !data ? <Spinner /> : data && (
                <Card title={`Months of ${data.year}`} subtitle={`Business date ${data.businessDate}`} bodyClass="p-0">
                    <Table>
                        <thead className="bg-[#F7FAFC] border-b border-[#E3E8EE]">
                            <tr><th className={th}>Month</th><th className={th}>Month close</th><th className={th}>Return</th><th className={th}>Versions</th><th className={th}>Last activity</th><th className={thR}></th></tr>
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
                                        <td className={td}>{m.current ? <span className="flex items-center gap-1.5"><StatusBadge status={m.current.status} /> <span className="text-[12px] text-[#697386]">v{m.current.version}</span></span> : <span className="text-[12px] text-[#AAB7C4]">None</span>}</td>
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
                                            {m.current?.submittedAt ? `Submitted ${fmtDateTime(m.current.submittedAt)}` : m.current ? `Generated ${fmtDateTime(m.current.generatedAt)}` : m.closedAt ? `Closed ${fmtDateTime(m.closedAt)}` : ''}
                                        </td>
                                        <td className={`${tdR}`}>
                                            <div className="flex justify-end gap-1.5">
                                                {m.current && <Btn size="sm" onClick={() => setSelected({ kind: 'stored', id: m.current!.id })}><Eye size={13} /> Open</Btn>}
                                                {closed && (
                                                    <Btn size="sm" variant={m.current ? 'secondary' : 'primary'} busy={act.busy === `gen-${m.month}`}
                                                        disabled={!data.permissions.prepare.allowed || pending}
                                                        reason={pending ? 'A version is waiting for submission.' : data.permissions.prepare.reason}
                                                        onClick={() => void generate(m.month)}>
                                                        <FilePlus2 size={13} /> {m.current ? 'New version' : 'Generate'}
                                                    </Btn>
                                                )}
                                                {!closed && <Btn size="sm" variant="ghost" onClick={() => setSelected({ kind: 'preview', month: m.month })}><Eye size={13} /> Preview</Btn>}
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
                <Card title={`Preview · ${preview.data?.content.period.label ?? ''}`} subtitle="Computed now and not stored. Close the month to generate the return that is filed.">
                    {preview.loading ? <Spinner /> : preview.error ? <ErrorBox error={preview.error} /> : preview.data && <ReturnBody content={preview.data.content} />}
                </Card>
            )}
        </LendingShell>
    );
}
