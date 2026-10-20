"use client";

import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import api from '@/lib/api';
import { useToast } from '@/components/ui/toast';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { Button } from '@/components/ui/button';
import {
    CheckCircle, Loader2, QrCode, Upload, XCircle, RefreshCcw, AlertTriangle,
} from 'lucide-react';

/** Just enough of a tier to decide whether it has a payment code to preview. */
type TierSummary = { name: string; displayName: string; requiresPayment: boolean };

type Merchant = {
    bakongAccountId: string;
    merchantName: string;
    merchantCity: string;
    merchantCategoryCode?: string;
};

type QrStatus = { configured: boolean; source: 'UPLOAD' | 'ENV' | 'NONE'; merchant: Merchant | null };

type PlanPreview = {
    plan: string;
    amount: number;
    currency: string;
    qrImage: string;
};

type PlanPayment = {
    id: string;
    reference: string;
    plan: string;
    amount: string;
    currency: string;
    status: string;
    createdAt: string;
    expiresAt: string;
    tenant: { id: string; name: string; status: string };
};

/**
 * Platform payment operations.
 *
 * Two jobs on one page, because they are the same workflow: configure the
 * KHQR that signup codes are minted from, then approve the transfers that
 * arrive against them.
 */
export default function PlatformPaymentsPage() {
    const t = useTranslations('PlatformPayments');
    const tc = useTranslations('Common');
    const { showToast } = useToast();
    const confirm = useConfirm();
    const fileRef = useRef<HTMLInputElement>(null);

    const [status, setStatus] = useState<QrStatus | null>(null);
    const [pending, setPending] = useState<PlanPayment[]>([]);
    const [preview, setPreview] = useState<{ merchant: Merchant; sourceType: string } | null>(null);
    const [planPreviews, setPlanPreviews] = useState<PlanPreview[]>([]);
    const [payloadText, setPayloadText] = useState('');
    const [pendingImage, setPendingImage] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    const [loading, setLoading] = useState(true);

    const load = useCallback(async () => {
        setLoading(true);
        try {
            // Which plans have a code to preview is a question for the tier
            // table, not a constant here — the operator can add or reprice a
            // tier at any time.
            const [qr, payments, tiers] = await Promise.all([
                api.get<QrStatus>('/platform/payment-qr'),
                api.get<PlanPayment[]>('/tenants/plan-payments/list', { params: { status: 'PENDING' } }),
                api.get<TierSummary[]>('/platform/plan-tiers').catch(() => ({ data: [] as TierSummary[] })),
            ]);
            setStatus(qr.data);
            setPending(payments.data);

            if (qr.data.configured) {
                const paidTiers = tiers.data.filter(t => t.requiresPayment);
                const previews = await Promise.all(
                    paidTiers.map(tier =>
                        api
                            .get<PlanPreview>('/platform/payment-qr/plan-preview', { params: { plan: tier.name } })
                            .then(r => r.data)
                            .catch(() => null),
                    ),
                );
                setPlanPreviews(previews.filter(Boolean) as PlanPreview[]);
            } else {
                setPlanPreviews([]);
            }
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { void load(); }, [load]);

    /** Digest without saving, so the operator sees what was read first. */
    const runPreview = async (body: { image?: string; payload?: string }) => {
        setBusy(true);
        setPreview(null);
        try {
            const { data } = await api.post('/platform/payment-qr/preview', body);
            setPreview(data);
            if (body.image) setPendingImage(body.image);
        } catch {
            /* the global interceptor already surfaced the API's message */
        } finally {
            setBusy(false);
        }
    };

    const onFile = async (file: File) => {
        const base64 = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result));
            reader.onerror = () => reject(new Error(t('fileReadFailed')));
            reader.readAsDataURL(file);
        });
        setPayloadText('');
        await runPreview({ image: base64 });
    };

    const save = async () => {
        if (!preview) return;
        setBusy(true);
        try {
            await api.post('/platform/payment-qr', pendingImage ? { image: pendingImage } : { payload: payloadText });
            showToast(t('toastSaved', { merchant: preview.merchant.merchantName }), 'success');
            setPreview(null);
            setPendingImage(null);
            setPayloadText('');
            if (fileRef.current) fileRef.current.value = '';
            await load();
        } finally {
            setBusy(false);
        }
    };

    const decide = async (payment: PlanPayment, approve: boolean) => {
        const ok = await confirm({
            title: approve ? t('confirmTitle') : t('rejectTitle'),
            message: approve
                ? t('confirmMessage', {
                    tenant: payment.tenant.name,
                    plan: payment.plan,
                    currency: payment.currency,
                    amount: payment.amount,
                    reference: payment.reference,
                })
                : t('rejectMessage', { tenant: payment.tenant.name }),
            variant: approve ? 'default' : 'danger',
        });
        if (!ok) return;

        setBusy(true);
        try {
            if (approve) {
                await api.put(`/tenants/plan-payments/${payment.id}/confirm`);
                showToast(t('toastActivated', { tenant: payment.tenant.name, plan: payment.plan }), 'success');
            } else {
                await api.put(`/tenants/plan-payments/${payment.id}/reject`, { reason: 'Transfer not received' });
                showToast(t('toastRejected'), 'info');
            }
            await load();
        } finally {
            setBusy(false);
        }
    };

    const cardClass = 'bg-card border border-border rounded-lg p-6';

    return (
        <div className="space-y-6 p-6 max-w-5xl">
            <div>
                <h1 className="text-xl font-bold text-foreground">{t('title')}</h1>
                <p className="text-sm text-muted-foreground mt-1">
                    {t('subtitle')}
                </p>
            </div>

            {/* ── KHQR configuration ─────────────────────────────────────── */}
            <div className={cardClass}>
                <div className="flex items-center justify-between mb-4">
                    <h2 className="text-base font-semibold text-foreground flex items-center gap-2">
                        <QrCode size={16} /> {t('merchantQr')}
                    </h2>
                    <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
                        <RefreshCcw size={13} className="mr-1.5" /> {t('refresh')}
                    </Button>
                </div>

                {loading ? (
                    <div className="flex items-center gap-2 text-sm text-muted-foreground py-6">
                        <Loader2 size={14} className="animate-spin" /> {tc('loading')}
                    </div>
                ) : (
                    <>
                        {status?.configured ? (
                            <div className="flex items-start gap-3 p-3 rounded border border-emerald-500/20 bg-emerald-500/5 mb-5">
                                <CheckCircle size={16} className="text-emerald-500 mt-0.5 shrink-0" />
                                <div className="text-sm">
                                    <div className="font-semibold text-foreground">
                                        {status.merchant?.merchantName}
                                    </div>
                                    <div className="text-muted-foreground">
                                        {status.merchant?.bakongAccountId} · {status.merchant?.merchantCity}
                                    </div>
                                    <div className="text-xs text-muted-foreground mt-1">
                                        {status.source === 'UPLOAD' ? t('sourceUpload') : t('sourceEnv')}
                                    </div>
                                </div>
                            </div>
                        ) : (
                            <div className="flex items-start gap-3 p-3 rounded border border-amber-500/20 bg-amber-500/5 mb-5">
                                <AlertTriangle size={16} className="text-amber-500 mt-0.5 shrink-0" />
                                <div className="text-sm text-foreground">
                                    {t('notConfigured')}
                                </div>
                            </div>
                        )}

                        <div className="grid gap-4 sm:grid-cols-2">
                            <div>
                                <label className="block text-xs font-semibold text-muted-foreground mb-1.5">
                                    {t('uploadLabel')}
                                </label>
                                <input
                                    ref={fileRef}
                                    type="file"
                                    accept="image/png,image/jpeg"
                                    disabled={busy}
                                    onChange={e => {
                                        const file = e.target.files?.[0];
                                        if (file) void onFile(file);
                                    }}
                                    className="block w-full text-sm text-muted-foreground file:mr-3 file:py-2 file:px-3 file:rounded file:border file:border-border file:text-sm file:bg-secondary file:text-foreground hover:file:border-primary"
                                />
                                <p className="text-[11px] text-muted-foreground mt-1.5">
                                    {t('uploadHint')}
                                </p>
                            </div>

                            <div>
                                <label className="block text-xs font-semibold text-muted-foreground mb-1.5">
                                    {t('payloadLabel')}
                                </label>
                                <textarea
                                    rows={3}
                                    value={payloadText}
                                    disabled={busy}
                                    onChange={e => setPayloadText(e.target.value)}
                                    placeholder="00020101021129..."
                                    className="w-full px-3 py-2 bg-secondary border border-border rounded text-xs font-mono text-foreground focus:outline-none focus:border-primary"
                                />
                                <Button
                                    variant="outline"
                                    size="sm"
                                    className="mt-2"
                                    disabled={busy || !payloadText.trim()}
                                    onClick={() => { setPendingImage(null); void runPreview({ payload: payloadText }); }}
                                >
                                    {t('readPayload')}
                                </Button>
                            </div>
                        </div>

                        {preview && (
                            <div className="mt-5 p-4 rounded border border-primary/30 bg-primary/5">
                                <div className="text-sm font-semibold text-foreground mb-2">
                                    {preview.sourceType === 'IMAGE' ? t('readFromImage') : t('readFromPayload')}
                                </div>
                                <dl className="text-sm grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 mb-4">
                                    <dt className="text-muted-foreground">{t('merchant')}</dt>
                                    <dd className="text-foreground">{preview.merchant.merchantName}</dd>
                                    <dt className="text-muted-foreground">{t('bakongAccount')}</dt>
                                    <dd className="text-foreground font-mono text-xs">{preview.merchant.bakongAccountId}</dd>
                                    <dt className="text-muted-foreground">{t('city')}</dt>
                                    <dd className="text-foreground">{preview.merchant.merchantCity}</dd>
                                </dl>
                                <div className="flex gap-2">
                                    <Button size="sm" onClick={() => void save()} disabled={busy}>
                                        {busy && <Loader2 size={13} className="animate-spin mr-1.5" />}
                                        <Upload size={13} className="mr-1.5" /> {t('useThisQr')}
                                    </Button>
                                    <Button variant="outline" size="sm" onClick={() => { setPreview(null); setPendingImage(null); }}>
                                        {tc('cancel')}
                                    </Button>
                                </div>
                            </div>
                        )}
                    </>
                )}
            </div>

            {/* ── Per-plan codes ─────────────────────────────────────────── */}
            {planPreviews.length > 0 && (
                <div className={cardClass}>
                    <h2 className="text-base font-semibold text-foreground mb-1">{t('planCodes')}</h2>
                    <p className="text-sm text-muted-foreground mb-4">
                        {t('planCodesHint')}
                    </p>
                    <div className="grid gap-4 sm:grid-cols-3">
                        {planPreviews.map(p => (
                            <div key={p.plan} className="border border-border rounded p-3 text-center">
                                {/* eslint-disable-next-line @next/next/no-img-element -- data: URI from our API */}
                                <img src={p.qrImage} alt={t('planQrAlt', { plan: p.plan })} className="w-full max-w-[160px] mx-auto bg-white rounded p-1.5" />
                                <div className="mt-2 text-sm font-semibold text-foreground">{p.plan}</div>
                                <div className="text-sm text-muted-foreground">{t('pricePerMonthValue', { currency: p.currency, amount: p.amount })}</div>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* ── Pending approvals ──────────────────────────────────────── */}
            <div className={cardClass}>
                <h2 className="text-base font-semibold text-foreground mb-1">{t('awaitingApproval')}</h2>
                <p className="text-sm text-muted-foreground mb-4">
                    {t('awaitingApprovalHint')}
                </p>

                {pending.length === 0 ? (
                    <div className="text-sm text-muted-foreground py-6 text-center">
                        {t('noPending')}
                    </div>
                ) : (
                    <div className="space-y-2">
                        {pending.map(p => (
                            <div key={p.id} className="flex items-center justify-between gap-4 p-3 border border-border rounded">
                                <div className="min-w-0">
                                    <div className="text-sm font-semibold text-foreground truncate">{p.tenant.name}</div>
                                    <div className="text-xs text-muted-foreground">
                                        {t.rich('pendingLine', {
                                            plan: p.plan,
                                            currency: p.currency,
                                            amount: p.amount,
                                            reference: p.reference,
                                            mono: chunks => <span className="font-mono">{chunks}</span>,
                                        })}
                                    </div>
                                </div>
                                <div className="flex gap-2 shrink-0">
                                    <Button size="sm" disabled={busy} onClick={() => void decide(p, true)}>
                                        <CheckCircle size={13} className="mr-1.5" /> {t('confirm')}
                                    </Button>
                                    <Button variant="outline" size="sm" disabled={busy} onClick={() => void decide(p, false)}>
                                        <XCircle size={13} className="mr-1.5" /> {t('reject')}
                                    </Button>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}
