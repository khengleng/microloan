"use client";

import { useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useWorkspace } from '@/lib/workspace';
import { LendingShell, useLendingHref } from '../LendingShell';
import { Btn, Card, Empty, ErrorBox, Notice, SelectInput, Spinner, Table, Tabs, TextInput, td, tdR, th, thR } from '../ui';
import { qs, useApi } from '../useAsync';
import { MoneyCell } from '../MoneyCell';
import { ReceiptsTable } from './ReceiptsTable';
import { StatementImportPanel } from './StatementImportPanel';
import { CodesPanel } from './CodesPanel';
import { RECEIPT_SOURCES, RECEIPT_STATUSES, type QueueView } from './types';

type Tab = 'receipts' | 'statements' | 'suspense' | 'codes';
const TABS: Tab[] = ['receipts', 'statements', 'suspense', 'codes'];

/**
 * KHQR repayments (D-160…D-165): receipts waiting for a second person,
 * bank statement imports and what they matched, the KHQR money still held
 * in suspense, and the lender's static codes.
 */
export function QrRepaymentsView() {
    const params = useSearchParams();
    const initial = params?.get('tab') as Tab | null;
    const [tab, setTab] = useState<Tab>(initial && TABS.includes(initial) ? initial : 'receipts');
    const t = useTranslations('LendingQr.view');
    const tn = useTranslations('Workspace.nav');
    return (
        <LendingShell title={tn('qrRepayments')} subtitle={t('subtitle')}>
            <Notice tone="info" title={t('noAutoTitle')}>{t('noAutoBody')}</Notice>
            <Tabs<Tab> value={tab} onChange={setTab} tabs={TABS.map((v) => ({ value: v, label: t(`tab_${v}`) }))} />
            {tab === 'receipts' && <ReceiptsPanel />}
            {tab === 'statements' && <StatementImportPanel />}
            {tab === 'suspense' && <SuspensePanel />}
            {tab === 'codes' && <CodesPanel />}
        </LendingShell>
    );
}

function ReceiptsPanel() {
    const t = useTranslations('LendingQr.queue');
    const ts = useTranslations('LendingQr.source');
    const tst = useTranslations('LendingQr.status');
    const [status, setStatus] = useState('PENDING');
    const [source, setSource] = useState('');
    const [search, setSearch] = useState('');
    const [applied, setApplied] = useState('');
    const view = useApi<QueueView>(`/lending/khqr/receipts${qs({ status, source, search: applied })}`);
    const counts = view.data?.counts ?? {};
    return (
        <Card
            title={t('title')}
            subtitle={t('subtitle', { pending: counts.PENDING ?? 0, posted: counts.POSTED ?? 0, rejected: counts.REJECTED ?? 0 })}
            bodyClass="p-0"
            actions={<>
                <SelectInput value={status} onChange={setStatus} placeholder={t('allStatuses')} options={RECEIPT_STATUSES.map((s) => ({ value: s, label: tst(s) }))} className="!w-36" />
                <SelectInput value={source} onChange={setSource} placeholder={t('allSources')} options={RECEIPT_SOURCES.map((s) => ({ value: s, label: ts(s) }))} className="!w-44" />
                <TextInput value={search} onChange={setSearch} placeholder={t('search')} className="!w-48" onKeyDown={(e) => { if (e.key === 'Enter') setApplied(search.trim()); }} aria-label={t('search')} />
                <Btn size="sm" variant="ghost" onClick={() => { setApplied(search.trim()); view.reload(); }}>{t('refresh')}</Btn>
            </>}
        >
            {view.error && <div className="p-4"><ErrorBox error={view.error} /></div>}
            {view.loading && !view.data ? <Spinner /> : !view.data?.receipts.length ? <Empty>{t('none')}</Empty> : (
                <ReceiptsTable receipts={view.data.receipts} onChanged={view.reload} />
            )}
        </Card>
    );
}

interface HeldPayment {
    id: string; reference: string; amount: string; remaining: string; currency: string; valueDate: string;
    channel: string; externalReference: string; payerName: string | null; narrative: string; ageDays: number; status: string;
}

/** KHQR money held in unidentified payments: allocated on the suspense screen. */
function SuspensePanel() {
    const t = useTranslations('LendingQr.suspense');
    const href = useLendingHref();
    const { can } = useWorkspace();
    const view = useApi<{ payments: HeldPayment[] }>(`/lending/suspense${qs({ status: 'OPEN', channel: 'KHQR' })}`);
    const rows = view.data?.payments ?? [];
    return (
        <Card title={t('title')} subtitle={t('subtitle')} bodyClass="p-0" actions={<Link href={href('/lending/suspense')} className="text-[12px] font-semibold text-[#635BFF] hover:underline">{t('open')}</Link>}>
            {view.error && <div className="p-4"><ErrorBox error={view.error} /></div>}
            {view.loading && !view.data ? <Spinner /> : !rows.length ? <Empty>{t('none')}</Empty> : (
                <Table>
                    <thead>
                        <tr className="border-b border-[#E3E8EE] bg-[#F7FAFC]">
                            <th className={th}>{t('colReference')}</th><th className={th}>{t('colDate')}</th><th className={th}>{t('colBankRef')}</th>
                            <th className={th}>{t('colPayer')}</th><th className={thR}>{t('colHeld')}</th><th className={th}>{t('colWhy')}</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-[#F0F2F5]">
                        {rows.map((p) => (
                            <tr key={p.id}>
                                <td className={`${td} font-mono text-[12px]`}>{p.reference}</td>
                                <td className={td}>{p.valueDate}<p className="text-[11px] text-[#697386]">{t('age', { days: p.ageDays })}</p></td>
                                <td className={`${td} font-mono text-[12px]`}>{p.externalReference.replace(/^KHQR /, '')}</td>
                                <td className={td}>{p.payerName ?? '—'}</td>
                                <td className={tdR}><MoneyCell value={p.remaining} currency={p.currency} /></td>
                                <td className={`${td} text-[12px]`}>{p.narrative}</td>
                            </tr>
                        ))}
                    </tbody>
                </Table>
            )}
            {!can('loan.repayment.post') && rows.length > 0 && <p className="p-4 text-[12px] text-[#697386]">{t('readOnly')}</p>}
        </Card>
    );
}
