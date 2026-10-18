"use client";

import { Fragment, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { FileText, Plus, Send, ShieldCheck } from 'lucide-react';
import api from '@/lib/api';
import { useToast } from '@/components/ui/toast';
import { LendingShell, useLendingHref } from '../LendingShell';
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
    const t = useTranslations('LendingDocuments');
    if (!d.expiresOn) return <span className="text-[#AAB7C4]">—</span>;
    const tone = d.expired ? 'text-red-700 font-semibold' : d.daysToExpiry !== null && d.daysToExpiry <= 30 ? 'text-amber-700 font-semibold' : '';
    return (
        <span className={`whitespace-nowrap ${tone}`}>
            {d.expiresOn}
            <span className="block text-[11px] font-normal text-[#697386]">{d.expired ? t('library.expired') : t('library.days', { count: d.daysToExpiry ?? 0 })}</span>
        </span>
    );
}

/**
 * One customer's document library (DOC-1): KYC, application, loan and
 * generated documents with their review state, versions, expiry, legal hold
 * and the required-document checklist of each open application.
 */
export function CustomerDocumentsView({ borrowerId }: { borrowerId: string }) {
    const t = useTranslations('LendingDocuments');
    const ts = useTranslations('Status');
    const { showToast } = useToast();
    const href = useLendingHref();
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
            title={t('library.title')}
            subtitle={t('library.subtitle')}
            back={{ href: `/borrowers/${borrowerId}`, label: t('library.back') }}
            actions={<>
                <Link href={href(`/lending/customers/${borrowerId}/alternative-data`)} className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[13px] font-semibold text-[#635BFF] hover:underline">
                    <ShieldCheck size={14} /> {t('library.altData')}
                </Link>
                <Btn onClick={() => { setPreset(undefined); setPanel(panel === 'request' ? null : 'request'); }}><Send size={14} /> {t('library.requestFromCustomer')}</Btn>
                <Btn variant="primary" onClick={() => setPanel(panel === 'upload' ? null : 'upload')}><Plus size={15} /> {t('common.upload')}</Btn>
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
                        <Tile label={t('library.tileDocuments')} value={lib.data.documents.filter((d) => d.status === 'ACTIVE').length} />
                        <Tile label={t('common.awaitingReview')} value={pending} tone={pending ? 'amber' : undefined} />
                        <Tile label={t('library.tileExpired')} value={expired} tone={expired ? 'red' : undefined} />
                        <Tile label={t('library.tileOpenRequests')} value={openRequests.length} />
                    </div>

                    {lib.data.checklist.map((c) => (
                        <Card key={c.applicationId} title={t('library.checklistTitle', { reference: c.reference })} subtitle={t('library.checklistSubtitle', { status: ts.has(c.status) ? ts(c.status) : c.status.toLowerCase() })} bodyClass="p-0">
                            {c.items.length === 0 ? <Empty>{t('library.noneRequired')}</Empty> : (
                                <Table>
                                    <thead><tr className="border-b border-[#E3E8EE] bg-[#F7FAFC]"><th className={th}>{t('common.document')}</th><th className={th}>{t('library.colStage')}</th><th className={th}>{t('common.status')}</th><th className={th}></th></tr></thead>
                                    <tbody className="divide-y divide-[#F0F2F5]">
                                        {c.items.map((i) => (
                                            <tr key={i.code}>
                                                <td className={td}>{i.label}<div className="font-mono text-[11px] text-[#697386]">{i.code}{i.mandatory ? '' : ` · ${t('library.optional')}`}</div></td>
                                                <td className={td}>{t.has(`stages.${i.stage}`) ? t(`stages.${i.stage}`) : i.stage.toLowerCase()}</td>
                                                <td className={td}><StatusBadge status={i.status} /></td>
                                                <td className={`${td} text-right`}>
                                                    {['MISSING', 'REJECTED', 'EXPIRED'].includes(i.status) && (
                                                        <Btn size="sm" onClick={() => { setPreset({ typeCode: i.code, label: i.label, applicationId: c.applicationId }); setPanel('request'); }}>{t('library.request')}</Btn>
                                                    )}
                                                    {i.documentIds[0] && <Btn size="sm" variant="ghost" onClick={() => setOpenId(i.documentIds[0])}>{t('common.open')}</Btn>}
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </Table>
                            )}
                        </Card>
                    ))}

                    {openRequests.length > 0 && (
                        <Card title={t('library.requestedTitle')} subtitle={t('library.requestedSubtitle')} bodyClass="p-0">
                            <Table>
                                <thead><tr className="border-b border-[#E3E8EE] bg-[#F7FAFC]"><th className={th}>{t('common.document')}</th><th className={th}>{t('library.colDue')}</th><th className={th}>{t('common.status')}</th><th className={th}>{t('library.colLastRejection')}</th><th className={th}></th></tr></thead>
                                <tbody className="divide-y divide-[#F0F2F5]">
                                    {openRequests.map((r) => (
                                        <tr key={r.id}>
                                            <td className={td}>{r.label}<div className="font-mono text-[11px] text-[#697386]">{r.typeCode}</div></td>
                                            <td className={td}>{r.dueOn ?? '—'}</td>
                                            <td className={td}><StatusBadge status={r.status} /></td>
                                            <td className={td}>{r.lastRejection ?? '—'}</td>
                                            <td className={`${td} text-right`}>
                                                {r.documentId && <Btn size="sm" variant="ghost" onClick={() => setOpenId(r.documentId)}>{t('common.open')}</Btn>}
                                                <Btn size="sm" variant="ghost" busy={busy === r.id}
                                                    onClick={() => run(r.id, async () => { await api.post(`/lending/document-requests/${r.id}/cancel`); showToast(t('library.withdrawn'), 'success'); reload(); })}>{t('library.withdraw')}</Btn>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </Table>
                            <div className="px-4 pb-3"><ErrorBox error={error} /></div>
                        </Card>
                    )}

                    <Card title={t('library.libraryTitle')} bodyClass="p-0" actions={<Checkbox checked={showDeleted} onChange={setShowDeleted} label={t('library.showDeleted')} />}>
                        <div className="px-4 pt-2">
                            <Tabs<Filter> value={filter} onChange={setFilter} tabs={[{ value: '', label: t('library.all') }, ...DOCUMENT_CATEGORIES.map((c) => ({ value: c, label: t(`categories.${c}`) }))]} />
                        </div>
                        {docs.length === 0 ? <Empty>{filter ? t('library.noDocsInCategory') : t('library.noDocs')}</Empty> : (
                            <Table>
                                <thead>
                                    <tr className="border-b border-[#E3E8EE] bg-[#F7FAFC]">
                                        <th className={th}>{t('common.document')}</th><th className={th}>{t('common.category')}</th><th className={th}>{t('common.version')}</th><th className={th}>{t('common.review')}</th><th className={th}>{t('common.expires')}</th><th className={th}>{t('library.colFiled')}</th><th className={th}></th>
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
                                                    <div className="font-mono text-[11px] text-[#697386]">{d.typeCode}{d.origin !== 'STAFF' ? ` · ${t.has(`origins.${d.origin}`) ? t(`origins.${d.origin}`) : d.origin.toLowerCase()}` : ''}</div>
                                                </td>
                                                <td className={td}>{t.has(`categories.${d.category}`) ? t(`categories.${d.category}`) : d.category.toLowerCase()}</td>
                                                <td className={td}>v{d.currentVersion}</td>
                                                <td className={td}>
                                                    <div className="flex flex-col items-start gap-1">
                                                        <StatusBadge status={d.status === 'DELETED' ? 'DELETED' : d.reviewStatus} />
                                                        {d.legalHold && <StatusBadge status="LEGAL_HOLD" />}
                                                    </div>
                                                </td>
                                                <td className={td}><ExpiryCell d={d} /></td>
                                                <td className={`${td} whitespace-nowrap`}>{fmtDateTime(d.createdAt)}</td>
                                                <td className={`${td} text-right`}><Btn size="sm" variant={openId === d.id ? 'primary' : 'secondary'} onClick={() => setOpenId(openId === d.id ? null : d.id)}>{t('library.details')}</Btn></td>
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
                        <Card title={t('common.document')}><DocumentDetailPanel documentId={openId} onChanged={reload} /></Card>
                    )}
                    <Notice>{t('library.notice', { date: lib.data.businessDate })}</Notice>
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
