"use client";

import { useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Crown, FilePlus2, UserPlus } from 'lucide-react';
import api from '@/lib/api';
import { useWorkspace } from '@/lib/workspace';
import { useToast } from '@/components/ui/toast';
import { LendingShell, useLendingHref } from '../LendingShell';
import { ActionPanel, Btn, Card, Checkbox, Empty, ErrorBox, Field, KV, Notice, Spinner, Table, TextArea, TextInput, td, tdR, th, thR } from '../ui';
import { clean, useAction, useApi } from '../useAsync';
import { MoneyCell } from '../MoneyCell';
import { StatusBadge } from '../StatusBadge';
import { fmtRate } from '../format';
import { BorrowerPicker, shortId, useBorrowerNames } from './borrowers';
import type { AddMemberBody, BorrowerGroupDetail, GroupApplication, GroupLoan, GroupMembership, LoanBinding, RemoveMemberResult } from './types';

const TRANSITIONS: { status: 'ACTIVE' | 'DORMANT' | 'DISBANDED'; variant: 'primary' | 'secondary' | 'danger' }[] = [
    { status: 'ACTIVE', variant: 'primary' },
    { status: 'DORMANT', variant: 'secondary' },
    { status: 'DISBANDED', variant: 'danger' },
];

export function GroupDetailView({ id }: { id: string }) {
    const { showToast } = useToast();
    const { locale } = useParams();
    const tc = useTranslations('Customers');
    const tg = useTranslations('LendingGroups');
    const { can } = useWorkspace();
    const href = useLendingHref();
    const mayManage = can('borrower_group.manage');
    const mayApply = can('loan_application.create');
    const group = useApi<BorrowerGroupDetail>(`/lending/applications/groups/${id}`);
    const branches = useApi<{ id: string; name: string; code: string | null }[]>('/borrowers/branches');
    const [adding, setAdding] = useState(false);
    const [removing, setRemoving] = useState<GroupMembership | null>(null);
    const [promoting, setPromoting] = useState<GroupMembership | null>(null);
    const [confirmDisband, setConfirmDisband] = useState(false);
    const status = useAction();

    const g = group.data;
    const nameOf = useBorrowerNames([
        ...(g?.members.map((m) => m.borrowerId) ?? []),
        ...(g?.loanBindings.map((b) => b.borrowerId) ?? []),
        ...(g?.loans?.map((l) => l.borrowerId) ?? []),
        ...(g?.applications?.map((a) => a.borrowerId) ?? []),
    ]);

    if (!g) {
        return (
            <LendingShell title={tg('common.group')} back={{ href: '/lending/groups', label: tg('detail.back') }}>
                {group.error ? <ErrorBox error={group.error} /> : <Spinner />}
            </LendingShell>
        );
    }

    const active = g.members.filter((m) => !m.leftOn);
    const past = g.members.filter((m) => m.leftOn);
    const leader = active.find((m) => m.role === 'LEADER');
    const disbanded = g.status === 'DISBANDED';
    // Bindings are newest first: the first one for a borrower is their current share.
    const latestBinding = new Map<string, LoanBinding>();
    for (const b of g.loanBindings) if (!latestBinding.has(b.borrowerId)) latestBinding.set(b.borrowerId, b);

    const changeStatus = async (next: 'ACTIVE' | 'DORMANT' | 'DISBANDED') => {
        const res = await status.run(next, () => api.post(`/lending/applications/groups/${id}/status`, { status: next }));
        setConfirmDisband(false);
        if (res) {
            showToast(tg(`detail.statusDone.${next}`), 'success');
            group.reload();
        }
    };

    const done = (msg: string) => {
        showToast(msg, 'success');
        setAdding(false);
        setRemoving(null);
        setPromoting(null);
        group.reload();
    };
    const branch = branches.data?.find((b) => b.id === g.branchId);
    const loanRef = new Map((g.loans ?? []).map((l) => [l.id, l.reference]));

    const borrowerLink = (borrowerId: string) => (
        <Link href={`/${locale}/borrowers/${borrowerId}`} className="font-semibold text-[#635BFF] hover:underline">{nameOf(borrowerId)}</Link>
    );

    return (
        <LendingShell
            title={<span className="flex items-center gap-2">{g.name} <StatusBadge status={g.status} /></span>}
            subtitle={<span className="font-mono text-[13px]">{g.code}</span>}
            back={{ href: '/lending/groups', label: tg('detail.back') }}
            actions={
                <>
                    {mayApply && (
                        <Link href={href(`/lending/applications?group=${id}`)}>
                            <Btn
                                variant="primary"
                                disabled={g.status !== 'ACTIVE'}
                                reason={g.status !== 'ACTIVE' ? tc('groupApp.onlyActive') : undefined}
                            >
                                <FilePlus2 size={14} /> {tc('groupApp.start')}
                            </Btn>
                        </Link>
                    )}
                    {mayManage && TRANSITIONS.filter((t) => t.status !== g.status).map((t) => (
                        <Btn
                            key={t.status}
                            variant={t.variant}
                            busy={status.busy === t.status}
                            disabled={disbanded || status.busy !== null}
                            reason={disbanded ? tg('detail.disbandedReason') : undefined}
                            onClick={() => (t.status === 'DISBANDED' ? setConfirmDisband(true) : changeStatus(t.status))}
                        >
                            {tg(`detail.transitions.${t.status}`)}
                        </Btn>
                    ))}
                    <Btn variant="ghost" onClick={group.reload}>{tg('common.refresh')}</Btn>
                </>
            }
        >
            <ErrorBox error={status.error} onDismiss={status.clearError} />
            {confirmDisband && (
                <ActionPanel title={tg('detail.confirmTitle')} onClose={() => setConfirmDisband(false)}>
                    <p className="text-[13px] text-[#3C4257]">
                        {tg('detail.confirmBody')}
                    </p>
                    <Btn variant="danger" busy={status.busy === 'DISBANDED'} onClick={() => changeStatus('DISBANDED')}>{tg('detail.confirmButton')}</Btn>
                </ActionPanel>
            )}

            <Card title={tg('common.group')}>
                <KV
                    cols={4}
                    items={[
                        [tg('common.code'), <span key="c" className="font-mono">{g.code}</span>],
                        [tg('common.status'), <StatusBadge key="s" status={g.status} />],
                        [tg('common.formedOn'), g.formedOn ?? '—'],
                        [tg('common.branch'), branch ? branch.name : <span key="b" className="font-mono text-[12px]" title={g.branchId ?? undefined}>{shortId(g.branchId)}</span>],
                        [tg('detail.activeMembers'), String(g.memberCount)],
                        [tg('common.leader'), leader ? nameOf(leader.borrowerId) : '—'],
                        [tg('detail.pastMembers'), String(past.length)],
                        [tg('detail.loans'), String(g.loans?.length ?? new Set(g.loanBindings.map((b) => b.loanAccountId)).size)],
                    ]}
                />
            </Card>

            <Card
                title={tg('common.members')}
                subtitle={tg('detail.membersSubtitle')}
                bodyClass="p-0"
                actions={mayManage ? (
                    <Btn variant="primary" disabled={disbanded} reason={disbanded ? tg('detail.disbandedReason') : undefined} onClick={() => { setAdding(true); setRemoving(null); setPromoting(null); }}>
                        <UserPlus size={14} /> {tg('detail.addMember')}
                    </Btn>
                ) : undefined}
            >
                {(adding || removing || promoting) && (
                    <div className="p-4 border-b border-[#E3E8EE]">
                        {adding && <AddMemberForm groupId={id} hasLeader={!!leader} exclude={active.map((m) => m.borrowerId)} onDone={done} onClose={() => setAdding(false)} />}
                        {removing && <RemoveMemberForm groupId={id} member={removing} name={nameOf(removing.borrowerId)} onDone={done} onClose={() => setRemoving(null)} />}
                        {promoting && <ChangeLeaderForm groupId={id} member={promoting} name={nameOf(promoting.borrowerId)} currentLeader={leader ? nameOf(leader.borrowerId) : null} onDone={done} onClose={() => setPromoting(null)} />}
                    </div>
                )}
                {g.members.length === 0 ? <Empty>{tg('detail.noMembers')}</Empty> : (
                    <Table>
                        <thead>
                            <tr className="border-b border-[#E3E8EE] bg-[#F7FAFC]">
                                <th className={th}>{tg('common.member')}</th>
                                <th className={th}>{tg('common.role')}</th>
                                <th className={thR}>{tg('detail.currentShare')}</th>
                                <th className={th}>{tg('detail.joined')}</th>
                                <th className={th}>{tg('common.status')}</th>
                                <th className={th} />
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-[#F0F2F5]">
                            {[...active, ...past].map((m) => {
                                const b = latestBinding.get(m.borrowerId);
                                return (
                                    <tr key={m.id} className={m.leftOn ? 'bg-[#FAFBFC] text-[#8792A2]' : 'hover:bg-[#F7FAFC]'}>
                                        <td className={td}>{borrowerLink(m.borrowerId)}</td>
                                        <td className={td}>
                                            {m.role === 'LEADER'
                                                ? <span className="inline-flex items-center gap-1 font-semibold text-amber-700"><Crown size={13} /> {tg('common.leader')}</span>
                                                : tg('common.member')}
                                        </td>
                                        <td className={tdR}>
                                            {b && !m.leftOn ? (
                                                <div>
                                                    <MoneyCell value={b.shareAmount} />
                                                    <div className="text-[11px] text-[#697386]">{fmtRate(b.shareFraction)}</div>
                                                </div>
                                            ) : '—'}
                                        </td>
                                        <td className={`${td} whitespace-nowrap`}>{m.joinedOn ?? '—'}</td>
                                        <td className={td}>
                                            {m.leftOn ? (
                                                <div className="space-y-0.5">
                                                    <StatusBadge status="INACTIVE" />
                                                    <div className="text-[11px]">{m.exitReason ? tg('detail.leftWithReason', { date: m.leftOn, reason: m.exitReason }) : tg('detail.left', { date: m.leftOn })}</div>
                                                    {m.exitSettlement && <div className="text-[11px]">{tg('detail.settlement')} <MoneyCell value={m.exitSettlement} /></div>}
                                                </div>
                                            ) : <StatusBadge status="ACTIVE" />}
                                        </td>
                                        <td className={`${td} text-right`}>
                                            {!m.leftOn && mayManage && (
                                                <div className="flex justify-end gap-1.5">
                                                    {m.role !== 'LEADER' && !disbanded && (
                                                        <Btn size="sm" variant="secondary" onClick={() => { setPromoting(m); setAdding(false); setRemoving(null); }}><Crown size={12} /> {tc('leader.make')}</Btn>
                                                    )}
                                                    <Btn size="sm" variant="danger" onClick={() => { setRemoving(m); setAdding(false); setPromoting(null); }}>{tg('detail.remove')}</Btn>
                                                </div>
                                            )}
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </Table>
                )}
            </Card>

            <GroupLoansCard loans={g.loans ?? []} nameOf={nameOf} />
            <GroupApplicationsCard applications={g.applications ?? []} nameOf={nameOf} />
            <LoanBindingsCard bindings={g.loanBindings} nameOf={nameOf} loanRef={loanRef} />
        </LendingShell>
    );
}

function AddMemberForm({ groupId, hasLeader, exclude, onDone, onClose }: {
    groupId: string; hasLeader: boolean; exclude: string[]; onDone: (msg: string) => void; onClose: () => void;
}) {
    const tg = useTranslations('LendingGroups');
    const [borrowerId, setBorrowerId] = useState('');
    const [leader, setLeader] = useState(false);
    const [joinedOn, setJoinedOn] = useState('');
    const [problem, setProblem] = useState('');
    const { busy, error, run, clearError } = useAction();

    const submit = async () => {
        if (!borrowerId) { setProblem(tg('add.pickBorrower')); return; }
        setProblem('');
        const body: AddMemberBody = clean({ borrowerId, role: leader ? 'LEADER' : 'MEMBER', joinedOn });
        const res = await run('add', () => api.post(`/lending/applications/groups/${groupId}/members`, body));
        if (res) onDone(leader ? tg('add.leaderAdded') : tg('add.memberAdded'));
    };

    return (
        <ActionPanel title={tg('add.title')} onClose={onClose}>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <Field label={tg('add.borrower')} error={problem || undefined} className="md:col-span-2">
                    <BorrowerPicker value={borrowerId} onChange={setBorrowerId} exclude={exclude} />
                </Field>
                <div className="space-y-3">
                    <Field label={tg('add.joinedOn')} hint={tg('add.joinedOnHint')}>
                        <TextInput type="date" value={joinedOn} onChange={setJoinedOn} />
                    </Field>
                    <Checkbox
                        checked={leader}
                        onChange={setLeader}
                        disabled={hasLeader}
                        label={hasLeader ? tg('add.leaderTaken') : tg('add.groupLeader')}
                    />
                </div>
            </div>
            <p className="text-[11px] text-[#697386]">
                {tg('add.note')}
            </p>
            <ErrorBox error={error} onDismiss={clearError} />
            <Btn variant="primary" onClick={submit} busy={busy === 'add'}>{tg('add.submit')}</Btn>
        </ActionPanel>
    );
}

function RemoveMemberForm({ groupId, member, name, onDone, onClose }: {
    groupId: string; member: GroupMembership; name: string; onDone: (msg: string) => void; onClose: () => void;
}) {
    const tg = useTranslations('LendingGroups');
    const [reason, setReason] = useState('');
    const { busy, error, run, clearError } = useAction();
    const refused = error?.code === 'MEMBER_EXIT_REFUSED';

    const submit = async () => {
        if (!reason.trim()) return;
        const res = await run('remove', () =>
            api.post<RemoveMemberResult>(`/lending/applications/groups/${groupId}/members/${member.borrowerId}/remove`, { reason: reason.trim() }),
        );
        if (res) {
            const s = res.data.settlementAmount;
            onDone(s ? tg('remove.leftSettlement', { name, amount: s }) : tg('remove.left', { name }));
        }
    };

    return (
        <ActionPanel title={tg('remove.title', { name })} onClose={onClose}>
            <Field label={tg('common.reason')} hint={tg('remove.reasonHint')}>
                <TextArea value={reason} onChange={setReason} rows={2} maxLength={500} />
            </Field>
            {refused ? (
                <Notice tone="danger" title={tg('remove.refusedTitle')}>
                    <ul className="list-disc pl-5 space-y-0.5 mt-1">
                        {(error.issues?.length ? error.issues.map((i) => i.message) : [error.message]).map((msg, k) => <li key={k}>{msg}</li>)}
                    </ul>
                    <p className="mt-1.5 text-[12px] opacity-80">
                        {tg('remove.refusedNote')}
                    </p>
                </Notice>
            ) : (
                <ErrorBox error={error} onDismiss={clearError} />
            )}
            <Btn variant="danger" onClick={submit} busy={busy === 'remove'} disabled={!reason.trim()} reason={!reason.trim() ? tg('remove.giveReason') : undefined}>{tg('remove.submit')}</Btn>
        </ActionPanel>
    );
}

function ChangeLeaderForm({ groupId, member, name, currentLeader, onDone, onClose }: {
    groupId: string; member: GroupMembership; name: string; currentLeader: string | null; onDone: (msg: string) => void; onClose: () => void;
}) {
    const tc = useTranslations('Customers');
    const [reason, setReason] = useState('');
    const { busy, error, run, clearError } = useAction();
    const submit = async () => {
        const res = await run('leader', () => api.post(`/lending/applications/groups/${groupId}/leader`, clean({ borrowerId: member.borrowerId, reason: reason.trim() })));
        if (res) onDone(tc('leader.done', { name }));
    };
    return (
        <ActionPanel title={tc('leader.title', { name })} onClose={onClose}>
            <p className="text-[13px] text-[#3C4257]">
                {currentLeader ? tc('leader.explainFrom', { from: currentLeader, to: name }) : tc('leader.explain', { to: name })}
            </p>
            <Field label={tc('leader.reason')} hint={tc('leader.reasonHint')}>
                <TextArea value={reason} onChange={setReason} rows={2} maxLength={500} />
            </Field>
            <ErrorBox error={error} onDismiss={clearError} />
            <Btn variant="primary" onClick={submit} busy={busy === 'leader'}><Crown size={14} /> {tc('leader.confirm')}</Btn>
        </ActionPanel>
    );
}

function GroupLoansCard({ loans, nameOf }: { loans: GroupLoan[]; nameOf: (id: string) => string }) {
    const tc = useTranslations('Customers');
    const href = useLendingHref();
    return (
        <Card title={tc('groupLoans.title')} subtitle={tc('groupLoans.subtitle')} bodyClass="p-0">
            {loans.length === 0 ? <Empty>{tc('groupLoans.none')}</Empty> : (
                <Table>
                    <thead>
                        <tr className="border-b border-[#E3E8EE] bg-[#F7FAFC]">
                            <th className={th}>{tc('groupLoans.loan')}</th>
                            <th className={th}>{tc('groupLoans.signatory')}</th>
                            <th className={th}>{tc('groupLoans.status')}</th>
                            <th className={thR}>{tc('groupLoans.outstanding')}</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-[#F0F2F5]">
                        {loans.map((l) => (
                            <tr key={l.id} className="hover:bg-[#F7FAFC]">
                                <td className={td}><Link href={href(`/lending/loans/${l.id}`)} className="font-mono text-[12px] font-semibold text-[#635BFF] hover:underline">{l.reference}</Link></td>
                                <td className={td}>{nameOf(l.borrowerId)}</td>
                                <td className={td}><StatusBadge status={l.status} /></td>
                                <td className={tdR}><MoneyCell value={l.principalOutstanding} currency={l.currency} /></td>
                            </tr>
                        ))}
                    </tbody>
                </Table>
            )}
        </Card>
    );
}

function GroupApplicationsCard({ applications, nameOf }: { applications: GroupApplication[]; nameOf: (id: string) => string }) {
    const tc = useTranslations('Customers');
    const href = useLendingHref();
    if (applications.length === 0) return null;
    return (
        <Card title={tc('groupApps.title')} bodyClass="p-0">
            <Table>
                <thead>
                    <tr className="border-b border-[#E3E8EE] bg-[#F7FAFC]">
                        <th className={th}>{tc('groupApps.application')}</th>
                        <th className={th}>{tc('groupLoans.signatory')}</th>
                        <th className={th}>{tc('groupLoans.status')}</th>
                        <th className={thR}>{tc('groupApps.requested')}</th>
                    </tr>
                </thead>
                <tbody className="divide-y divide-[#F0F2F5]">
                    {applications.map((a) => (
                        <tr key={a.id} className="hover:bg-[#F7FAFC]">
                            <td className={td}><Link href={href(`/lending/applications/${a.id}`)} className="font-mono text-[12px] font-semibold text-[#635BFF] hover:underline">{a.reference}</Link></td>
                            <td className={td}>{nameOf(a.borrowerId)}</td>
                            <td className={td}><StatusBadge status={a.status} /></td>
                            <td className={tdR}><MoneyCell value={a.requestedAmount} currency={a.currency} /></td>
                        </tr>
                    ))}
                </tbody>
            </Table>
        </Card>
    );
}

function LoanBindingsCard({ bindings, nameOf, loanRef }: { bindings: LoanBinding[]; nameOf: (id: string) => string; loanRef: Map<string, string> }) {
    const href = useLendingHref();
    const tc = useTranslations('Customers');
    const tg = useTranslations('LendingGroups');
    return (
        <Card title={tc('groupLoans.sharesTitle')} subtitle={tg('bindings.subtitle')} bodyClass="p-0">
            {bindings.length === 0 ? <Empty>{tc('groupLoans.none')}</Empty> : (
                <Table>
                    <thead>
                        <tr className="border-b border-[#E3E8EE] bg-[#F7FAFC]">
                            <th className={th}>{tc('groupLoans.loan')}</th>
                            <th className={th}>{tg('common.member')}</th>
                            <th className={th}>{tg('common.role')}</th>
                            <th className={th}>{tg('common.liability')}</th>
                            <th className={thR}>{tg('common.share')}</th>
                            <th className={thR}>{tg('common.fraction')}</th>
                            <th className={thR}>{tg('common.liableFor')}</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-[#F0F2F5]">
                        {bindings.map((b, i) => (
                            <tr key={`${b.loanAccountId ?? i}-${b.borrowerId}`} className="hover:bg-[#F7FAFC]">
                                <td className={td}>
                                    {b.loanAccountId
                                        ? <Link href={href(`/lending/loans/${b.loanAccountId}`)} className="font-mono text-[12px] font-semibold text-[#635BFF] hover:underline">{loanRef.get(b.loanAccountId) ?? shortId(b.loanAccountId)}</Link>
                                        : <span className="text-[#AAB7C4]">—</span>}
                                </td>
                                <td className={td}>{nameOf(b.borrowerId)}</td>
                                <td className={td}>{b.role === 'LEADER' ? tg('common.leader') : tg('common.member')}</td>
                                <td className={td}><StatusBadge status={b.liability} /></td>
                                <td className={tdR}><MoneyCell value={b.shareAmount} /></td>
                                <td className={tdR}>{fmtRate(b.shareFraction)}</td>
                                <td className={tdR}><MoneyCell value={b.liableFor} strong /></td>
                            </tr>
                        ))}
                    </tbody>
                </Table>
            )}
        </Card>
    );
}
