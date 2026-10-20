"use client";

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Download } from 'lucide-react';
import { useWorkspace } from '@/lib/workspace';
import { LendingShell, useLendingHref } from '../LendingShell';
import { Btn, Card, Empty, ErrorBox, Field, Notice, SelectInput, Spinner, Table, Tabs, TextInput, td, tdR, th, thR } from '../ui';
import { Pager } from '../Pager';
import { StatusBadge } from '../StatusBadge';
import { qs, useApi } from '../useAsync';
import { fmtMoney } from '../format';
import Link from 'next/link';

const PAGE = 25;
export const AGEING_BANDS = ['CURRENT', 'D1_30', 'D31_60', 'D61_90', 'D90_PLUS'] as const;

interface PortfolioRow {
    id: string; reference: string; borrowerName: string; branch: string; product: string; familyCode: string;
    currency: string; status: string; bookedPrincipal: string; principalOutstanding: string; interestReceivable: string;
    chargesReceivable: string; daysPastDue: number; band: string; classification: string | null;
    disbursementDate: string | null; maturityDate: string | null;
}
interface Portfolio {
    businessDate: string; reportingCurrency: string;
    filters: { branches: { id: string; name: string }[]; products: { id: string; name: string }[]; currencies: string[] };
    summary: { currency: string; loans: number; principalOutstanding: string; interestReceivable: string; overdueOutstanding: string; par30Pct: string | null; allowance: string }[];
    totals: { loans: number; principalOutstanding: string; overdueOutstanding: string; par30Pct: string | null } | null;
    unconverted: string[];
    data: PortfolioRow[]; total: number; page: number;
}
interface ReceiptRow {
    id: string; valueDate: string; type: string; loanAccountId: string | null; reference: string | null; borrowerName: string | null;
    currency: string; amount: string; principal: string; interest: string; charges: string; unallocated: string; externalReference: string | null;
}
interface Receipts {
    businessDate: string; reportingCurrency: string; from: string; to: string;
    summary: { currency: string; count: number; amount: string; byType: Record<string, string> }[];
    totals: { count: number; amount: string } | null;
    unconverted: string[];
    data: ReceiptRow[]; total: number; page: number;
}

const pct = (v: string | null | undefined) => (v === null || v === undefined ? '—' : `${v}%`);

/** Reports on the lending book (D-153): the loan portfolio and money received, with CSV exports. */
export function LendingReportsView() {
    const t = useTranslations('LendingReports');
    const { can } = useWorkspace();
    const [tab, setTab] = useState<'portfolio' | 'receipts'>('portfolio');
    return (
        <LendingShell title={t('title')} subtitle={t('subtitle')}>
            <Tabs value={tab} onChange={setTab} tabs={[{ value: 'portfolio', label: t('tabPortfolio') }, { value: 'receipts', label: t('tabReceipts') }]} />
            {tab === 'portfolio' ? <PortfolioTab mayExport={can('loan_data.export')} /> : <ReceiptsTab mayExport={can('loan_data.export')} />}
        </LendingShell>
    );
}

function CsvLink({ href, label }: { href: string; label: string }) {
    return (
        <a href={`/api/proxy${href}`} className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[13px] font-semibold rounded border border-[#E3E8EE] bg-white text-[#3C4257] hover:bg-slate-50">
            <Download size={14} /> {label}
        </a>
    );
}

function PortfolioTab({ mayExport }: { mayExport: boolean }) {
    const t = useTranslations('LendingReports');
    const href = useLendingHref();
    const [draft, setDraft] = useState({ status: '', currency: '', branchId: '', productId: '', band: '', q: '' });
    const [applied, setApplied] = useState(draft);
    const [page, setPage] = useState(1);
    const query = qs({ ...applied, page, limit: PAGE });
    const { data, error, loading } = useApi<Portfolio>(`/lending/reports/portfolio${query}`);
    const set = (k: keyof typeof draft) => (v: string) => setDraft((d) => ({ ...d, [k]: v }));
    return (
        <div className="space-y-4">
            <ErrorBox error={error} />
            <Card>
                <div className="grid gap-3 grid-cols-2 md:grid-cols-3 lg:grid-cols-6 items-end">
                    <Field label={t('status')}>
                        <SelectInput value={draft.status} onChange={set('status')} placeholder={t('statusOpen')}
                            options={['BOOKED', 'ACTIVE', 'CLOSED', 'WRITTEN_OFF'].map((s) => ({ value: s, label: t(`statuses.${s}`) }))} />
                    </Field>
                    <Field label={t('currency')}>
                        <SelectInput value={draft.currency} onChange={set('currency')} placeholder={t('all')}
                            options={(data?.filters.currencies ?? []).map((c) => ({ value: c, label: c }))} />
                    </Field>
                    <Field label={t('branch')}>
                        <SelectInput value={draft.branchId} onChange={set('branchId')} placeholder={t('all')}
                            options={(data?.filters.branches ?? []).map((b) => ({ value: b.id, label: b.name }))} />
                    </Field>
                    <Field label={t('product')}>
                        <SelectInput value={draft.productId} onChange={set('productId')} placeholder={t('all')}
                            options={(data?.filters.products ?? []).map((p) => ({ value: p.id, label: p.name }))} />
                    </Field>
                    <Field label={t('ageing')}>
                        <SelectInput value={draft.band} onChange={set('band')} placeholder={t('all')}
                            options={AGEING_BANDS.map((b) => ({ value: b, label: t(`bands.${b}`) }))} />
                    </Field>
                    <Field label={t('reference')}>
                        <TextInput value={draft.q} onChange={set('q')} />
                    </Field>
                </div>
                <div className="flex flex-wrap gap-2 mt-3">
                    <Btn variant="primary" onClick={() => { setApplied(draft); setPage(1); }}>{t('apply')}</Btn>
                    <Btn variant="ghost" onClick={() => { const e = { status: '', currency: '', branchId: '', productId: '', band: '', q: '' }; setDraft(e); setApplied(e); setPage(1); }}>{t('reset')}</Btn>
                    {mayExport && <CsvLink href={`/lending/reports/portfolio.csv${qs(applied)}`} label={t('exportCsv')} />}
                </div>
            </Card>
            {loading && !data ? <Spinner /> : data && (
                <>
                    <p className="text-[13px] text-[#697386]">{t('asOf', { date: data.businessDate, currency: data.reportingCurrency })}</p>
                    {data.unconverted.length > 0 && <Notice tone="warn">{t('unconverted', { currencies: data.unconverted.join(', '), currency: data.reportingCurrency })}</Notice>}
                    {data.totals && (
                        <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
                            <Stat label={t('loans')} value={data.totals.loans.toLocaleString()} />
                            <Stat label={t('principalOutstanding')} value={`${fmtMoney(data.totals.principalOutstanding)} ${data.reportingCurrency}`} />
                            <Stat label={t('overdueOutstanding')} value={`${fmtMoney(data.totals.overdueOutstanding)} ${data.reportingCurrency}`} />
                            <Stat label={t('par30')} value={pct(data.totals.par30Pct)} />
                        </div>
                    )}
                    {data.summary.length > 1 && (
                        <Card title={t('byCurrency')} bodyClass="p-0">
                            <Table>
                                <thead className="bg-[#F7FAFC] border-b border-[#E3E8EE]">
                                    <tr><th className={th}>{t('currency')}</th><th className={thR}>{t('loans')}</th><th className={thR}>{t('principalOutstanding')}</th><th className={thR}>{t('overdueOutstanding')}</th><th className={thR}>{t('par30')}</th><th className={thR}>{t('allowance')}</th></tr>
                                </thead>
                                <tbody>
                                    {data.summary.map((s) => (
                                        <tr key={s.currency} className="border-b border-[#F0F2F5]">
                                            <td className={td}>{s.currency}</td><td className={tdR}>{s.loans}</td><td className={tdR}>{fmtMoney(s.principalOutstanding)}</td>
                                            <td className={tdR}>{fmtMoney(s.overdueOutstanding)}</td><td className={tdR}>{pct(s.par30Pct)}</td><td className={tdR}>{fmtMoney(s.allowance)}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </Table>
                        </Card>
                    )}
                    <Card title={t('loansTitle')} bodyClass="p-0">
                        {data.data.length === 0 ? <Empty>{t('noLoans')}</Empty> : (
                            <Table>
                                <thead className="bg-[#F7FAFC] border-b border-[#E3E8EE]">
                                    <tr>
                                        <th className={th}>{t('reference')}</th><th className={th}>{t('borrower')}</th><th className={th}>{t('branch')}</th><th className={th}>{t('product')}</th>
                                        <th className={th}>{t('status')}</th><th className={thR}>{t('principalOutstanding')}</th><th className={thR}>{t('interest')}</th>
                                        <th className={thR}>{t('daysPastDue')}</th><th className={th}>{t('maturity')}</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {data.data.map((l) => (
                                        <tr key={l.id} className="border-b border-[#F0F2F5]">
                                            <td className={td}><Link href={href(`/lending/loans/${l.id}`)} className="font-mono text-[#635BFF] hover:underline">{l.reference}</Link></td>
                                            <td className={td}>{l.borrowerName}</td><td className={td}>{l.branch}</td><td className={td}>{l.product}</td>
                                            <td className={td}><StatusBadge status={l.status} /></td>
                                            <td className={tdR}>{fmtMoney(l.principalOutstanding)} {l.currency}</td><td className={tdR}>{fmtMoney(l.interestReceivable)}</td>
                                            <td className={tdR}>{l.daysPastDue}</td><td className={td}>{l.maturityDate ?? ''}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </Table>
                        )}
                        <div className="px-5 py-3"><Pager page={page} total={data.total} pageSize={PAGE} onPage={setPage} /></div>
                    </Card>
                </>
            )}
        </div>
    );
}

function ReceiptsTab({ mayExport }: { mayExport: boolean }) {
    const t = useTranslations('LendingReports');
    const href = useLendingHref();
    const [draft, setDraft] = useState({ from: '', to: '', currency: '' });
    const [applied, setApplied] = useState(draft);
    const [page, setPage] = useState(1);
    const { data, error, loading } = useApi<Receipts>(`/lending/reports/receipts${qs({ ...applied, page, limit: PAGE })}`);
    const set = (k: keyof typeof draft) => (v: string) => setDraft((d) => ({ ...d, [k]: v }));
    return (
        <div className="space-y-4">
            <ErrorBox error={error} />
            <Card>
                <div className="grid gap-3 grid-cols-2 md:grid-cols-4 items-end">
                    <Field label={t('from')}><TextInput type="date" value={draft.from} onChange={set('from')} /></Field>
                    <Field label={t('to')}><TextInput type="date" value={draft.to} onChange={set('to')} /></Field>
                    <Field label={t('currency')}><TextInput value={draft.currency} onChange={(v) => set('currency')(v.toUpperCase())} maxLength={3} /></Field>
                    <div className="flex flex-wrap gap-2">
                        <Btn variant="primary" onClick={() => { setApplied(draft); setPage(1); }}>{t('apply')}</Btn>
                        {mayExport && <CsvLink href={`/lending/reports/receipts.csv${qs(applied)}`} label={t('exportCsv')} />}
                    </div>
                </div>
            </Card>
            {loading && !data ? <Spinner /> : data && (
                <>
                    <p className="text-[13px] text-[#697386]">{t('period', { from: data.from, to: data.to, currency: data.reportingCurrency })}</p>
                    {data.unconverted.length > 0 && <Notice tone="warn">{t('unconverted', { currencies: data.unconverted.join(', '), currency: data.reportingCurrency })}</Notice>}
                    {data.totals && (
                        <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
                            <Stat label={t('payments')} value={data.totals.count.toLocaleString()} />
                            <Stat label={t('received')} value={`${fmtMoney(data.totals.amount)} ${data.reportingCurrency}`} />
                            {data.summary.map((s) => <Stat key={s.currency} label={t('receivedIn', { currency: s.currency })} value={fmtMoney(s.amount)} />)}
                        </div>
                    )}
                    <Card title={t('receiptsTitle')} bodyClass="p-0">
                        {data.data.length === 0 ? <Empty>{t('noReceipts')}</Empty> : (
                            <Table>
                                <thead className="bg-[#F7FAFC] border-b border-[#E3E8EE]">
                                    <tr>
                                        <th className={th}>{t('valueDate')}</th><th className={th}>{t('reference')}</th><th className={th}>{t('borrower')}</th><th className={th}>{t('type')}</th>
                                        <th className={thR}>{t('amount')}</th><th className={thR}>{t('principal')}</th><th className={thR}>{t('interest')}</th><th className={thR}>{t('charges')}</th><th className={th}>{t('externalReference')}</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {data.data.map((e) => (
                                        <tr key={e.id} className="border-b border-[#F0F2F5]">
                                            <td className={td}>{e.valueDate}</td>
                                            <td className={td}>{e.loanAccountId ? <Link href={href(`/lending/loans/${e.loanAccountId}`)} className="font-mono text-[#635BFF] hover:underline">{e.reference}</Link> : '—'}</td>
                                            <td className={td}>{e.borrowerName ?? ''}</td><td className={td}><StatusBadge status={e.type} /></td>
                                            <td className={tdR}>{fmtMoney(e.amount)} {e.currency}</td><td className={tdR}>{fmtMoney(e.principal)}</td><td className={tdR}>{fmtMoney(e.interest)}</td><td className={tdR}>{fmtMoney(e.charges)}</td>
                                            <td className={td}>{e.externalReference ?? ''}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </Table>
                        )}
                        <div className="px-5 py-3"><Pager page={page} total={data.total} pageSize={PAGE} onPage={setPage} /></div>
                    </Card>
                </>
            )}
        </div>
    );
}

export function Stat({ label, value, note }: { label: string; value: string; note?: string }) {
    return (
        <div className="bg-white border border-[#E3E8EE] rounded-lg p-4">
            <p className="text-[12px] text-[#697386]">{label}</p>
            <p className="text-[20px] font-bold text-[#1A1F36] mt-1 tabular-nums">{value}</p>
            {note && <p className="text-[12px] text-[#697386] mt-1">{note}</p>}
        </div>
    );
}
