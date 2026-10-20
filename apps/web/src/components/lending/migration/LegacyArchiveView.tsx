"use client";

import { useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Archive, Download } from 'lucide-react';
import { useWorkspace } from '@/lib/workspace';
import { LendingShell, useLendingHref } from '../LendingShell';
import { ActionPanel, Btn, Card, Empty, ErrorBox, Field, Notice, SelectInput, Spinner, Table, TextInput, td, tdR, th, thR } from '../ui';
import { Pager } from '../Pager';
import { StatusBadge } from '../StatusBadge';
import { qs, useApi } from '../useAsync';
import { fmtDateTime, fmtMoney } from '../format';

const PAGE = 50;
const STATUSES = ['OPEN', 'UNFUNDED', 'PENDING', 'APPROVED', 'DISBURSED', 'DEFAULTED', 'CLOSED', 'WRITTEN_OFF', 'REJECTED'] as const;

interface Row {
    id: string; borrowerId: string; borrowerName: string; branch: string | null; product: string | null; status: string; currency: string;
    principal: string; principalOutstanding: string; overdueAmount: string; daysPastDue: number; startDate: string | null; termMonths: number;
    migratedTo: { loanAccountId: string; reference: string | null } | null;
    migratable: boolean; migrationBlock: 'NOT_OPEN' | 'NO_FUTURE_INSTALMENT' | null;
}
interface Summary {
    total: number; open: number; unfunded: number; migrated: number;
    openPrincipal: { currency: string; amount: string }[];
}
interface Detail extends Row {
    annualInterestRate: string; interestMethod: string; createdAt: string; writtenOffAt: string | null; writeOffReason: string | null;
    schedule: { number: number; dueDate: string | null; principal: string; interest: string; penalty: string; total: string; paid: string; isPaid: boolean }[];
    repayments: { id: string; date: string; amount: string; currency: string; principal: string; interest: string; penalty: string; reversedAt: string | null; reversalReason: string | null }[];
}

/**
 * The legacy loan archive (D-154): the original module's loans, read-only.
 * Open loans are moved to the lending platform with the loan-book migration;
 * the whole archive downloads as CSV so nothing is stranded.
 */
export function LegacyArchiveView() {
    const t = useTranslations('LegacyArchive');
    const href = useLendingHref();
    const params = useSearchParams();
    const { can } = useWorkspace();
    const borrowerId = params?.get('borrowerId') ?? '';
    const [draft, setDraft] = useState({ status: '', q: '' });
    const [applied, setApplied] = useState(draft);
    const [page, setPage] = useState(1);
    const [selected, setSelected] = useState<string | null>(params?.get('loan') ?? null);
    const filter = { ...applied, borrowerId: borrowerId || undefined };
    const summary = useApi<Summary>('/lending/legacy-archive/summary');
    const list = useApi<{ data: Row[]; total: number }>(`/lending/legacy-archive/loans${qs({ ...filter, page, limit: PAGE })}`);
    const s = summary.data;

    const migration = (r: Row) => {
        if (r.migratedTo)
            return <Link href={href(`/lending/loans/${r.migratedTo.loanAccountId}`)} className="text-[#635BFF] hover:underline">{t('migratedTo', { reference: r.migratedTo.reference ?? '' })}</Link>;
        if (r.migratable) return <span className="text-emerald-700 font-semibold">{t('readyToMigrate')}</span>;
        if (r.migrationBlock === 'NO_FUTURE_INSTALMENT') return <span className="text-amber-800">{t('pastMaturity')}</span>;
        return <span className="text-[#AAB7C4]">—</span>;
    };

    return (
        <LendingShell
            title={t('title')}
            subtitle={t('subtitle')}
            actions={
                <a href={`/api/proxy/lending/legacy-archive/export.csv${qs(filter)}`} className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[13px] font-semibold rounded border border-[#E3E8EE] bg-white text-[#3C4257] hover:bg-slate-50">
                    <Download size={14} /> {t('exportCsv')}
                </a>
            }
        >
            <ErrorBox error={summary.error ?? list.error} />
            <Notice tone="info" title={t('readOnlyTitle')}>
                <p>{t('readOnlyBody')}</p>
                {(can('loan.migration.manage') || can('loan.migration.approve')) && (
                    <p className="mt-1.5">
                        <Link href={href('/lending/migration')} className="font-semibold underline">{t('openMigration')}</Link>
                        {can('loan.migration.manage') && (
                            <> · <a href="/api/proxy/lending/migrations/legacy-export.csv" className="font-semibold underline">{t('downloadMigrationFile')}</a></>
                        )}
                    </p>
                )}
            </Notice>

            {s && (
                <div className="grid gap-3 grid-cols-2 lg:grid-cols-5">
                    <Tile label={t('total')} value={s.total} />
                    <Tile label={t('open')} value={s.open} />
                    <Tile label={t('unfunded')} value={s.unfunded} />
                    <Tile label={t('migrated')} value={s.migrated} />
                    <div className="bg-white border border-[#E3E8EE] rounded-lg p-4">
                        <p className="text-[12px] text-[#697386]">{t('openPrincipal')}</p>
                        {s.openPrincipal.length === 0 ? <p className="text-[20px] font-bold text-[#1A1F36] mt-1">0</p> : s.openPrincipal.map((p) => (
                            <p key={p.currency} className="text-[16px] font-bold text-[#1A1F36] mt-1 tabular-nums">{fmtMoney(p.amount)} {p.currency}</p>
                        ))}
                    </div>
                </div>
            )}
            {s && s.unfunded > 0 && <Notice tone="warn">{t('unfundedNote', { count: s.unfunded })}</Notice>}

            <Card>
                <div className="grid gap-3 grid-cols-1 md:grid-cols-4 items-end">
                    <Field label={t('status')}>
                        <SelectInput value={draft.status} onChange={(v) => setDraft((d) => ({ ...d, status: v }))} placeholder={t('allStatuses')}
                            options={STATUSES.map((v) => ({ value: v, label: t(`statuses.${v}`) }))} />
                    </Field>
                    <Field label={t('search')} hint={t('searchHint')}>
                        <TextInput value={draft.q} onChange={(v) => setDraft((d) => ({ ...d, q: v }))} />
                    </Field>
                    <div className="flex gap-2">
                        <Btn variant="primary" onClick={() => { setApplied(draft); setPage(1); }}>{t('apply')}</Btn>
                        {borrowerId && <Link href={href('/lending/legacy-archive')} className="text-[13px] font-semibold text-[#635BFF] self-center hover:underline">{t('allBorrowers')}</Link>}
                    </div>
                </div>
            </Card>

            <Card title={t('loansTitle')} bodyClass="p-0">
                {list.loading && !list.data ? <Spinner /> : !list.data || list.data.data.length === 0 ? (
                    <Empty><Archive size={18} className="inline mr-1" />{t('noLoans')}</Empty>
                ) : (
                    <Table>
                        <thead className="bg-[#F7FAFC] border-b border-[#E3E8EE]">
                            <tr>
                                <th className={th}>{t('borrower')}</th><th className={th}>{t('branch')}</th><th className={th}>{t('product')}</th><th className={th}>{t('status')}</th>
                                <th className={thR}>{t('principal')}</th><th className={thR}>{t('outstanding')}</th><th className={thR}>{t('overdue')}</th><th className={thR}>{t('daysPastDue')}</th>
                                <th className={th}>{t('migration')}</th><th className={th} />
                            </tr>
                        </thead>
                        <tbody>
                            {list.data.data.map((r) => (
                                <tr key={r.id} className={`border-b border-[#F0F2F5] ${selected === r.id ? 'bg-[#F0F5FF]' : ''}`}>
                                    <td className={td}>{r.borrowerName}<div className="font-mono text-[11px] text-[#8792A2]">{r.id.slice(0, 8)}</div></td>
                                    <td className={td}>{r.branch ?? ''}</td><td className={td}>{r.product ?? ''}</td>
                                    <td className={td}><StatusBadge status={r.status} /></td>
                                    <td className={tdR}>{fmtMoney(r.principal)} {r.currency}</td><td className={tdR}>{fmtMoney(r.principalOutstanding)}</td>
                                    <td className={tdR}>{fmtMoney(r.overdueAmount)}</td><td className={tdR}>{r.daysPastDue}</td>
                                    <td className={td}>{migration(r)}</td>
                                    <td className={td}><Btn size="sm" onClick={() => setSelected(r.id)}>{t('view')}</Btn></td>
                                </tr>
                            ))}
                        </tbody>
                    </Table>
                )}
                {list.data && <div className="px-5 py-3"><Pager page={page} total={list.data.total} pageSize={PAGE} onPage={setPage} /></div>}
            </Card>

            {selected && <LoanDetail id={selected} onClose={() => setSelected(null)} />}
        </LendingShell>
    );
}

function Tile({ label, value }: { label: string; value: number }) {
    return (
        <div className="bg-white border border-[#E3E8EE] rounded-lg p-4">
            <p className="text-[12px] text-[#697386]">{label}</p>
            <p className="text-[20px] font-bold text-[#1A1F36] mt-1 tabular-nums">{value.toLocaleString()}</p>
        </div>
    );
}

function LoanDetail({ id, onClose }: { id: string; onClose: () => void }) {
    const t = useTranslations('LegacyArchive');
    const { data, error, loading } = useApi<Detail>(`/lending/legacy-archive/loans/${id}`);
    return (
        <ActionPanel title={data ? t('detailTitle', { borrower: data.borrowerName }) : t('detail')} onClose={onClose}>
            <ErrorBox error={error} />
            {loading && !data ? <Spinner /> : data && (
                <div className="space-y-4">
                    <dl className="grid grid-cols-2 md:grid-cols-4 gap-3 text-[13px]">
                        <div><dt className="text-[#697386]">{t('status')}</dt><dd><StatusBadge status={data.status} /></dd></div>
                        <div><dt className="text-[#697386]">{t('principal')}</dt><dd className="font-semibold">{fmtMoney(data.principal)} {data.currency}</dd></div>
                        <div><dt className="text-[#697386]">{t('rate')}</dt><dd className="font-semibold">{data.annualInterestRate}% · {data.interestMethod}</dd></div>
                        <div><dt className="text-[#697386]">{t('term')}</dt><dd className="font-semibold">{t('termMonths', { count: data.termMonths })} · {data.startDate ?? ''}</dd></div>
                        <div><dt className="text-[#697386]">{t('outstanding')}</dt><dd className="font-semibold">{fmtMoney(data.principalOutstanding)}</dd></div>
                        <div><dt className="text-[#697386]">{t('overdue')}</dt><dd className="font-semibold">{fmtMoney(data.overdueAmount)} · {t('daysPastDueShort', { count: data.daysPastDue })}</dd></div>
                        {data.writtenOffAt && <div className="col-span-2"><dt className="text-[#697386]">{t('writtenOff')}</dt><dd>{fmtDateTime(data.writtenOffAt)} · {data.writeOffReason ?? ''}</dd></div>}
                    </dl>
                    <Table>
                        <thead className="bg-[#F7FAFC] border-b border-[#E3E8EE]">
                            <tr><th className={th}>#</th><th className={th}>{t('dueDate')}</th><th className={thR}>{t('principal')}</th><th className={thR}>{t('interest')}</th><th className={thR}>{t('penalty')}</th><th className={thR}>{t('scheduleTotal')}</th><th className={thR}>{t('paid')}</th></tr>
                        </thead>
                        <tbody>
                            {data.schedule.map((l) => (
                                <tr key={l.number} className="border-b border-[#F0F2F5]">
                                    <td className={td}>{l.number}</td><td className={td}>{l.dueDate}</td><td className={tdR}>{fmtMoney(l.principal)}</td><td className={tdR}>{fmtMoney(l.interest)}</td>
                                    <td className={tdR}>{fmtMoney(l.penalty)}</td><td className={tdR}>{fmtMoney(l.total)}</td><td className={tdR}>{fmtMoney(l.paid)}</td>
                                </tr>
                            ))}
                        </tbody>
                    </Table>
                    <h3 className="text-[13px] font-bold text-[#1A1F36]">{t('repayments')}</h3>
                    {data.repayments.length === 0 ? <p className="text-[13px] text-[#697386]">{t('noRepayments')}</p> : (
                        <Table>
                            <thead className="bg-[#F7FAFC] border-b border-[#E3E8EE]">
                                <tr><th className={th}>{t('date')}</th><th className={thR}>{t('amount')}</th><th className={thR}>{t('principal')}</th><th className={thR}>{t('interest')}</th><th className={thR}>{t('penalty')}</th><th className={th}>{t('reversed')}</th></tr>
                            </thead>
                            <tbody>
                                {data.repayments.map((r) => (
                                    <tr key={r.id} className="border-b border-[#F0F2F5]">
                                        <td className={td}>{fmtDateTime(r.date)}</td><td className={tdR}>{fmtMoney(r.amount)} {r.currency}</td><td className={tdR}>{fmtMoney(r.principal)}</td>
                                        <td className={tdR}>{fmtMoney(r.interest)}</td><td className={tdR}>{fmtMoney(r.penalty)}</td>
                                        <td className={td}>{r.reversedAt ? `${fmtDateTime(r.reversedAt)} · ${r.reversalReason ?? ''}` : ''}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </Table>
                    )}
                </div>
            )}
        </ActionPanel>
    );
}
