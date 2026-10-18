"use client";

import Link from 'next/link';
import { Fragment, useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { useTranslations } from 'next-intl';
import api from '@/lib/api';
import { useWorkspace } from '@/lib/workspace';
import { useToast } from '@/components/ui/toast';
import { LendingShell, useLendingHref } from '@/components/lending/LendingShell';
import { Btn, Card, Empty, ErrorBox, Field, Notice, Spinner, Table, Tabs, TextInput, th, thR, td, tdR } from '@/components/lending/ui';
import { MoneyCell } from '@/components/lending/MoneyCell';
import { StatusBadge } from '@/components/lending/StatusBadge';
import { Pager } from '@/components/lending/Pager';
import { LoanPicker } from '@/components/lending/LoanPicker';
import { qs, useApi } from '@/components/lending/useAsync';
import { addDecimal, fmtDateTime, subDecimal } from '@/components/lending/format';
import type { JournalEntry, Paged, Reconciliation, TrialBalance } from '@/components/lending/types';

function TrialBalanceView() {
    const { data, error, loading, reload } = useApi<TrialBalance[]>('/lending/ops/trial-balance');
    if (loading && !data) return <Spinner />;
    if (error) return <ErrorBox error={error} />;
    if (!data || data.length === 0) return <Card><Empty>No lending journal entries yet.</Empty></Card>;
    return (
        <div className="space-y-4">
            <div className="flex justify-end"><Btn size="sm" onClick={reload} busy={loading}>Refresh</Btn></div>
            {data.map((tb) => (
                <Card key={tb.currency} bodyClass="p-0"
                    title={`Trial balance — ${tb.currency}`}
                    actions={tb.totals.balanced ? <StatusBadge status="BALANCED" /> : <StatusBadge status="UNBALANCED" />}>
                    <Table>
                        <thead>
                            <tr className="border-b border-[#E3E8EE] bg-[#F7FAFC]">
                                <th className={th}>Code</th><th className={th}>Account</th><th className={th}>Type</th>
                                <th className={thR}>Debit</th><th className={thR}>Credit</th><th className={thR}>Balance</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-[#F0F2F5]">
                            {tb.rows.map((r) => (
                                <tr key={r.code}>
                                    <td className={`${td} font-mono text-[12px]`}>{r.code}</td>
                                    <td className={td}>{r.name}</td>
                                    <td className={td}><span className="text-[11px] text-[#697386]">{r.type}</span></td>
                                    <td className={tdR}><MoneyCell value={r.debit} /></td>
                                    <td className={tdR}><MoneyCell value={r.credit} /></td>
                                    <td className={tdR}><MoneyCell value={r.balance} strong /></td>
                                </tr>
                            ))}
                            <tr className="bg-[#F7FAFC] font-bold">
                                <td className={td} colSpan={3}>Totals</td>
                                <td className={tdR}><MoneyCell value={tb.totals.debit} strong /></td>
                                <td className={tdR}><MoneyCell value={tb.totals.credit} strong /></td>
                                <td className={td}></td>
                            </tr>
                        </tbody>
                    </Table>
                </Card>
            ))}
        </div>
    );
}

function ReconciliationView() {
    const href = useLendingHref();
    const { data, error, loading, reload } = useApi<Reconciliation>('/lending/ops/reconciliation');
    if (loading && !data) return <Spinner label="Reconciling sub-ledger to general ledger…" />;
    if (error) return <ErrorBox error={error} />;
    if (!data) return null;
    const clean = data.breaks.length === 0 && data.trialBalanceBalanced;
    return (
        <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-[13px] text-[#697386]">{data.accountsChecked} loan accounts checked · {fmtDateTime(data.checkedAt)}</p>
                <Btn size="sm" onClick={reload} busy={loading}>Re-run</Btn>
            </div>
            {clean
                ? <Notice tone="success" title="Reconciled">Every loan sub-ledger balance matches the general ledger and the trial balance balances.</Notice>
                : (
                    <Notice tone="danger" title="Reconciliation breaks found">
                        {!data.trialBalanceBalanced && <p>The trial balance does not balance.</p>}
                        {data.breaks.length > 0 && <p>{data.breaks.length} sub-ledger / ledger difference(s) — investigate before closing the day.</p>}
                    </Notice>
                )}
            {data.breaks.length > 0 && (
                <Card title="Breaks" bodyClass="p-0">
                    <Table>
                        <thead>
                            <tr className="border-b border-[#E3E8EE] bg-[#F7FAFC]">
                                <th className={th}>Loan</th><th className={th}>Check</th><th className={thR}>Sub-ledger</th><th className={thR}>Ledger</th><th className={thR}>Difference</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-[#F0F2F5]">
                            {data.breaks.map((b, i) => (
                                <tr key={i} className="bg-red-50/40">
                                    <td className={td}><Link className="text-[#635BFF] hover:underline font-semibold" href={href(`/lending/loans/${b.loanAccountId}`)}>{b.reference}</Link></td>
                                    <td className={`${td} font-mono text-[12px]`}>{b.check}{b.detail && <p className="font-sans text-[12px] text-red-700">{b.detail}</p>}</td>
                                    <td className={tdR}>{b.subledger !== undefined ? <MoneyCell value={b.subledger} /> : '—'}</td>
                                    <td className={tdR}>
                                        {b.ledger !== undefined ? <MoneyCell value={b.ledger} /> : b.schedule !== undefined ? <span title="Unpaid principal per schedule"><MoneyCell value={b.schedule} /> <span className="text-[10px] text-[#8792A2]">schedule</span></span> : '—'}
                                    </td>
                                    <td className={tdR}>
                                        <MoneyCell highlightNonZero value={b.difference ?? (b.subledger !== undefined && (b.ledger ?? b.schedule) !== undefined ? subDecimal(b.subledger, b.ledger ?? b.schedule) : undefined)} />
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </Table>
                </Card>
            )}
        </div>
    );
}

function JournalView() {
    const href = useLendingHref();
    const [filters, setFilters] = useState({ loanAccountId: '', from: '', to: '' });
    const [applied, setApplied] = useState(filters);
    const [page, setPage] = useState(1);
    const [open, setOpen] = useState<Record<string, boolean>>({});
    const { data, error, loading } = useApi<Paged<JournalEntry>>(`/lending/ops/journal${qs({ ...applied, page })}`);

    return (
        <div className="space-y-4">
            <Card>
                <form className="grid grid-cols-1 sm:grid-cols-4 gap-3 items-end" onSubmit={(e) => { e.preventDefault(); setApplied(filters); setPage(1); }}>
                    <Field label="Loan" hint="Optional — search by loan reference"><LoanPicker value={filters.loanAccountId} onChange={(id) => setFilters((f) => ({ ...f, loanAccountId: id }))} /></Field>
                    <Field label="From"><TextInput type="date" value={filters.from} onChange={(v) => setFilters((f) => ({ ...f, from: v }))} /></Field>
                    <Field label="To"><TextInput type="date" value={filters.to} onChange={(v) => setFilters((f) => ({ ...f, to: v }))} /></Field>
                    <Btn variant="primary" type="submit">Apply</Btn>
                </form>
            </Card>
            {error && <ErrorBox error={error} />}
            {loading && !data ? <Spinner /> : data && (
                <Card bodyClass="p-0">
                    {data.data.length === 0 ? <Empty>No journal entries match.</Empty> : (
                        <Table>
                            <thead>
                                <tr className="border-b border-[#E3E8EE] bg-[#F7FAFC]">
                                    <th className={th}></th><th className={th}>Date</th><th className={th}>Description</th><th className={th}>Event</th><th className={th}>Ccy</th><th className={thR}>Total debits</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-[#F0F2F5]">
                                {data.data.map((e) => {
                                    const isOpen = !!open[e.id];
                                    return (
                                        <Fragment key={e.id}>
                                            <tr className="cursor-pointer hover:bg-[#F7FAFC]" onClick={() => setOpen((o) => ({ ...o, [e.id]: !o[e.id] }))}>
                                                <td className={td}>{isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</td>
                                                <td className={`${td} whitespace-nowrap`}>{e.entryDate}</td>
                                                <td className={td}>
                                                    {e.description}
                                                    {e.loanAccountId && <Link onClick={(ev) => ev.stopPropagation()} href={href(`/lending/loans/${e.loanAccountId}`)} className="ml-2 text-[11px] text-[#635BFF] hover:underline">loan</Link>}
                                                </td>
                                                <td className={td}>{e.event ? <span className="flex gap-1"><StatusBadge status={e.event.type} /><StatusBadge status={e.event.status} /></span> : '—'}</td>
                                                <td className={td}>{e.currency}</td>
                                                <td className={tdR}><MoneyCell value={addDecimal(...e.lines.map((l) => l.debit))} /></td>
                                            </tr>
                                            {isOpen && (
                                                <tr>
                                                    <td></td>
                                                    <td colSpan={5} className="px-3 pb-3">
                                                        <table className="min-w-[360px] border border-[#E3E8EE] rounded">
                                                            <thead><tr className="bg-[#F7FAFC]"><th className={th}>Account</th><th className={thR}>Debit</th><th className={thR}>Credit</th></tr></thead>
                                                            <tbody className="divide-y divide-[#F0F2F5]">
                                                                {e.lines.map((l, i) => (
                                                                    <tr key={l.id ?? i}>
                                                                        <td className={`${td} font-mono text-[12px]`}>{l.accountCode}</td>
                                                                        <td className={tdR}><MoneyCell value={l.debit} /></td>
                                                                        <td className={tdR}><MoneyCell value={l.credit} /></td>
                                                                    </tr>
                                                                ))}
                                                            </tbody>
                                                        </table>
                                                    </td>
                                                </tr>
                                            )}
                                        </Fragment>
                                    );
                                })}
                            </tbody>
                        </Table>
                    )}
                    <div className="p-3 border-t border-[#E3E8EE]"><Pager page={page} total={data.total} pageSize={100} onPage={setPage} /></div>
                </Card>
            )}
        </div>
    );
}

/** Fetch a CSV through the API proxy and save it; errors come back as readable messages, not a raw JSON page. */
async function downloadCsv(path: string, filename: string): Promise<{ headers: Record<string, string> }> {
    try {
        const res = await api.get<Blob>(path, { responseType: 'blob' });
        const url = URL.createObjectURL(res.data);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        return { headers: res.headers as Record<string, string> };
    } catch (e) {
        const data = (e as { response?: { data?: Blob } }).response?.data;
        let message: string | undefined;
        if (data instanceof Blob) {
            try { message = JSON.parse(await data.text())?.message; } catch { /* not JSON */ }
        }
        throw new Error(Array.isArray(message) ? message[0] : message || (e as Error).message);
    }
}

function ExportsView() {
    const t = useTranslations('LendingAccounting');
    const { can } = useWorkspace();
    const { showToast } = useToast();
    const [from, setFrom] = useState('');
    const [to, setTo] = useState('');
    const [busy, setBusy] = useState<'gl' | 'bureau' | null>(null);
    const [totals, setTotals] = useState<{ from: string; to: string; debit: string; credit: string } | null>(null);
    const ready = /^\d{4}-\d{2}-\d{2}$/.test(from) && /^\d{4}-\d{2}-\d{2}$/.test(to) && from <= to;
    const gl = async () => {
        setBusy('gl');
        try {
            const { headers } = await downloadCsv(`/lending/ops/gl-export.csv${qs({ from, to })}`, `gl-${from}-${to}.csv`);
            // The API returns the period's totals as response headers alongside the file.
            setTotals({ from, to, debit: headers['x-total-debit'] ?? '—', credit: headers['x-total-credit'] ?? '—' });
        } catch (e) {
            showToast(t('downloadFailed', { message: (e as Error).message }), 'error');
        } finally { setBusy(null); }
    };
    const bureau = async () => {
        setBusy('bureau');
        try { await downloadCsv('/lending/ops/bureau-export.csv', 'credit-bureau.csv'); }
        catch (e) { showToast(t('downloadFailed', { message: (e as Error).message }), 'error'); }
        finally { setBusy(null); }
    };
    return (
        <div className="space-y-4">
            {can('accounting.read') && (
                <Card title={t('glTitle')} subtitle={t('glSubtitle')}>
                    <div className="flex flex-wrap items-end gap-2">
                        <Field label={t('from')}><TextInput type="date" value={from} onChange={setFrom} className="w-44" /></Field>
                        <Field label={t('to')}><TextInput type="date" value={to} onChange={setTo} className="w-44" /></Field>
                        {ready
                            ? <Btn onClick={gl} busy={busy === 'gl'}>{t('glDownload')}</Btn>
                            : <span className="text-[12px] text-[#697386]">{t('choosePeriod')}</span>}
                    </div>
                    {totals && (
                        <p className="mt-3 text-[13px] text-[#3C4257]">
                            {t.rich('glTotals', { from: totals.from, to: totals.to, debit: totals.debit, credit: totals.credit, b: (c) => <b className="tabular-nums">{c}</b> })}
                        </p>
                    )}
                </Card>
            )}
            {can('loan_data.export') && (
                <Card title={t('bureauTitle')} subtitle={t('bureauSubtitle')}>
                    <Btn onClick={bureau} busy={busy === 'bureau'}>{t('bureauDownload')}</Btn>
                </Card>
            )}
            {!can('accounting.read') && !can('loan_data.export') && <Card><Empty>{t('noExports')}</Empty></Card>}
        </div>
    );
}

export default function LendingAccountingPage() {
    const [tab, setTab] = useState<'tb' | 'rec' | 'journal' | 'exports'>('rec');
    return (
        <LendingShell title="Accounting reconciliation" subtitle="Lending sub-ledger journals, trial balance and sub-ledger-to-ledger reconciliation.">
            <Tabs value={tab} onChange={setTab} tabs={[
                { value: 'rec', label: 'Reconciliation' },
                { value: 'tb', label: 'Trial balance' },
                { value: 'journal', label: 'Journal' },
                { value: 'exports', label: 'Exports' },
            ]} />
            {tab === 'tb' && <TrialBalanceView />}
            {tab === 'rec' && <ReconciliationView />}
            {tab === 'journal' && <JournalView />}
            {tab === 'exports' && <ExportsView />}
        </LendingShell>
    );
}
