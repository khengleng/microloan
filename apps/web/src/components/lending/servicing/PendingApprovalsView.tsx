"use client";

import { useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import api from '@/lib/api';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { useToast } from '@/components/ui/toast';
import { useWorkspace } from '@/lib/workspace';
import { LendingShell, useLendingHref } from '../LendingShell';
import { Btn, Card, Empty, ErrorBox, Notice, Spinner, Table, Tabs, td, tdR, th, thR } from '../ui';
import { idem, qs, useAction, useApi, useIdempotencyKey } from '../useAsync';
import { fmtDateTime } from '../format';
import { MoneyCell } from '../MoneyCell';

export type PendingKind = 'FEE_WAIVER' | 'ADVANCE_REFUND' | 'SET_OFF';
export const PENDING_KINDS: PendingKind[] = ['FEE_WAIVER', 'ADVANCE_REFUND', 'SET_OFF'];

interface PendingRow {
    id: string;
    action: PendingKind;
    requiredPermission: string;
    amount: string | null;
    currency: string;
    createdAt: string;
    makerId: string;
    makerEmail: string | null;
    mine: boolean;
    loan: { id: string; reference: string; status: string; borrowerName: string | null };
    detail: { kind: string | null; reason: string | null; sourceAccount: string | null; expiresOn: string | null };
}

/** The approve / reject call for each kind, as the loan screen makes it. */
const DECISION_PATH: Record<PendingKind, string> = {
    FEE_WAIVER: 'fee-waivers',
    ADVANCE_REFUND: 'advance-refunds',
    SET_OFF: 'set-offs',
};
/**
 * Fee waivers, advance refunds and set-offs waiting for a second person
 * (the "to approve" work queues land here). The maker's own items are shown
 * but cannot be decided by them, as the server enforces.
 */
export function PendingApprovalsView({ initial }: { initial: PendingKind }) {
    const t = useTranslations('Servicing.approvals');
    const href = useLendingHref();
    const confirm = useConfirm();
    const { showToast } = useToast();
    const { can, reloadWork } = useWorkspace();
    const [kind, setKind] = useState<PendingKind>(initial);
    const list = useApi<{ data: PendingRow[]; total: number }>(`/lending/loans/pending-approvals${qs({ action: kind })}`);
    const { busy, error, run, clearError } = useAction();
    const key = useIdempotencyKey();

    const decide = async (row: PendingRow, approve: boolean) => {
        const ok = await confirm({
            title: approve ? t('approveTitle') : t('rejectTitle'),
            message: t('confirm', { what: t(`kind.${row.action}`), loan: row.loan.reference, borrower: row.loan.borrowerName ?? '—' }),
            confirmLabel: approve ? t('approve') : t('reject'),
            variant: approve ? 'default' : 'danger',
        });
        if (!ok) return;
        const body = { approve };
        const res = await run(`${row.id}:${approve}`, () =>
            api.post(`/lending/loans/${row.loan.id}/${DECISION_PATH[row.action]}/${row.id}/decision`, body, idem(key.keyFor({ id: row.id, ...body }))));
        if (res) {
            key.reset();
            showToast(approve ? t('approved') : t('rejected'), 'success');
            list.reload();
            reloadWork();
        }
    };

    const rows = list.data?.data ?? [];
    return (
        <LendingShell title={t('title')} subtitle={t('subtitle')}>
            <Tabs tabs={PENDING_KINDS.map((k) => ({ value: k, label: t(`tab.${k}`) }))} value={kind} onChange={(k) => { setKind(k); clearError(); }} />
            {kind === 'ADVANCE_REFUND' && (
                <Notice tone="info">
                    {t('suspenseNote')} <Link href={href('/lending/suspense')} className="font-semibold text-[#635BFF] hover:underline">{t('openSuspense')}</Link>
                </Notice>
            )}
            <Card
                title={t(`tab.${kind}`)}
                subtitle={list.data ? t('count', { count: list.data.total }) : undefined}
                actions={<Btn variant="ghost" onClick={list.reload}>{t('refresh')}</Btn>}
                bodyClass="p-0"
            >
                {(error || list.error) && <div className="p-4"><ErrorBox error={error ?? list.error} onDismiss={clearError} /></div>}
                {list.loading && !list.data ? <Spinner /> : rows.length === 0 ? <Empty>{t('none')}</Empty> : (
                    <Table>
                        <thead>
                            <tr className="border-b border-[#E3E8EE] bg-[#F7FAFC]">
                                <th className={th}>{t('colLoan')}</th>
                                <th className={th}>{t('colBorrower')}</th>
                                <th className={thR}>{t('colAmount')}</th>
                                <th className={th}>{t('colDetail')}</th>
                                <th className={th}>{t('colMaker')}</th>
                                <th className={th}>{t('colSince')}</th>
                                <th className={th} />
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-[#F0F2F5]">
                            {rows.map((r) => {
                                // The task records the permission its checker needs (loan.repayment.reverse for all three).
                                const allowed = can(r.requiredPermission);
                                return (
                                    <tr key={r.id} className="align-top">
                                        <td className={td}><Link href={href(`/lending/loans/${r.loan.id}`)} className="font-mono text-[12px] font-semibold text-[#635BFF] hover:underline">{r.loan.reference}</Link></td>
                                        <td className={td}>{r.loan.borrowerName || '—'}</td>
                                        <td className={tdR}>{r.amount ? <MoneyCell value={r.amount} currency={r.currency} /> : '—'}</td>
                                        <td className={`${td} max-w-[280px] whitespace-normal text-[12px]`}>
                                            {r.detail.kind && <div className="font-semibold">{t.has(`feeKind.${r.detail.kind}`) ? t(`feeKind.${r.detail.kind}`) : r.detail.kind}</div>}
                                            {r.detail.sourceAccount && <div>{t('depositAccount', { account: r.detail.sourceAccount })}</div>}
                                            {r.detail.expiresOn && <div>{t('expiresOn', { date: r.detail.expiresOn })}</div>}
                                            {r.detail.reason && <div className="text-[#697386]">{r.detail.reason}</div>}
                                        </td>
                                        <td className={td}><span className="text-[12px]">{r.makerEmail ?? r.makerId.slice(0, 8)}</span></td>
                                        <td className={`${td} whitespace-nowrap`}>{fmtDateTime(r.createdAt)}</td>
                                        <td className={`${td} whitespace-nowrap`}>
                                            {r.mine ? <span className="text-[11px] text-[#697386]">{t('yours')}</span> : allowed ? (
                                                <div className="flex justify-end gap-1.5">
                                                    <Btn size="sm" variant="primary" onClick={() => decide(r, true)} busy={busy === `${r.id}:true`}>{t('approve')}</Btn>
                                                    <Btn size="sm" variant="danger" onClick={() => decide(r, false)} busy={busy === `${r.id}:false`}>{t('reject')}</Btn>
                                                </div>
                                            ) : <span className="text-[11px] text-[#697386]">{t('notYours')}</span>}
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </Table>
                )}
            </Card>
        </LendingShell>
    );
}

