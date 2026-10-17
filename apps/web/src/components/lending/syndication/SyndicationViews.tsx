"use client";

import { useState } from 'react';
import Link from 'next/link';
import api from '@/lib/api';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { LendingShell, useLendingHref } from '../LendingShell';
import { Btn, Card, Checkbox, Empty, ErrorBox, Field, KV, Notice, Spinner, Table, TextInput, td, tdR, th, thR } from '../ui';
import { idem, qs, useAction, useApi, useIdempotencyKey } from '../useAsync';
import { Money, MoneyCell, Rate } from '../MoneyCell';
import { StatusBadge } from '../StatusBadge';
import type { LoanSummary, Paged } from '../types';

interface Participant {
    id: string; lenderName: string; isAgent: boolean; share: string; feeShare: string; commitment: string; funded: string;
    principalReturned: string; interestEarned: string; penaltyEarned: string; feesEarned: string; paidOut: string; outstanding: string; payable: string;
}
interface SyndicateView {
    syndicated: boolean;
    loan: { id: string; reference: string; status: string; currency: string; bookedPrincipal: string; principalOutstanding: string; rateType: string; floating: { benchmarkCode: string; margin: string } | null };
    syndicate: null | { id: string; status: string; principal: string; makerId: string; checkerId: string | null; participants: Participant[] };
    entries: { id: string; participantId: string; kind: string; amount: string; sourceEventId: string; createdAt: string }[];
    payouts: { id: string; subjectId: string; status: string; amount: string; makerId: string }[];
}

/** Find a syndicated loan (LT-24). */
export function SyndicationHome() {
    const href = useLendingHref();
    const [search, setSearch] = useState('');
    const [query, setQuery] = useState('');
    const list = useApi<Paged<LoanSummary>>(`/lending/loans${qs({ search: query, page: 1 })}`);
    return (
        <LendingShell title="Syndication" subtitle="Loans shared with other lenders, with this lender as agent. Book the loan under a syndicated product, then set up its participants here.">
            <Card
                title="Loans"
                bodyClass="p-0"
                actions={
                    <>
                        <TextInput value={search} onChange={setSearch} placeholder="Search reference…" className="w-48" onKeyDown={(e) => { if (e.key === 'Enter') setQuery(search.trim()); }} />
                        <Btn onClick={() => setQuery(search.trim())}>Search</Btn>
                    </>
                }
            >
                {list.error && <div className="p-4"><ErrorBox error={list.error} /></div>}
                {list.loading && !list.data ? <Spinner /> : (list.data?.data.length ?? 0) === 0 ? <Empty>No loans.</Empty> : (
                    <Table>
                        <thead><tr className="border-b border-[#E3E8EE] bg-[#F7FAFC]"><th className={th}>Loan</th><th className={th}>Status</th><th className={thR}>Principal</th><th className={th}></th></tr></thead>
                        <tbody className="divide-y divide-[#F0F2F5]">
                            {list.data!.data.map((l) => (
                                <tr key={l.id}>
                                    <td className={td}>{l.reference}</td>
                                    <td className={td}><StatusBadge status={l.status} /></td>
                                    <td className={tdR}><MoneyCell value={l.bookedPrincipal} currency={l.currency} /></td>
                                    <td className={td}><Link className="text-[12px] font-semibold text-[#635BFF] hover:underline" href={href(`/lending/syndication/${l.id}`)}>Syndicate →</Link></td>
                                </tr>
                            ))}
                        </tbody>
                    </Table>
                )}
            </Card>
        </LendingShell>
    );
}

type Row = { lenderName: string; isAgent: boolean; share: string; amount: string; feeShare: string };

/** One syndicated loan: participants, approval, funding, shares and payouts. */
export function SyndicateDetail({ loanId }: { loanId: string }) {
    const href = useLendingHref();
    const confirm = useConfirm();
    const view = useApi<SyndicateView>(`/lending/loans/${loanId}/syndicate`);
    const { busy, error, run, clearError } = useAction();
    const fundKey = useIdempotencyKey();
    const payKey = useIdempotencyKey();
    const [byAmount, setByAmount] = useState(false);
    const [rows, setRows] = useState<Row[]>([
        { lenderName: '', isAgent: true, share: '', amount: '', feeShare: '' },
        { lenderName: '', isAgent: false, share: '', amount: '', feeShare: '' },
    ]);
    const [fundRef, setFundRef] = useState('');
    const [msg, setMsg] = useState('');

    if (!view.data) return <LendingShell title="Syndicate" back={{ href: '/lending/syndication', label: 'Syndication' }}>{view.error ? <ErrorBox error={view.error} /> : <Spinner />}</LendingShell>;
    const { loan, syndicate: s, payouts } = view.data;
    const ccy = loan.currency;
    const done = (m: string) => { setMsg(m); view.reload(); };
    const pendingFor = (pid: string) => payouts.find((t) => t.subjectId === pid && t.status === 'PENDING');

    const save = async () => {
        const participants = rows.map((r) => ({
            lenderName: r.lenderName.trim(),
            isAgent: r.isAgent,
            ...(byAmount ? { amount: r.amount.trim() } : { share: r.share.trim() }),
            ...(r.feeShare.trim() ? { feeShare: r.feeShare.trim() } : {}),
        }));
        const res = await run('save', () => api.put(`/lending/loans/${loanId}/syndicate`, { participants }));
        if (res) done('Participants saved as a draft — a checker approves them');
    };
    const post = async (name: string, path: string, body: unknown, message: string, key?: string) => {
        const res = await run(name, () => api.post(`/lending/loans/${loanId}/syndicate/${path}`, body, key ? idem(key) : undefined));
        if (res) done(message);
        return res;
    };
    const decide = async (taskId: string, approve: boolean) => {
        const body = { approve };
        const res = await post(`decide-${taskId}`, `payouts/${taskId}/decision`, body, approve ? 'Payout made' : 'Payout rejected', payKey.keyFor({ taskId, ...body }));
        if (res) payKey.reset();
    };

    return (
        <LendingShell
            title={`Syndicate · ${loan.reference}`}
            subtitle="The loan is serviced as usual; every collection is shared with the participants by share."
            back={{ href: '/lending/syndication', label: 'Syndication' }}
            actions={<Link href={href(`/lending/loans/${loanId}`)} className="text-[13px] font-semibold text-[#635BFF] hover:underline">Loan →</Link>}
        >
            {msg && <Notice tone="success">{msg}</Notice>}
            <ErrorBox error={error} onDismiss={clearError} />
            {!view.data.syndicated && <Notice tone="warn" title="Not a syndicated product">This loan was not booked under a syndicated product; it cannot take participants.</Notice>}
            <Card title="Loan">
                <KV
                    cols={4}
                    items={[
                        ['Status', <StatusBadge key="s" status={loan.status} />],
                        ['Booked', <Money key="b" value={loan.bookedPrincipal} currency={ccy} />],
                        ['Outstanding', <Money key="o" value={loan.principalOutstanding} currency={ccy} />],
                        ['Pricing', loan.floating ? <span key="p">{loan.floating.benchmarkCode} + <Rate value={loan.floating.margin} /></span> : 'Fixed'],
                        ['Syndicate', s ? <StatusBadge key="ss" status={s.status} /> : 'Not set up'],
                    ]}
                />
            </Card>

            {(!s || s.status === 'DRAFT') && loan.status === 'BOOKED' && (
                <Card title={s ? 'Participants (draft)' : 'Set up participants'} subtitle="Shares must sum to 100% (or amounts to the loan). Exactly one participant is this lender, as agent.">
                    <div className="mb-3"><Checkbox checked={byAmount} onChange={setByAmount} label="Enter amounts instead of shares" /></div>
                    <div className="space-y-2">
                        {rows.map((r, i) => (
                            <div key={i} className="grid grid-cols-1 md:grid-cols-5 gap-2 items-end">
                                <Field label="Lender"><TextInput value={r.lenderName} onChange={(v) => setRows(rows.map((x, j) => (j === i ? { ...x, lenderName: v } : x)))} maxLength={160} /></Field>
                                {byAmount
                                    ? <Field label={`Amount (${ccy})`}><TextInput value={r.amount} onChange={(v) => setRows(rows.map((x, j) => (j === i ? { ...x, amount: v } : x)))} inputMode="decimal" /></Field>
                                    : <Field label="Share (0.35 = 35%)"><TextInput value={r.share} onChange={(v) => setRows(rows.map((x, j) => (j === i ? { ...x, share: v } : x)))} inputMode="decimal" /></Field>}
                                <Field label="Fee share" hint="Optional"><TextInput value={r.feeShare} onChange={(v) => setRows(rows.map((x, j) => (j === i ? { ...x, feeShare: v } : x)))} inputMode="decimal" /></Field>
                                <Checkbox checked={r.isAgent} onChange={(v) => setRows(rows.map((x, j) => ({ ...x, isAgent: j === i ? v : v ? false : x.isAgent })))} label="Agent (us)" />
                                <Btn size="sm" variant="ghost" disabled={rows.length <= 2} onClick={() => setRows(rows.filter((_, j) => j !== i))}>Remove</Btn>
                            </div>
                        ))}
                    </div>
                    <div className="mt-3 flex gap-2">
                        <Btn onClick={() => setRows([...rows, { lenderName: '', isAgent: false, share: '', amount: '', feeShare: '' }])}>Add participant</Btn>
                        <Btn variant="primary" onClick={save} busy={busy === 'save'}>Save draft</Btn>
                        {s?.status === 'DRAFT' && <Btn variant="primary" busy={busy === 'approve'} onClick={async () => { if (await confirm({ title: 'Approve syndicate', message: 'Approve these participants and shares?', confirmLabel: 'Approve' })) await post('approve', 'approve', {}, 'Syndicate approved — record the participants’ funding next'); }}>Approve (checker)</Btn>}
                    </div>
                </Card>
            )}

            {s?.status === 'APPROVED' && (
                <Card title="Participant funding" subtitle="Record that the other participants have paid their shares; the loan cannot be disbursed before.">
                    <div className="flex flex-wrap items-end gap-2">
                        <Field label="Payment reference"><TextInput value={fundRef} onChange={setFundRef} maxLength={120} className="w-64" /></Field>
                        <Btn variant="primary" busy={busy === 'fund'} onClick={async () => { const body = { externalReference: fundRef.trim() }; const r = await post('fund', 'funding', body, 'Participant funding recorded', fundKey.keyFor(body)); if (r) fundKey.reset(); }}>Record funding</Btn>
                    </div>
                </Card>
            )}

            {s && (
                <Card
                    title="Participants"
                    subtitle="Each collection is split by share (fees by fee share); the agent takes the rounding."
                    bodyClass="p-0"
                    actions={['ACTIVE', 'CLOSED'].includes(loan.status) ? <Btn busy={busy === 'distribute'} onClick={() => post('distribute', 'distribute', {}, 'Collections shared')}>Share new collections</Btn> : undefined}
                >
                    <Table>
                        <thead>
                            <tr className="border-b border-[#E3E8EE] bg-[#F7FAFC]">
                                <th className={th}>Lender</th><th className={thR}>Share</th><th className={thR}>Commitment</th><th className={thR}>Funded</th>
                                <th className={thR}>Principal back</th><th className={thR}>Interest</th><th className={thR}>Fees</th><th className={thR}>Paid out</th><th className={thR}>Due to them</th><th className={th}></th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-[#F0F2F5]">
                            {s.participants.map((p) => {
                                const pending = pendingFor(p.id);
                                return (
                                    <tr key={p.id}>
                                        <td className={td}>{p.lenderName}{p.isAgent && <span className="ml-1 text-[11px] font-bold text-[#635BFF]">AGENT</span>}</td>
                                        <td className={tdR}><Rate value={p.share} /></td>
                                        <td className={tdR}><MoneyCell value={p.commitment} currency={ccy} /></td>
                                        <td className={tdR}><MoneyCell value={p.funded} currency={ccy} /></td>
                                        <td className={tdR}><MoneyCell value={p.principalReturned} currency={ccy} /></td>
                                        <td className={tdR}><MoneyCell value={p.interestEarned} currency={ccy} /></td>
                                        <td className={tdR}><MoneyCell value={p.feesEarned} currency={ccy} /></td>
                                        <td className={tdR}><MoneyCell value={p.paidOut} currency={ccy} /></td>
                                        <td className={tdR}><MoneyCell value={p.payable} currency={ccy} highlightNonZero /></td>
                                        <td className={`${td} whitespace-nowrap`}>
                                            {!p.isAgent && !pending && Number(p.payable) > 0 && <Btn size="sm" busy={busy === `propose-${p.id}`} onClick={() => post(`propose-${p.id}`, `participants/${p.id}/payouts`, {}, `Payout to ${p.lenderName} proposed`)}>Propose payout</Btn>}
                                            {pending && (
                                                <div className="flex gap-1.5">
                                                    <Btn size="sm" variant="primary" busy={busy === `decide-${pending.id}`} onClick={() => decide(pending.id, true)}>Approve {pending.amount}</Btn>
                                                    <Btn size="sm" variant="danger" onClick={() => decide(pending.id, false)}>Reject</Btn>
                                                </div>
                                            )}
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </Table>
                </Card>
            )}

            {s && view.data.entries.length > 0 && (
                <Card title="Participant sub-ledger" bodyClass="p-0">
                    <Table>
                        <thead><tr className="border-b border-[#E3E8EE] bg-[#F7FAFC]"><th className={th}>When</th><th className={th}>Lender</th><th className={th}>Kind</th><th className={thR}>Amount</th></tr></thead>
                        <tbody className="divide-y divide-[#F0F2F5]">
                            {view.data.entries.map((e) => (
                                <tr key={e.id}>
                                    <td className={td}>{e.createdAt.slice(0, 10)}</td>
                                    <td className={td}>{s.participants.find((p) => p.id === e.participantId)?.lenderName ?? '—'}</td>
                                    <td className={td}>{e.kind.toLowerCase()}</td>
                                    <td className={tdR}><MoneyCell value={e.amount} currency={ccy} /></td>
                                </tr>
                            ))}
                        </tbody>
                    </Table>
                </Card>
            )}
        </LendingShell>
    );
}
