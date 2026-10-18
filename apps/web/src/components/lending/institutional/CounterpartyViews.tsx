"use client";

import { useState } from 'react';
import Link from 'next/link';
import api from '@/lib/api';
import { useTranslations } from 'next-intl';
import { useToast } from '@/components/ui/toast';
import { LendingShell, useLendingHref } from '../LendingShell';
import { ActionPanel, Btn, Card, Empty, ErrorBox, Field, KV, Notice, SelectInput, Spinner, Table, Tabs, TextInput, td, tdR, th, thR } from '../ui';
import { clean, qs, useAction, useApi } from '../useAsync';
import { fmtDateTime, fmtRate } from '../format';
import { MoneyCell } from '../MoneyCell';
import { StatusBadge } from '../StatusBadge';
import type { LoanDetail } from '../types';

const MONEY_RE = /^\d+(\.\d{1,4})?$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const COUNTERPARTY_TYPES = [
    { value: 'BANK', label: 'Bank' },
    { value: 'MUNICIPALITY', label: 'Municipality' },
    { value: 'SOVEREIGN', label: 'Sovereign' },
    { value: 'DEVELOPMENT_INSTITUTION', label: 'Development institution' },
];
/** Counterparty type label in the viewer's language. */
function useTypeLabel() {
    const t = useTranslations('LendingCounterparties.type');
    return (type: string) => (COUNTERPARTY_TYPES.some((x) => x.value === type) ? t(type) : type);
}
const RATINGS = ['AAA', 'AA+', 'AA', 'AA-', 'A+', 'A', 'A-', 'BBB+', 'BBB', 'BBB-', 'BB+', 'BB', 'BB-', 'B+', 'B', 'B-', 'CCC+', 'CCC', 'CCC-', 'CC', 'C', 'D'];

export interface LimitPosition {
    limitId: string; currency: string; limit: string; utilised: string; byStage: { OUTSTANDING: string; BOOKED: string; APPROVED: string };
    headroom: string; utilisation: string | null; reviewOn: string | null; status: string;
}
export interface Counterparty {
    id: string; reference: string; name: string; type: string; countryCode: string; borrowerId: string | null; legalIdentifier: string;
    rating: string | null; ratingAgency: string; ratedOn: string | null; investmentGrade: boolean | null; status: string; createdAt: string;
}
interface ExposureLimitRow {
    id: string; scope: string; counterpartyId: string | null; countryCode: string | null; currency: string; amount: string; reviewOn: string | null;
    status: string; note: string; proposedBy: string; decidedBy: string | null; decidedAt: string | null; comment: string; createdAt: string; counterpartyName?: string | null;
}
interface Exposure {
    asOf: string;
    byCounterparty: (Counterparty & { utilisedByCurrency: Record<string, string>; limits: LimitPosition[] })[];
    byCountry: { countryCode: string; counterparties: number; utilisedByCurrency: Record<string, string>; limits: LimitPosition[] }[];
    byType: Record<string, Record<string, string>>;
    pendingLimits: ExposureLimitRow[];
}
interface CounterpartyDetail extends Counterparty {
    position: { utilisedByCurrency: Record<string, string>; limits: LimitPosition[] };
    country: { countryCode: string; counterparties: number; limits: LimitPosition[] };
    limits: ExposureLimitRow[];
    countryLimits: ExposureLimitRow[];
    loans: { id: string; reference: string; status: string; currency: string; bookedPrincipal: string; principalOutstanding: string; maturityDate: string | null; daysPastDue: number; familyCode: string }[];
    approvedApplications: { id: string; reference: string; currency: string; requestedAmount: string }[];
}

/** Utilisation bar: green within, amber near, red beyond the limit. */
function UtilisationBar({ p }: { p: LimitPosition }) {
    const t = useTranslations('LendingCounterparties');
    const pct = p.utilisation ? Math.min(100, Math.round(Number(p.utilisation) * 100)) : 0;
    const colour = p.status === 'BREACHED' ? 'bg-red-500' : p.status === 'NEAR_LIMIT' ? 'bg-amber-500' : p.status === 'LAPSED' ? 'bg-slate-400' : 'bg-emerald-500';
    return (
        <div className="min-w-[120px]">
            <div className="h-1.5 rounded bg-slate-100 overflow-hidden"><div className={`h-full ${colour}`} style={{ width: `${pct}%` }} /></div>
            <div className="text-[11px] text-[#697386] mt-0.5">{t('used', { pct: p.utilisation ? fmtRate(p.utilisation, 1) : '—' })}</div>
        </div>
    );
}

function PositionCells({ p }: { p: LimitPosition | undefined }) {
    const t = useTranslations('LendingCounterparties');
    if (!p) return (<><td className={tdR}>—</td><td className={tdR}>—</td><td className={tdR}>—</td><td className={td}>—</td><td className={td}><StatusBadge status="NO_LIMIT" /></td></>);
    return (
        <>
            <td className={tdR}><MoneyCell value={p.limit} currency={p.currency} /></td>
            <td className={tdR}><MoneyCell value={p.utilised} currency={p.currency} /></td>
            <td className={tdR}><MoneyCell value={p.headroom} currency={p.currency} highlightNonZero /></td>
            <td className={td}><UtilisationBar p={p} /></td>
            <td className={td}><StatusBadge status={p.status} />{p.reviewOn && <div className="text-[11px] text-[#697386]">{t('review', { date: p.reviewOn })}</div>}</td>
        </>
    );
}

/** Lending › Counterparties: the exposure view, counterparties and limits awaiting approval. */
export function CounterpartiesHome() {
    const t = useTranslations('LendingCounterparties');
    const typeLabel = useTypeLabel();
    const href = useLendingHref();
    const { showToast } = useToast();
    const [tab, setTab] = useState<'exposure' | 'pending'>('exposure');
    const [panel, setPanel] = useState<'counterparty' | 'country' | null>(null);
    const exp = useApi<Exposure>('/lending/counterparties/exposure');
    const done = (msg: string) => { setPanel(null); exp.reload(); showToast(msg, 'success'); };
    const e = exp.data;
    return (
        <LendingShell
            title="Counterparties & exposure"
            subtitle="Banks, municipalities, sovereigns and development institutions, their ratings, and the counterparty and country limits every institutional loan is checked against at approval and at payout."
            actions={
                <>
                    <Btn onClick={() => setPanel('country')}>{t('proposeCountryLimit')}</Btn>
                    <Btn variant="primary" onClick={() => setPanel('counterparty')}>{t('registerCounterparty')}</Btn>
                </>
            }
        >
            {panel === 'counterparty' && <RegisterCounterparty onDone={done} onClose={() => setPanel(null)} />}
            {panel === 'country' && <ProposeLimit country onDone={done} onClose={() => setPanel(null)} />}
            {exp.error && <ErrorBox error={exp.error} />}
            <Tabs
                tabs={[
                    { value: 'exposure', label: t('home.tabExposure') },
                    { value: 'pending', label: e?.pendingLimits.length ? t('home.tabPendingCount', { count: e.pendingLimits.length }) : t('home.tabPending') },
                ]}
                value={tab}
                onChange={setTab}
            />
            {!e ? <Spinner /> : tab === 'pending' ? (
                <Card title={t('home.tabPending')} subtitle={t('home.pendingSubtitle')}>
                    {e.pendingLimits.length === 0 ? <Empty>{t('home.nothingWaiting')}</Empty> : (
                        <div className="space-y-3">{e.pendingLimits.map((l) => <PendingLimit key={l.id} l={l} onDone={done} />)}</div>
                    )}
                </Card>
            ) : (
                <div className="space-y-5">
                    <Card title={t('home.byCounterparty')} subtitle={t('home.byCounterpartySubtitle', { date: e.asOf })} bodyClass="p-0">
                        {e.byCounterparty.length === 0 ? <div className="p-5"><Empty>{t('home.noCounterparties')}</Empty></div> : (
                            <Table>
                                <thead>
                                    <tr className="border-b border-[#E3E8EE] bg-[#F7FAFC]">
                                        <th className={th}>{t('col.counterparty')}</th><th className={th}>{t('col.type')}</th><th className={th}>{t('col.country')}</th><th className={th}>{t('col.rating')}</th>
                                        <th className={thR}>{t('col.limit')}</th><th className={thR}>{t('col.used')}</th><th className={thR}>{t('col.headroom')}</th><th className={th}>{t('col.utilisation')}</th><th className={th}>{t('col.status')}</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-[#F0F2F5]">
                                    {e.byCounterparty.map((c) => (
                                        <tr key={c.id}>
                                            <td className={td}>
                                                <Link href={href(`/lending/counterparties/${c.id}`)} className="font-semibold text-[#635BFF] hover:underline">{c.name}</Link>
                                                <div className="text-[11px] text-[#697386]">{c.reference}{c.status !== 'ACTIVE' && <> · <StatusBadge status={c.status} /></>}</div>
                                            </td>
                                            <td className={td}>{typeLabel(c.type)}</td>
                                            <td className={td}>{c.countryCode}</td>
                                            <td className={td}>{c.rating ?? t('unrated')}{c.investmentGrade === false && <div className="text-[11px] text-amber-700">{t('subInvestmentLower')}</div>}</td>
                                            <PositionCells p={c.limits[0]} />
                                        </tr>
                                    ))}
                                </tbody>
                            </Table>
                        )}
                    </Card>
                    <Card title={t('home.byCountry')} subtitle={t('home.byCountrySubtitle')} bodyClass="p-0">
                        {e.byCountry.length === 0 ? <div className="p-5"><Empty>{t('home.noCountry')}</Empty></div> : (
                            <Table>
                                <thead>
                                    <tr className="border-b border-[#E3E8EE] bg-[#F7FAFC]">
                                        <th className={th}>{t('col.country')}</th><th className={thR}>{t('col.counterparties')}</th>
                                        <th className={thR}>{t('col.limit')}</th><th className={thR}>{t('col.used')}</th><th className={thR}>{t('col.headroom')}</th><th className={th}>{t('col.utilisation')}</th><th className={th}>{t('col.status')}</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-[#F0F2F5]">
                                    {e.byCountry.map((c) => (
                                        <tr key={c.countryCode}>
                                            <td className={td}><b>{c.countryCode}</b></td>
                                            <td className={tdR}>{c.counterparties}</td>
                                            <PositionCells p={c.limits[0]} />
                                        </tr>
                                    ))}
                                </tbody>
                            </Table>
                        )}
                    </Card>
                    {Object.keys(e.byType).length > 0 && (
                        <Card title={t('home.byType')}>
                            <KV
                                cols={4}
                                items={Object.entries(e.byType).map(([ty, byCur]) => [
                                    typeLabel(ty),
                                    <span key={ty}>{Object.entries(byCur).map(([cur, v]) => <span key={cur} className="block"><MoneyCell value={v} currency={cur} /></span>)}</span>,
                                ])}
                            />
                        </Card>
                    )}
                </div>
            )}
        </LendingShell>
    );
}

function PendingLimit({ l, onDone }: { l: ExposureLimitRow; onDone: (m: string) => void }) {
    const t = useTranslations('LendingCounterparties');
    const [comment, setComment] = useState('');
    const { busy, error, run, clearError } = useAction();
    const decide = async (approve: boolean) => {
        const r = await run(approve ? 'approve' : 'reject', () => api.post(`/lending/exposure-limits/${l.id}/decision`, clean({ approve, comment: comment.trim() })));
        if (r) onDone(approve ? t('pending.approved') : t('pending.rejected'));
    };
    return (
        <div className="border border-[#E3E8EE] rounded-md p-3 space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-[13px] text-[#1A1F36]">
                    {t.rich('pending.line', { b: (chunks) => <b>{chunks}</b>, who: l.scope === 'COUNTRY' ? t('countryCode', { code: l.countryCode ?? '' }) : l.counterpartyName ?? t('counterparty'), currency: l.currency, amount: l.amount, date: l.reviewOn ?? '—' })}
                </p>
                <span className="text-[11px] text-[#697386]">{t('pending.proposed', { when: fmtDateTime(l.createdAt) })}</span>
            </div>
            {l.note && <p className="text-[12px] text-[#697386]">{l.note}</p>}
            <div className="flex flex-wrap items-end gap-2">
                <Field label={t('pending.comment')} className="min-w-[220px]"><TextInput value={comment} onChange={setComment} maxLength={500} /></Field>
                <Btn variant="primary" onClick={() => decide(true)} busy={busy === 'approve'}>{t('pending.approve')}</Btn>
                <Btn variant="danger" onClick={() => decide(false)} busy={busy === 'reject'}>{t('pending.reject')}</Btn>
            </div>
            <ErrorBox error={error} onDismiss={clearError} />
        </div>
    );
}

interface LegacyBorrower { id: string; firstName?: string | null; lastName?: string | null; phone?: string | null }

function RegisterCounterparty({ onDone, onClose }: { onDone: (m: string) => void; onClose: () => void }) {
    const t = useTranslations('LendingCounterparties');
    const tt = useTranslations('LendingCounterparties.type');
    const [name, setName] = useState('');
    const [type, setType] = useState('BANK');
    const [countryCode, setCountry] = useState('KH');
    const [search, setSearch] = useState('');
    const [query, setQuery] = useState('');
    const [borrowerId, setBorrowerId] = useState('');
    const [legalIdentifier, setLegalIdentifier] = useState('');
    const [rating, setRating] = useState('');
    const [ratingAgency, setRatingAgency] = useState('');
    const [ratedOn, setRatedOn] = useState('');
    const { busy, error, run, clearError } = useAction();
    const borrowers = useApi<{ data: LegacyBorrower[] }>(`/borrowers${qs({ search: query, limit: 20, page: 1 })}`);
    const options = (borrowers.data?.data ?? []).map((b) => ({ value: b.id, label: `${[b.firstName, b.lastName].filter(Boolean).join(' ') || t('register.noName')} · ${b.id.slice(0, 8)}` }));
    const problems: string[] = [];
    if (name.trim().length < 2) problems.push(t('register.problemName'));
    if (!/^[A-Z]{2}$/.test(countryCode)) problems.push(t('register.problemCountry'));
    if (!UUID_RE.test(borrowerId.trim())) problems.push(t('register.problemBorrower'));
    if (rating && !DATE_RE.test(ratedOn)) problems.push(t('register.problemRatedOn'));
    const submit = async () => {
        const body = clean({ name: name.trim(), type, countryCode, borrowerId: borrowerId.trim(), legalIdentifier: legalIdentifier.trim(), rating, ratingAgency: ratingAgency.trim(), ratedOn });
        const r = await run('create', () => api.post('/lending/counterparties', body));
        if (r) onDone(t('register.done', { name: name.trim() }));
    };
    return (
        <ActionPanel title={t('registerCounterparty')} onClose={onClose}>
            <p className="text-[12px] text-[#697386]">{t('register.intro')}</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                <Field label={t('register.name')}><TextInput value={name} onChange={setName} maxLength={160} /></Field>
                <Field label={t('register.type')}><SelectInput value={type} onChange={setType} options={COUNTERPARTY_TYPES.map((x) => ({ value: x.value, label: tt(x.value) }))} /></Field>
                <Field label={t('register.country')}><TextInput value={countryCode} onChange={(v) => setCountry(v.toUpperCase())} maxLength={2} /></Field>
                <Field label={t('register.findBorrower')}>
                    <div className="flex gap-2">
                        <TextInput value={search} onChange={setSearch} onKeyDown={(ev) => { if (ev.key === 'Enter') { ev.preventDefault(); setQuery(search.trim()); } }} />
                        <Btn onClick={() => setQuery(search.trim())} busy={borrowers.loading}>{t('register.search')}</Btn>
                    </div>
                </Field>
                <Field label={t('register.borrowerRecord')}>
                    <SelectInput value={options.some((o) => o.value === borrowerId) ? borrowerId : ''} onChange={setBorrowerId} options={options} placeholder={options.length ? t('register.select') : t('register.noBorrowers')} />
                </Field>
                <Field label={t('register.identifier')} hint={t('optional')}><TextInput value={legalIdentifier} onChange={setLegalIdentifier} maxLength={60} /></Field>
                <Field label={t('register.rating')} hint={t('register.ratingHint')}><SelectInput value={rating} onChange={setRating} options={RATINGS} placeholder={t('unrated')} /></Field>
                <Field label={t('register.agency')}><TextInput value={ratingAgency} onChange={setRatingAgency} maxLength={60} /></Field>
                <Field label={t('register.ratedOn')}><TextInput type="date" value={ratedOn} onChange={setRatedOn} /></Field>
            </div>
            {problems.length > 0 && <p className="text-[12px] text-[#697386]">{problems.join(' ')}</p>}
            <ErrorBox error={error} onDismiss={clearError} />
            <Btn variant="primary" onClick={submit} busy={busy === 'create'} disabled={problems.length > 0}>{t('register.submit')}</Btn>
        </ActionPanel>
    );
}

/** Propose a counterparty limit (counterpartyId) or a country limit (country). */
function ProposeLimit({ counterpartyId, country, onDone, onClose }: { counterpartyId?: string; country?: boolean; onDone: (m: string) => void; onClose: () => void }) {
    const t = useTranslations('LendingCounterparties');
    const [countryCode, setCountry] = useState('');
    const [amount, setAmount] = useState('');
    const [currency, setCurrency] = useState('USD');
    const [reviewOn, setReviewOn] = useState('');
    const [note, setNote] = useState('');
    const { busy, error, run, clearError } = useAction();
    const valid = MONEY_RE.test(amount.trim()) && /^[A-Z]{3}$/.test(currency) && DATE_RE.test(reviewOn) && (!country || /^[A-Z]{2}$/.test(countryCode));
    const submit = async () => {
        const body = clean({ amount: amount.trim(), currency, reviewOn, note: note.trim(), ...(country ? { countryCode } : {}) });
        const r = await run('propose', () => api.post(country ? '/lending/exposure-limits/country' : `/lending/counterparties/${counterpartyId}/limits`, body));
        if (r) onDone(t('limit.proposed'));
    };
    return (
        <ActionPanel title={country ? t('proposeCountryLimit') : t('limit.counterpartyTitle')} onClose={onClose}>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                {country && <Field label={t('limit.country')}><TextInput value={countryCode} onChange={(v) => setCountry(v.toUpperCase())} maxLength={2} placeholder="KH" /></Field>}
                <Field label={t('limit.limit')}><TextInput value={amount} onChange={setAmount} inputMode="decimal" /></Field>
                <Field label={t('limit.currency')}><TextInput value={currency} onChange={(v) => setCurrency(v.toUpperCase())} maxLength={3} /></Field>
                <Field label={t('limit.reviewBy')} hint={t('limit.reviewByHint')}><TextInput type="date" value={reviewOn} onChange={setReviewOn} /></Field>
                <Field label={t('limit.note')} hint={t('limit.noteHint')} className="sm:col-span-2"><TextInput value={note} onChange={setNote} maxLength={500} /></Field>
            </div>
            <ErrorBox error={error} onDismiss={clearError} />
            <Btn variant="primary" onClick={submit} busy={busy === 'propose'} disabled={!valid}>{t('limit.propose')}</Btn>
        </ActionPanel>
    );
}

/** One counterparty: rating, limits and their history, and its loans. */
export function CounterpartyDetailView({ id }: { id: string }) {
    const t = useTranslations('LendingCounterparties');
    const typeLabel = useTypeLabel();
    const href = useLendingHref();
    const { showToast } = useToast();
    const res = useApi<CounterpartyDetail>(`/lending/counterparties/${id}`);
    const [panel, setPanel] = useState<'limit' | 'rating' | 'status' | null>(null);
    const done = (msg: string) => { setPanel(null); res.reload(); showToast(msg, 'success'); };
    const c = res.data;
    return (
        <LendingShell
            title={c ? c.name : t('counterparty')}
            subtitle={c ? `${typeLabel(c.type)} · ${c.countryCode} · ${c.reference}` : undefined}
            back={{ href: '/lending/counterparties', label: 'Counterparties' }}
            actions={c && (
                <>
                    <Btn onClick={() => setPanel('rating')}>{t('rating.title')}</Btn>
                    <Btn onClick={() => setPanel('status')}>{c.status === 'ACTIVE' ? t('status.suspend') : t('status.reinstate')}</Btn>
                    <Btn variant="primary" onClick={() => setPanel('limit')}>{t('detail.proposeLimit')}</Btn>
                </>
            )}
        >
            {res.error && <ErrorBox error={res.error} />}
            {!c ? <Spinner /> : (
                <>
                    {panel === 'limit' && <ProposeLimit counterpartyId={c.id} onDone={done} onClose={() => setPanel(null)} />}
                    {panel === 'rating' && <RatingPanel c={c} onDone={done} onClose={() => setPanel(null)} />}
                    {panel === 'status' && <StatusPanel c={c} onDone={done} onClose={() => setPanel(null)} />}
                    {c.status !== 'ACTIVE' && <Notice tone="warn" title={t('detail.suspended')}>{t('detail.suspendedBody')}</Notice>}
                    <Card title={t('counterparty')}>
                        <KV
                            cols={4}
                            items={[
                                [t('col.rating'), c.rating ? `${c.rating}${c.ratingAgency ? ` (${c.ratingAgency})` : ''}${c.ratedOn ? ` · ${c.ratedOn}` : ''}` : t('unrated')],
                                [t('detail.grade'), c.investmentGrade === null ? '—' : c.investmentGrade ? t('detail.investmentGrade') : t('detail.subInvestmentGrade')],
                                [t('detail.identifier'), c.legalIdentifier || '—'],
                                [t('col.status'), <StatusBadge key="s" status={c.status} />],
                            ]}
                        />
                    </Card>
                    <Card title={t('detail.limitsInForce')} bodyClass="p-0">
                        <Table>
                            <thead>
                                <tr className="border-b border-[#E3E8EE] bg-[#F7FAFC]">
                                    <th className={th}>{t('col.limitOn')}</th><th className={thR}>{t('col.limit')}</th><th className={thR}>{t('col.used')}</th><th className={thR}>{t('col.headroom')}</th><th className={th}>{t('col.utilisation')}</th><th className={th}>{t('col.status')}</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-[#F0F2F5]">
                                <tr><td className={td}>{t('detail.thisCounterparty')}</td><PositionCells p={c.position.limits[0]} /></tr>
                                <tr><td className={td}>{t('detail.countryLine', { code: c.countryCode, count: c.country.counterparties })}</td><PositionCells p={c.country.limits[0]} /></tr>
                            </tbody>
                        </Table>
                        {c.position.limits[0] && (
                            <p className="px-5 py-3 text-[12px] text-[#697386]">
                                {t('detail.usedBreakdown', { outstanding: c.position.limits[0].byStage.OUTSTANDING, booked: c.position.limits[0].byStage.BOOKED, approved: c.position.limits[0].byStage.APPROVED })}
                            </p>
                        )}
                    </Card>
                    <Card title={t('detail.loans')} bodyClass="p-0">
                        {c.loans.length === 0 && c.approvedApplications.length === 0 ? <div className="p-5"><Empty>{t('detail.noLending')}</Empty></div> : (
                            <Table>
                                <thead>
                                    <tr className="border-b border-[#E3E8EE] bg-[#F7FAFC]">
                                        <th className={th}>{t('col.loan')}</th><th className={th}>{t('col.status')}</th><th className={thR}>{t('col.booked')}</th><th className={thR}>{t('col.outstanding')}</th><th className={th}>{t('col.maturity')}</th><th className={thR}>{t('col.dpd')}</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-[#F0F2F5]">
                                    {c.loans.map((l) => (
                                        <tr key={l.id}>
                                            <td className={td}><Link href={href(`/lending/loans/${l.id}`)} className="font-semibold text-[#635BFF] hover:underline">{l.reference}</Link></td>
                                            <td className={td}><StatusBadge status={l.status} /></td>
                                            <td className={tdR}><MoneyCell value={l.bookedPrincipal} currency={l.currency} /></td>
                                            <td className={tdR}><MoneyCell value={l.principalOutstanding} currency={l.currency} /></td>
                                            <td className={td}>{l.maturityDate ?? '—'}</td>
                                            <td className={tdR}>{l.daysPastDue}</td>
                                        </tr>
                                    ))}
                                    {c.approvedApplications.map((a) => (
                                        <tr key={a.id}>
                                            <td className={td}><Link href={href(`/lending/applications/${a.id}`)} className="font-semibold text-[#635BFF] hover:underline">{a.reference}</Link></td>
                                            <td className={td}><StatusBadge status="APPROVED" /></td>
                                            <td className={tdR}><MoneyCell value={a.requestedAmount} currency={a.currency} /></td>
                                            <td className={tdR}>—</td><td className={td}>{t('detail.notBooked')}</td><td className={tdR}>—</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </Table>
                        )}
                    </Card>
                    <Card title={t('detail.limitHistory')} bodyClass="p-0">
                        <LimitHistory rows={[...c.limits, ...c.countryLimits]} />
                    </Card>
                </>
            )}
        </LendingShell>
    );
}

function LimitHistory({ rows }: { rows: ExposureLimitRow[] }) {
    const t = useTranslations('LendingCounterparties');
    if (!rows.length) return <div className="p-5"><Empty>{t('history.none')}</Empty></div>;
    return (
        <Table>
            <thead>
                <tr className="border-b border-[#E3E8EE] bg-[#F7FAFC]">
                    <th className={th}>{t('history.on')}</th><th className={thR}>{t('col.limit')}</th><th className={th}>{t('limit.reviewBy')}</th><th className={th}>{t('col.status')}</th><th className={th}>{t('history.proposed')}</th><th className={th}>{t('history.decided')}</th>
                </tr>
            </thead>
            <tbody className="divide-y divide-[#F0F2F5]">
                {rows.map((l) => (
                    <tr key={l.id}>
                        <td className={td}>{l.scope === 'COUNTRY' ? t('countryCode', { code: l.countryCode ?? '' }) : t('counterparty')}{l.note && <div className="text-[11px] text-[#697386]">{l.note}</div>}</td>
                        <td className={tdR}><MoneyCell value={l.amount} currency={l.currency} /></td>
                        <td className={td}>{l.reviewOn}</td>
                        <td className={td}><StatusBadge status={l.status} /></td>
                        <td className={td}>{fmtDateTime(l.createdAt)}</td>
                        <td className={td}>{l.decidedAt ? fmtDateTime(l.decidedAt) : '—'}{l.comment && <div className="text-[11px] text-[#697386]">{l.comment}</div>}</td>
                    </tr>
                ))}
            </tbody>
        </Table>
    );
}

function RatingPanel({ c, onDone, onClose }: { c: Counterparty; onDone: (m: string) => void; onClose: () => void }) {
    const t = useTranslations('LendingCounterparties');
    const [rating, setRating] = useState(c.rating ?? '');
    const [ratingAgency, setRatingAgency] = useState(c.ratingAgency);
    const [ratedOn, setRatedOn] = useState('');
    const [reason, setReason] = useState('');
    const { busy, error, run, clearError } = useAction();
    const valid = DATE_RE.test(ratedOn) && reason.trim().length >= 3;
    const submit = async () => {
        const r = await run('rating', () => api.post(`/lending/counterparties/${c.id}/rating`, { rating: rating || null, ratingAgency: ratingAgency.trim(), ratedOn, reason: reason.trim() }));
        if (r) onDone(t('rating.recorded'));
    };
    return (
        <ActionPanel title={t('rating.title')} onClose={onClose}>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                <Field label={t('col.rating')}><SelectInput value={rating} onChange={setRating} options={RATINGS} placeholder={t('rating.withdrawn')} /></Field>
                <Field label={t('rating.agency')}><TextInput value={ratingAgency} onChange={setRatingAgency} maxLength={60} /></Field>
                <Field label={t('register.ratedOn')}><TextInput type="date" value={ratedOn} onChange={setRatedOn} /></Field>
                <Field label={t('reason')}><TextInput value={reason} onChange={setReason} maxLength={500} /></Field>
            </div>
            <p className="text-[12px] text-[#697386]">{t('rating.note')}</p>
            <ErrorBox error={error} onDismiss={clearError} />
            <Btn variant="primary" onClick={submit} busy={busy === 'rating'} disabled={!valid}>{t('rating.record')}</Btn>
        </ActionPanel>
    );
}

function StatusPanel({ c, onDone, onClose }: { c: Counterparty; onDone: (m: string) => void; onClose: () => void }) {
    const t = useTranslations('LendingCounterparties');
    const [reason, setReason] = useState('');
    const next = c.status === 'ACTIVE' ? 'SUSPENDED' : 'ACTIVE';
    const { busy, error, run, clearError } = useAction();
    const submit = async () => {
        const r = await run('status', () => api.post(`/lending/counterparties/${c.id}/status`, { status: next, reason: reason.trim() }));
        if (r) onDone(next === 'SUSPENDED' ? t('status.suspended') : t('status.reinstated'));
    };
    return (
        <ActionPanel title={next === 'SUSPENDED' ? t('status.suspendTitle') : t('status.reinstateTitle')} onClose={onClose}>
            <Field label={t('reason')}><TextInput value={reason} onChange={setReason} maxLength={500} /></Field>
            <ErrorBox error={error} onDismiss={clearError} />
            <Btn variant={next === 'SUSPENDED' ? 'danger' : 'primary'} onClick={submit} busy={busy === 'status'} disabled={reason.trim().length < 3}>{next === 'SUSPENDED' ? t('status.suspend') : t('status.reinstate')}</Btn>
        </ActionPanel>
    );
}

/** On an institutional loan: who the counterparty is and where it stands against its limits. */
export function InstitutionalLoanCard({ detail }: { detail: LoanDetail }) {
    const t = useTranslations('LendingCounterparties');
    const typeLabel = useTypeLabel();
    const href = useLendingHref();
    const list = useApi<(Counterparty & { exposure: { limits: LimitPosition[] } })[]>('/lending/counterparties');
    const borrowerId = (detail.account as { borrowerId?: string }).borrowerId;
    const c = list.data?.find((x) => x.borrowerId === borrowerId);
    return (
        <Card title={t('loanCard.title')} subtitle={t('loanCard.subtitle')}>
            {list.error && <ErrorBox error={list.error} />}
            {!list.data ? <Spinner /> : !c ? <Empty>{t('loanCard.notRegistered')}</Empty> : (
                <div className="space-y-3">
                    <KV
                        cols={4}
                        items={[
                            [t('counterparty'), <Link key="n" href={href(`/lending/counterparties/${c.id}`)} className="font-semibold text-[#635BFF] hover:underline">{c.name}</Link>],
                            [t('loanCard.typeCountry'), `${typeLabel(c.type)} · ${c.countryCode}`],
                            [t('col.rating'), c.rating ?? t('unrated')],
                            [t('col.status'), <StatusBadge key="s" status={c.status} />],
                        ]}
                    />
                    {c.exposure.limits[0] && (
                        <Table>
                            <thead>
                                <tr className="border-b border-[#E3E8EE] bg-[#F7FAFC]">
                                    <th className={thR}>{t('col.limit')}</th><th className={thR}>{t('col.used')}</th><th className={thR}>{t('col.headroom')}</th><th className={th}>{t('col.utilisation')}</th><th className={th}>{t('col.status')}</th>
                                </tr>
                            </thead>
                            <tbody><tr><PositionCells p={c.exposure.limits[0]} /></tr></tbody>
                        </Table>
                    )}
                </div>
            )}
        </Card>
    );
}
