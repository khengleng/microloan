"use client";

import { useState } from 'react';
import api from '@/lib/api';
import { useToast } from '@/components/ui/toast';
import { ActionPanel, Btn, Card, Empty, ErrorBox, Field, Notice, Table, TextInput, td, tdR, th, thR } from '../ui';
import { useAction, useApi } from '../useAsync';
import { MoneyCell } from '../MoneyCell';
import { StatusBadge } from '../StatusBadge';
import { todayIso } from '../format';
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
export function LoanCollateralCard({ loanId, currency, status }: { loanId: string; currency: string; status: string }) {
    const { showToast } = useToast();
    const view = useApi<CollateralView>(`/lending/loans/${loanId}/collateral`);
    const [panel, setPanel] = useState<null | { revalue: Pledge } | 'pledge' | { release: Pledge }>(null);
    const [value, setValue] = useState('');
    const [valuer, setValuer] = useState('');
    const [reference, setReference] = useState('');
    const { busy, error, run, clearError } = useAction();

    const v = view.data;
    if (!v || v.pledges.length === 0) return null;
    const pct = (x: string | null) => (x === null ? '—' : `${(Number(x) * 100).toFixed(2)}%`);
    const open = v.marginCalls.find((m) => m.status === 'OPEN');
    const done = (msg: string) => { showToast(msg, 'success'); setPanel(null); view.reload(); };

    const revalue = async (p: Pledge) => {
        if (!MONEY_RE.test(value.trim()) || valuer.trim().length < 2) return;
        const res = await run('revalue', () => api.post<{ marginCall: MarginCallRow | null }>(`/lending/loans/${loanId}/collateral/${p.collateralId}/valuations`, {
            marketValue: value.trim(), valuationDate: todayIso(), valuer: valuer.trim(), method: 'MARKET',
        }));
        if (res) done(res.data.marginCall ? 'Revalued — the loan is above max LTV: margin call opened' : 'Revalued');
    };
    const release = async (p: Pledge) => {
        if (reference.trim().length < 2) return;
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
            actions={status === 'ACTIVE' ? <Btn size="sm" onClick={() => setPanel('pledge')}>Pledge more collateral</Btn> : undefined}
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
                        <p>Reference {t.payload.reference}; proposed by <span className="font-mono">{t.makerId.slice(0, 8)}</span>. A different user must sign it off.</p>
                        <div className="flex gap-2 mt-2">
                            <Btn size="sm" variant="primary" onClick={() => decide(t.id, true)} busy={busy === `${t.id}:true`}>Sign off release</Btn>
                            <Btn size="sm" variant="danger" onClick={() => decide(t.id, false)} busy={busy === `${t.id}:false`}>Reject</Btn>
                        </div>
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
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                            <Field label={`New market value (${currency})`}><TextInput value={value} onChange={setValue} inputMode="decimal" /></Field>
                            <Field label="Valuer"><TextInput value={valuer} onChange={setValuer} maxLength={120} /></Field>
                        </div>
                        <Btn variant="primary" onClick={() => revalue(panel.revalue)} busy={busy === 'revalue'}>Record valuation</Btn>
                    </ActionPanel>
                </div>
            )}
            {panel && typeof panel === 'object' && 'release' in panel && (
                <div className="p-4 border-b border-[#E3E8EE]">
                    <ActionPanel title={`Release ${panel.release.type}`} onClose={() => setPanel(null)}>
                        <Field label="Returned-document reference" hint="Title deed / receipt number given back to the borrower"><TextInput value={reference} onChange={setReference} maxLength={120} /></Field>
                        <Btn variant="primary" onClick={() => release(panel.release)} busy={busy === 'release'}>Propose release</Btn>
                    </ActionPanel>
                </div>
            )}
            <ErrorBox error={error} onDismiss={clearError} />
            {v.pledges.length === 0 ? <Empty>No collateral.</Empty> : (
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
                                    {p.status === 'ACTIVE' && status === 'ACTIVE' && <Btn size="sm" onClick={() => { setValue(''); setPanel({ revalue: p }); }}>Revalue</Btn>}
                                    {p.status === 'ACTIVE' && status === 'CLOSED' && <Btn size="sm" onClick={() => { setReference(''); setPanel({ release: p }); }}>Release</Btn>}
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
