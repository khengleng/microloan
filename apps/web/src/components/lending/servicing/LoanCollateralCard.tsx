"use client";

import { useState } from 'react';
import api from '@/lib/api';
import { useToast } from '@/components/ui/toast';
import { useTranslations } from 'next-intl';
import { Person } from '../People';
import { useBusinessDate } from '../useBusinessDate';
import { ActionPanel, Btn, Card, Empty, ErrorBox, Field, Notice, Table, TextInput, td, tdR, th, thR } from '../ui';
import { useAction, useApi } from '../useAsync';
import { MoneyCell } from '../MoneyCell';
import { StatusBadge } from '../StatusBadge';
import { CollateralForm } from '../origination/ApplicationForms';

interface Pledge {
    pledgeId: string; collateralId: string; type: string; description: string; status: string;
    marketValue: string | null; valuationDate: string | null; haircut: string; priorLienAmount: string;
    releaseReference: string | null;
}
interface MarginCallRow {
    id: string; status: string; ltv: string; maxLtv: string; requiredRepayment: string; requiredCollateral: string; deadline: string; resolution: string;
}
interface CollateralView {
    outstanding: string; lendingValue: string; priorLiens: string; ltv: string | null; maxLtv: string | null;
    pledges: Pledge[]; marginCalls: MarginCallRow[]; pendingReleases: { id: string; makerId: string; payload: { collateralId: string; reference: string } }[];
}

const MONEY_RE = /^\d+(\.\d{1,4})?$/;

/**
 * Collateral on a running loan: LTV, revaluation and margin calls (UC-51),
 * more collateral, and release after closure (UC-73).
 */
export function LoanCollateralCard({ loanId, currency, status, can }: {
    loanId: string; currency: string; status: string; can: (code: string) => { allowed: boolean; reason?: string };
}) {
    const t = useTranslations('Servicing.collateral');
    const businessDate = useBusinessDate();
    const { showToast } = useToast();
    const view = useApi<CollateralView>(`/lending/loans/${loanId}/collateral`);
    const [panel, setPanel] = useState<null | { revalue: Pledge } | 'pledge' | { release: Pledge }>(null);
    const [value, setValue] = useState('');
    const [valuer, setValuer] = useState('');
    const [reference, setReference] = useState('');
    const [valuationDate, setValuationDate] = useState('');
    const [problem, setProblem] = useState<{ value?: string; valuer?: string; date?: string; reference?: string }>({});
    const { busy, error, run, clearError } = useAction();
    const revalueCap = can('loan.collateral.revalue');
    const releaseCap = can('loan.collateral.release.propose');
    const signOffCap = can('loan.collateral.release.approve');
    // The API takes more collateral on booked and active loans (pledging uses the revalue permission).
    const canPledge = ['ACTIVE', 'BOOKED'].includes(status) && revalueCap.allowed;

    const v = view.data;
    if (!v) return null;
    // No pledges: show the card only where something can be pledged.
    if (v.pledges.length === 0 && v.pendingReleases.length === 0 && !canPledge) return null;
    const pct = (x: string | null) => (x === null ? '—' : `${(Number(x) * 100).toFixed(2)}%`);
    const open = v.marginCalls.find((m) => m.status === 'OPEN');
    const done = (msg: string) => { showToast(msg, 'success'); setPanel(null); view.reload(); };

    const revalue = async (p: Pledge) => {
        const date = valuationDate || businessDate;
        const e: typeof problem = {};
        if (!MONEY_RE.test(value.trim()) || !/[1-9]/.test(value)) e.value = t('valueInvalid');
        if (valuer.trim().length < 2) e.valuer = t('valuerInvalid');
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) e.date = t('dateInvalid');
        else if (date > businessDate) e.date = t('dateFuture', { date: businessDate });
        setProblem(e);
        if (Object.keys(e).length) return;
        const res = await run('revalue', () => api.post<{ marginCall: MarginCallRow | null }>(`/lending/loans/${loanId}/collateral/${p.collateralId}/valuations`, {
            marketValue: value.trim(), valuationDate: date, valuer: valuer.trim(), method: 'MARKET',
        }));
        if (res) done(res.data.marginCall ? 'Revalued — the loan is above max LTV: margin call opened' : 'Revalued');
    };
    const release = async (p: Pledge) => {
        if (reference.trim().length < 2) { setProblem({ reference: t('referenceInvalid') }); return; }
        setProblem({});
        const res = await run('release', () => api.post(`/lending/loans/${loanId}/collateral/${p.collateralId}/release`, { reference: reference.trim() }));
        if (res) done('Release proposed — a different user signs it off');
    };
    const decide = async (taskId: string, approve: boolean) => {
        const res = await run(`${taskId}:${approve}`, () => api.post(`/lending/loans/${loanId}/collateral-releases/${taskId}/decision`, { approve }));
        if (res) done(approve ? 'Collateral released' : 'Release rejected');
    };

    return (
        <Card
            title="Collateral"
            subtitle={`Loan-to-value ${pct(v.ltv)}${v.maxLtv ? ` (max ${pct(v.maxLtv)})` : ''} · owed ${v.outstanding} against lending value ${v.lendingValue}${Number(v.priorLiens) > 0 ? ` after ${v.priorLiens} ranking ahead` : ''}`}
            actions={canPledge ? <Btn size="sm" onClick={() => setPanel('pledge')}>{v.pledges.length ? 'Pledge more collateral' : t('pledge')}</Btn> : undefined}
            bodyClass="p-0"
        >
            {open && (
                <div className="p-4 border-b border-[#E3E8EE]">
                    <Notice tone="danger" title={`Margin call — cure by ${open.deadline}`}>
                        LTV {pct(open.ltv)} is above {pct(open.maxLtv)}. The borrower must repay {currency} {open.requiredRepayment} or add collateral worth {currency} {open.requiredCollateral}.
                    </Notice>
                </div>
            )}
            {v.pendingReleases.map((t) => (
                <div key={t.id} className="p-4 border-b border-[#E3E8EE]">
                    <Notice tone="warn" title="Collateral release awaiting sign-off">
                        <p>Reference {t.payload.reference}; proposed by <Person id={t.makerId} />. A different user must sign it off.</p>
                        {signOffCap.allowed && (
                            <div className="flex gap-2 mt-2">
                                <Btn size="sm" variant="primary" onClick={() => decide(t.id, true)} busy={busy === `${t.id}:true`}>Sign off release</Btn>
                                <Btn size="sm" variant="danger" onClick={() => decide(t.id, false)} busy={busy === `${t.id}:false`}>Reject</Btn>
                            </div>
                        )}
                    </Notice>
                </div>
            ))}
            {panel === 'pledge' && (
                <div className="p-4 border-b border-[#E3E8EE]">
                    <CollateralForm appId="" currency={currency} endpoint={`/lending/loans/${loanId}/collateral`} onDone={() => done('Collateral pledged')} onClose={() => setPanel(null)} />
                </div>
            )}
            {panel && typeof panel === 'object' && 'revalue' in panel && (
                <div className="p-4 border-b border-[#E3E8EE]">
                    <ActionPanel title={`Revalue ${panel.revalue.type}`} onClose={() => setPanel(null)}>
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                            <Field label={`New market value (${currency})`} error={problem.value}><TextInput value={value} onChange={setValue} inputMode="decimal" /></Field>
                            <Field label="Valuer" error={problem.valuer}><TextInput value={valuer} onChange={setValuer} maxLength={120} /></Field>
                            <Field label={t('valuationDate')} hint={t('valuationDateHint', { date: businessDate })} error={problem.date}><TextInput type="date" value={valuationDate || businessDate} onChange={setValuationDate} max={businessDate} /></Field>
                        </div>
                        <Btn variant="primary" onClick={() => revalue(panel.revalue)} busy={busy === 'revalue'}>Record valuation</Btn>
                    </ActionPanel>
                </div>
            )}
            {panel && typeof panel === 'object' && 'release' in panel && (
                <div className="p-4 border-b border-[#E3E8EE]">
                    <ActionPanel title={`Release ${panel.release.type}`} onClose={() => setPanel(null)}>
                        <Field label="Returned-document reference" hint="Title deed / receipt number given back to the borrower" error={problem.reference}><TextInput value={reference} onChange={setReference} maxLength={120} /></Field>
                        <Btn variant="primary" onClick={() => release(panel.release)} busy={busy === 'release'}>Propose release</Btn>
                    </ActionPanel>
                </div>
            )}
            <ErrorBox error={error} onDismiss={clearError} />
            {v.pledges.length === 0 ? <Empty>{t('none')}</Empty> : (
                <Table>
                    <thead><tr className="border-b border-[#E3E8EE] bg-[#F7FAFC]"><th className={th}>Asset</th><th className={th}>Status</th><th className={thR}>Market value</th><th className={th}>Valued</th><th className={thR}>Ranking ahead</th><th className={th}></th></tr></thead>
                    <tbody className="divide-y divide-[#F0F2F5]">
                        {v.pledges.map((p) => (
                            <tr key={p.pledgeId}>
                                <td className={td}><b>{p.type}</b><div className="text-[12px] text-[#697386]">{p.description}</div></td>
                                <td className={td}><StatusBadge status={p.status} />{p.releaseReference && <div className="text-[11px] text-[#697386]">ref {p.releaseReference}</div>}</td>
                                <td className={tdR}>{p.marketValue ? <MoneyCell value={p.marketValue} currency={currency} /> : '—'}</td>
                                <td className={td}>{p.valuationDate ?? '—'}</td>
                                <td className={tdR}><MoneyCell value={p.priorLienAmount} /></td>
                                <td className={td}>
                                    {p.status === 'ACTIVE' && status === 'ACTIVE' && revalueCap.allowed && <Btn size="sm" onClick={() => { setValue(''); setValuationDate(''); setProblem({}); setPanel({ revalue: p }); }}>Revalue</Btn>}
                                    {p.status === 'ACTIVE' && status === 'CLOSED' && releaseCap.allowed && <Btn size="sm" onClick={() => { setReference(''); setProblem({}); setPanel({ release: p }); }}>Release</Btn>}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </Table>
            )}
            {v.marginCalls.length > 0 && (
                <div className="p-4 text-[12px] text-[#697386]">
                    Margin calls: {v.marginCalls.map((m) => `${m.status.toLowerCase()} (${m.deadline})`).join(' · ')}
                </div>
            )}
        </Card>
    );
}
