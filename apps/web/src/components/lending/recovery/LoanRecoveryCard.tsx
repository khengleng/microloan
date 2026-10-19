"use client";

import { useState } from 'react';
import { useTranslations } from 'next-intl';
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

/**
 * Recovery on the loan screen: repossession (UC-65), pawn custody and
 * auction (UC-66, LT-09), credit insurance and claims (UC-68, UC-06), and
 * debt sale (UC-71), with everything awaiting a second user's decision.
 */
export function LoanRecoveryCard({ loanId, currency, can, onChanged }: {
    loanId: string; currency: string; can: Can; onChanged?: () => void;
}) {
    const t = useTranslations('LendingRecovery.card');
    const { showToast } = useToast();
    const view = useApi<LoanRecoveryView>(`/lending/loans/${loanId}/recovery`);
    const [panel, setPanel] = useState<Panel | null>(null);
    const v = view.data;
    if (!v) return view.error ? <Card title={t('title')}><ErrorBox error={view.error} /></Card> : null;

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
            title={t('title')}
            subtitle={t('subtitle', { dpd: v.loan.daysPastDue, currency, owed: v.loan.owed, minDpd: v.rules.repossessionMinDpd, order: v.rules.proceedsOrder.join(' → ').toLowerCase() })}
            actions={
                <div className="flex flex-wrap gap-2">
                    {repossessable && btn(t('repossess'), 'repossess', 'loan.repossession.propose', 'danger')}
                    {(active || status === 'BOOKED') && btn(t('pawnItem'), 'pawn', 'loan.pawn.custody')}
                    {active && btn(t('insurancePolicy'), 'policy', 'loan.insurance.manage')}
                    {(active || status === 'WRITTEN_OFF') && btn(t('sellLoan'), 'debt-sale', 'loan.debt_sale.propose', 'danger')}
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
                    {p && 'sell' in p && <SaleForm title={t('sellAssetTitle')} endpoint={`/lending/loans/${loanId}/repossessions/${p.sell.id}/sale`} currency={currency} owed={v.loan.owed} businessDate={v.businessDate} onDone={done} onClose={close} />}
                    {p && 'auction' in p && <SaleForm title={t('auctionTitle', { item: p.auction.description })} endpoint={`/lending/loans/${loanId}/pawn-items/${p.auction.id}/sale`} currency={currency} owed={v.loan.owed} businessDate={v.businessDate} onDone={done} onClose={close} />}
                    {p && 'forfeit' in p && <OneFieldForm title={t('forfeitTitle', { item: p.forfeit.description })} label={t('reason')} field="reason" multiline endpoint={`/lending/loans/${loanId}/pawn-items/${p.forfeit.id}/forfeiture`} button={t('proposeForfeiture')} done={t('forfeitureProposed')} onDone={done} onClose={close} />}
                    {p && 'giveBack' in p && <OneFieldForm title={t('returnTitle', { item: p.giveBack.description })} label={t('returnReference')} field="reference" endpoint={`/lending/loans/${loanId}/pawn-items/${p.giveBack.id}/return`} button={t('recordReturn')} done={t('itemReturned')} onDone={done} onClose={close} />}
                    {p && 'remit' in p && <RemittanceForm loanId={loanId} policy={p.remit} onDone={done} onClose={close} />}
                    {p && 'claim' in p && <ClaimForm loanId={loanId} policy={p.claim} businessDate={v.businessDate} onDone={done} onClose={close} />}
                    {p && 'receipt' in p && <ClaimReceiptForm loanId={loanId} claimId={p.receipt.claimId} due={p.receipt.due} currency={currency} onDone={done} onClose={close} />}
                    {p && 'payout' in p && <OneFieldForm title={t('payoutTitle')} label={t('payee')} field="payee" endpoint={`/lending/loans/${loanId}/recovery-refunds/${p.payout}/payout`} button={t('proposePayout')} done={t('payoutProposed')} onDone={done} onClose={close} />}
                </div>
            )}

            {v.repossessions.length > 0 && (
                <>
                    <p className={section}>{t('sectionRepossession')}</p>
                    <Table>
                        <thead><tr className="border-b border-[#E3E8EE] bg-[#F7FAFC]"><th className={th}>{t('colSeized')}</th><th className={th}>{t('colStatus')}</th><th className={thR}>{t('colValuation')}</th><th className={thR}>{t('colSalePrice')}</th><th className={thR}>{t('colCosts')}</th><th className={thR}>{t('colSurplus')}</th><th className={thR}>{t('colDeficiency')}</th><th className={th}></th></tr></thead>
                        <tbody className="divide-y divide-[#F0F2F5]">
                            {v.repossessions.map((r) => (
                                <tr key={r.id}>
                                    <td className={td}>{r.seizedOn}<div className="text-[12px] text-[#697386]">{r.location}</div></td>
                                    <td className={td}><StatusBadge status={r.status} />{r.buyer && <div className="text-[11px] text-[#697386]">{t('toBuyer', { buyer: r.buyer })}</div>}</td>
                                    <td className={tdR}><MoneyCell value={r.valuationAmount} currency={currency} /></td>
                                    <td className={tdR}><MoneyCell value={r.salePrice} /></td>
                                    <td className={tdR}><MoneyCell value={r.saleCosts} /></td>
                                    <td className={tdR}><MoneyCell value={r.surplus} /></td>
                                    <td className={tdR}><MoneyCell value={r.deficiency} highlightNonZero /></td>
                                    <td className={td}>
                                        {active && (r.status === 'SEIZED' || r.status === 'VALUED') && btn(r.status === 'SEIZED' ? t('value') : t('revalue'), { value: r }, 'loan.repossession.value')}
                                        {active && r.status === 'VALUED' && <span className="ml-1">{btn(t('sell'), { sell: r }, 'loan.repossession.sell', 'primary')}</span>}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </Table>
                </>
            )}

            {v.pawnItems.length > 0 && (
                <>
                    <p className={section}>{t('sectionPawn')}</p>
                    <Table>
                        <thead><tr className="border-b border-[#E3E8EE] bg-[#F7FAFC]"><th className={th}>{t('colItem')}</th><th className={th}>{t('colCustody')}</th><th className={thR}>{t('colWeightPurity')}</th><th className={thR}>{t('colValue')}</th><th className={th}>{t('colRedeemBy')}</th><th className={th}>{t('colStatus')}</th><th className={th}></th></tr></thead>
                        <tbody className="divide-y divide-[#F0F2F5]">
                            {v.pawnItems.map((i) => (
                                <tr key={i.id}>
                                    <td className={td}><b>{i.description}</b><div className="text-[12px] text-[#697386]">{i.itemType}{i.sealNumber ? ` · ${t('seal', { seal: i.sealNumber })}` : ''}</div></td>
                                    <td className={td}>{i.custodyLocation}<div className="text-[12px] text-[#697386]">{t('since', { date: i.receivedOn })}</div></td>
                                    <td className={tdR}>{i.weightGrams} g × {i.karat ? `${i.karat}k` : i.purity}<div className="text-[11px] text-[#697386]">@ {i.pricePerGram}/g</div></td>
                                    <td className={tdR}><MoneyCell value={i.appraisedValue} currency={currency} /></td>
                                    <td className={td}>{i.redemptionDeadline}{i.forfeitable && <div className="text-[11px] font-semibold text-red-600">{t('pastDeadline')}</div>}</td>
                                    <td className={td}><StatusBadge status={i.status} />{i.status === 'SOLD' && <div className="text-[11px] text-[#697386]">{t('soldTo', { price: i.salePrice ?? '', buyer: i.buyer ?? '' })}</div>}{i.returnReference && <div className="text-[11px] text-[#697386]">{t('ref', { ref: i.returnReference })}</div>}</td>
                                    <td className={td}>
                                        {i.forfeitable && btn(t('forfeit'), { forfeit: i }, 'loan.pawn.forfeit.propose', 'danger')}
                                        {i.status === 'FORFEITED' && active && btn(t('auction'), { auction: i }, 'loan.pawn.sell', 'primary')}
                                        {i.status === 'IN_CUSTODY' && status === 'CLOSED' && btn(t('return'), { giveBack: i }, 'loan.pawn.return', 'primary')}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </Table>
                </>
            )}

            {v.insurancePolicies.length > 0 && (
                <>
                    <p className={section}>{t('sectionInsurance')}</p>
                    <Table>
                        <thead><tr className="border-b border-[#E3E8EE] bg-[#F7FAFC]"><th className={th}>{t('colInsurerPolicy')}</th><th className={th}>{t('colCover')}</th><th className={thR}>{t('colPremium')}</th><th className={thR}>{t('colToRemit')}</th><th className={th}>{t('colClaims')}</th><th className={th}></th></tr></thead>
                        <tbody className="divide-y divide-[#F0F2F5]">
                            {v.insurancePolicies.map((pol) => (
                                <tr key={pol.id}>
                                    <td className={td}><b>{pol.insurer}</b><div className="text-[12px] text-[#697386]">{pol.policyNumber} · {t('from', { date: pol.startDate })}</div></td>
                                    <td className={td}>{pol.coverType.replace(/_/g, ' ').toLowerCase()}<div><StatusBadge status={pol.status} /></div></td>
                                    <td className={tdR}><MoneyCell value={pol.premium} currency={currency} /><div className="text-[11px] text-[#697386]">{pol.premiumTreatment.toLowerCase()}</div></td>
                                    <td className={tdR}><MoneyCell value={pol.premiumToRemit} highlightNonZero /></td>
                                    <td className={td}>
                                        {pol.claims.length === 0 ? '—' : pol.claims.map((c) => {
                                            const due = subDecimal(c.amountClaimed, c.received);
                                            return (
                                                <div key={c.id} className="text-[12px] mb-1">
                                                    {c.eventType.toLowerCase()} {c.eventDate} · <StatusBadge status={c.status} /> {c.amountClaimed}
                                                    {c.status === 'SETTLED' && <span className="text-[#697386]"> · {t('insurerPaidAmount', { amount: c.received })}</span>}
                                                    {c.status === 'SETTLED' && Number(due) > 0 && <span className="ml-1">{btn(t('insurerPaid'), { receipt: { claimId: c.id, due } }, 'loan.insurance.claim.receive')}</span>}
                                                </div>
                                            );
                                        })}
                                    </td>
                                    <td className={td}>
                                        {Number(pol.premiumToRemit) > 0 && btn(t('remit'), { remit: pol }, 'loan.insurance.remit.propose')}
                                        {active && pol.status === 'ACTIVE' && !pol.claims.some((c) => c.status === 'PENDING') && <span className="ml-1">{btn(t('claim'), { claim: pol }, 'loan.insurance.claim.propose', 'danger')}</span>}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </Table>
                </>
            )}

            {v.debtSales.length > 0 && (
                <>
                    <p className={section}>{t('sectionDebtSale')}</p>
                    <Table>
                        <thead><tr className="border-b border-[#E3E8EE] bg-[#F7FAFC]"><th className={th}>{t('colBuyer')}</th><th className={th}>{t('colDate')}</th><th className={th}>{t('colStatus')}</th><th className={thR}>{t('colPrice')}</th><th className={thR}>{t('colCarrying')}</th><th className={thR}>{t('colGainLoss')}</th></tr></thead>
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
                    <p className={section}>{t('sectionRefunds')}</p>
                    <Table>
                        <thead><tr className="border-b border-[#E3E8EE] bg-[#F7FAFC]"><th className={th}>{t('colFrom')}</th><th className={th}>{t('colPayee')}</th><th className={th}>{t('colStatus')}</th><th className={thR}>{t('colAmount')}</th><th className={th}></th></tr></thead>
                        <tbody className="divide-y divide-[#F0F2F5]">
                            {v.refunds.map((r) => {
                                const pending = v.pendingTasks.some((task) => task.action === 'RECOVERY_REFUND' && (task.payload as { refundId?: string }).refundId === r.id);
                                return (
                                    <tr key={r.id}>
                                        <td className={td}>{r.source.replace(/_/g, ' ').toLowerCase()}</td>
                                        <td className={td}>{r.payee}</td>
                                        <td className={td}><StatusBadge status={r.status} />{pending && <span className="ml-1 text-[11px] text-amber-700">{t('payoutAwaiting')}</span>}</td>
                                        <td className={tdR}><MoneyCell value={r.amount} currency={r.currency} /></td>
                                        <td className={td}>{r.status === 'PAYABLE' && !pending && btn(t('proposePayout'), { payout: r.id }, 'loan.recovery_refund.propose')}</td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </Table>
                </>
            )}
            {!has && <p className="p-4 text-[12px] text-[#697386]">{t('none')}</p>}
        </Card>
    );
}
