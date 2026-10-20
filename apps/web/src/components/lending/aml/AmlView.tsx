"use client";

import { Fragment, useState } from 'react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Download, Play, Upload } from 'lucide-react';
import api from '@/lib/api';
import { useToast } from '@/components/ui/toast';
import { useWorkspace } from '@/lib/workspace';
import { LendingShell, useLendingHref } from '../LendingShell';
import { ActionPanel, Btn, Card, Checkbox, Empty, ErrorBox, Field, KV, Notice, SelectInput, Spinner, Table, Tabs, TextArea, TextInput, td, tdR, th, thR } from '../ui';
import { qs, useAction, useApi } from '../useAsync';
import { StatusBadge } from '../StatusBadge';
import { fmtDateTime, fmtMoney, todayIso } from '../format';
import { useAmlText, usePeople } from './i18n';
import type { CtrReport, RatingRow, RescreenJob, ScreeningCase, StrCase, WatchListVersion } from './types';

type Tab = 'cases' | 'lists' | 'risk' | 'ctr' | 'str';

function useMe() {
    const ws = useWorkspace();
    return { can: (p: string) => !ws.access || ws.can(p), me: ws.access?.principal.id ?? null };
}

/** The AML & compliance area: screening cases, watch lists, risk ratings, the cash transaction report and suspicious transaction referrals. */
export function AmlView() {
    const { t } = useAmlText();
    const tw = useTranslations('Workspace.nav');
    const { can } = useMe();
    const params = useSearchParams();
    const tabs: { value: Tab; label: string }[] = [
        ...(can('aml.read') ? [{ value: 'cases' as const, label: t('tabs.cases') }] : []),
        ...(can('aml.screen') ? [{ value: 'lists' as const, label: t('tabs.lists') }] : []),
        ...(can('aml.read') ? [{ value: 'risk' as const, label: t('tabs.risk') }, { value: 'ctr' as const, label: t('tabs.ctr') }] : []),
        ...(can('aml.str.review') ? [{ value: 'str' as const, label: t('tabs.str') }] : []),
    ];
    const wanted = params.get('tab') as Tab | null;
    const [tab, setTab] = useState<Tab>(wanted && tabs.some((x) => x.value === wanted) ? wanted : tabs[0]?.value ?? 'cases');
    return (
        <LendingShell title={tw('aml')} subtitle={t('subtitle')}>
            {tabs.length === 0 ? <Empty>{t('noAccess')}</Empty> : (
                <>
                    <Tabs tabs={tabs} value={tab} onChange={setTab} />
                    {tab === 'cases' && <CasesTab focus={params.get('case')} />}
                    {tab === 'lists' && <WatchListsTab />}
                    {tab === 'risk' && <RiskTab />}
                    {tab === 'ctr' && <CtrTab />}
                    {tab === 'str' && <StrTab />}
                </>
            )}
        </LendingShell>
    );
}

// ── Screening cases ─────────────────────────────────────────────────────────

function CasesTab({ focus }: { focus: string | null }) {
    const { t, trigger } = useAmlText();
    const href = useLendingHref();
    const [status, setStatus] = useState(focus ? '' : 'OPEN');
    const [open, setOpen] = useState<string | null>(focus);
    const list = useApi<{ data: ScreeningCase[] }>(`/lending/aml/cases${qs({ status })}`);
    return (
        <Card title={t('cases.title')} subtitle={t('cases.subtitle')} actions={
            <SelectInput value={status} onChange={setStatus} placeholder={t('common.all')} options={['OPEN', 'PENDING_APPROVAL', 'TRUE_MATCH', 'FALSE_POSITIVE'].map((s) => ({ value: s, label: t(`caseStatus.${s}`) }))} />
        } bodyClass="p-0">
            <ErrorBox error={list.error} />
            {list.loading && !list.data ? <Spinner /> : !list.data?.data.length ? <Empty>{t('cases.none')}</Empty> : (
                <Table>
                    <thead><tr><th className={th}>{t('cases.reference')}</th><th className={th}>{t('common.customer')}</th><th className={th}>{t('cases.type')}</th><th className={thR}>{t('cases.score')}</th><th className={th}>{t('cases.trigger')}</th><th className={th}>{t('common.status')}</th><th className={th}>{t('common.created')}</th></tr></thead>
                    <tbody>
                        {list.data.data.map((c) => (
                            <Fragment key={c.id}>
                                <tr className="border-t border-[#E3E8EE] hover:bg-[#F7FAFC] cursor-pointer" onClick={() => setOpen(open === c.id ? null : c.id)}>
                                    <td className={`${td} font-mono`}>{c.reference}</td>
                                    <td className={td}>{c.borrower ? <Link onClick={(e) => e.stopPropagation()} className="text-[#635BFF] hover:underline" href={href(`/borrowers/${c.borrowerId}`)}>{c.borrower.firstName} {c.borrower.lastName}</Link> : c.borrowerId.slice(0, 8)}</td>
                                    <td className={td}><StatusBadge status={c.topType} /></td>
                                    <td className={tdR}>{Number(c.topScore).toFixed(2)}</td>
                                    <td className={td}>{trigger(c.trigger)}</td>
                                    <td className={td}><StatusBadge status={c.status} /></td>
                                    <td className={td}>{fmtDateTime(c.createdAt)}</td>
                                </tr>
                                {open === c.id && <tr><td colSpan={7} className="p-4 bg-[#F7FAFC]"><CaseDetail id={c.id} onChange={list.reload} /></td></tr>}
                            </Fragment>
                        ))}
                    </tbody>
                </Table>
            )}
        </Card>
    );
}

function CaseDetail({ id, onChange }: { id: string; onChange: () => void }) {
    const { t } = useAmlText();
    const { can, me } = useMe();
    const { showToast } = useToast();
    const c = useApi<ScreeningCase & { pendingDisposition: { taskId: string; proposedBy: string } | null }>(`/lending/aml/cases/${id}`);
    const person = usePeople([c.data?.proposedBy, c.data?.decidedBy]);
    const [outcome, setOutcome] = useState('FALSE_POSITIVE');
    const [reason, setReason] = useState('');
    const { busy, error, run } = useAction();
    if (!c.data) return c.error ? <ErrorBox error={c.error} /> : <Spinner />;
    const d = c.data;
    const act = async (name: string, url: string, body: unknown, msg: string) => {
        const r = await run(name, () => api.post(url, body));
        if (r) { setReason(''); showToast(msg, 'success'); c.reload(); onChange(); }
    };
    return (
        <div className="space-y-3">
            <Table>
                <thead><tr><th className={th}>{t('cases.listEntry')}</th><th className={th}>{t('cases.matchedOn')}</th><th className={th}>{t('cases.type')}</th><th className={th}>{t('cases.list')}</th><th className={thR}>{t('cases.score')}</th><th className={th}>{t('cases.notes')}</th></tr></thead>
                <tbody>
                    {d.hits.map((h) => (
                        <tr key={h.entryId} className="border-t border-[#E3E8EE]">
                            <td className={td}>{h.listName}</td>
                            <td className={td}>{h.matchedName}</td>
                            <td className={td}><StatusBadge status={h.entryType} /></td>
                            <td className={td}>{h.listCode} · {h.source}</td>
                            <td className={tdR}>{h.score.toFixed(2)}</td>
                            <td className={td}>{[h.method === 'JOINED' ? t('cases.joined') : '', h.dobMismatch ? t('cases.dobMismatch') : ''].filter(Boolean).join(' · ') || '—'}</td>
                        </tr>
                    ))}
                </tbody>
            </Table>
            {d.disposition && <KV items={[[t('cases.disposition'), <StatusBadge key="d" status={d.disposition} />], [t('cases.proposedBy'), person(d.proposedBy)], [t('cases.decidedBy'), person(d.decidedBy)], [t('cases.reason'), d.dispositionNote || '—']]} cols={4} />}
            {d.status === 'OPEN' && can('aml.disposition') && (
                <ActionPanel title={t('cases.propose')}>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                        <Field label={t('cases.outcome')}><SelectInput value={outcome} onChange={setOutcome} options={['FALSE_POSITIVE', 'TRUE_MATCH'].map((o) => ({ value: o, label: t(`caseStatus.${o}`) }))} /></Field>
                        <Field label={t('cases.reason')} className="md:col-span-2" hint={outcome === 'TRUE_MATCH' ? t('cases.trueMatchHint') : t('cases.falsePositiveHint')}><TextArea value={reason} onChange={setReason} /></Field>
                    </div>
                    <ErrorBox error={error} />
                    <Btn variant="primary" busy={busy === 'propose'} disabled={reason.trim().length < 5} onClick={() => act('propose', `/lending/aml/cases/${id}/disposition`, { outcome, reason: reason.trim() }, t('toast.proposed'))}>{t('cases.propose')}</Btn>
                </ActionPanel>
            )}
            {d.status === 'PENDING_APPROVAL' && (
                <Notice tone="info" title={t('cases.awaiting', { who: person(d.proposedBy) })}>
                    {can('aml.disposition') && d.proposedBy !== me ? (
                        <div className="flex flex-wrap gap-2 mt-2 items-center">
                            <Btn size="sm" variant="primary" busy={busy === 'approve'} onClick={() => act('approve', `/lending/aml/cases/${id}/disposition/decision`, { approve: true }, t('toast.decided'))}>{t('cases.approve')}</Btn>
                            <Btn size="sm" variant="danger" busy={busy === 'back'} disabled={reason.trim().length < 3} onClick={() => act('back', `/lending/aml/cases/${id}/disposition/decision`, { approve: false, comment: reason.trim() }, t('toast.sentBack'))}>{t('cases.sendBack')}</Btn>
                            <TextInput value={reason} onChange={setReason} placeholder={t('panel.refuseReason')} />
                        </div>
                    ) : <p>{t('cases.secondPerson')}</p>}
                    <ErrorBox error={error} />
                </Notice>
            )}
        </div>
    );
}

// ── Watch lists ─────────────────────────────────────────────────────────────

function WatchListsTab() {
    const { t } = useAmlText();
    const { can, me } = useMe();
    const { showToast } = useToast();
    const data = useApi<{ versions: WatchListVersion[]; jobs: RescreenJob[] }>('/lending/aml/watch-lists');
    const person = usePeople((data.data?.versions ?? []).flatMap((v) => [v.makerId, v.checkerId]));
    const [upload, setUpload] = useState<{ listCode: string; name: string; fileName: string; content: string } | null>(null);
    const [reason, setReason] = useState('');
    const { busy, error, run } = useAction();
    const act = async (name: string, url: string, body: unknown, msg: string) => {
        const r = await run(name, () => api.post(url, body));
        if (r) { setReason(''); setUpload(null); showToast(msg, 'success'); data.reload(); }
        return r;
    };
    const readFile = async (file: File | undefined) => {
        if (!file) return;
        const content = await file.text();
        setUpload((u) => ({ ...(u ?? { listCode: '', name: '' }), fileName: file.name, content }));
    };
    return (
        <div className="space-y-4">
            <Card title={t('lists.title')} subtitle={t('lists.subtitle')} actions={
                <>
                    {can('aml.screen') && <Btn size="sm" variant="primary" onClick={() => setUpload({ listCode: '', name: '', fileName: '', content: '' })}><Upload size={13} /> {t('lists.upload')}</Btn>}
                    {can('aml.disposition') && <Btn size="sm" busy={busy === 'run'} onClick={async () => {
                        const r = await run('run', () => api.post<{ jobs: unknown[] }>('/lending/aml/rescreen-jobs/run'));
                        if (r) { showToast(t('toast.rescreened', { count: r.data.jobs.length }), 'success'); data.reload(); }
                    }}><Play size={13} /> {t('lists.runRescreen')}</Btn>}
                </>
            } bodyClass="p-0">
                {upload && (
                    <div className="p-4">
                        <ActionPanel title={t('lists.upload')} onClose={() => setUpload(null)}>
                            <Notice>{t('lists.format')}</Notice>
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                                <Field label={t('lists.code')} hint={t('lists.codeHint')}><TextInput value={upload.listCode} onChange={(v) => setUpload({ ...upload, listCode: v.toUpperCase() })} /></Field>
                                <Field label={t('lists.name')}><TextInput value={upload.name} onChange={(v) => setUpload({ ...upload, name: v })} /></Field>
                                <Field label={t('lists.file')}><input type="file" accept=".csv,text/csv" onChange={(e) => void readFile(e.target.files?.[0])} className="text-[12px]" /></Field>
                            </div>
                            <ErrorBox error={error} />
                            <Btn variant="primary" busy={busy === 'upload'} disabled={!upload.listCode || upload.name.trim().length < 2 || !upload.content}
                                onClick={() => act('upload', '/lending/aml/watch-lists', { ...upload, name: upload.name.trim() }, t('toast.uploaded'))}>{t('lists.upload')}</Btn>
                        </ActionPanel>
                    </div>
                )}
                <ErrorBox error={data.error} />
                {!data.data ? <Spinner /> : !data.data.versions.length ? <Empty>{t('lists.none')}</Empty> : (
                    <Table>
                        <thead><tr><th className={th}>{t('lists.code')}</th><th className={th}>{t('lists.name')}</th><th className={thR}>{t('lists.entries')}</th><th className={th}>{t('common.status')}</th><th className={th}>{t('lists.uploadedBy')}</th><th className={th}>{t('lists.activatedBy')}</th><th className={th} /></tr></thead>
                        <tbody>
                            {data.data.versions.map((v) => (
                                <tr key={v.id} className="border-t border-[#E3E8EE]">
                                    <td className={`${td} font-mono`}>{v.listCode} v{v.version}</td>
                                    <td className={td}>{v.name}<div className="text-[11px] text-[#697386]">{v.fileName} · {fmtDateTime(v.createdAt)}</div></td>
                                    <td className={tdR}>{v.entryCount}</td>
                                    <td className={td}><StatusBadge status={v.status} />{v.reason && <div className="text-[11px] text-[#697386]">{v.reason}</div>}</td>
                                    <td className={td}>{person(v.makerId)}</td>
                                    <td className={td}>{person(v.checkerId)}</td>
                                    <td className={td}>
                                        {v.status === 'PENDING' && can('aml.disposition') && v.makerId !== me && (
                                            <div className="flex gap-1.5 items-center">
                                                <Btn size="sm" variant="primary" busy={busy === `a${v.id}`} onClick={() => act(`a${v.id}`, `/lending/aml/watch-lists/${v.id}/decision`, { approve: true }, t('toast.activated'))}>{t('lists.activate')}</Btn>
                                                <Btn size="sm" variant="danger" busy={busy === `r${v.id}`} disabled={reason.trim().length < 3} onClick={() => act(`r${v.id}`, `/lending/aml/watch-lists/${v.id}/decision`, { approve: false, reason: reason.trim() }, t('toast.refused'))}>{t('lists.reject')}</Btn>
                                                <TextInput value={reason} onChange={setReason} placeholder={t('panel.refuseReason')} />
                                            </div>
                                        )}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </Table>
                )}
            </Card>
            <Card title={t('lists.jobs')} subtitle={t('lists.jobsSubtitle')} bodyClass="p-0">
                {!data.data?.jobs.length ? <Empty>{t('lists.noJobs')}</Empty> : (
                    <Table>
                        <thead><tr><th className={th}>{t('common.created')}</th><th className={th}>{t('common.status')}</th><th className={thR}>{t('lists.screened')}</th><th className={thR}>{t('lists.casesOpened')}</th><th className={th}>{t('lists.completed')}</th></tr></thead>
                        <tbody>
                            {data.data.jobs.map((j) => (
                                <tr key={j.id} className="border-t border-[#E3E8EE]">
                                    <td className={td}>{fmtDateTime(j.createdAt)}</td>
                                    <td className={td}><StatusBadge status={j.status} />{j.error && <div className="text-[11px] text-red-600">{j.error}</div>}</td>
                                    <td className={tdR}>{j.screened}</td>
                                    <td className={tdR}>{j.casesOpened}</td>
                                    <td className={td}>{fmtDateTime(j.completedAt)}</td>
                                </tr>
                            ))}
                        </tbody>
                    </Table>
                )}
            </Card>
        </div>
    );
}

// ── Risk ratings ────────────────────────────────────────────────────────────

function RiskTab() {
    const { t } = useAmlText();
    const href = useLendingHref();
    const [rating, setRating] = useState('HIGH');
    const [due, setDue] = useState(false);
    const list = useApi<{ data: RatingRow[] }>(`/lending/aml/risk-ratings${qs({ rating, due: due ? 'true' : undefined })}`);
    return (
        <Card title={t('risk.title')} subtitle={t('risk.subtitle')} actions={
            <div className="flex items-center gap-3">
                <SelectInput value={rating} onChange={setRating} placeholder={t('common.all')} options={['HIGH', 'MEDIUM', 'LOW'].map((r) => ({ value: r, label: t(`rating.${r}`) }))} />
                <Checkbox checked={due} onChange={setDue} label={t('risk.dueOnly')} />
            </div>
        } bodyClass="p-0">
            <ErrorBox error={list.error} />
            {!list.data ? <Spinner /> : !list.data.data.length ? <Empty>{t('risk.none')}</Empty> : (
                <Table>
                    <thead><tr><th className={th}>{t('common.customer')}</th><th className={th}>{t('risk.rating')}</th><th className={thR}>{t('panel.score')}</th><th className={th}>PEP</th><th className={th}>{t('panel.edd')}</th><th className={th}>AML</th><th className={th}>{t('panel.nextReview')}</th></tr></thead>
                    <tbody>
                        {list.data.data.map((r) => (
                            <tr key={r.id} className="border-t border-[#E3E8EE]">
                                <td className={td}><Link className="text-[#635BFF] hover:underline" href={href(`/borrowers/${r.id}`)}>{r.firstName} {r.lastName}</Link></td>
                                <td className={td}><StatusBadge status={r.amlRiskRating} /></td>
                                <td className={tdR}>{r.amlRiskScore ?? '—'}</td>
                                <td className={td}>{r.pep ? <StatusBadge status="PEP" /> : '—'}</td>
                                <td className={td}>{r.eddRequired ? <StatusBadge status={r.eddStatus === 'NONE' ? 'MISSING' : r.eddStatus} /> : t('panel.notRequired')}</td>
                                <td className={td}><StatusBadge status={r.amlStatus} /></td>
                                <td className={td}>{r.amlNextReviewOn ?? '—'}</td>
                            </tr>
                        ))}
                    </tbody>
                </Table>
            )}
        </Card>
    );
}

// ── Cash transaction report ─────────────────────────────────────────────────

function CtrTab() {
    const { t } = useAmlText();
    const today = todayIso();
    const [range, setRange] = useState({ from: `${today.slice(0, 8)}01`, to: today });
    const [query, setQuery] = useState(range);
    const report = useApi<CtrReport>(`/lending/aml/ctr${qs(query)}`);
    const r = report.data;
    return (
        <Card title={t('ctr.title')} subtitle={t('ctr.subtitle')} actions={
            <div className="flex flex-wrap items-end gap-2">
                <Field label={t('ctr.from')}><TextInput type="date" value={range.from} onChange={(v) => setRange((x) => ({ ...x, from: v }))} /></Field>
                <Field label={t('ctr.to')}><TextInput type="date" value={range.to} onChange={(v) => setRange((x) => ({ ...x, to: v }))} /></Field>
                <Btn size="sm" variant="primary" onClick={() => setQuery(range)}>{t('ctr.run')}</Btn>
                <a href={`/api/proxy/lending/aml/ctr.csv${qs(query)}`} className="inline-flex items-center gap-1.5 rounded font-semibold shadow-sm text-[12px] px-2.5 py-1 bg-white hover:bg-slate-50 text-[#3C4257] border border-[#E3E8EE]"><Download size={13} /> {t('ctr.download')}</a>
            </div>
        } bodyClass="p-0">
            <ErrorBox error={report.error} />
            {!r ? <Spinner /> : (
                <>
                    <div className="p-4 space-y-2">
                        <KV cols={3} items={[
                            [t('ctr.thresholds'), Object.entries(r.thresholds).map(([c, v]) => `${c} ${fmtMoney(v)}`).join(' · ')],
                            [t('ctr.cashChannels'), r.cashChannels.join(', ')],
                            [t('ctr.cashTransactions'), r.cashTransactions],
                        ]} />
                        {r.withoutChannel > 0 && <Notice tone="warn">{t('ctr.withoutChannel', { count: r.withoutChannel })}</Notice>}
                        {r.unassessedCurrencies.length > 0 && <Notice tone="warn">{t('ctr.unassessed', { currencies: r.unassessedCurrencies.join(', ') })}</Notice>}
                    </div>
                    {!r.groups.length ? <Empty>{t('ctr.none')}</Empty> : (
                        <Table>
                            <thead><tr><th className={th}>{t('ctr.date')}</th><th className={th}>{t('common.customer')}</th><th className={th}>{t('ctr.id')}</th><th className={th}>{t('ctr.branch')}</th><th className={thR}>{t('ctr.total')}</th><th className={th}>{t('ctr.basis')}</th><th className={th}>{t('ctr.transactions')}</th></tr></thead>
                            <tbody>
                                {r.groups.map((g) => (
                                    <tr key={`${g.borrowerId}-${g.date}-${g.currency}`} className="border-t border-[#E3E8EE]">
                                        <td className={td}>{g.date}</td>
                                        <td className={td}>{g.customer.name}</td>
                                        <td className={td}>{[g.customer.idType, g.customer.idNumberHint].filter(Boolean).join(' ') || '—'}</td>
                                        <td className={td}>{g.customer.branch ?? '—'}</td>
                                        <td className={tdR}>{g.currency} {fmtMoney(g.total)}</td>
                                        <td className={td}>{t(`ctr.basis${g.basis}`)}</td>
                                        <td className={td}>{g.transactions.map((x) => `${x.direction === 'IN' ? t('ctr.in') : t('ctr.out')} ${fmtMoney(x.amount)}`).join(' · ')}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </Table>
                    )}
                </>
            )}
        </Card>
    );
}

// ── Suspicious transaction referrals ────────────────────────────────────────

function StrTab() {
    const { t, indicator } = useAmlText();
    const href = useLendingHref();
    const { showToast } = useToast();
    const [status, setStatus] = useState('OPEN');
    const [open, setOpen] = useState<string | null>(null);
    const list = useApi<{ data: StrCase[] }>(`/lending/aml/str${qs({ status })}`);
    const person = usePeople((list.data?.data ?? []).flatMap((s) => [s.raisedBy, s.reviewedBy]));
    const [form, setForm] = useState({ decision: 'TO_REPORT', notes: '', cafiuReference: '', reportedOn: todayIso() });
    const { busy, error, run } = useAction();
    const act = async (name: string, url: string, body: unknown, msg: string) => {
        const r = await run(name, () => api.post(url, body));
        if (r) { showToast(msg, 'success'); list.reload(); }
    };
    return (
        <Card title={t('str.title')} subtitle={t('str.subtitle')} actions={
            <SelectInput value={status} onChange={setStatus} placeholder={t('common.all')} options={['OPEN', 'TO_REPORT', 'REPORTED', 'NO_FURTHER_ACTION'].map((s) => ({ value: s, label: t(`strStatus.${s}`) }))} />
        } bodyClass="p-0">
            <div className="px-4 pt-3"><Notice tone="warn">{t('str.tippingOff')}</Notice></div>
            <ErrorBox error={list.error} />
            {!list.data ? <Spinner /> : !list.data.data.length ? <Empty>{t('str.none')}</Empty> : (
                <Table>
                    <thead><tr><th className={th}>{t('cases.reference')}</th><th className={th}>{t('common.customer')}</th><th className={th}>{t('str.raisedBy')}</th><th className={th}>{t('common.status')}</th><th className={th}>{t('common.created')}</th></tr></thead>
                    <tbody>
                        {list.data.data.map((s) => (
                            <Fragment key={s.id}>
                                <tr className="border-t border-[#E3E8EE] hover:bg-[#F7FAFC] cursor-pointer" onClick={() => setOpen(open === s.id ? null : s.id)}>
                                    <td className={`${td} font-mono`}>{s.reference}</td>
                                    <td className={td}>{s.borrower ? <Link onClick={(e) => e.stopPropagation()} className="text-[#635BFF] hover:underline" href={href(`/borrowers/${s.borrowerId}`)}>{s.borrower.firstName} {s.borrower.lastName}</Link> : s.borrowerId.slice(0, 8)}</td>
                                    <td className={td}>{person(s.raisedBy)}</td>
                                    <td className={td}><StatusBadge status={s.status} /></td>
                                    <td className={td}>{fmtDateTime(s.createdAt)}</td>
                                </tr>
                                {open === s.id && (
                                    <tr><td colSpan={5} className="p-4 bg-[#F7FAFC] space-y-3">
                                        <p className="text-[13px] whitespace-pre-wrap">{s.grounds}</p>
                                        {s.indicators.length > 0 && <p className="text-[12px] text-[#697386]">{s.indicators.map(indicator).join(' · ')}</p>}
                                        <KV cols={4} items={[
                                            [t('str.reviewedBy'), s.reviewedBy ? `${person(s.reviewedBy)} · ${fmtDateTime(s.reviewedAt)}` : '—'],
                                            [t('str.notes'), s.reviewNotes || '—'],
                                            [t('str.cafiuReference'), s.cafiuReference ?? '—'],
                                            [t('str.reportedOn'), s.cafiuReportedOn ?? '—'],
                                        ]} />
                                        {s.status === 'OPEN' && (
                                            <ActionPanel title={t('str.review')}>
                                                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                                                    <Field label={t('str.decision')}><SelectInput value={form.decision} onChange={(v) => setForm((f) => ({ ...f, decision: v }))} options={['TO_REPORT', 'NO_FURTHER_ACTION'].map((d) => ({ value: d, label: t(`strStatus.${d}`) }))} /></Field>
                                                    <Field label={t('str.notes')} className="md:col-span-2"><TextArea value={form.notes} onChange={(v) => setForm((f) => ({ ...f, notes: v }))} /></Field>
                                                </div>
                                                <ErrorBox error={error} />
                                                <Btn variant="primary" busy={busy === 'review'} disabled={form.notes.trim().length < 5} onClick={() => act('review', `/lending/aml/str/${s.id}/review`, { decision: form.decision, notes: form.notes.trim() }, t('toast.reviewed'))}>{t('str.review')}</Btn>
                                            </ActionPanel>
                                        )}
                                        {s.status === 'TO_REPORT' && (
                                            <ActionPanel title={t('str.markReported')}>
                                                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                                    <Field label={t('str.cafiuReference')}><TextInput value={form.cafiuReference} onChange={(v) => setForm((f) => ({ ...f, cafiuReference: v }))} /></Field>
                                                    <Field label={t('str.reportedOn')}><TextInput type="date" value={form.reportedOn} onChange={(v) => setForm((f) => ({ ...f, reportedOn: v }))} /></Field>
                                                </div>
                                                <ErrorBox error={error} />
                                                <Btn variant="primary" busy={busy === 'reported'} disabled={form.cafiuReference.trim().length < 2 || !form.reportedOn} onClick={() => act('reported', `/lending/aml/str/${s.id}/reported`, { cafiuReference: form.cafiuReference.trim(), reportedOn: form.reportedOn }, t('toast.reported'))}>{t('str.markReported')}</Btn>
                                            </ActionPanel>
                                        )}
                                    </td></tr>
                                )}
                            </Fragment>
                        ))}
                    </tbody>
                </Table>
            )}
        </Card>
    );
}
