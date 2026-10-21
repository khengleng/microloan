"use client";

import { useState } from 'react';
import Link from 'next/link';
import api from '@/lib/api';
import { useTranslations } from 'next-intl';
import { useToast } from '@/components/ui/toast';
import { useWorkspace } from '@/lib/workspace';
import { useLendingHref } from '../LendingShell';
import { Btn, ErrorBox, Field, Table, TextInput, td, tdR, th, thR } from '../ui';
import { idem, useAction, useIdempotencyKey } from '../useAsync';
import { MoneyCell } from '../MoneyCell';
import { StatusBadge } from '../StatusBadge';
import { fmtDateTime } from '../format';
import type { Receipt } from './types';

/**
 * KHQR receipts with their verify / reject actions. Verifying posts the
 * repayment (channel KHQR); the person who recorded a receipt cannot decide
 * it, and a borrower's claim is decided by staff (D-160).
 */
export function ReceiptsTable({ receipts, onChanged, showLoan = true }: {
    receipts: Receipt[]; onChanged: () => void; showLoan?: boolean;
}) {
    const t = useTranslations('LendingQr.receipts');
    const href = useLendingHref();
    const { can } = useWorkspace();
    const canDecide = can('loan.repayment.reverse');
    const [open, setOpen] = useState<{ id: string; mode: 'verify' | 'reject' } | null>(null);
    return (
        <Table>
            <thead>
                <tr className="border-b border-[#E3E8EE] bg-[#F7FAFC]">
                    <th className={th}>{t('colReceipt')}</th>
                    {showLoan && <th className={th}>{t('colLoan')}</th>}
                    <th className={th}>{t('colSource')}</th>
                    <th className={th}>{t('colPaid')}</th>
                    <th className={th}>{t('colBankRef')}</th>
                    <th className={th}>{t('colPayer')}</th>
                    <th className={thR}>{t('colAmount')}</th>
                    <th className={th}>{t('colStatus')}</th>
                    <th className={th}></th>
                </tr>
            </thead>
            <tbody className="divide-y divide-[#F0F2F5]">
                {receipts.map((r) => (
                    <ReceiptRow
                        key={r.id}
                        r={r}
                        showLoan={showLoan}
                        loanHref={href(`/lending/loans/${r.loanAccountId}`)}
                        canDecide={canDecide}
                        open={open?.id === r.id ? open.mode : null}
                        setOpen={(mode) => setOpen(mode ? { id: r.id, mode } : null)}
                        onChanged={onChanged}
                    />
                ))}
            </tbody>
        </Table>
    );
}

function ReceiptRow({ r, showLoan, loanHref, canDecide, open, setOpen, onChanged }: {
    r: Receipt; showLoan: boolean; loanHref: string; canDecide: boolean;
    open: 'verify' | 'reject' | null; setOpen: (m: 'verify' | 'reject' | null) => void; onChanged: () => void;
}) {
    const t = useTranslations('LendingQr.receipts');
    const ts = useTranslations('LendingQr.source');
    const { showToast } = useToast();
    const { busy, error, run, clearError } = useAction();
    const key = useIdempotencyKey();
    const [reason, setReason] = useState('');
    const pending = r.status === 'PENDING';
    const verify = async () => {
        const body = {};
        const k = key.keyFor({ id: r.id });
        const res = await run('verify', () => api.post(`/lending/khqr/receipts/${r.id}/verify`, body, idem(k)));
        if (res) { key.reset(); showToast(t('verified'), 'success'); setOpen(null); onChanged(); }
    };
    const reject = async () => {
        const res = await run('reject', () => api.post(`/lending/khqr/receipts/${r.id}/reject`, { reason: reason.trim() }));
        if (res) { showToast(t('rejected'), 'success'); setOpen(null); onChanged(); }
    };
    const why = r.yours ? t('yoursNote') : !canDecide ? t('noPermission') : undefined;
    return (
        <>
            <tr data-testid={`qr-receipt-${r.bankRef}`}>
                <td className={td}><span className="font-mono text-[12px]">{r.reference}</span><p className="text-[11px] text-[#697386]">{fmtDateTime(r.createdAt)}</p></td>
                {showLoan && (
                    <td className={td}>
                        <Link href={loanHref} className="text-[#635BFF] font-semibold hover:underline">{r.loanReference ?? '—'}</Link>
                        {r.borrowerName && <p className="text-[11px] text-[#697386]">{r.borrowerName}</p>}
                    </td>
                )}
                <td className={td}>{ts(r.source)}{r.unidentifiedPaymentId && <p className="text-[11px] text-emerald-700">{t('onStatement')}</p>}</td>
                <td className={td}>{r.valueDate}<p className="text-[11px] text-[#697386]">{fmtDateTime(r.paidAt)}</p></td>
                <td className={`${td} font-mono text-[12px]`}>{r.bankRef}</td>
                <td className={td}>{r.payerName ?? '—'}{r.payerAccount && <p className="text-[11px] text-[#697386]">{r.payerAccount}</p>}{r.remark && <p className="text-[11px] text-[#697386]">“{r.remark}”</p>}</td>
                <td className={tdR}><MoneyCell value={r.amount} currency={r.currency} /></td>
                <td className={td}><StatusBadge status={r.status} />{r.decisionNote && <p className="text-[11px] text-[#697386]">{r.decisionNote}</p>}</td>
                <td className={`${td} whitespace-nowrap`}>
                    {pending && (
                        <div className="flex gap-1">
                            <Btn size="sm" variant="primary" disabled={!!why} reason={why} onClick={() => setOpen(open === 'verify' ? null : 'verify')}>{t('verify')}</Btn>
                            <Btn size="sm" variant="ghost" disabled={!!why} reason={why} onClick={() => setOpen(open === 'reject' ? null : 'reject')}>{t('reject')}</Btn>
                        </div>
                    )}
                </td>
            </tr>
            {open && (
                <tr className="bg-[#F8F9FF]">
                    <td className={td} colSpan={showLoan ? 9 : 8}>
                        <div className="space-y-2 max-w-xl">
                            {open === 'verify' ? (
                                <>
                                    <p className="text-[12px] text-[#3C4257]">{r.unidentifiedPaymentId ? t('verifyFromSuspense') : t('verifyCheck', { amount: r.amount, currency: r.currency, ref: r.bankRef })}</p>
                                    <Btn variant="primary" onClick={verify} busy={busy === 'verify'}>{t('confirmVerify')}</Btn>
                                </>
                            ) : (
                                <>
                                    <Field label={t('rejectReason')}><TextInput value={reason} onChange={setReason} maxLength={500} /></Field>
                                    <Btn variant="danger" onClick={reject} busy={busy === 'reject'} disabled={reason.trim().length < 3}>{t('confirmReject')}</Btn>
                                </>
                            )}
                            <ErrorBox error={error} onDismiss={clearError} />
                        </div>
                    </td>
                </tr>
            )}
        </>
    );
}
