"use client";

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Archive, CheckCircle2, Clock, Gavel, Loader2, Lock, ShieldAlert, Trash2, XCircle } from 'lucide-react';
import api from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { useToast } from '@/components/ui/toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';

/**
 * Permanently purging an archived organisation (platform super-admins):
 * archive → request → a second super-admin approves → purge. The API checks
 * every step again (grace period, legal holds, retention, a fresh archive,
 * two different people); these screens show where the organisation stands.
 */

interface PurgeArchive {
    id: string; createdAt: string; sha256: string; sizeBytes: number;
    storageProvider: string; storageKey: string; recordCounts?: Record<string, number> | null;
}
interface PurgeBlockers {
    legalHolds: number; openRelationships: number; withinRetention: number | boolean; retainUntil: string | null;
    examples: { kind: string; id: string; reason: string }[];
}
export interface PurgeRequest {
    id: string; status: string; makerId: string; checkerId: string | null; subjectId?: string;
    createdAt: string; expiresAt: string;
    payload?: { tenantName?: string; archiveSha256?: string; reason?: string } | null;
}
interface PurgeStatus {
    tenant: { id: string; name: string; status: string; deletedAt: string | null };
    erasureRequested: boolean; graceDays: number; graceEndsAt: string | null; graceElapsed: boolean;
    archives: PurgeArchive[]; archiveReady: boolean; blockers: PurgeBlockers; request: PurgeRequest | null;
}
interface PurgeResult { filesDeleted?: number; archive?: { sha256?: string } }

type Tr = ReturnType<typeof useTranslations>;
type ApiErr = { stepUpCancelled?: boolean; response?: { data?: { code?: string; message?: string | string[]; graceEndsAt?: string } } };

const fmtDate = (v: string | null | undefined) => (v ? new Date(v).toLocaleString() : '—');
const fmtBytes = (n: number) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : n >= 1024 ? `${(n / 1024).toFixed(1)} KB` : `${n} B`);
const blocked = (b: PurgeBlockers) => b.legalHolds > 0 || b.openRelationships > 0 || !!b.withinRetention;

/** The message for a refused step, or null when the person cancelled the code prompt. */
function problemOf(err: unknown, t: Tr): string | null {
    const e = err as ApiErr;
    if (e?.stepUpCancelled) return null;
    const data = e?.response?.data;
    switch (data?.code) {
        case 'TENANT_PURGE_GRACE': return t('errors.grace', { date: fmtDate(data.graceEndsAt) });
        case 'TENANT_PURGE_NO_ARCHIVE': return t('errors.noArchive');
        case 'TENANT_PURGE_BLOCKED': return t('errors.blocked');
        case 'TENANT_PURGE_NOT_APPROVED': return t('errors.notApproved');
    }
    const m = data?.message;
    return (Array.isArray(m) ? m.join(' ') : m) || t('errors.generic');
}

/** Platform staff by id, to name who requested or approved. */
export function usePlatformPeople() {
    const [people, setPeople] = useState<Record<string, string>>({});
    useEffect(() => {
        api.get<{ id: string; email: string }[]>('/users', { quiet: true }).then(
            (r) => setPeople(Object.fromEntries((Array.isArray(r.data) ? r.data : []).map((u) => [u.id, u.email]))),
            () => setPeople({}),
        );
    }, []);
    return people;
}

function personName(id: string | null | undefined, me: string | undefined, people: Record<string, string>, t: Tr) {
    if (!id) return '—';
    if (id === me) return t('you');
    return people[id] ?? `${id.slice(0, 8)}…`;
}

function Step({ n, title, state, children }: { n: number; title: string; state: 'done' | 'current' | 'locked'; children?: React.ReactNode }) {
    const badge = state === 'done'
        ? 'bg-emerald-100 text-emerald-700'
        : state === 'current' ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-400';
    return (
        <li className={`rounded-xl border p-4 ${state === 'current' ? 'border-indigo-200 bg-white' : 'border-slate-100 bg-slate-50/50'}`}>
            <div className="flex items-center gap-3">
                <span className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-black ${badge}`} aria-hidden>
                    {state === 'done' ? <CheckCircle2 size={15} /> : state === 'locked' ? <Lock size={13} /> : n}
                </span>
                <h3 className="text-sm font-bold text-slate-900">{title}</h3>
            </div>
            {children && <div className="mt-3 pl-10 space-y-3 text-sm text-slate-600">{children}</div>}
        </li>
    );
}

/**
 * The stepped purge dialog for one archived organisation.
 */
export function TenantPurgeDialog({ tenant, open, onOpenChange, onPurged }: {
    tenant: { id: string; name: string } | null;
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onPurged: () => void;
}) {
    const t = useTranslations('Tenants.purge');
    const { user } = useAuth();
    const { showToast } = useToast();
    const people = usePlatformPeople();
    const [info, setInfo] = useState<PurgeStatus | null>(null);
    const [loadError, setLoadError] = useState<string | null>(null);
    const [busy, setBusy] = useState<string | null>(null);
    const [problem, setProblem] = useState<string | null>(null);
    const [reason, setReason] = useState('');
    const [comment, setComment] = useState('');
    const [typed, setTyped] = useState('');
    const [result, setResult] = useState<PurgeResult | null>(null);
    const me = user?.sub;

    const load = useCallback(async () => {
        if (!tenant) return;
        setLoadError(null);
        try {
            const r = await api.get<PurgeStatus>(`/tenants/${tenant.id}/purge`, { quiet: true });
            setInfo(r.data);
        } catch (err) {
            setLoadError(problemOf(err, t) ?? t('errors.generic'));
        }
    }, [tenant, t]);

    useEffect(() => {
        if (!open) return;
        setInfo(null); setProblem(null); setReason(''); setComment(''); setTyped(''); setResult(null);
        void load();
    }, [open, load]);

    const run = async (key: string, fn: () => Promise<unknown>, done?: string) => {
        setBusy(key);
        setProblem(null);
        try {
            const out = await fn();
            if (done) showToast(done, 'success');
            await load();
            return out;
        } catch (err) {
            setProblem(problemOf(err, t));
            return undefined;
        } finally {
            setBusy(null);
        }
    };

    const id = tenant?.id;
    const archive = () => run('archive', () => api.post(`/tenants/${id}/archive`, undefined, { quiet: true }), t('archived'));
    const request = () => run('request', () => api.post(`/tenants/${id}/purge-requests`, { reason: reason.trim() || undefined }, { quiet: true }), t('requested'));
    const decide = (approve: boolean) => {
        const rid = info?.request?.id;
        if (!rid) return;
        return run(approve ? 'approve' : 'reject', () => api.post(
            `/tenants/purge-requests/${rid}/${approve ? 'approve' : 'reject'}`,
            approve ? { comment: comment.trim() || undefined } : { reason: comment.trim() || undefined },
            { quiet: true },
        ), approve ? t('approved') : t('rejected'));
    };
    const purge = async () => {
        setBusy('purge');
        setProblem(null);
        try {
            const r = await api.delete<PurgeResult>(`/tenants/${id}/hard`, { quiet: true });
            setResult(r.data ?? {});
            onPurged();
        } catch (err) {
            setProblem(problemOf(err, t));
        } finally {
            setBusy(null);
        }
    };

    const req = info?.request ?? null;
    const latest = info?.archives[0];
    const isBlocked = info ? blocked(info.blockers) : false;
    const approved = req?.status === 'APPROVED';
    const ownRequest = !!req && req.makerId === me;
    const canRequest = !!info && info.erasureRequested && info.graceElapsed && info.archiveReady && !isBlocked && !req;

    return (
        <Dialog open={open} onOpenChange={(v) => { if (!busy) onOpenChange(v); }}>
            <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto rounded-[2rem] p-8">
                <DialogHeader>
                    <DialogTitle className="text-xl font-black text-slate-900 tracking-tight flex items-center gap-2">
                        <Trash2 size={20} className="text-rose-500" />
                        {t('title', { name: tenant?.name ?? '' })}
                    </DialogTitle>
                    <DialogDescription>{t('desc')}</DialogDescription>
                </DialogHeader>

                {result ? (
                    <div role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900 space-y-2">
                        <p className="font-bold flex items-center gap-2"><CheckCircle2 size={16} /> {t('purgedTitle', { name: tenant?.name ?? '' })}</p>
                        <p>{t('filesDeleted', { count: result.filesDeleted ?? 0 })}</p>
                        <p>{t('archiveKept')}</p>
                        <code className="block text-[11px] break-all">{result.archive?.sha256 ?? latest?.sha256 ?? '—'}</code>
                        <div className="pt-2"><Button type="button" variant="outline" onClick={() => onOpenChange(false)}>{t('close')}</Button></div>
                    </div>
                ) : !info ? (
                    loadError ? (
                        <p role="alert" className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{loadError}</p>
                    ) : (
                        <div className="flex items-center gap-2 py-8 justify-center text-slate-400 text-sm"><Loader2 className="animate-spin" size={16} /> {t('loading')}</div>
                    )
                ) : (
                    <div className="space-y-4">
                        {/* Where the organisation stands */}
                        <div className="rounded-xl border border-slate-100 bg-slate-50/60 p-4 space-y-2 text-sm">
                            {!info.erasureRequested ? (
                                <p className="flex gap-2 text-amber-800"><ShieldAlert size={16} className="flex-shrink-0 mt-0.5" /> {t('notErased')}</p>
                            ) : info.graceElapsed ? (
                                <p className="flex gap-2 text-emerald-800"><CheckCircle2 size={16} className="flex-shrink-0 mt-0.5" /> {t('graceOver', { date: fmtDate(info.graceEndsAt), days: info.graceDays })}</p>
                            ) : (
                                <p className="flex gap-2 text-amber-800"><Clock size={16} className="flex-shrink-0 mt-0.5" /> {t('graceRunning', { date: fmtDate(info.graceEndsAt), days: info.graceDays })}</p>
                            )}
                            {isBlocked ? (
                                <div className="text-rose-800 space-y-1">
                                    <p className="flex gap-2 font-bold"><Gavel size={16} className="flex-shrink-0 mt-0.5" /> {t('blockedTitle')}</p>
                                    <ul className="list-disc pl-10 space-y-0.5">
                                        {info.blockers.legalHolds > 0 && <li>{t('legalHolds', { count: info.blockers.legalHolds })}</li>}
                                        {info.blockers.openRelationships > 0 && <li>{t('openRelationships', { count: info.blockers.openRelationships })}</li>}
                                        {!!info.blockers.withinRetention && (
                                            <li>{t('withinRetention', { count: Number(info.blockers.withinRetention), date: info.blockers.retainUntil ?? '—' })}</li>
                                        )}
                                    </ul>
                                    {info.blockers.examples.length > 0 && (
                                        <div className="pl-6 pt-1">
                                            <p className="text-xs font-semibold">{t('examples')}</p>
                                            <ul className="text-xs space-y-0.5">
                                                {info.blockers.examples.slice(0, 8).map((ex) => (
                                                    <li key={`${ex.kind}-${ex.id}`}><span className="font-mono">{ex.kind} {ex.id.slice(0, 8)}</span> — {ex.reason}</li>
                                                ))}
                                            </ul>
                                        </div>
                                    )}
                                </div>
                            ) : (
                                <p className="flex gap-2 text-emerald-800"><CheckCircle2 size={16} className="flex-shrink-0 mt-0.5" /> {t('noBlockers')}</p>
                            )}
                        </div>

                        {problem && <p role="alert" className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{problem}</p>}

                        <ol className="space-y-3">
                            <Step n={1} title={t('step1')} state={info.archiveReady ? 'done' : 'current'}>
                                <p>{t('step1Desc')}</p>
                                {latest && (
                                    <div className="rounded border border-slate-200 bg-white p-3 text-xs space-y-1">
                                        <p><span className="font-semibold">{t('archiveCreated')}</span> {fmtDate(latest.createdAt)} · {fmtBytes(latest.sizeBytes)} · {latest.storageProvider}</p>
                                        <p className="font-semibold">{t('sha256')}</p>
                                        <code className="block break-all text-[11px]">{latest.sha256}</code>
                                        {!info.archiveReady && <p className="text-amber-700">{t('archiveStale')}</p>}
                                    </div>
                                )}
                                <Button type="button" variant="outline" size="sm" onClick={() => void archive()} disabled={!!busy || !info.erasureRequested}>
                                    {busy === 'archive' ? <Loader2 size={14} className="animate-spin mr-2" /> : <Archive size={14} className="mr-2" />}
                                    {latest ? t('archiveAgain') : t('archive')}
                                </Button>
                            </Step>

                            <Step n={2} title={t('step2')} state={req ? 'done' : info.archiveReady ? 'current' : 'locked'}>
                                {req ? (
                                    <div className="text-xs space-y-0.5">
                                        <p>{t('requestedBy', { who: personName(req.makerId, me, people, t), at: fmtDate(req.createdAt) })}</p>
                                        <p>{t('expires', { at: fmtDate(req.expiresAt) })}</p>
                                        {req.payload?.reason && <p>{t('reasonShown', { reason: req.payload.reason })}</p>}
                                    </div>
                                ) : (
                                    <>
                                        <p>{t('step2Desc')}</p>
                                        <div className="space-y-1">
                                            <Label htmlFor="purge-reason">{t('reason')}</Label>
                                            <Input id="purge-reason" value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} />
                                        </div>
                                        <Button type="button" size="sm" onClick={() => void request()} disabled={!!busy || !canRequest}>
                                            {busy === 'request' && <Loader2 size={14} className="animate-spin mr-2" />}
                                            {t('request')}
                                        </Button>
                                        {!canRequest && <p className="text-xs text-slate-500">{t('requestLocked')}</p>}
                                    </>
                                )}
                            </Step>

                            <Step n={3} title={t('step3')} state={approved ? 'done' : req ? 'current' : 'locked'}>
                                {approved ? (
                                    <p className="text-xs">{t('approvedBy', { who: personName(req?.checkerId, me, people, t) })}</p>
                                ) : req ? (
                                    <>
                                        <p>{ownRequest ? t('waitingOther') : t('step3Desc')}</p>
                                        <div className="space-y-1">
                                            <Label htmlFor="purge-comment">{t('comment')}</Label>
                                            <Input id="purge-comment" value={comment} maxLength={500} onChange={(e) => setComment(e.target.value)} />
                                        </div>
                                        <div className="flex flex-wrap gap-2">
                                            <Button type="button" size="sm" onClick={() => void decide(true)} disabled={!!busy || ownRequest} title={ownRequest ? t('ownRequest') : undefined}>
                                                {busy === 'approve' ? <Loader2 size={14} className="animate-spin mr-2" /> : <CheckCircle2 size={14} className="mr-2" />}
                                                {t('approve')}
                                            </Button>
                                            <Button
                                                type="button"
                                                size="sm"
                                                variant="outline"
                                                onClick={() => void decide(false)}
                                                disabled={!!busy || ownRequest || !comment.trim()}
                                                title={ownRequest ? t('ownRequest') : !comment.trim() ? t('rejectNeedsReason') : undefined}
                                            >
                                                {busy === 'reject' ? <Loader2 size={14} className="animate-spin mr-2" /> : <XCircle size={14} className="mr-2" />}
                                                {t('reject')}
                                            </Button>
                                        </div>
                                    </>
                                ) : (
                                    <p className="text-xs text-slate-500">{t('step3Desc')}</p>
                                )}
                            </Step>

                            <Step n={4} title={t('step4')} state={approved ? 'current' : 'locked'}>
                                <p>{t('step4Desc')}</p>
                                {approved && (
                                    <>
                                        <div className="space-y-1">
                                            <Label htmlFor="purge-confirm">{t('typeName', { name: info.tenant.name })}</Label>
                                            <Input id="purge-confirm" value={typed} autoComplete="off" onChange={(e) => setTyped(e.target.value)} />
                                        </div>
                                        <Button
                                            type="button"
                                            size="sm"
                                            className="bg-rose-600 hover:bg-rose-700 text-white"
                                            onClick={() => void purge()}
                                            disabled={!!busy || typed.trim() !== info.tenant.name}
                                        >
                                            {busy === 'purge' ? <Loader2 size={14} className="animate-spin mr-2" /> : <Trash2 size={14} className="mr-2" />}
                                            {t('purge')}
                                        </Button>
                                    </>
                                )}
                            </Step>
                        </ol>
                    </div>
                )}
            </DialogContent>
        </Dialog>
    );
}

/**
 * Purge requests waiting for a second super-administrator, on the
 * organisations page. Opening one shows the full stepped dialog.
 */
export function PurgeRequestsPanel({ refreshKey, onOpen }: { refreshKey: number; onOpen: (tenant: { id: string; name: string }) => void }) {
    const t = useTranslations('Tenants.purge');
    const { user } = useAuth();
    const people = usePlatformPeople();
    const [rows, setRows] = useState<PurgeRequest[]>([]);

    useEffect(() => {
        api.get<PurgeRequest[]>('/tenants/purge-requests/list', { params: { status: 'PENDING' }, quiet: true }).then(
            (r) => setRows(Array.isArray(r.data) ? r.data : []),
            () => setRows([]),
        );
    }, [refreshKey]);

    if (rows.length === 0) return null;
    return (
        <section className="glass rounded-[2rem] premium-shadow border border-amber-200/60 p-6 space-y-3">
            <h2 className="text-sm font-black uppercase tracking-widest text-amber-800 flex items-center gap-2">
                <Gavel size={16} /> {t('pendingTitle', { count: rows.length })}
            </h2>
            <ul className="divide-y divide-slate-100">
                {rows.map((r) => {
                    const name = r.payload?.tenantName ?? r.subjectId ?? '';
                    const own = r.makerId === user?.sub;
                    return (
                        <li key={r.id} className="py-3 flex flex-col sm:flex-row sm:items-center gap-2 justify-between">
                            <div className="text-sm">
                                <p className="font-bold text-slate-900">{name}</p>
                                <p className="text-xs text-slate-500">
                                    {t('requestedBy', { who: personName(r.makerId, user?.sub, people, t), at: fmtDate(r.createdAt) })} · {t('expires', { at: fmtDate(r.expiresAt) })}
                                </p>
                                {own && <p className="text-xs text-amber-700">{t('waitingOther')}</p>}
                            </div>
                            {r.subjectId && (
                                <Button type="button" size="sm" variant="outline" onClick={() => onOpen({ id: r.subjectId!, name })}>
                                    {t('review')}
                                </Button>
                            )}
                        </li>
                    );
                })}
            </ul>
        </section>
    );
}
