"use client";

import { Fragment, useMemo, useState } from 'react';
import { FileText, Plus, Send } from 'lucide-react';
import api from '@/lib/api';
import { useToast } from '@/components/ui/toast';
import { LendingShell } from '../LendingShell';
import { Btn, Card, Checkbox, Empty, ErrorBox, Notice, Spinner, Table, Tabs, td, th } from '../ui';
import { qs, useAction, useApi } from '../useAsync';
import { StatusBadge } from '../StatusBadge';
import { fmtDateTime } from '../format';
import { DOCUMENT_CATEGORIES } from './types';
import type { CustomerDocument, Library } from './types';
import { DocumentDetailPanel, RequestPanel, UploadPanel } from './DocumentPanels';

type Panel = 'upload' | 'request' | null;
type Filter = '' | (typeof DOCUMENT_CATEGORIES)[number];

function ExpiryCell({ d }: { d: CustomerDocument }) {
    if (!d.expiresOn) return <span className="text-[#AAB7C4]">—</span>;
    const tone = d.expired ? 'text-red-700 font-semibold' : d.daysToExpiry !== null && d.daysToExpiry <= 30 ? 'text-amber-700 font-semibold' : '';
    return (
        <span className={`whitespace-nowrap ${tone}`}>
            {d.expiresOn}
            <span className="block text-[11px] font-normal text-[#697386]">{d.expired ? 'expired' : `${d.daysToExpiry} days`}</span>
        </span>
    );
}

/**
 * One customer's document library (DOC-1): KYC, application, loan and
 * generated documents with their review state, versions, expiry, legal hold
 * and the required-document checklist of each open application.
 */
export function CustomerDocumentsView({ borrowerId }: { borrowerId: string }) {
    const { showToast } = useToast();
    const [showDeleted, setShowDeleted] = useState(false);
    const lib = useApi<Library>(`/lending/customers/${borrowerId}/documents${qs({ includeDeleted: showDeleted ? 'true' : undefined })}`);
    const [panel, setPanel] = useState<Panel>(null);
    const [preset, setPreset] = useState<{ typeCode: string; label: string; applicationId?: string } | undefined>();
    const [openId, setOpenId] = useState<string | null>(null);
    const [filter, setFilter] = useState<Filter>('');
    const { busy, error, run } = useAction();

    const applications = useMemo(() => (lib.data?.checklist ?? []).map((c) => ({ id: c.applicationId, reference: c.reference })), [lib.data]);
    const docs = (lib.data?.documents ?? []).filter((d) => !filter || d.category === filter);
    const openRequests = (lib.data?.requests ?? []).filter((r) => r.status === 'OPEN' || r.status === 'SUBMITTED');
    const pending = (lib.data?.documents ?? []).filter((d) => d.reviewStatus === 'PENDING_REVIEW').length;
    const expired = (lib.data?.documents ?? []).filter((d) => d.expired).length;
    const reload = () => lib.reload();

    return (
        <LendingShell
            title="Customer documents"
            subtitle="One library per customer — KYC, applications, loans and letters. Every view and download is recorded."
            back={{ href: `/borrowers/${borrowerId}`, label: 'Customer profile' }}
            actions={<>
                <Btn onClick={() => { setPreset(undefined); setPanel(panel === 'request' ? null : 'request'); }}><Send size={14} /> Request from customer</Btn>
                <Btn variant="primary" onClick={() => setPanel(panel === 'upload' ? null : 'upload')}><Plus size={15} /> Upload</Btn>
            </>}
        >
            {panel === 'upload' && <UploadPanel borrowerId={borrowerId} applications={applications} onClose={() => setPanel(null)} onDone={() => { setPanel(null); reload(); }} />}
            {panel === 'request' && (
                <RequestPanel key={preset?.typeCode ?? 'blank'} borrowerId={borrowerId} applications={applications} preset={preset}
                    onClose={() => setPanel(null)} onDone={() => { setPanel(null); reload(); }} />
            )}
            {lib.error && <ErrorBox error={lib.error} />}
            {lib.loading && !lib.data ? <Spinner /> : lib.data && (
                <>
                    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                        <Tile label="Documents" value={lib.data.documents.filter((d) => d.status === 'ACTIVE').length} />
                        <Tile label="Awaiting review" value={pending} tone={pending ? 'amber' : undefined} />
                        <Tile label="Expired" value={expired} tone={expired ? 'red' : undefined} />
                        <Tile label="Open requests" value={openRequests.length} />
                    </div>

                    {lib.data.checklist.map((c) => (
                        <Card key={c.applicationId} title={`Required documents — application ${c.reference}`} subtitle={`Status ${c.status.toLowerCase()}. Missing, rejected or expired mandatory items block the stage.`} bodyClass="p-0">
                            {c.items.length === 0 ? <Empty>The product requires no documents.</Empty> : (
                                <Table>
                                    <thead><tr className="border-b border-[#E3E8EE] bg-[#F7FAFC]"><th className={th}>Document</th><th className={th}>Stage</th><th className={th}>Status</th><th className={th}></th></tr></thead>
                                    <tbody className="divide-y divide-[#F0F2F5]">
                                        {c.items.map((i) => (
                                            <tr key={i.code}>
                                                <td className={td}>{i.label}<div className="font-mono text-[11px] text-[#697386]">{i.code}{i.mandatory ? '' : ' · optional'}</div></td>
                                                <td className={td}>{i.stage.toLowerCase()}</td>
                                                <td className={td}><StatusBadge status={i.status} /></td>
                                                <td className={`${td} text-right`}>
                                                    {['MISSING', 'REJECTED', 'EXPIRED'].includes(i.status) && (
                                                        <Btn size="sm" onClick={() => { setPreset({ typeCode: i.code, label: i.label, applicationId: c.applicationId }); setPanel('request'); }}>Request</Btn>
                                                    )}
                                                    {i.documentIds[0] && <Btn size="sm" variant="ghost" onClick={() => setOpenId(i.documentIds[0])}>Open</Btn>}
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </Table>
                            )}
                        </Card>
                    ))}

                    {openRequests.length > 0 && (
                        <Card title="Requested from the customer" subtitle="Shown in the borrower portal until accepted." bodyClass="p-0">
                            <Table>
                                <thead><tr className="border-b border-[#E3E8EE] bg-[#F7FAFC]"><th className={th}>Document</th><th className={th}>Due</th><th className={th}>Status</th><th className={th}>Last rejection</th><th className={th}></th></tr></thead>
                                <tbody className="divide-y divide-[#F0F2F5]">
                                    {openRequests.map((r) => (
                                        <tr key={r.id}>
                                            <td className={td}>{r.label}<div className="font-mono text-[11px] text-[#697386]">{r.typeCode}</div></td>
                                            <td className={td}>{r.dueOn ?? '—'}</td>
                                            <td className={td}><StatusBadge status={r.status} /></td>
                                            <td className={td}>{r.lastRejection ?? '—'}</td>
                                            <td className={`${td} text-right`}>
                                                {r.documentId && <Btn size="sm" variant="ghost" onClick={() => setOpenId(r.documentId)}>Open</Btn>}
                                                <Btn size="sm" variant="ghost" busy={busy === r.id}
                                                    onClick={() => run(r.id, async () => { await api.post(`/lending/document-requests/${r.id}/cancel`); showToast('Request withdrawn', 'success'); reload(); })}>Withdraw</Btn>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </Table>
                            <div className="px-4 pb-3"><ErrorBox error={error} /></div>
                        </Card>
                    )}

                    <Card title="Library" bodyClass="p-0" actions={<Checkbox checked={showDeleted} onChange={setShowDeleted} label="Show deleted" />}>
                        <div className="px-4 pt-2">
                            <Tabs<Filter> value={filter} onChange={setFilter} tabs={[{ value: '', label: 'All' }, ...DOCUMENT_CATEGORIES.map((c) => ({ value: c, label: c.charAt(0) + c.slice(1).toLowerCase() }))]} />
                        </div>
                        {docs.length === 0 ? <Empty>No documents{filter ? ' in this category' : ''}.</Empty> : (
                            <Table>
                                <thead>
                                    <tr className="border-b border-[#E3E8EE] bg-[#F7FAFC]">
                                        <th className={th}>Document</th><th className={th}>Category</th><th className={th}>Version</th><th className={th}>Review</th><th className={th}>Expires</th><th className={th}>Filed</th><th className={th}></th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-[#F0F2F5]">
                                    {docs.map((d) => (
                                        <Fragment key={d.id}>
                                            <tr className={`${openId === d.id ? 'bg-[#F7FAFC]' : 'hover:bg-[#F7FAFC]'} ${d.status === 'DELETED' ? 'opacity-60' : ''}`}>
                                                <td className={td}>
                                                    <button type="button" onClick={() => setOpenId(openId === d.id ? null : d.id)} className="flex items-start gap-1.5 text-left font-semibold text-[#635BFF] hover:underline">
                                                        <FileText size={14} className="mt-0.5 shrink-0" /> {d.title}
                                                    </button>
                                                    <div className="font-mono text-[11px] text-[#697386]">{d.typeCode}{d.origin !== 'STAFF' ? ` · ${d.origin.toLowerCase()}` : ''}</div>
                                                </td>
                                                <td className={td}>{d.category.toLowerCase()}</td>
                                                <td className={td}>v{d.currentVersion}</td>
                                                <td className={td}>
                                                    <div className="flex flex-col items-start gap-1">
                                                        <StatusBadge status={d.status === 'DELETED' ? 'DELETED' : d.reviewStatus} />
                                                        {d.legalHold && <StatusBadge status="LEGAL_HOLD" />}
                                                    </div>
                                                </td>
                                                <td className={td}><ExpiryCell d={d} /></td>
                                                <td className={`${td} whitespace-nowrap`}>{fmtDateTime(d.createdAt)}</td>
                                                <td className={`${td} text-right`}><Btn size="sm" variant={openId === d.id ? 'primary' : 'secondary'} onClick={() => setOpenId(openId === d.id ? null : d.id)}>Details</Btn></td>
                                            </tr>
                                            {openId === d.id && (
                                                <tr><td colSpan={7} className="px-4 py-4 bg-[#FBFCFE]"><DocumentDetailPanel documentId={d.id} onChanged={reload} /></td></tr>
                                            )}
                                        </Fragment>
                                    ))}
                                </tbody>
                            </Table>
                        )}
                    </Card>
                    {openId && !docs.some((d) => d.id === openId) && (
                        <Card title="Document"><DocumentDetailPanel documentId={openId} onChanged={reload} /></Card>
                    )}
                    <Notice>Business date {lib.data.businessDate}. Downloads use links that expire within minutes; each one is logged against your user.</Notice>
                </>
            )}
        </LendingShell>
    );
}

function Tile({ label, value, tone }: { label: string; value: number; tone?: 'amber' | 'red' }) {
    const cls = tone === 'red' ? 'text-red-700' : tone === 'amber' ? 'text-amber-700' : 'text-[#1A1F36]';
    return (
        <div className="bg-white border border-[#E3E8EE] rounded-lg shadow-sm px-4 py-3">
            <p className="text-[11px] font-bold uppercase tracking-wide text-[#8792A2]">{label}</p>
            <p className={`text-[18px] font-bold mt-0.5 ${cls}`}>{value}</p>
        </div>
    );
}
