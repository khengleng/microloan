"use client";

import { type ReactNode, useState } from 'react';
import Link from 'next/link';
import { useToast } from '@/components/ui/toast';
import { LendingShell, useLendingHref } from '../LendingShell';
import { Btn, Card, ErrorBox, KV, Notice, Spinner, Table, td, tdR, th, thR } from '../ui';
import { useApi, useCapabilities } from '../useAsync';
import { fmtRate, fullName, isPositive } from '../format';
import { Money, MoneyCell } from '../MoneyCell';
import { StatusBadge } from '../StatusBadge';
import { FacilityTypeLabel } from './FacilitiesList';
import { DrawdownRequestPanel } from './DrawdownRequestPanel';
import { DrawdownsCard } from './DrawdownsCard';
import { ConditionsCard } from './ConditionsCard';
import { LimitChangePanel, LimitChangesCard } from './LimitChangesCard';
import { StatementsCard } from './StatementsCard';
import { FacilityRepaymentPanel, StatementPanel, StatusPanel, TermOutPanel, availableStatusMoves } from './FacilityPanels';
import type { FacilityDetail } from './types';

type Panel = 'drawdown' | 'repay' | 'statement' | 'limit' | 'status' | 'termout';

function Kpi({ label, children, hint }: { label: string; children: ReactNode; hint?: ReactNode }) {
    return (
        <div className="bg-white border border-[#E3E8EE] rounded-lg shadow-sm px-4 py-3 min-w-0">
            <p className="text-[11px] font-bold uppercase tracking-wide text-[#8792A2]">{label}</p>
            <div className="text-[18px] font-bold text-[#1A1F36] mt-0.5 truncate">{children}</div>
            {hint && <div className="text-[11px] text-[#697386] mt-0.5">{hint}</div>}
        </div>
    );
}

function UtilizationBar({ value }: { value: string }) {
    // Display only: the fraction is already computed exactly by the server.
    const pct = Math.max(0, Math.min(100, Number(value) * 100 || 0));
    const over = Number(value) > 1;
    return (
        <div className="h-1.5 rounded bg-slate-100 overflow-hidden mt-1.5">
            <div className={`h-full ${over ? 'bg-red-500' : pct >= 85 ? 'bg-amber-500' : 'bg-[#635BFF]'}`} style={{ width: `${pct}%` }} />
        </div>
    );
}

export function FacilityDetailView({ id }: { id: string }) {
    const href = useLendingHref();
    const { showToast } = useToast();
    const res = useApi<FacilityDetail>(`/lending/facilities/${id}`);
    const d = res.data;
    // Repayments are authorized against the facility's loan account, so its capability map applies.
    const loanCaps = useCapabilities('LOAN_ACCOUNT', d?.loanAccountId ?? null);
    const borrower = useApi<{ firstName?: string | null; lastName?: string | null }>(d ? `/borrowers/${d.facility.borrowerId}` : null);
    const [panel, setPanel] = useState<Panel | null>(null);

    if (!d) {
        return (
            <LendingShell title="Facility" back={{ href: '/lending/facilities', label: 'Facilities' }}>
                {res.error ? <ErrorBox error={res.error} /> : <Spinner />}
            </LendingShell>
        );
    }

    const f = d.facility;
    const t = d.terms;
    const p = d.position;
    const cur = f.currency;
    const staged = f.facilityType === 'STAGED_DRAWDOWN';
    const status = f.status;

    const done = (msg: string) => {
        showToast(msg, 'success');
        setPanel(null);
        res.reload();
        loanCaps.reload();
    };
    const close = () => setPanel(null);
    const toggle = (pn: Panel) => setPanel((cur2) => (cur2 === pn ? null : pn));

    const canDraw = status === 'ACTIVE';
    const canRepay = !['CLOSED', 'CANCELLED'].includes(status);
    const canStatement = ['ACTIVE', 'SUSPENDED', 'EXPIRED'].includes(status);
    const canLimit = ['PENDING', 'ACTIVE', 'SUSPENDED'].includes(status);
    const statusMoves = availableStatusMoves(status);
    const canTermOut = ['ACTIVE', 'EXPIRED'].includes(status);
    // Statement periods never overlap: the next one starts where the last ended.
    const nextPeriodStart = d.statements[0]?.periodEnd ?? f.availabilityFrom ?? '';
    const repayCap = loanCaps.can('loan.repayment.post');
    const openDrawdowns = d.drawdowns.filter((x) => x.status === 'REQUESTED' || x.status === 'APPROVED');
    const borrowerName = borrower.data ? fullName(borrower.data) : null;

    return (
        <LendingShell
            title={<span className="flex items-center gap-2">{f.reference} <StatusBadge status={status} /></span>}
            subtitle={<span className="flex flex-wrap items-center gap-1.5"><FacilityTypeLabel type={f.facilityType} /> · {cur} · rate {fmtRate(t.annualRate)} · created {f.createdAt?.slice(0, 10)}</span>}
            back={{ href: '/lending/facilities', label: 'Facilities' }}
            actions={
                <>
                    <Link href={href(`/lending/loans/${d.loanAccountId}`)} className="inline-flex items-center gap-1.5 rounded font-semibold shadow-sm text-[13px] px-3.5 py-1.5 bg-white hover:bg-slate-50 text-[#3C4257] border border-[#E3E8EE]">
                        Loan account →
                    </Link>
                    <Btn variant="ghost" onClick={() => { res.reload(); loanCaps.reload(); }}>Refresh</Btn>
                </>
            }
        >
            {res.error && <ErrorBox error={res.error} />}

            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
                <Kpi label="Limit"><Money value={t.limitAmount} currency={cur} /></Kpi>
                <Kpi label="Drawn balance" hint={`Total ever drawn ${cur} ${p.totalDrawn}`}><Money value={p.outstanding} currency={cur} /></Kpi>
                <Kpi label="Available" hint={staged ? 'Staged: repayments do not reinstate' : 'Reinstates on repayment'}><Money value={p.available} currency={cur} /></Kpi>
                <Kpi label="Utilization" hint={<UtilizationBar value={p.utilization} />}>{fmtRate(p.utilization, 2)}</Kpi>
                <Kpi label="Status"><StatusBadge status={status} /></Kpi>
                <Kpi label="Availability ends" hint={`Maturity ${t.maturityDate}`}>{t.availabilityEnd}</Kpi>
            </div>

            {isPositive(p.overlimit) && (
                <Notice tone="danger" title="Over limit">
                    The drawn balance exceeds the limit by <Money value={p.overlimit} currency={cur} />.
                    {t.overlimitRate ? <> Over-limit interest accrues at {fmtRate(t.overlimitRate)}.</> : null}
                </Notice>
            )}
            {d.card && (
                <Notice title={`Credit card ${d.card.reference}`}>
                    This line carries a credit card. Purchases, cash advances, statements and payments move on the card; the line keeps the limit, its changes and its status.{' '}
                    <Link href={href(`/lending/cards/${d.card.id}`)} className="font-semibold text-[#635BFF] hover:underline">Open the card →</Link>
                </Notice>
            )}
            {status === 'SUSPENDED' && <Notice tone="warn" title="Suspended">No drawdowns can be requested, approved or released while the facility is suspended.</Notice>}

            <Card title="Facility actions" subtitle="The server re-checks every action against policy, limits and maker-checker; refusals show the reason.">
                <div className="space-y-3">
                    <div className="flex flex-wrap gap-2">
                        {canDraw && <Btn variant="primary" onClick={() => toggle('drawdown')}>Request drawdown</Btn>}
                        {canRepay && <Btn variant="primary" onClick={() => toggle('repay')} disabled={!repayCap.allowed} reason={repayCap.reason}>Post repayment</Btn>}
                        {canStatement && <Btn onClick={() => toggle('statement')}>Generate statement</Btn>}
                        {canLimit && <Btn onClick={() => toggle('limit')}>Request limit change</Btn>}
                        {statusMoves.length > 0 && <Btn variant="danger" onClick={() => toggle('status')}>Change status</Btn>}
                        {canTermOut && <Btn variant="danger" onClick={() => toggle('termout')}>Term out</Btn>}
                    </div>
                    {!canDraw && !canRepay && !canStatement && !canLimit && statusMoves.length === 0 && (
                        <p className="text-[12px] text-[#697386]">This facility is {status.replace(/_/g, ' ').toLowerCase()}; no actions are available.</p>
                    )}
                    {openDrawdowns.length > 0 && (
                        <p className="text-[12px] text-[#697386]">{openDrawdowns.length} drawdown{openDrawdowns.length === 1 ? ' is' : 's are'} awaiting approval or release — see Drawdowns below.</p>
                    )}

                    {panel === 'drawdown' && <DrawdownRequestPanel facilityId={id} terms={t} onDone={done} onClose={close} />}
                    {panel === 'repay' && <FacilityRepaymentPanel facilityId={id} currency={cur} outstanding={p.outstanding} can={loanCaps.can} onDone={done} onClose={close} />}
                    {panel === 'statement' && <StatementPanel facilityId={id} currency={cur} periodStart={nextPeriodStart} onDone={done} onClose={close} />}
                    {panel === 'limit' && <LimitChangePanel facilityId={id} currency={cur} currentLimit={t.limitAmount} onDone={done} onClose={close} />}
                    {panel === 'status' && <StatusPanel facilityId={id} status={status} onDone={done} onClose={close} />}
                    {panel === 'termout' && <TermOutPanel facilityId={id} currency={cur} availabilityEnd={t.availabilityEnd} maturityDate={t.maturityDate} onDone={done} onClose={close} />}
                </div>
            </Card>

            <Card title="Facility">
                <KV
                    cols={4}
                    items={[
                        ['Borrower', <Link key="b" href={href(`/borrowers/${f.borrowerId}`)} className="text-[#635BFF] hover:underline">{borrowerName && borrowerName !== '—' ? borrowerName : <span className="font-mono text-[12px]">{f.borrowerId.slice(0, 8)}</span>}</Link>],
                        ['Loan account', <Link key="la" href={href(`/lending/loans/${d.loanAccountId}`)} className="text-[#635BFF] hover:underline">open drawn-balance account</Link>],
                        ['Available from', t.availabilityStart],
                        ['Available to', t.availabilityEnd],
                        ['Maturity', t.maturityDate],
                        ['Annual rate', fmtRate(t.annualRate)],
                        ['Day count', t.dayCount],
                        ['Total repaid', <Money key="tr" value={p.totalRepaid} currency={cur} />],
                        ['Charges raised', <Money key="cr" value={f.chargesRaised} currency={cur} />],
                        ['Minimum drawdown', t.minimumDrawdown ? <Money key="mn" value={t.minimumDrawdown} currency={cur} /> : 'No floor'],
                        ['Maximum drawdown', t.maximumDrawdown ? <Money key="mx" value={t.maximumDrawdown} currency={cur} /> : 'Up to available'],
                        ['Commitment fee', t.commitmentFeeRate ? `${fmtRate(t.commitmentFeeRate)} p.a. on undrawn` : 'None'],
                        ['Over-limit', t.overlimitRate ? `Priced at ${fmtRate(t.overlimitRate)}` : 'Refused'],
                        ...(f.facilityType === 'OVERDRAFT'
                            ? [['Minimum payment', `${fmtRate(t.minimumPaymentRate)} of balance${t.minimumPaymentFloor ? `, floor ${cur} ${t.minimumPaymentFloor}` : ''}`] as [string, string]]
                            : []),
                        ['Last statement to', d.statements[0]?.periodEnd ?? 'None yet'],
                    ]}
                />
            </Card>

            {staged && (
                <Card title="Tranches" bodyClass="p-0">
                    <Table>
                        <thead>
                            <tr className="border-b border-[#E3E8EE] bg-[#F7FAFC]">
                                <th className={th}>Tranche</th>
                                <th className={thR}>Amount</th>
                                <th className={th}>Available from</th>
                                <th className={th}>Conditions</th>
                                <th className={th}>State</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-[#F0F2F5]">
                            {t.tranches.map((tr) => {
                                const conds = d.conditions.filter((c) => c.trancheCode === tr.code);
                                const met = conds.filter((c) => c.status !== 'PENDING').length;
                                const released = p.releasedTranches.includes(tr.code);
                                return (
                                    <tr key={tr.code}>
                                        <td className={td}><span className="font-mono text-[12px] font-semibold">{tr.code}</span></td>
                                        <td className={tdR}><MoneyCell value={tr.amount} currency={cur} /></td>
                                        <td className={`${td} whitespace-nowrap`}>{tr.availableFrom}</td>
                                        <td className={td}>{conds.length ? `${met} of ${conds.length} met` : tr.conditions.length ? tr.conditions.join(', ') : 'None'}</td>
                                        <td className={td}><StatusBadge status={released ? 'RELEASED' : conds.length && met < conds.length ? 'PENDING' : 'OPEN'} /></td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </Table>
                </Card>
            )}

            <DrawdownsCard
                facilityId={id}
                loanAccountId={d.loanAccountId}
                drawdowns={d.drawdowns}
                onDone={done}
                actions={canDraw && panel !== 'drawdown' ? <Btn size="sm" onClick={() => setPanel('drawdown')}>New request</Btn> : undefined}
            />

            {(staged || d.conditions.length > 0) && (
                <ConditionsCard facilityId={id} conditions={d.conditions} tranches={t.tranches} releasedTranches={p.releasedTranches} onDone={done} />
            )}

            <LimitChangesCard facilityId={id} currency={cur} changes={d.limitChanges} onDone={done} />

            <StatementsCard statements={d.statements} currency={cur} />

            <Notice tone="info">
                The drawn balance is serviced on its own loan account: posted drawdowns, repayments, charges and reversals appear in that account&apos;s{' '}
                <Link href={href(`/lending/loans/${d.loanAccountId}`)} className="font-semibold text-[#635BFF] hover:underline">financial events</Link>.
            </Notice>
        </LendingShell>
    );
}
