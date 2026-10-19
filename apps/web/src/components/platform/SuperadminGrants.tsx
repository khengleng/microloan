"use client";

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { CheckCircle2, Loader2, ShieldCheck, XCircle } from 'lucide-react';
import api from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { useToast } from '@/components/ui/toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { usePlatformPeople } from '@/components/platform/TenantPurge';

interface GrantRequest {
    id: string; subjectId: string; makerId: string; createdAt: string; expiresAt: string;
    payload?: { email?: string; mode?: string } | null;
}

/**
 * Super-administrator grants waiting for a second super-administrator
 * (platform team page). A new or promoted super-admin stays inactive until a
 * different super-admin approves; the requester cannot decide their own.
 */
export function SuperadminGrantsPanel({ refreshKey, onDecided }: { refreshKey: number; onDecided: () => void }) {
    const t = useTranslations('Users.superadminGrants');
    const { user } = useAuth();
    const { showToast } = useToast();
    const people = usePlatformPeople();
    const [rows, setRows] = useState<GrantRequest[]>([]);
    const [notes, setNotes] = useState<Record<string, string>>({});
    const [busy, setBusy] = useState<string | null>(null);
    const [reload, setReload] = useState(0);

    useEffect(() => {
        api.get<GrantRequest[]>('/auth/superadmin-grants', { params: { status: 'PENDING' }, quiet: true }).then(
            (r) => setRows(Array.isArray(r.data) ? r.data : []),
            () => setRows([]),
        );
    }, [refreshKey, reload]);

    const decide = async (row: GrantRequest, approve: boolean) => {
        const note = (notes[row.id] ?? '').trim();
        setBusy(`${row.id}:${approve}`);
        try {
            await api.post(
                `/auth/superadmin-grants/${row.id}/${approve ? 'approve' : 'reject'}`,
                approve ? { comment: note || undefined } : { reason: note },
            );
            showToast(approve ? t('approved', { email: row.payload?.email ?? '' }) : t('rejected', { email: row.payload?.email ?? '' }), 'success');
            setReload((k) => k + 1);
            onDecided();
        } catch {
            // The API's own message is shown as a toast by the client.
        } finally {
            setBusy(null);
        }
    };

    if (rows.length === 0) return null;
    return (
        <section className="glass rounded-[2rem] premium-shadow border border-amber-200/60 p-6 space-y-3">
            <h2 className="text-sm font-black uppercase tracking-widest text-amber-800 flex items-center gap-2">
                <ShieldCheck size={16} /> {t('title', { count: rows.length })}
            </h2>
            <p className="text-xs text-slate-500">{t('desc')}</p>
            <ul className="divide-y divide-slate-100">
                {rows.map((r) => {
                    const own = r.makerId === user?.sub;
                    const note = notes[r.id] ?? '';
                    const maker = own ? t('you') : people[r.makerId] ?? `${r.makerId.slice(0, 8)}…`;
                    return (
                        <li key={r.id} className="py-3 space-y-2">
                            <div className="text-sm">
                                <p className="font-bold text-slate-900">
                                    {r.payload?.email ?? r.subjectId}
                                    <span className="ml-2 text-[10px] font-black uppercase tracking-widest text-slate-400">
                                        {r.payload?.mode === 'PROMOTE' ? t('modePromote') : t('modeNew')}
                                    </span>
                                </p>
                                <p className="text-xs text-slate-500">
                                    {t('requestedBy', { who: maker, at: new Date(r.createdAt).toLocaleString() })} · {t('expires', { at: new Date(r.expiresAt).toLocaleString() })}
                                </p>
                                {own && <p className="text-xs text-amber-700">{t('ownRequest')}</p>}
                            </div>
                            <div className="flex flex-col sm:flex-row gap-2">
                                <Input
                                    aria-label={t('note')}
                                    placeholder={t('note')}
                                    value={note}
                                    maxLength={500}
                                    disabled={own}
                                    onChange={(e) => setNotes((n) => ({ ...n, [r.id]: e.target.value }))}
                                    className="h-8 text-sm sm:max-w-xs"
                                />
                                <Button type="button" size="sm" onClick={() => void decide(r, true)} disabled={!!busy || own} title={own ? t('ownRequest') : undefined}>
                                    {busy === `${r.id}:true` ? <Loader2 size={14} className="animate-spin mr-2" /> : <CheckCircle2 size={14} className="mr-2" />}
                                    {t('approve')}
                                </Button>
                                <Button
                                    type="button"
                                    size="sm"
                                    variant="outline"
                                    onClick={() => void decide(r, false)}
                                    disabled={!!busy || own || !note.trim()}
                                    title={own ? t('ownRequest') : !note.trim() ? t('rejectNeedsReason') : undefined}
                                >
                                    {busy === `${r.id}:false` ? <Loader2 size={14} className="animate-spin mr-2" /> : <XCircle size={14} className="mr-2" />}
                                    {t('reject')}
                                </Button>
                            </div>
                        </li>
                    );
                })}
            </ul>
        </section>
    );
}
