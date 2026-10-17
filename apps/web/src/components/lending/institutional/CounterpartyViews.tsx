"use client";

import { useState } from 'react';
import Link from 'next/link';
import api from '@/lib/api';
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
const typeLabel = (t: string) => COUNTERPARTY_TYPES.find((x) => x.value === t)?.label ?? t;
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
    const pct = p.utilisation ? Math.min(100, Math.round(Number(p.utilisation) * 100)) : 0;
    const colour = p.status === 'BREACHED' ? 'bg-red-500' : p.status === 'NEAR_LIMIT' ? 'bg-amber-500' : p.status === 'LAPSED' ? 'bg-slate-400' : 'bg-emerald-500';
    return (
        <div className="min-w-[120px]">
            <div className="h-1.5 rounded bg-slate-100 overflow-hidden"><div className={`h-full ${colour}`} style={{ width: `${pct}%` }} /></div>
            <div className="text-[11px] text-[#697386] mt-0.5">{p.utilisation ? fmtRate(p.utilisation, 1) : '—'} used</div>
        </div>
    );
}

function PositionCells({ p }: { p: LimitPosition | undefined }) {
    if (!p) return (<><td className={tdR}>—</td><td className={tdR}>—</td><td className={tdR}>—</td><td className={td}>—</td><td className={td}><StatusBadge status="NO_LIMIT" /></td></>);
    return (
        <>
            <td className={tdR}><MoneyCell value={p.limit} currency={p.currency} /></td>
            <td className={tdR}><MoneyCell value={p.utilised} currency={p.currency} /></td>
            <td className={tdR}><MoneyCell value={p.headroom} currency={p.currency} highlightNonZero /></td>
            <td className={td}><UtilisationBar p={p} /></td>
            <td className={td}><StatusBadge status={p.status} />{p.reviewOn && <div className="text-[11px] text-[#697386]">review {p.reviewOn}</div>}</td>
        </>
    );
}

/** Lending › Counterparties: the exposure view, counterparties and limits awaiting approval. */
export function CounterpartiesHome() {
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
                    <Btn onClick={() => setPanel('country')}>Propose a country limit</Btn>
                    <Btn variant="primary" onClick={() => setPanel('counterparty')}>Register a counterparty</Btn>
                </>
            }
        >
            {panel === 'counterparty' && <RegisterCounterparty onDone={done} onClose={() => setPanel(null)} />}
            {panel === 'country' && <ProposeLimit country onDone={done} onClose={() => setPanel(null)} />}
            {exp.error && <ErrorBox error={exp.error} />}
            <Tabs
                tabs={[
                    { value: 'exposure', label: 'Exposure' },
                    { value: 'pending', label: `Limits awaiting approval${e?.pendingLimits.length ? ` (${e.pendingLimits.length})` : ''}` },
                ]}
                value={tab}
                onChange={setTab}
            />
            {!e ? <Spinner /> : tab === 'pending' ? (
                <Card title="Limits awaiting approval" subtitle="A different person from the proposer approves, within their approval authority for the amount. An approved limit replaces the one in force.">
                    {e.pendingLimits.length === 0 ? <Empty>Nothing waiting.</Empty> : (
                        <div className="space-y-3">{e.pendingLimits.map((l) => <PendingLimit key={l.id} l={l} onDone={done} />)}</div>
                    )}
                </Card>
            ) : (
                <div className="space-y-5">
                    <Card title="By counterparty" subtitle={`As of ${e.asOf}. Utilisation = principal outstanding + loans booked but not paid out + approvals not yet booked.`} bodyClass="p-0">
                        {e.byCounterparty.length === 0 ? <div className="p-5"><Empty>No counterparties registered yet.</Empty></div> : (
                            <Table>
                                <thead>
                                    <tr className="border-b border-[#E3E8EE] bg-[#F7FAFC]">
                                        <th className={th}>Counterparty</th><th className={th}>Type</th><th className={th}>Country</th><th className={th}>Rating</th>
                                        <th className={thR}>Limit</th><th className={thR}>Used</th><th className={thR}>Headroom</th><th className={th}>Utilisation</th><th className={th}>Status</th>
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
                                            <td className={td}>{c.rating ?? 'Unrated'}{c.investmentGrade === false && <div className="text-[11px] text-amber-700">sub-investment grade</div>}</td>
                                            <PositionCells p={c.limits[0]} />
                                        </tr>
                                    ))}
                                </tbody>
                            </Table>
                        )}
                    </Card>
                    <Card title="By country" subtitle="Every counterparty in a country counts against its country limit." bodyClass="p-0">
                        {e.byCountry.length === 0 ? <div className="p-5"><Empty>No country exposure.</Empty></div> : (
                            <Table>
                                <thead>
                                    <tr className="border-b border-[#E3E8EE] bg-[#F7FAFC]">
                                        <th className={th}>Country</th><th className={thR}>Counterparties</th>
                                        <th className={thR}>Limit</th><th className={thR}>Used</th><th className={thR}>Headroom</th><th className={th}>Utilisation</th><th className={th}>Status</th>
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
                        <Card title="By counterparty type">
                            <KV
                                cols={4}
                                items={Object.entries(e.byType).map(([t, byCur]) => [
                                    typeLabel(t),
                                    <span key={t}>{Object.entries(byCur).map(([cur, v]) => <span key={cur} className="block"><MoneyCell value={v} currency={cur} /></span>)}</span>,
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
    const [comment, setComment] = useState('');
    const { busy, error, run, clearError } = useAction();
    const decide = async (approve: boolean) => {
        const r = await run(approve ? 'approve' : 'reject', () => api.post(`/lending/exposure-limits/${l.id}/decision`, clean({ approve, comment: comment.trim() })));
        if (r) onDone(approve ? 'Limit approved and in force' : 'Limit rejected');
    };
    return (
        <div className="border border-[#E3E8EE] rounded-md p-3 space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-[13px] text-[#1A1F36]">
                    <b>{l.scope === 'COUNTRY' ? `Country ${l.countryCode}` : l.counterpartyName ?? 'Counterparty'}</b>: limit of <b>{l.currency} {l.amount}</b>, review by {l.reviewOn}
                </p>
                <span className="text-[11px] text-[#697386]">Proposed {fmtDateTime(l.createdAt)}</span>
            </div>
            {l.note && <p className="text-[12px] text-[#697386]">{l.note}</p>}
            <div className="flex flex-wrap items-end gap-2">
                <Field label="Comment" className="min-w-[220px]"><TextInput value={comment} onChange={setComment} maxLength={500} /></Field>
                <Btn variant="primary" onClick={() => decide(true)} busy={busy === 'approve'}>Approve</Btn>
                <Btn variant="danger" onClick={() => decide(false)} busy={busy === 'reject'}>Reject</Btn>
            </div>
            <ErrorBox error={error} onDismiss={clearError} />
        </div>
    );
}

interface LegacyBorrower { id: string; firstName?: string | null; lastName?: string | null; phone?: string | null }

function RegisterCounterparty({ onDone, onClose }: { onDone: (m: string) => void; onClose: () => void }) {
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
    const options = (borrowers.data?.data ?? []).map((b) => ({ value: b.id, label: `${[b.firstName, b.lastName].filter(Boolean).join(' ') || '(no name)'} · ${b.id.slice(0, 8)}` }));
    const problems: string[] = [];
    if (name.trim().length < 2) problems.push('Name the counterparty.');
    if (!/^[A-Z]{2}$/.test(countryCode)) problems.push('Country is a two-letter ISO code (KH, TH, LA…).');
    if (!UUID_RE.test(borrowerId.trim())) problems.push('Pick the borrower record its applications are made under.');
    if (rating && !DATE_RE.test(ratedOn)) problems.push('Give the date of the rating.');
    const submit = async () => {
        const body = clean({ name: name.trim(), type, countryCode, borrowerId: borrowerId.trim(), legalIdentifier: legalIdentifier.trim(), rating, ratingAgency: ratingAgency.trim(), ratedOn });
        const r = await run('create', () => api.post('/lending/counterparties', body));
        if (r) onDone(`${name.trim()} registered — propose its limit next`);
    };
    return (
        <ActionPanel title="Register a counterparty" onClose={onClose}>
            <p className="text-[12px] text-[#697386]">The institution applies for loans as a borrower: create (or find) its borrower record first, then link it here with its type, country and rating.</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                <Field label="Name"><TextInput value={name} onChange={setName} maxLength={160} /></Field>
                <Field label="Type"><SelectInput value={type} onChange={setType} options={COUNTERPARTY_TYPES} /></Field>
                <Field label="Country (risk country)"><TextInput value={countryCode} onChange={(v) => setCountry(v.toUpperCase())} maxLength={2} /></Field>
                <Field label="Find borrower record">
                    <div className="flex gap-2">
                        <TextInput value={search} onChange={setSearch} onKeyDown={(ev) => { if (ev.key === 'Enter') { ev.preventDefault(); setQuery(search.trim()); } }} />
                        <Btn onClick={() => setQuery(search.trim())} busy={borrowers.loading}>Search</Btn>
                    </div>
                </Field>
                <Field label="Borrower record">
                    <SelectInput value={options.some((o) => o.value === borrowerId) ? borrowerId : ''} onChange={setBorrowerId} options={options} placeholder={options.length ? 'Select' : 'No borrowers found'} />
                </Field>
                <Field label="LEI / SWIFT / registration no." hint="Optional"><TextInput value={legalIdentifier} onChange={setLegalIdentifier} maxLength={60} /></Field>
                <Field label="Long-term rating" hint="Optional — S&P/Fitch scale"><SelectInput value={rating} onChange={setRating} options={RATINGS} placeholder="Unrated" /></Field>
                <Field label="Rating agency"><TextInput value={ratingAgency} onChange={setRatingAgency} maxLength={60} /></Field>
                <Field label="Rated on"><TextInput type="date" value={ratedOn} onChange={setRatedOn} /></Field>
            </div>
            {problems.length > 0 && <p className="text-[12px] text-[#697386]">{problems.join(' ')}</p>}
            <ErrorBox error={error} onDismiss={clearError} />
            <Btn variant="primary" onClick={submit} busy={busy === 'create'} disabled={problems.length > 0}>Register</Btn>
        </ActionPanel>
    );
}

/** Propose a counterparty limit (counterpartyId) or a country limit (country). */
function ProposeLimit({ counterpartyId, country, onDone, onClose }: { counterpartyId?: string; country?: boolean; onDone: (m: string) => void; onClose: () => void }) {
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
        if (r) onDone('Limit proposed — a credit approver must approve it');
    };
    return (
        <ActionPanel title={country ? 'Propose a country limit' : 'Propose a counterparty limit'} onClose={onClose}>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                {country && <Field label="Country"><TextInput value={countryCode} onChange={(v) => setCountry(v.toUpperCase())} maxLength={2} placeholder="KH" /></Field>}
                <Field label="Limit"><TextInput value={amount} onChange={setAmount} inputMode="decimal" /></Field>
                <Field label="Currency"><TextInput value={currency} onChange={(v) => setCurrency(v.toUpperCase())} maxLength={3} /></Field>
                <Field label="Review by" hint="The limit lapses after this date until renewed"><TextInput type="date" value={reviewOn} onChange={setReviewOn} /></Field>
                <Field label="Note" hint="Optional — e.g. annual credit review" className="sm:col-span-2"><TextInput value={note} onChange={setNote} maxLength={500} /></Field>
            </div>
            <ErrorBox error={error} onDismiss={clearError} />
            <Btn variant="primary" onClick={submit} busy={busy === 'propose'} disabled={!valid}>Propose</Btn>
        </ActionPanel>
    );
}

/** One counterparty: rating, limits and their history, and its loans. */
export function CounterpartyDetailView({ id }: { id: string }) {
    const href = useLendingHref();
    const { showToast } = useToast();
    const res = useApi<CounterpartyDetail>(`/lending/counterparties/${id}`);
    const [panel, setPanel] = useState<'limit' | 'rating' | 'status' | null>(null);
    const done = (msg: string) => { setPanel(null); res.reload(); showToast(msg, 'success'); };
    const c = res.data;
    return (
        <LendingShell
            title={c ? c.name : 'Counterparty'}
            subtitle={c ? `${typeLabel(c.type)} · ${c.countryCode} · ${c.reference}` : undefined}
            back={{ href: '/lending/counterparties', label: 'Counterparties' }}
            actions={c && (
                <>
                    <Btn onClick={() => setPanel('rating')}>Record a rating</Btn>
                    <Btn onClick={() => setPanel('status')}>{c.status === 'ACTIVE' ? 'Suspend' : 'Reinstate'}</Btn>
                    <Btn variant="primary" onClick={() => setPanel('limit')}>Propose a limit</Btn>
                </>
            )}
        >
            {res.error && <ErrorBox error={res.error} />}
            {!c ? <Spinner /> : (
                <>
                    {panel === 'limit' && <ProposeLimit counterpartyId={c.id} onDone={done} onClose={() => setPanel(null)} />}
                    {panel === 'rating' && <RatingPanel c={c} onDone={done} onClose={() => setPanel(null)} />}
                    {panel === 'status' && <StatusPanel c={c} onDone={done} onClose={() => setPanel(null)} />}
                    {c.status !== 'ACTIVE' && <Notice tone="warn" title="Suspended">No new lending is approved or paid out to this counterparty while it is suspended.</Notice>}
                    <Card title="Counterparty">
                        <KV
                            cols={4}
                            items={[
                                ['Rating', c.rating ? `${c.rating}${c.ratingAgency ? ` (${c.ratingAgency})` : ''}${c.ratedOn ? ` · ${c.ratedOn}` : ''}` : 'Unrated'],
                                ['Grade', c.investmentGrade === null ? '—' : c.investmentGrade ? 'Investment grade' : 'Sub-investment grade'],
                                ['Identifier', c.legalIdentifier || '—'],
                                ['Status', <StatusBadge key="s" status={c.status} />],
                            ]}
                        />
                    </Card>
                    <Card title="Limits in force" bodyClass="p-0">
                        <Table>
                            <thead>
                                <tr className="border-b border-[#E3E8EE] bg-[#F7FAFC]">
                                    <th className={th}>Limit on</th><th className={thR}>Limit</th><th className={thR}>Used</th><th className={thR}>Headroom</th><th className={th}>Utilisation</th><th className={th}>Status</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-[#F0F2F5]">
                                <tr><td className={td}>This counterparty</td><PositionCells p={c.position.limits[0]} /></tr>
                                <tr><td className={td}>Country {c.countryCode} ({c.country.counterparties} counterparties)</td><PositionCells p={c.country.limits[0]} /></tr>
                            </tbody>
                        </Table>
                        {c.position.limits[0] && (
                            <p className="px-5 py-3 text-[12px] text-[#697386]">
                                Used = outstanding {c.position.limits[0].byStage.OUTSTANDING} + booked, not paid out {c.position.limits[0].byStage.BOOKED} + approved, not booked {c.position.limits[0].byStage.APPROVED}.
                            </p>
                        )}
                    </Card>
                    <Card title="Loans" bodyClass="p-0">
                        {c.loans.length === 0 && c.approvedApplications.length === 0 ? <div className="p-5"><Empty>No lending yet.</Empty></div> : (
                            <Table>
                                <thead>
                                    <tr className="border-b border-[#E3E8EE] bg-[#F7FAFC]">
                                        <th className={th}>Loan</th><th className={th}>Status</th><th className={thR}>Booked</th><th className={thR}>Outstanding</th><th className={th}>Maturity</th><th className={thR}>DPD</th>
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
                                            <td className={tdR}>—</td><td className={td}>Not yet booked</td><td className={tdR}>—</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </Table>
                        )}
                    </Card>
                    <Card title="Limit history" bodyClass="p-0">
                        <LimitHistory rows={[...c.limits, ...c.countryLimits]} />
                    </Card>
                </>
            )}
        </LendingShell>
    );
}

function LimitHistory({ rows }: { rows: ExposureLimitRow[] }) {
    if (!rows.length) return <div className="p-5"><Empty>No limits proposed yet.</Empty></div>;
    return (
        <Table>
            <thead>
                <tr className="border-b border-[#E3E8EE] bg-[#F7FAFC]">
                    <th className={th}>On</th><th className={thR}>Limit</th><th className={th}>Review by</th><th className={th}>Status</th><th className={th}>Proposed</th><th className={th}>Decided</th>
                </tr>
            </thead>
            <tbody className="divide-y divide-[#F0F2F5]">
                {rows.map((l) => (
                    <tr key={l.id}>
                        <td className={td}>{l.scope === 'COUNTRY' ? `Country ${l.countryCode}` : 'Counterparty'}{l.note && <div className="text-[11px] text-[#697386]">{l.note}</div>}</td>
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
    const [rating, setRating] = useState(c.rating ?? '');
    const [ratingAgency, setRatingAgency] = useState(c.ratingAgency);
    const [ratedOn, setRatedOn] = useState('');
    const [reason, setReason] = useState('');
    const { busy, error, run, clearError } = useAction();
    const valid = DATE_RE.test(ratedOn) && reason.trim().length >= 3;
    const submit = async () => {
        const r = await run('rating', () => api.post(`/lending/counterparties/${c.id}/rating`, { rating: rating || null, ratingAgency: ratingAgency.trim(), ratedOn, reason: reason.trim() }));
        if (r) onDone('Rating recorded');
    };
    return (
        <ActionPanel title="Record a rating" onClose={onClose}>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                <Field label="Rating"><SelectInput value={rating} onChange={setRating} options={RATINGS} placeholder="Withdrawn / unrated" /></Field>
                <Field label="Agency"><TextInput value={ratingAgency} onChange={setRatingAgency} maxLength={60} /></Field>
                <Field label="Rated on"><TextInput type="date" value={ratedOn} onChange={setRatedOn} /></Field>
                <Field label="Reason"><TextInput value={reason} onChange={setReason} maxLength={500} /></Field>
            </div>
            <p className="text-[12px] text-[#697386]">A rating below a product&apos;s minimum stops new approvals and payouts to this counterparty under that product.</p>
            <ErrorBox error={error} onDismiss={clearError} />
            <Btn variant="primary" onClick={submit} busy={busy === 'rating'} disabled={!valid}>Record</Btn>
        </ActionPanel>
    );
}

function StatusPanel({ c, onDone, onClose }: { c: Counterparty; onDone: (m: string) => void; onClose: () => void }) {
    const [reason, setReason] = useState('');
    const next = c.status === 'ACTIVE' ? 'SUSPENDED' : 'ACTIVE';
    const { busy, error, run, clearError } = useAction();
    const submit = async () => {
        const r = await run('status', () => api.post(`/lending/counterparties/${c.id}/status`, { status: next, reason: reason.trim() }));
        if (r) onDone(next === 'SUSPENDED' ? 'Counterparty suspended' : 'Counterparty reinstated');
    };
    return (
        <ActionPanel title={next === 'SUSPENDED' ? 'Suspend new lending to this counterparty' : 'Reinstate this counterparty'} onClose={onClose}>
            <Field label="Reason"><TextInput value={reason} onChange={setReason} maxLength={500} /></Field>
            <ErrorBox error={error} onDismiss={clearError} />
            <Btn variant={next === 'SUSPENDED' ? 'danger' : 'primary'} onClick={submit} busy={busy === 'status'} disabled={reason.trim().length < 3}>{next === 'SUSPENDED' ? 'Suspend' : 'Reinstate'}</Btn>
        </ActionPanel>
    );
}

/** On an institutional loan: who the counterparty is and where it stands against its limits. */
export function InstitutionalLoanCard({ detail }: { detail: LoanDetail }) {
    const href = useLendingHref();
    const list = useApi<(Counterparty & { exposure: { limits: LimitPosition[] } })[]>('/lending/counterparties');
    const borrowerId = (detail.account as { borrowerId?: string }).borrowerId;
    const c = list.data?.find((x) => x.borrowerId === borrowerId);
    return (
        <Card title="Institutional counterparty" subtitle="This loan was checked against the counterparty's and its country's approved limits at approval and again at payout.">
            {list.error && <ErrorBox error={list.error} />}
            {!list.data ? <Spinner /> : !c ? <Empty>The borrower is not registered as a counterparty.</Empty> : (
                <div className="space-y-3">
                    <KV
                        cols={4}
                        items={[
                            ['Counterparty', <Link key="n" href={href(`/lending/counterparties/${c.id}`)} className="font-semibold text-[#635BFF] hover:underline">{c.name}</Link>],
                            ['Type · country', `${typeLabel(c.type)} · ${c.countryCode}`],
                            ['Rating', c.rating ?? 'Unrated'],
                            ['Status', <StatusBadge key="s" status={c.status} />],
                        ]}
                    />
                    {c.exposure.limits[0] && (
                        <Table>
                            <thead>
                                <tr className="border-b border-[#E3E8EE] bg-[#F7FAFC]">
                                    <th className={thR}>Limit</th><th className={thR}>Used</th><th className={thR}>Headroom</th><th className={th}>Utilisation</th><th className={th}>Status</th>
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
