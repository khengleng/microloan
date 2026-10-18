"use client";

import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, ChevronLeft, HandCoins, Loader2 } from 'lucide-react';
import type { ProposedLine, RestructureComparison } from '../types';
import { fmtMoney } from '../format';
import { ScheduleTable, rowsFromProposal } from '../ScheduleTable';
import { DIFFICULTY_TYPES, HARDSHIP_CATEGORIES } from '../restructure/labels';

/* Borrower-portal requests use plain fetch through the proxy (the borrower cookie is forwarded). */

type PortalError = { message: string; code?: string };

async function portalFetch<T>(path: string, init?: { method?: string; body?: unknown }): Promise<T> {
    const res = await fetch(`/api/proxy${path}`, {
        method: init?.method ?? 'GET',
        headers: { 'X-Requested-With': 'XMLHttpRequest', ...(init?.body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
        body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
    });
    const text = await res.text();
    let data: unknown = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = null; }
    if (!res.ok) {
        const d = (data && typeof data === 'object' ? data : {}) as Record<string, unknown>;
        const inner = d.message && typeof d.message === 'object' && !Array.isArray(d.message) ? (d.message as Record<string, unknown>) : d;
        const raw = inner.message ?? d.message;
        const message = Array.isArray(raw) ? raw.join('; ') : typeof raw === 'string' ? raw
            : res.status === 401 ? 'Your session has expired. Please sign in again.' : `Something went wrong (${res.status}).`;
        const err: PortalError = { message, code: (inner.code ?? d.code) as string | undefined };
        throw err;
    }
    return data as T;
}

const asError = (e: unknown): PortalError =>
    e && typeof e === 'object' && 'message' in e ? (e as PortalError) : { message: 'Something went wrong. Please try again.' };

/** GET with derived loading state (no synchronous setState in the effect). */
function usePortalGet<T>(path: string | null) {
    const [version, setVersion] = useState(0);
    const [state, setState] = useState<{ key: string | null; data?: T; error?: PortalError }>({ key: null });
    const key = path === null ? null : `${path}#${version}`;
    useEffect(() => {
        if (path === null) return;
        let cancelled = false;
        const k = `${path}#${version}`;
        portalFetch<T>(path).then(
            (data) => { if (!cancelled) setState({ key: k, data }); },
            (e) => { if (!cancelled) setState({ key: k, error: asError(e) }); },
        );
        return () => { cancelled = true; };
    }, [path, version]);
    const reload = useCallback(() => setVersion((v) => v + 1), []);
    const settled = state.key === key;
    return { data: settled ? state.data : undefined, error: settled ? state.error : undefined, loading: path !== null && !settled, reload };
}

interface CaseSummary { id: string; reference: string; status: string; hardshipCategory?: string; createdAt?: string }
interface PortalProposal {
    id: string; version: number; status: string; effectiveDate: string; comparison: RestructureComparison;
    proposalHash: string; expiresAt: string | null; schedule: ProposedLine[];
}
interface CaseDetail { id: string; reference: string; status: string; loanAccountId: string; requestedRelief: Record<string, unknown> | null; proposals: PortalProposal[] }

const STATUS_TEXT: Record<string, string> = {
    REQUESTED: 'Received — we will review your situation',
    MORE_INFO_REQUIRED: 'We need more information — your branch will contact you',
    AFFORDABILITY_ASSESSED: 'Under review',
    SPECIALIST_REVIEW: 'Under specialist review',
    OPTIONS_PROPOSED: 'Under review',
    APPROVED: 'An offer is ready for you',
    CUSTOMER_ACCEPTED: 'You accepted the offer',
    CONDITIONS_SATISFIED: 'Being finalised',
    MONITORING: 'New terms in effect',
    COMPLETED: 'Completed',
    REJECTED: 'Not approved',
    WITHDRAWN: 'Withdrawn',
    EXPIRED: 'Expired',
    REVERSED: 'Cancelled',
};

const inputCls = 'w-full border border-border rounded-md px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-primary/30';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MONEY_RE = /^\d+(\.\d{1,4})?$/;
const posInt = (v: string) => (/^\d+$/.test(v.trim()) && Number.parseInt(v, 10) > 0 ? Number.parseInt(v, 10) : undefined);

function ErrorLine({ error }: { error: PortalError | null | undefined }) {
    if (!error) return null;
    return <p className="text-sm text-red-700 bg-red-50 border border-red-100 rounded-md px-3 py-2" role="alert">{error.message}</p>;
}

function RequestForm({ onCreated }: { onCreated: (id: string) => void }) {
    const [loanId, setLoanId] = useState('');
    // The borrower's own active loans; a reference given by the branch can still be typed.
    const myLoans = usePortalGet<{ id: string; reference: string; currency: string }[]>('/lending/portal/loans');
    const [hardshipCategory, setCategory] = useState('INCOME_REDUCTION');
    const [difficultyType, setDifficulty] = useState('TEMPORARY');
    const [statement, setStatement] = useState('');
    const [lowerInstalment, setLower] = useState('');
    const [longerTerm, setLonger] = useState('');
    const [breakMonths, setBreak] = useState('');
    const [note, setNote] = useState('');
    const [recovery, setRecovery] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<PortalError | null>(null);

    const breakN = posInt(breakMonths);
    const problem = !UUID_RE.test(loanId.trim()) ? 'Choose the loan you need help with.'
        : lowerInstalment && !MONEY_RE.test(lowerInstalment.trim()) ? 'Enter the instalment as a number, e.g. 150 or 150.50.'
            : longerTerm && !posInt(longerTerm) ? 'Enter the extra term as a whole number of months.'
                : breakMonths && (!breakN || breakN > 24) ? 'A payment break can be 1 to 24 months.'
                    : null;

    const submit = async () => {
        setBusy(true);
        setError(null);
        const relief: Record<string, unknown> = {};
        if (lowerInstalment.trim()) relief.lowerInstalment = lowerInstalment.trim();
        if (posInt(longerTerm)) relief.longerTermMonths = posInt(longerTerm);
        if (breakN) relief.paymentBreakMonths = breakN;
        if (note.trim()) relief.note = note.trim();
        const body: Record<string, unknown> = { hardshipCategory, difficultyType, requestedRelief: relief };
        if (statement.trim()) body.customerStatement = statement.trim();
        if (recovery) body.expectedRecoveryDate = recovery;
        try {
            const res = await portalFetch<{ id: string }>(`/lending/portal/loans/${loanId.trim()}/restructure-requests`, { method: 'POST', body });
            onCreated(res.id);
        } catch (e) {
            setError(asError(e));
        } finally {
            setBusy(false);
        }
    };

    return (
        <div className="space-y-3 text-sm">
            <label className="block">
                <span className="block text-xs font-medium text-muted-foreground mb-1">Which loan?</span>
                {myLoans.data && myLoans.data.length > 0 ? (
                    <select className={inputCls} value={loanId} onChange={(e) => setLoanId(e.target.value)}>
                        <option value="">Choose a loan…</option>
                        {myLoans.data.map((l) => <option key={l.id} value={l.id}>{l.reference} ({l.currency})</option>)}
                    </select>
                ) : (
                    <input className={`${inputCls} font-mono`} value={loanId} onChange={(e) => setLoanId(e.target.value)} placeholder={myLoans.loading ? 'Loading your loans…' : 'Loan id given to you by your branch'} />
                )}
            </label>
            <label className="block">
                <span className="block text-xs font-medium text-muted-foreground mb-1">What happened?</span>
                <select className={inputCls} value={hardshipCategory} onChange={(e) => setCategory(e.target.value)}>
                    {HARDSHIP_CATEGORIES.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
            </label>
            <label className="block">
                <span className="block text-xs font-medium text-muted-foreground mb-1">How long do you expect it to last?</span>
                <select className={inputCls} value={difficultyType} onChange={(e) => setDifficulty(e.target.value)}>
                    {DIFFICULTY_TYPES.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
            </label>
            <label className="block">
                <span className="block text-xs font-medium text-muted-foreground mb-1">Tell us more (optional)</span>
                <textarea className={inputCls} rows={3} maxLength={2000} value={statement} onChange={(e) => setStatement(e.target.value)} />
            </label>
            <p className="text-xs font-semibold text-foreground pt-1">What would help? (all optional)</p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <label className="block">
                    <span className="block text-xs text-muted-foreground mb-1">A lower payment of</span>
                    <input className={inputCls} inputMode="decimal" value={lowerInstalment} onChange={(e) => setLower(e.target.value)} />
                </label>
                <label className="block">
                    <span className="block text-xs text-muted-foreground mb-1">More time (months)</span>
                    <input className={inputCls} inputMode="numeric" value={longerTerm} onChange={(e) => setLonger(e.target.value)} />
                </label>
                <label className="block">
                    <span className="block text-xs text-muted-foreground mb-1">Payment break (1–24 months)</span>
                    <input className={inputCls} inputMode="numeric" value={breakMonths} onChange={(e) => setBreak(e.target.value)} />
                </label>
            </div>
            <label className="block">
                <span className="block text-xs text-muted-foreground mb-1">Anything else (optional)</span>
                <input className={inputCls} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
            </label>
            <label className="block">
                <span className="block text-xs text-muted-foreground mb-1">When do you expect things to improve? (optional)</span>
                <input type="date" className={inputCls} value={recovery} onChange={(e) => setRecovery(e.target.value)} />
            </label>
            <p className="text-xs text-muted-foreground">Sending a request does not change your loan. Keep paying what you can while we review it.</p>
            {problem && <p className="text-xs text-amber-700">{problem}</p>}
            <ErrorLine error={error} />
            <button type="button" disabled={!!problem || busy} onClick={submit}
                className="w-full sm:w-auto inline-flex items-center justify-center gap-2 rounded-md bg-primary text-primary-foreground px-4 py-2 text-sm font-semibold disabled:opacity-50">
                {busy && <Loader2 size={14} className="animate-spin" />} Send request
            </button>
        </div>
    );
}

function Row({ label, now, next, strong }: { label: string; now: string; next: string; strong?: boolean }) {
    return (
        <tr className="border-b border-border last:border-0">
            <td className="py-2 pr-2 text-muted-foreground">{label}</td>
            <td className="py-2 px-2 text-right tabular-nums">{now}</td>
            <td className={`py-2 pl-2 text-right tabular-nums ${strong ? 'font-bold text-foreground' : ''}`}>{next}</td>
        </tr>
    );
}

function OfferCard({ caseId, p, onAccepted }: { caseId: string; p: PortalProposal; onAccepted: () => void }) {
    const [understood, setUnderstood] = useState(false);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<PortalError | null>(null);
    const [now] = useState(() => Date.now());
    const c = p.comparison;
    const expired = !!p.expiresAt && new Date(p.expiresAt).getTime() < now;
    const canAccept = p.status === 'APPROVED' && !expired;
    const m = (v: string | null | undefined) => (v === null || v === undefined ? 'varies' : fmtMoney(v));

    const accept = async () => {
        setBusy(true);
        setError(null);
        try {
            await portalFetch(`/lending/portal/restructures/${caseId}/proposals/${p.id}/accept`, { method: 'POST', body: { proposalHash: p.proposalHash } });
            onAccepted();
        } catch (e) {
            setError(asError(e));
        } finally {
            setBusy(false);
        }
    };

    return (
        <div className="border border-border rounded-md p-4 space-y-3">
            <div className="flex items-center justify-between">
                <p className="text-sm font-bold text-foreground">Offer (version {p.version})</p>
                <span className="text-[11px] font-semibold px-2 py-0.5 rounded bg-slate-100 text-slate-600">{p.status}</span>
            </div>
            <p className="text-sm text-foreground">
                If you accept, your new terms start on <b>{p.effectiveDate}</b>.
                {p.expiresAt && <> This offer is valid until <b className={expired ? 'text-red-700' : ''}>{new Date(p.expiresAt).toLocaleDateString()}</b>{expired ? ' (expired)' : ''}.</>}
            </p>
            {c && (
                <table className="w-full text-sm">
                    <thead>
                        <tr className="text-xs text-muted-foreground border-b border-border">
                            <th className="py-1.5 text-left font-medium"></th>
                            <th className="py-1.5 text-right font-medium">Now</th>
                            <th className="py-1.5 text-right font-medium">With this offer</th>
                        </tr>
                    </thead>
                    <tbody>
                        <Row label="Each payment" now={m(c.original.instalment)} next={m(c.proposed.instalment)} strong />
                        <Row label="Last payment date" now={c.original.maturityDate ?? '—'} next={c.proposed.maturityDate} />
                        <Row label="Total you will pay" now={fmtMoney(c.original.totalFuturePayments)} next={fmtMoney(c.proposed.totalFuturePayments)} strong />
                        <Row label="Total interest & charges" now={fmtMoney(c.original.totalFutureInterestAndCharges)} next={fmtMoney(c.proposed.totalFutureInterestAndCharges)} strong />
                        <Row label={`Due on ${p.effectiveDate}`} now="—" next={fmtMoney(c.proposed.payableAtEffectiveDate)} />
                    </tbody>
                </table>
            )}

            {c?.lowerInstalmentHigherCost ? (
                <div className="flex gap-2 rounded-md border-2 border-amber-400 bg-amber-50 px-3 py-2.5 text-amber-900" role="alert">
                    <AlertTriangle size={18} className="shrink-0 mt-0.5" />
                    <div className="text-sm">
                        <p className="font-bold">A lower instalment may cost you more interest overall</p>
                        <p className="text-xs mt-0.5">
                            You would pay less each time, but {fmtMoney(c.proposed.totalFutureInterestAndCharges)} in interest and charges in total,
                            compared with {fmtMoney(c.original.totalFutureInterestAndCharges)} today.
                        </p>
                    </div>
                </div>
            ) : (
                <p className="text-xs text-muted-foreground">A lower instalment may cost you more interest overall. Compare the totals above before you accept.</p>
            )}
            {(c?.warnings?.length ?? 0) > 0 && (
                <ul className="text-xs text-amber-800 bg-amber-50 border border-amber-100 rounded-md px-3 py-2 list-disc pl-6 space-y-0.5">
                    {c.warnings.map((w, i) => <li key={i}>{w}</li>)}
                </ul>
            )}

            {(p.schedule?.length ?? 0) > 0 && (
                <details className="text-sm">
                    <summary className="cursor-pointer font-medium text-primary">See the new payment schedule ({p.schedule.length} payments)</summary>
                    <div className="mt-2 -mx-1"><ScheduleTable rows={rowsFromProposal(p.schedule)} chargesLabel="Overdue amounts" showStatus={false} /></div>
                </details>
            )}

            {canAccept && (
                <div className="space-y-2 border-t border-border pt-3">
                    <label className="flex items-start gap-2 text-sm cursor-pointer">
                        <input type="checkbox" className="mt-1" checked={understood} onChange={(e) => setUnderstood(e.target.checked)} />
                        <span>I have read and understood the new terms, including the total cost.</span>
                    </label>
                    <ErrorLine error={error} />
                    <button type="button" disabled={!understood || busy} onClick={accept}
                        className="w-full sm:w-auto inline-flex items-center justify-center gap-2 rounded-md bg-primary text-primary-foreground px-4 py-2 text-sm font-semibold disabled:opacity-50">
                        {busy && <Loader2 size={14} className="animate-spin" />} Accept this offer
                    </button>
                </div>
            )}
            {p.status === 'ACCEPTED' && <p className="text-sm text-emerald-700 font-medium">You accepted this offer. Your branch will finalise the change.</p>}
            {p.status === 'EXECUTED' && <p className="text-sm text-emerald-700 font-medium">These terms are now in effect.</p>}
        </div>
    );
}

function CaseView({ id, onBack }: { id: string; onBack: () => void }) {
    const { data, error, loading, reload } = usePortalGet<CaseDetail>(`/lending/portal/restructures/${id}`);
    const [accepted, setAccepted] = useState(false);
    return (
        <div className="space-y-3">
            <button type="button" onClick={onBack} className="inline-flex items-center gap-1 text-sm text-primary"><ChevronLeft size={14} /> All requests</button>
            {loading && !data && <p className="text-sm text-muted-foreground flex items-center gap-2"><Loader2 size={14} className="animate-spin" /> Loading…</p>}
            <ErrorLine error={error} />
            {data && (
                <>
                    <div>
                        <p className="text-sm font-semibold text-foreground">Request {data.reference}</p>
                        <p className="text-xs text-muted-foreground">{STATUS_TEXT[data.status] ?? data.status.replace(/_/g, ' ')}</p>
                    </div>
                    {accepted && <p className="text-sm text-emerald-700 bg-emerald-50 border border-emerald-100 rounded-md px-3 py-2">Thank you — your acceptance has been recorded.</p>}
                    {data.proposals.length === 0
                        ? <p className="text-sm text-muted-foreground">There is no offer yet. We will let you know when one is ready.</p>
                        : data.proposals.map((p) => <OfferCard key={p.id} caseId={data.id} p={p} onAccepted={() => { setAccepted(true); reload(); }} />)}
                </>
            )}
        </div>
    );
}

/** Borrower self-service: request payment relief and review / accept offers. */
export function PaymentReliefSection() {
    const { data, error, loading, reload } = usePortalGet<CaseSummary[]>('/lending/portal/restructures');
    const [mode, setMode] = useState<'list' | 'new'>('list');
    const [selected, setSelected] = useState<string | null>(null);

    return (
        <section className="bg-white border border-border rounded-md p-4 space-y-3">
            <h2 className="text-sm font-bold text-foreground flex items-center gap-2"><HandCoins size={15} /> Request a lower payment / payment relief</h2>
            {selected ? (
                <CaseView id={selected} onBack={() => { setSelected(null); reload(); }} />
            ) : mode === 'new' ? (
                <div className="space-y-3">
                    <button type="button" onClick={() => setMode('list')} className="inline-flex items-center gap-1 text-sm text-primary"><ChevronLeft size={14} /> Back</button>
                    <RequestForm onCreated={(id) => { setMode('list'); reload(); setSelected(id); }} />
                </div>
            ) : (
                <div className="space-y-3 text-sm">
                    <p className="text-muted-foreground">
                        Having difficulty paying? Tell us what happened and we will review options such as a lower payment, more time or a short payment break.
                    </p>
                    <button type="button" onClick={() => setMode('new')}
                        className="w-full sm:w-auto rounded-md bg-primary text-primary-foreground px-4 py-2 text-sm font-semibold">Start a request</button>
                    {loading && !data && <p className="text-muted-foreground flex items-center gap-2"><Loader2 size={14} className="animate-spin" /> Loading your requests…</p>}
                    <ErrorLine error={error} />
                    {data && data.length > 0 && (
                        <ul className="divide-y divide-border border border-border rounded-md">
                            {data.map((c) => (
                                <li key={c.id}>
                                    <button type="button" onClick={() => setSelected(c.id)} className="w-full text-left px-3 py-2.5 hover:bg-slate-50 flex items-center justify-between gap-2">
                                        <span>
                                            <span className="block font-medium text-foreground">{c.reference}</span>
                                            <span className="block text-xs text-muted-foreground">{STATUS_TEXT[c.status] ?? c.status.replace(/_/g, ' ')}</span>
                                        </span>
                                        {c.status === 'APPROVED' && <span className="text-[11px] font-semibold px-2 py-0.5 rounded bg-emerald-50 text-emerald-700">Offer ready</span>}
                                    </button>
                                </li>
                            ))}
                        </ul>
                    )}
                </div>
            )}
        </section>
    );
}

export default PaymentReliefSection;
