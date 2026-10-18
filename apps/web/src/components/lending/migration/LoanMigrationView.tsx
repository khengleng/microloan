"use client";

import { useRef, useState } from 'react';
import Link from 'next/link';
import { CheckCircle2, Download, FileSpreadsheet, Plus, Trash2, UploadCloud, XCircle } from 'lucide-react';
import api from '@/lib/api';
import { useTranslations } from 'next-intl';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { useToast } from '@/components/ui/toast';
import { LendingShell, useLendingHref } from '../LendingShell';
import { Btn, Card, Empty, ErrorBox, Field, Notice, Spinner, Table, Tabs, TextInput, td, tdR, th, thR } from '../ui';
import { qs, useAction, useApi } from '../useAsync';
import { MoneyCell } from '../MoneyCell';
import { StatusBadge } from '../StatusBadge';
import { fmtDateTime } from '../format';

type Can = { allowed: boolean; reason: string };
interface Totals { currency: string; loans: number; principal: string; interest: string; fees: string; penalties: string; allowance: string; accrualDifference: string; inArrears: number }
interface Batch {
    id: string; reference: string; fileName: string; cutOverDate: string; status: string;
    rowCount: number; validCount: number; errorCount: number; warningCount: number; postedCount: number; failedCount: number;
    createdBy: string; approvedBy: string | null; createdAt: string; postedAt: string | null;
}
interface Row {
    id: string; lineNo: number; externalLoanId: string; customerId: string; status: string;
    values: Record<string, string>; issues: { field: string; message: string }[]; warnings: string[];
    preview: { instalments?: number; instalmentAmount?: string; maturityDate?: string; daysPastDue?: number; interestOpening?: string; accrualDifference?: string };
    loanAccountId: string | null; loanReference: string | null;
}
interface BatchDetail extends Batch {
    businessDate: string; totals: Totals[]; controlTotals: { currency: string; loans: number; principal: string }[]; fileIssues: string[];
    readiness: { label: string; ok: boolean; detail: string }[]; ready: boolean; counts: Record<string, number>;
    rows: Row[]; rowTotal: number; page: number; permissions: { manage: Can; approve: Can };
}
interface ListResponse { batches: Batch[]; businessDate: string; permissions: { manage: Can; approve: Can } }

/* ── New file ────────────────────────────────────────────────────────────── */

function NewFile({ businessDate, can, onLoaded }: { businessDate: string; can: Can; onLoaded: (id: string) => void }) {
    const t = useTranslations('LendingMigration');
    const input = useRef<HTMLInputElement>(null);
    const [file, setFile] = useState<{ name: string; content: string; rows: number } | null>(null);
    const [cutOver, setCutOver] = useState(businessDate);
    const [controls, setControls] = useState<{ currency: string; loans: string; principal: string }[]>([]);
    const [dragging, setDragging] = useState(false);
    const [legacyProduct, setLegacyProduct] = useState('');
    const { busy, error, run, clearError } = useAction();

    const read = async (f: File | undefined) => {
        if (!f) return;
        const content = await f.text();
        setFile({ name: f.name, content, rows: Math.max(0, content.split(/\r?\n/).filter((l) => l.trim()).length - 1) });
    };
    const submit = async () => {
        if (!file) return;
        const body = {
            fileName: file.name,
            content: file.content,
            cutOverDate: cutOver,
            controlTotals: controls
                .filter((c) => c.currency.trim())
                .map((c) => ({ currency: c.currency.trim().toUpperCase(), loans: Number(c.loans) || 0, principal: c.principal.trim() || '0' })),
        };
        const res = await run('upload', () => api.post<BatchDetail>('/lending/migrations', body));
        if (res) { setFile(null); setControls([]); onLoaded(res.data.id); }
    };

    return (
        <Card title={t('load.title')} subtitle={t('load.subtitle')}>
            <div className="space-y-4">
                <ol className="grid gap-4 md:grid-cols-3">
                    <li className="space-y-2">
                        <div className="text-[12px] font-bold uppercase tracking-wide text-[#8792A2]">{t('load.step1')}</div>
                        <button
                            type="button"
                            onClick={() => input.current?.click()}
                            onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
                            onDragLeave={() => setDragging(false)}
                            onDrop={(e) => { e.preventDefault(); setDragging(false); void read(e.dataTransfer.files[0]); }}
                            className={`flex w-full flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed px-3 py-6 text-center transition-colors ${dragging ? 'border-[#635BFF] bg-[#F0F5FF]' : 'border-[#E3E8EE] hover:border-[#635BFF]'}`}
                        >
                            {file ? <FileSpreadsheet size={22} className="text-[#635BFF]" /> : <UploadCloud size={22} className="text-[#8792A2]" />}
                            <span className="text-[13px] font-semibold text-[#1A1F36]">{file ? file.name : t('load.drop')}</span>
                            <span className="text-[12px] text-[#697386]">{file ? t('loansCount', { count: file.rows }) : t('load.upTo')}</span>
                        </button>
                        <input ref={input} type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => void read(e.target.files?.[0])} />
                        <a href="/api/proxy/lending/migrations/template.csv" className="inline-flex items-center gap-1 text-[12px] font-semibold text-[#635BFF] hover:underline">
                            <Download size={12} /> {t('load.template')}
                        </a>
                        <div className="rounded-md border border-[#E3E8EE] bg-[#F7FAFC] p-2 text-[12px] text-[#3C4257]">
                            <div className="font-semibold">{t('load.legacyQuestion')}</div>
                            <div className="mt-1 flex items-center gap-1">
                                <TextInput value={legacyProduct} onChange={setLegacyProduct} placeholder={t('load.productCode')} className="w-40" />
                                <a href={`/api/proxy/lending/migrations/legacy-export.csv${qs({ productCode: legacyProduct.trim() })}`} className="inline-flex items-center gap-1 font-semibold text-[#635BFF] hover:underline">
                                    <Download size={12} /> {t('load.export')}
                                </a>
                            </div>
                        </div>
                    </li>
                    <li className="space-y-2">
                        <div className="text-[12px] font-bold uppercase tracking-wide text-[#8792A2]">{t('load.step2')}</div>
                        <Field label={t('load.balancesAsAt')} hint={t('load.balancesHint', { date: businessDate })}>
                            <TextInput type="date" value={cutOver} onChange={setCutOver} />
                        </Field>
                    </li>
                    <li className="space-y-2">
                        <div className="text-[12px] font-bold uppercase tracking-wide text-[#8792A2]">{t('load.step3')}</div>
                        <p className="text-[12px] text-[#697386]">{t('load.controlsNote')}</p>
                        {controls.map((c, i) => (
                            <div key={i} className="flex items-center gap-1">
                                <TextInput value={c.currency} onChange={(v) => setControls(controls.map((x, j) => (j === i ? { ...x, currency: v } : x)))} placeholder="USD" maxLength={3} className="w-16" />
                                <TextInput value={c.loans} onChange={(v) => setControls(controls.map((x, j) => (j === i ? { ...x, loans: v } : x)))} placeholder={t('load.loans')} inputMode="numeric" className="w-20" />
                                <TextInput value={c.principal} onChange={(v) => setControls(controls.map((x, j) => (j === i ? { ...x, principal: v } : x)))} placeholder={t('load.principal')} inputMode="decimal" />
                                <button type="button" aria-label={t('load.remove')} onClick={() => setControls(controls.filter((_, j) => j !== i))} className="p-1 text-[#8792A2] hover:text-red-600"><Trash2 size={14} /></button>
                            </div>
                        ))}
                        <Btn size="sm" variant="ghost" onClick={() => setControls([...controls, { currency: 'USD', loans: '', principal: '' }])}><Plus size={13} /> {t('load.addCurrency')}</Btn>
                    </li>
                </ol>
                <div className="flex items-center gap-3 border-t border-[#E3E8EE] pt-3">
                    <Btn variant="primary" onClick={submit} busy={busy === 'upload'} disabled={!file || !can.allowed} reason={!can.allowed ? can.reason : !file ? t('load.chooseFirst') : undefined}>
                        {t('load.check')}
                    </Btn>
                    <span className="text-[12px] text-[#697386]">{t('load.checkNote')}</span>
                </div>
                <ErrorBox error={error} onDismiss={clearError} />
            </div>
        </Card>
    );
}

/* ── File detail ─────────────────────────────────────────────────────────── */

const FILTERS = [
    { value: '', label: 'ALL' },
    { value: 'ERROR', label: 'ERROR' },
    { value: 'WARNING', label: 'WARNING' },
    { value: 'POSTED', label: 'POSTED' },
    { value: 'FAILED', label: 'FAILED' },
] as const;

function BatchPanel({ id, onChanged }: { id: string; onChanged: () => void }) {
    const t = useTranslations('LendingMigration');
    const href = useLendingHref();
    const confirm = useConfirm();
    const { showToast } = useToast();
    const [filter, setFilter] = useState<'' | 'ERROR' | 'WARNING' | 'POSTED' | 'FAILED'>('');
    const [page, setPage] = useState(1);
    const b = useApi<BatchDetail>(`/lending/migrations/${id}${qs({ status: filter, page: String(page) })}`);
    const { busy, error, run, clearError } = useAction();
    const d = b.data;
    if (b.loading && !d) return <Card><Spinner /></Card>;
    if (!d) return b.error ? <Card><ErrorBox error={b.error} /></Card> : null;

    const approve = async () => {
        const summary = d.totals.map((x) => t('batch.totalsItem', { loans: x.loans, currency: x.currency, principal: x.principal })).join('; ');
        const ok = await confirm({
            title: t('batch.postTitle', { reference: d.reference }),
            message: t('batch.postMessage', { count: d.validCount, summary, date: d.cutOverDate }),
            confirmLabel: t('batch.approvePost'),
            variant: 'warning',
        });
        if (!ok) return;
        const res = await run('approve', () => api.post<BatchDetail>(`/lending/migrations/${id}/decision`, { approve: true }));
        if (res) { showToast(t('batch.posted', { count: res.data.postedCount }), 'success'); b.reload(); onChanged(); }
    };
    const reject = async () => {
        if (!(await confirm({ title: t('batch.rejectTitle'), message: t('batch.rejectMessage'), confirmLabel: t('batch.reject'), variant: 'danger' }))) return;
        if (await run('reject', () => api.post(`/lending/migrations/${id}/decision`, { approve: false }))) { b.reload(); onChanged(); }
    };
    const cancel = async () => {
        if (await run('cancel', () => api.post(`/lending/migrations/${id}/cancel`))) { b.reload(); onChanged(); }
    };
    const pages = Math.max(1, Math.ceil(d.rowTotal / 100));
    const open = d.status === 'VALIDATED' || d.status === 'PARTIALLY_POSTED';

    return (
        <Card title={<span className="flex items-center gap-2">{d.reference} <StatusBadge status={d.status} /></span>} subtitle={t('batch.subtitle', { file: d.fileName, date: d.cutOverDate, loaded: fmtDateTime(d.createdAt) })}>
            <div className="space-y-5">
                {d.status === 'POSTED' && (
                    <Notice tone="success" title={t('batch.posted', { count: d.postedCount })}>
                        {t.rich('batch.postedBody', { link: (chunks) => <Link href={href('/lending/accounting')} className="font-semibold underline">{chunks}</Link> })}
                    </Notice>
                )}
                {d.status === 'PARTIALLY_POSTED' && (
                    <Notice tone="warn" title={t('batch.partial', { posted: d.postedCount, failed: d.failedCount })}>{t('batch.partialBody')}</Notice>
                )}

                {open && (
                    <ul className="divide-y divide-[#F0F2F5] rounded-md border border-[#E3E8EE]">
                        {d.readiness.map((r) => (
                            <li key={r.label} className="flex items-start gap-3 px-3 py-2.5">
                                {r.ok ? <CheckCircle2 size={16} className="mt-0.5 shrink-0 text-emerald-600" /> : <XCircle size={16} className="mt-0.5 shrink-0 text-red-600" />}
                                <div>
                                    <div className="text-[13px] font-medium text-[#1A1F36]">{r.label}</div>
                                    <div className="text-[12px] text-[#697386]">{r.detail}</div>
                                </div>
                            </li>
                        ))}
                    </ul>
                )}

                <div className="grid gap-3 md:grid-cols-2">
                    {d.totals.length === 0 ? <Empty>{t('batch.noValid')}</Empty> : d.totals.map((tot) => (
                        <div key={tot.currency} className="rounded-md border border-[#E3E8EE] p-3">
                            <div className="mb-2 flex items-center justify-between">
                                <span className="text-[13px] font-bold text-[#1A1F36]">{tot.currency} · {t('loansCount', { count: tot.loans })}</span>
                                {tot.inArrears > 0 && <span className="text-[12px] text-amber-700">{t('batch.inArrears', { count: tot.inArrears })}</span>}
                            </div>
                            <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-[12px]">
                                <dt className="text-[#697386]">{t('batch.principal')}</dt><dd className="text-right font-semibold"><MoneyCell value={tot.principal} currency={tot.currency} /></dd>
                                <dt className="text-[#697386]">{t('batch.interest')}</dt><dd className="text-right"><MoneyCell value={tot.interest} /></dd>
                                <dt className="text-[#697386]">{t('batch.feesPenalties')}</dt><dd className="text-right"><MoneyCell value={String(Number(tot.fees) + Number(tot.penalties))} /></dd>
                                <dt className="text-[#697386]">{t('batch.allowance')}</dt><dd className="text-right"><MoneyCell value={tot.allowance} /></dd>
                                <dt className="text-[#697386]" title={t('batch.accrualHint')}>{t('batch.accrualDifference')}</dt><dd className="text-right"><MoneyCell value={tot.accrualDifference} /></dd>
                            </dl>
                        </div>
                    ))}
                </div>

                <div className="space-y-2">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                        <Tabs value={filter} onChange={(v) => { setFilter(v); setPage(1); }} tabs={FILTERS.map((f) => ({ value: f.value, label: f.value && d.counts[f.value] ? t('batch.filterCount', { label: t(`batch.filter.${f.label}`), count: d.counts[f.value] }) : t(`batch.filter.${f.label}`) }))} />
                        {(d.errorCount > 0 || d.warningCount > 0 || d.failedCount > 0) && (
                            <a href={`/api/proxy/lending/migrations/${id}/issues.csv`} className="inline-flex items-center gap-1 text-[12px] font-semibold text-[#635BFF] hover:underline"><Download size={12} /> {t('batch.issuesCsv')}</a>
                        )}
                    </div>
                    {d.rows.length === 0 ? <Empty>{t('batch.noRows')}</Empty> : (
                        <Table>
                            <thead>
                                <tr className="border-b border-[#E3E8EE] bg-[#F7FAFC]">
                                    <th className={th}>{t('batch.colLine')}</th><th className={th}>{t('batch.colLoan')}</th><th className={th}>{t('batch.colCustomer')}</th><th className={th}>{t('batch.colProduct')}</th>
                                    <th className={thR}>{t('batch.colOutstanding')}</th><th className={thR}>{t('batch.colDpd')}</th><th className={th}>{t('batch.colStatus')}</th><th className={th}>{t('batch.colNotes')}</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-[#F0F2F5]">
                                {d.rows.map((r) => (
                                    <tr key={r.id} className="align-top">
                                        <td className={`${td} text-[#8792A2]`}>{r.lineNo}</td>
                                        <td className={td}>
                                            <div className="font-mono text-[12px]">{r.externalLoanId}</div>
                                            {r.loanAccountId && <Link href={href(`/lending/loans/${r.loanAccountId}`)} className="text-[12px] font-semibold text-[#635BFF] hover:underline">{r.loanReference ?? t('batch.openLoan')}</Link>}
                                        </td>
                                        <td className={td}>{r.values.first_name} {r.values.last_name}<div className="text-[11px] text-[#8792A2]">{r.customerId}</div></td>
                                        <td className={td}>{r.values.product_code}</td>
                                        <td className={tdR}><MoneyCell value={r.values.principal_outstanding ?? '0'} currency={r.values.currency} /></td>
                                        <td className={`${tdR} ${r.preview.daysPastDue ? 'text-red-600 font-semibold' : ''}`}>{r.preview.daysPastDue ?? '—'}</td>
                                        <td className={td}><StatusBadge status={r.status} /></td>
                                        <td className={`${td} max-w-md text-[12px]`}>
                                            {r.issues.map((i, k) => <div key={k} className="text-red-700"><b>{i.field.replace(/_/g, ' ')}</b> {i.message}</div>)}
                                            {r.warnings.map((w, k) => <div key={k} className="text-amber-800">{w}</div>)}
                                            {!r.issues.length && !r.warnings.length && r.preview.instalments && (
                                                <span className="text-[#697386]">{t.rich('batch.preview', { count: r.preview.instalments, amount: () => <MoneyCell value={r.preview.instalmentAmount ?? '0'} />, date: r.preview.maturityDate ?? '' })}</span>
                                            )}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </Table>
                    )}
                    {pages > 1 && (
                        <div className="flex items-center justify-end gap-2 text-[12px]">
                            <Btn size="sm" variant="ghost" disabled={page <= 1} onClick={() => setPage(page - 1)}>{t('batch.previous')}</Btn>
                            <span>{t('batch.page', { page, pages })}</span>
                            <Btn size="sm" variant="ghost" disabled={page >= pages} onClick={() => setPage(page + 1)}>{t('batch.next')}</Btn>
                        </div>
                    )}
                </div>

                {open && (
                    <div className="flex flex-wrap gap-2 border-t border-[#E3E8EE] pt-4">
                        <Btn variant="primary" onClick={approve} busy={busy === 'approve'} disabled={!d.permissions.approve.allowed || !d.ready}
                            reason={!d.permissions.approve.allowed ? d.permissions.approve.reason : !d.ready ? t('batch.readinessMust') : undefined}>
                            {t('batch.approvePost')}
                        </Btn>
                        {d.status === 'VALIDATED' && (
                            <>
                                <Btn variant="danger" onClick={reject} disabled={!d.permissions.approve.allowed || busy !== null} reason={d.permissions.approve.reason || undefined}>{t('batch.reject')}</Btn>
                                <Btn variant="ghost" onClick={cancel} busy={busy === 'cancel'} disabled={!d.permissions.manage.allowed} reason={d.permissions.manage.reason || undefined}>{t('batch.cancelFile')}</Btn>
                            </>
                        )}
                    </div>
                )}
                <ErrorBox error={error} onDismiss={clearError} />
            </div>
        </Card>
    );
}

/* ── Page ────────────────────────────────────────────────────────────────── */

export function LoanMigrationView() {
    const t = useTranslations('LendingMigration');
    const list = useApi<ListResponse>('/lending/migrations');
    const [selected, setSelected] = useState<string | null>(null);
    const data = list.data;
    const shown = selected ?? data?.batches[0]?.id ?? null;

    return (
        <LendingShell title={t('title')} subtitle={t('subtitle')}>
            {list.error && <ErrorBox error={list.error} />}
            {!data ? <Spinner /> : (
                <>
                    <NewFile businessDate={data.businessDate} can={data.permissions.manage} onLoaded={(id) => { setSelected(id); list.reload(); }} />
                    <Card title={t('files')} bodyClass="p-0">
                        {data.batches.length === 0 ? <div className="p-5"><Empty>{t('noFiles')}</Empty></div> : (
                            <Table>
                                <thead>
                                    <tr className="border-b border-[#E3E8EE] bg-[#F7FAFC]">
                                        <th className={th}>{t('colFile')}</th><th className={th}>{t('colCutOver')}</th><th className={thR}>{t('colLoans')}</th><th className={thR}>{t('colErrors')}</th><th className={thR}>{t('colPosted')}</th><th className={th}>{t('colStatus')}</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-[#F0F2F5]">
                                    {data.batches.map((b) => (
                                        <tr key={b.id} onClick={() => setSelected(b.id)} className={`cursor-pointer hover:bg-[#F7FAFC] ${shown === b.id ? 'bg-[#F0F5FF]' : ''}`}>
                                            <td className={td}><div className="font-semibold text-[#1A1F36]">{b.reference}</div><div className="text-[11px] text-[#8792A2]">{b.fileName}</div></td>
                                            <td className={td}>{b.cutOverDate}</td>
                                            <td className={tdR}>{b.rowCount}</td>
                                            <td className={`${tdR} ${b.errorCount ? 'text-red-600 font-semibold' : ''}`}>{b.errorCount}</td>
                                            <td className={tdR}>{b.postedCount}</td>
                                            <td className={td}><StatusBadge status={b.status} /></td>
                                        </tr>
                                    ))}
                                </tbody>
                            </Table>
                        )}
                    </Card>
                    {shown && <BatchPanel key={shown} id={shown} onChanged={list.reload} />}
                </>
            )}
        </LendingShell>
    );
}
