"use client";

import { useState } from 'react';
import { useToast } from '@/components/ui/toast';
import { Btn, Card, ErrorBox, Table, td, tdR, th, thR } from '../ui';
import { useApi } from '../useAsync';
import { MoneyCell } from '../MoneyCell';
import { StatusBadge } from '../StatusBadge';
import { subDecimal } from '../format';
import { RecoveryTasks } from './RecoveryTasks';
import {
    ClaimForm, ClaimReceiptForm, DebtSaleForm, OneFieldForm, PawnForm, PolicyForm, RemittanceForm,
    RepossessionForm, RepossessionValuationForm, SaleForm,
} from './RecoveryForms';
import type { InsurancePolicy, LoanRecoveryView, PawnItem, Repossession } from './types';

type Can = (code: string) => { allowed: boolean; reason?: string };
type Panel =
    | 'repossess' | 'pawn' | 'policy' | 'debt-sale'
    | { value: Repossession } | { sell: Repossession }
    | { forfeit: PawnItem } | { auction: PawnItem } | { giveBack: PawnItem }
    | { remit: InsurancePolicy } | { claim: InsurancePolicy } | { receipt: { claimId: string; due: string } }
    | { payout: string };

const section = 'px-4 pt-4 pb-1 text-[12px] font-bold uppercase tracking-wide text-[#697386]';
const fmtDays = (n: number) => `${n} day${n === 1 ? '' : 's'}`;

/**
 * Recovery on the loan screen: repossession (UC-65), pawn custody and
 * auction (UC-66, LT-09), credit insurance and claims (UC-68, UC-06), and
 * debt sale (UC-71), with everything awaiting a second user's decision.
 */
export function LoanRecoveryCard({ loanId, currency, can, onChanged }: {
    loanId: string; currency: string; can: Can; onChanged?: () => void;
}) {
    const { showToast } = useToast();
    const view = useApi<LoanRecoveryView>(`/lending/loans/${loanId}/recovery`);
    const [panel, setPanel] = useState<Panel | null>(null);
    const v = view.data;
    if (!v) return view.error ? <Card title="Recovery"><ErrorBox error={view.error} /></Card> : null;

    const status = v.loan.status;
    const active = status === 'ACTIVE';
    const done = (msg: string) => { showToast(msg, 'success'); setPanel(null); view.reload(); onChanged?.(); };
    const close = () => setPanel(null);
    const btn = (label: string, p: Panel, action: string, variant: 'primary' | 'secondary' | 'danger' = 'secondary') => {
        const c = can(action);
        return <Btn size="sm" variant={variant} onClick={() => setPanel(p)} disabled={!c.allowed} reason={c.reason}>{label}</Btn>;
    };
    const has = v.repossessions.length + v.pawnItems.length + v.insurancePolicies.length + v.debtSales.length + v.refunds.length + v.pendingTasks.length > 0;
    if (!has && !active && status !== 'WRITTEN_OFF' && status !== 'BOOKED') return null;

    const activePledges = v.pledges.filter((p) => p.status === 'ACTIVE');
    const repossessable = active && activePledges.length > 0;
    const p = panel && typeof panel === 'object' ? panel : null;

    return (
        <Card
            title="Recovery"
            subtitle={`Repossession, pawn custody, credit insurance and debt sale · ${v.loan.daysPastDue} days past due · owed ${currency} ${v.loan.owed}. Repossession from ${fmtDays(v.rules.repossessionMinDpd)} past due; proceeds pay costs, then ${v.rules.proceedsOrder.join(' → ').toLowerCase()}.`}
            actions={
                <div className="flex flex-wrap gap-2">
                    {repossessable && btn('Repossess', 'repossess', 'loan.repossession.propose', 'danger')}
                    {(active || status === 'BOOKED') && btn('Pawn item', 'pawn', 'loan.pawn.custody')}
                    {active && btn('Insurance policy', 'policy', 'loan.insurance.manage')}
                    {(active || status === 'WRITTEN_OFF') && btn('Sell loan', 'debt-sale', 'loan.debt_sale.propose', 'danger')}
                </div>
            }
            bodyClass="p-0"
        >
            {v.pendingTasks.length > 0 && (
                <div className="p-4 border-b border-[#E3E8EE]">
                    <RecoveryTasks loanId={loanId} tasks={v.pendingTasks} currency={currency} can={can} onDone={done} />
                </div>
            )}
            {panel && (
                <div className="p-4 border-b border-[#E3E8EE]">
                    {panel === 'repossess' && <RepossessionForm loanId={loanId} pledges={activePledges} businessDate={v.businessDate} onDone={done} onClose={close} />}
                    {panel === 'pawn' && <PawnForm loanId={loanId} currency={currency} businessDate={v.businessDate} onDone={done} onClose={close} />}
                    {panel === 'policy' && <PolicyForm loanId={loanId} currency={currency} businessDate={v.businessDate} onDone={done} onClose={close} />}
                    {panel === 'debt-sale' && <DebtSaleForm loanId={loanId} currency={currency} businessDate={v.businessDate} onDone={done} onClose={close} />}
                    {p && 'value' in p && <RepossessionValuationForm loanId={loanId} repo={p.value} currency={currency} businessDate={v.businessDate} onDone={done} onClose={close} />}
                    {p && 'sell' in p && <SaleForm title="Sell the repossessed asset" endpoint={`/lending/loans/${loanId}/repossessions/${p.sell.id}/sale`} currency={currency} owed={v.loan.owed} businessDate={v.businessDate} onDone={done} onClose={close} />}
                    {p && 'auction' in p && <SaleForm title={`Auction: ${p.auction.description}`} endpoint={`/lending/loans/${loanId}/pawn-items/${p.auction.id}/sale`} currency={currency} owed={v.loan.owed} businessDate={v.businessDate} onDone={done} onClose={close} />}
                    {p && 'forfeit' in p && <OneFieldForm title={`Forfeit: ${p.forfeit.description}`} label="Reason" field="reason" multiline endpoint={`/lending/loans/${loanId}/pawn-items/${p.forfeit.id}/forfeiture`} button="Propose forfeiture" done="Forfeiture proposed — a different user approves it" onDone={done} onClose={close} />}
                    {p && 'giveBack' in p && <OneFieldForm title={`Return: ${p.giveBack.description}`} label="Return receipt reference" field="reference" endpoint={`/lending/loans/${loanId}/pawn-items/${p.giveBack.id}/return`} button="Record return" done="Item returned to the borrower" onDone={done} onClose={close} />}
                    {p && 'remit' in p && <RemittanceForm loanId={loanId} policy={p.remit} onDone={done} onClose={close} />}
                    {p && 'claim' in p && <ClaimForm loanId={loanId} policy={p.claim} businessDate={v.businessDate} onDone={done} onClose={close} />}
                    {p && 'receipt' in p && <ClaimReceiptForm loanId={loanId} claimId={p.receipt.claimId} due={p.receipt.due} currency={currency} onDone={done} onClose={close} />}
                    {p && 'payout' in p && <OneFieldForm title="Pay out the surplus" label="Payee (borrower, estate, or their representative)" field="payee" endpoint={`/lending/loans/${loanId}/recovery-refunds/${p.payout}/payout`} button="Propose payout" done="Payout proposed — a different user approves it" onDone={done} onClose={close} />}
                </div>
            )}

            {v.repossessions.length > 0 && (
                <>
                    <p className={section}>Repossession (UC-65)</p>
                    <Table>
                        <thead><tr className="border-b border-[#E3E8EE] bg-[#F7FAFC]"><th className={th}>Seized</th><th className={th}>Status</th><th className={thR}>Valuation</th><th className={thR}>Sale price</th><th className={thR}>Costs</th><th className={thR}>Surplus</th><th className={thR}>Deficiency</th><th className={th}></th></tr></thead>
                        <tbody className="divide-y divide-[#F0F2F5]">
                            {v.repossessions.map((r) => (
                                <tr key={r.id}>
                                    <td className={td}>{r.seizedOn}<div className="text-[12px] text-[#697386]">{r.location}</div></td>
                                    <td className={td}><StatusBadge status={r.status} />{r.buyer && <div className="text-[11px] text-[#697386]">to {r.buyer}</div>}</td>
                                    <td className={tdR}><MoneyCell value={r.valuationAmount} currency={currency} /></td>
                                    <td className={tdR}><MoneyCell value={r.salePrice} /></td>
                                    <td className={tdR}><MoneyCell value={r.saleCosts} /></td>
                                    <td className={tdR}><MoneyCell value={r.surplus} /></td>
                                    <td className={tdR}><MoneyCell value={r.deficiency} highlightNonZero /></td>
                                    <td className={td}>
                                        {active && (r.status === 'SEIZED' || r.status === 'VALUED') && btn(r.status === 'SEIZED' ? 'Value' : 'Revalue', { value: r }, 'loan.repossession.value')}
                                        {active && r.status === 'VALUED' && <span className="ml-1">{btn('Sell', { sell: r }, 'loan.repossession.sell', 'primary')}</span>}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </Table>
                </>
            )}

            {v.pawnItems.length > 0 && (
                <>
                    <p className={section}>Pawned items (UC-66, LT-09)</p>
                    <Table>
                        <thead><tr className="border-b border-[#E3E8EE] bg-[#F7FAFC]"><th className={th}>Item</th><th className={th}>Custody</th><th className={thR}>Weight × purity</th><th className={thR}>Value</th><th className={th}>Redeem by</th><th className={th}>Status</th><th className={th}></th></tr></thead>
                        <tbody className="divide-y divide-[#F0F2F5]">
                            {v.pawnItems.map((i) => (
                                <tr key={i.id}>
                                    <td className={td}><b>{i.description}</b><div className="text-[12px] text-[#697386]">{i.itemType}{i.sealNumber ? ` · seal ${i.sealNumber}` : ''}</div></td>
                                    <td className={td}>{i.custodyLocation}<div className="text-[12px] text-[#697386]">since {i.receivedOn}</div></td>
                                    <td className={tdR}>{i.weightGrams} g × {i.karat ? `${i.karat}k` : i.purity}<div className="text-[11px] text-[#697386]">@ {i.pricePerGram}/g</div></td>
                                    <td className={tdR}><MoneyCell value={i.appraisedValue} currency={currency} /></td>
                                    <td className={td}>{i.redemptionDeadline}{i.forfeitable && <div className="text-[11px] font-semibold text-red-600">past deadline</div>}</td>
                                    <td className={td}><StatusBadge status={i.status} />{i.status === 'SOLD' && <div className="text-[11px] text-[#697386]">{i.salePrice} to {i.buyer}</div>}{i.returnReference && <div className="text-[11px] text-[#697386]">ref {i.returnReference}</div>}</td>
                                    <td className={td}>
                                        {i.forfeitable && btn('Forfeit', { forfeit: i }, 'loan.pawn.forfeit.propose', 'danger')}
                                        {i.status === 'FORFEITED' && active && btn('Auction', { auction: i }, 'loan.pawn.sell', 'primary')}
                                        {i.status === 'IN_CUSTODY' && status === 'CLOSED' && btn('Return', { giveBack: i }, 'loan.pawn.return', 'primary')}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </Table>
                </>
            )}

            {v.insurancePolicies.length > 0 && (
                <>
                    <p className={section}>Credit insurance (UC-68, UC-06)</p>
                    <Table>
                        <thead><tr className="border-b border-[#E3E8EE] bg-[#F7FAFC]"><th className={th}>Insurer / policy</th><th className={th}>Cover</th><th className={thR}>Premium</th><th className={thR}>To remit</th><th className={th}>Claims</th><th className={th}></th></tr></thead>
                        <tbody className="divide-y divide-[#F0F2F5]">
                            {v.insurancePolicies.map((pol) => (
                                <tr key={pol.id}>
                                    <td className={td}><b>{pol.insurer}</b><div className="text-[12px] text-[#697386]">{pol.policyNumber} · from {pol.startDate}</div></td>
                                    <td className={td}>{pol.coverType.replace(/_/g, ' ').toLowerCase()}<div><StatusBadge status={pol.status} /></div></td>
                                    <td className={tdR}><MoneyCell value={pol.premium} currency={currency} /><div className="text-[11px] text-[#697386]">{pol.premiumTreatment.toLowerCase()}</div></td>
                                    <td className={tdR}><MoneyCell value={pol.premiumToRemit} highlightNonZero /></td>
                                    <td className={td}>
                                        {pol.claims.length === 0 ? '—' : pol.claims.map((c) => {
                                            const due = subDecimal(c.amountClaimed, c.received);
                                            return (
                                                <div key={c.id} className="text-[12px] mb-1">
                                                    {c.eventType.toLowerCase()} {c.eventDate} · <StatusBadge status={c.status} /> {c.amountClaimed}
                                                    {c.status === 'SETTLED' && <span className="text-[#697386]"> · insurer paid {c.received}</span>}
                                                    {c.status === 'SETTLED' && Number(due) > 0 && <span className="ml-1">{btn('Insurer paid', { receipt: { claimId: c.id, due } }, 'loan.insurance.claim.receive')}</span>}
                                                </div>
                                            );
                                        })}
                                    </td>
                                    <td className={td}>
                                        {Number(pol.premiumToRemit) > 0 && btn('Remit', { remit: pol }, 'loan.insurance.remit.propose')}
                                        {active && pol.status === 'ACTIVE' && !pol.claims.some((c) => c.status === 'PENDING') && <span className="ml-1">{btn('Claim', { claim: pol }, 'loan.insurance.claim.propose', 'danger')}</span>}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </Table>
                </>
            )}

            {v.debtSales.length > 0 && (
                <>
                    <p className={section}>Debt sale (UC-71)</p>
                    <Table>
                        <thead><tr className="border-b border-[#E3E8EE] bg-[#F7FAFC]"><th className={th}>Buyer</th><th className={th}>Date</th><th className={th}>Status</th><th className={thR}>Price</th><th className={thR}>Carrying amount</th><th className={thR}>Gain / loss</th></tr></thead>
                        <tbody className="divide-y divide-[#F0F2F5]">
                            {v.debtSales.map((s) => (
                                <tr key={s.id}>
                                    <td className={td}><b>{s.buyer}</b><div className="text-[12px] text-[#697386]">{s.reason}</div></td>
                                    <td className={td}>{s.saleDate}</td>
                                    <td className={td}><StatusBadge status={s.status} /></td>
                                    <td className={tdR}><MoneyCell value={s.price} currency={currency} /></td>
                                    <td className={tdR}><MoneyCell value={s.carryingAmount} /></td>
                                    <td className={tdR}><MoneyCell value={s.gainLoss} highlightNonZero={(s.gainLoss ?? '').startsWith('-')} /></td>
                                </tr>
                            ))}
                        </tbody>
                    </Table>
                </>
            )}

            {v.refunds.length > 0 && (
                <>
                    <p className={section}>Surplus owed to the borrower or estate</p>
                    <Table>
                        <thead><tr className="border-b border-[#E3E8EE] bg-[#F7FAFC]"><th className={th}>From</th><th className={th}>Payee</th><th className={th}>Status</th><th className={thR}>Amount</th><th className={th}></th></tr></thead>
                        <tbody className="divide-y divide-[#F0F2F5]">
                            {v.refunds.map((r) => {
                                const pending = v.pendingTasks.some((t) => t.action === 'RECOVERY_REFUND' && (t.payload as { refundId?: string }).refundId === r.id);
                                return (
                                    <tr key={r.id}>
                                        <td className={td}>{r.source.replace(/_/g, ' ').toLowerCase()}</td>
                                        <td className={td}>{r.payee}</td>
                                        <td className={td}><StatusBadge status={r.status} />{pending && <span className="ml-1 text-[11px] text-amber-700">payout awaiting approval</span>}</td>
                                        <td className={tdR}><MoneyCell value={r.amount} currency={r.currency} /></td>
                                        <td className={td}>{r.status === 'PAYABLE' && !pending && btn('Propose payout', { payout: r.id }, 'loan.recovery_refund.propose')}</td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </Table>
                </>
            )}
            {!has && <p className="p-4 text-[12px] text-[#697386]">No recovery action on this loan.</p>}
        </Card>
    );
}
