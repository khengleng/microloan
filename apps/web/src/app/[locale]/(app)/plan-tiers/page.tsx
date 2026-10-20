"use client";

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import api from '@/lib/api';
import { useToast } from '@/components/ui/toast';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { Button } from '@/components/ui/button';
import {
    Layers, Loader2, Plus, RefreshCcw, Trash2, ChevronUp, ChevronDown,
    EyeOff, Eye, AlertTriangle, Save, X,
} from 'lucide-react';

type Tier = {
    id: string;
    name: string;
    displayName: string;
    description: string | null;
    amount: number;
    currency: 'USD' | 'KHR';
    sortOrder: number;
    isActive: boolean;
    requiresPayment: boolean;
    limits: {
        maxUsers: number | null;
        maxBorrowers: number | null;
        maxLoanProducts: number | null;
        maxLoans: number | null;
    };
    organizations: number;
};

/** Form values are strings so a blank quota field can mean "unlimited". */
type TierForm = {
    name: string;
    displayName: string;
    description: string;
    amount: string;
    currency: 'USD' | 'KHR';
    maxUsers: string;
    maxBorrowers: string;
    maxLoanProducts: string;
    maxLoans: string;
};

const EMPTY_FORM: TierForm = {
    name: '',
    displayName: '',
    description: '',
    amount: '0',
    currency: 'USD',
    maxUsers: '',
    maxBorrowers: '',
    maxLoanProducts: '',
    maxLoans: '',
};

const formFor = (tier: Tier): TierForm => ({
    name: tier.name,
    displayName: tier.displayName,
    description: tier.description ?? '',
    amount: String(tier.amount),
    currency: tier.currency,
    maxUsers: tier.limits.maxUsers === null ? '' : String(tier.limits.maxUsers),
    maxBorrowers: tier.limits.maxBorrowers === null ? '' : String(tier.limits.maxBorrowers),
    maxLoanProducts: tier.limits.maxLoanProducts === null ? '' : String(tier.limits.maxLoanProducts),
    maxLoans: tier.limits.maxLoans === null ? '' : String(tier.limits.maxLoans),
});

/** Blank means unlimited, which the API stores as null. */
const quotaValue = (raw: string): number | null => {
    const trimmed = raw.trim();
    return trimmed === '' ? null : Number(trimmed);
};

const showQuota = (n: number | null, unlimited: string) => (n === null ? unlimited : n.toLocaleString());

const inputClass =
    'w-full px-2.5 py-1.5 text-sm bg-secondary border border-border rounded text-foreground focus:outline-none focus:border-primary';
const labelClass = 'block text-[11px] font-semibold text-muted-foreground mb-1';

/**
 * Subscription plans, owned by the platform operator.
 *
 * Tiers are rows rather than code, so this page is the only place they are
 * defined: the signup page, the KHQR amounts and every tenant's quota ceilings
 * all read from what is set here.
 */
export default function PlanTiersPage() {
    const t = useTranslations('PlanTiers');
    const tc = useTranslations('Common');
    const { showToast } = useToast();
    const confirm = useConfirm();

    const [tiers, setTiers] = useState<Tier[]>([]);
    const [loading, setLoading] = useState(true);
    const [busy, setBusy] = useState(false);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [form, setForm] = useState<TierForm>(EMPTY_FORM);
    const [creating, setCreating] = useState(false);

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const { data } = await api.get<Tier[]>('/platform/plan-tiers');
            setTiers(data);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { void load(); }, [load]);

    const set = (key: keyof TierForm) => (value: string) =>
        setForm(prev => ({ ...prev, [key]: value }));

    const quotaPayload = () => ({
        maxUsers: quotaValue(form.maxUsers),
        maxBorrowers: quotaValue(form.maxBorrowers),
        maxLoanProducts: quotaValue(form.maxLoanProducts),
        maxLoans: quotaValue(form.maxLoans),
    });

    const startCreate = () => {
        setForm(EMPTY_FORM);
        setEditingId(null);
        setCreating(true);
    };

    const startEdit = (tier: Tier) => {
        setForm(formFor(tier));
        setCreating(false);
        setEditingId(tier.id);
    };

    const cancel = () => {
        setCreating(false);
        setEditingId(null);
    };

    const submitCreate = async () => {
        setBusy(true);
        try {
            await api.post('/platform/plan-tiers', {
                name: form.name,
                displayName: form.displayName,
                description: form.description || undefined,
                amount: Number(form.amount),
                currency: form.currency,
                ...quotaPayload(),
            });
            showToast(t('toastCreated', { name: form.name.toUpperCase() }), 'success');
            cancel();
            await load();
        } finally {
            setBusy(false);
        }
    };

    const submitUpdate = async (id: string) => {
        setBusy(true);
        try {
            // `name` is deliberately absent: organizations store the tier by
            // name, so renaming would orphan them.
            await api.patch(`/platform/plan-tiers/${id}`, {
                displayName: form.displayName,
                description: form.description,
                amount: Number(form.amount),
                currency: form.currency,
                ...quotaPayload(),
            });
            showToast(t('toastUpdated'), 'success');
            cancel();
            await load();
        } finally {
            setBusy(false);
        }
    };

    const toggleActive = async (tier: Tier) => {
        if (tier.isActive) {
            const ok = await confirm({
                title: t('retireTitle', { name: tier.displayName }),
                message:
                    tier.organizations > 0
                        ? t('retireMessageInUse', { count: tier.organizations })
                        : t('retireMessage'),
                confirmLabel: t('retire'),
                variant: 'warning',
            });
            if (!ok) return;
        }
        setBusy(true);
        try {
            await api.patch(`/platform/plan-tiers/${tier.id}`, { isActive: !tier.isActive });
            showToast(tier.isActive ? t('toastRetired') : t('toastReenabled'), 'success');
            await load();
        } finally {
            setBusy(false);
        }
    };

    const remove = async (tier: Tier) => {
        const ok = await confirm({
            title: t('deleteTitle', { name: tier.displayName }),
            message: t('deleteMessage'),
            confirmLabel: tc('delete'),
            variant: 'danger',
        });
        if (!ok) return;
        setBusy(true);
        try {
            await api.delete(`/platform/plan-tiers/${tier.id}`);
            showToast(t('toastDeleted'), 'success');
            await load();
        } finally {
            setBusy(false);
        }
    };

    /** Persist a new order by sending the full id list. */
    const move = async (index: number, delta: number) => {
        const target = index + delta;
        if (target < 0 || target >= tiers.length) return;
        const next = [...tiers];
        [next[index], next[target]] = [next[target], next[index]];
        setTiers(next); // optimistic, so the arrow feels instant
        setBusy(true);
        try {
            await api.patch('/platform/plan-tiers/reorder', { ids: next.map(t => t.id) });
            await load();
        } finally {
            setBusy(false);
        }
    };

    const cardClass = 'bg-card border border-border rounded-lg p-6';

    const quotaFields = (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {([
                ['maxUsers', 'quota.maxUsers'],
                ['maxBorrowers', 'quota.maxBorrowers'],
                ['maxLoanProducts', 'quota.maxLoanProducts'],
                ['maxLoans', 'quota.maxLoans'],
            ] as const).map(([key, labelKey]) => (
                <div key={key}>
                    <label className={labelClass}>{t(labelKey)}</label>
                    <input
                        type="number"
                        min={1}
                        value={form[key]}
                        placeholder={t('unlimited')}
                        onChange={e => set(key)(e.target.value)}
                        className={inputClass}
                    />
                </div>
            ))}
        </div>
    );

    const commonFields = (
        <>
            <div className="grid gap-3 sm:grid-cols-2">
                <div>
                    <label className={labelClass}>{t('displayName')}</label>
                    <input
                        value={form.displayName}
                        onChange={e => set('displayName')(e.target.value)}
                        placeholder={t('displayNamePlaceholder')}
                        className={inputClass}
                    />
                </div>
                <div className="grid grid-cols-[1fr_auto] gap-2">
                    <div>
                        <label className={labelClass}>{t('pricePerMonth')}</label>
                        <input
                            type="number"
                            min={0}
                            step="0.01"
                            value={form.amount}
                            onChange={e => set('amount')(e.target.value)}
                            className={inputClass}
                        />
                    </div>
                    <div>
                        <label className={labelClass}>{t('currency')}</label>
                        <select
                            value={form.currency}
                            onChange={e => set('currency')(e.target.value)}
                            className={inputClass}
                        >
                            <option value="USD">USD</option>
                            <option value="KHR">KHR</option>
                        </select>
                    </div>
                </div>
            </div>
            <div>
                <label className={labelClass}>{t('description')}</label>
                <input
                    value={form.description}
                    onChange={e => set('description')(e.target.value)}
                    placeholder={t('descriptionPlaceholder')}
                    className={inputClass}
                />
            </div>
            {quotaFields}
            <p className="text-[11px] text-muted-foreground">
                {t('formHint')}
            </p>
        </>
    );

    return (
        <div className="space-y-6 p-6 max-w-5xl">
            <div className="flex items-start justify-between gap-4">
                <div>
                    <h1 className="text-xl font-bold text-foreground">{t('title')}</h1>
                    <p className="text-sm text-muted-foreground mt-1">
                        {t('subtitle')}
                    </p>
                </div>
                <div className="flex gap-2 shrink-0">
                    <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
                        <RefreshCcw size={13} className="mr-1.5" /> {t('refresh')}
                    </Button>
                    <Button size="sm" onClick={startCreate} disabled={busy}>
                        <Plus size={13} className="mr-1.5" /> {t('newPlan')}
                    </Button>
                </div>
            </div>

            {creating && (
                <div className={cardClass}>
                    <h2 className="text-base font-semibold text-foreground flex items-center gap-2 mb-4">
                        <Plus size={16} /> {t('newPlan')}
                    </h2>
                    <div className="space-y-3">
                        <div>
                            <label className={labelClass}>{t('planKey')}</label>
                            <input
                                value={form.name}
                                onChange={e => set('name')(e.target.value)}
                                placeholder="PROFESSIONAL"
                                className={inputClass}
                            />
                            <p className="text-[11px] text-muted-foreground mt-1">
                                {t.rich('planKeyHint', { strong: chunks => <strong>{chunks}</strong> })}
                            </p>
                        </div>
                        {commonFields}
                        <div className="flex gap-2 pt-1">
                            <Button
                                size="sm"
                                onClick={() => void submitCreate()}
                                disabled={busy || !form.name.trim() || !form.displayName.trim()}
                            >
                                {busy ? <Loader2 size={13} className="mr-1.5 animate-spin" /> : <Save size={13} className="mr-1.5" />}
                                {t('createPlan')}
                            </Button>
                            <Button variant="outline" size="sm" onClick={cancel} disabled={busy}>
                                <X size={13} className="mr-1.5" /> {tc('cancel')}
                            </Button>
                        </div>
                    </div>
                </div>
            )}

            <div className={cardClass}>
                <h2 className="text-base font-semibold text-foreground flex items-center gap-2 mb-4">
                    <Layers size={16} /> {t('plans')}
                </h2>

                {loading ? (
                    <div className="flex items-center gap-2 text-sm text-muted-foreground py-6">
                        <Loader2 size={14} className="animate-spin" /> {tc('loading')}
                    </div>
                ) : tiers.length === 0 ? (
                    <div className="flex items-start gap-3 p-3 rounded border border-amber-500/20 bg-amber-500/5">
                        <AlertTriangle size={16} className="text-amber-500 mt-0.5 shrink-0" />
                        <div className="text-sm text-foreground">
                            {t('empty')}
                        </div>
                    </div>
                ) : (
                    <div className="space-y-2">
                        {tiers.map((tier, index) => (
                            <div
                                key={tier.id}
                                className={`border rounded ${tier.isActive ? 'border-border' : 'border-border/50 bg-secondary/30'}`}
                            >
                                <div className="flex items-center gap-3 px-3 py-2.5">
                                    <div className="flex flex-col">
                                        <button
                                            onClick={() => void move(index, -1)}
                                            disabled={busy || index === 0}
                                            className="text-muted-foreground hover:text-foreground disabled:opacity-30"
                                            aria-label={t('moveUp')}
                                        >
                                            <ChevronUp size={14} />
                                        </button>
                                        <button
                                            onClick={() => void move(index, 1)}
                                            disabled={busy || index === tiers.length - 1}
                                            className="text-muted-foreground hover:text-foreground disabled:opacity-30"
                                            aria-label={t('moveDown')}
                                        >
                                            <ChevronDown size={14} />
                                        </button>
                                    </div>

                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-center gap-2 flex-wrap">
                                            <span className="text-sm font-semibold text-foreground">
                                                {tier.displayName}
                                            </span>
                                            <code className="text-[10px] px-1.5 py-0.5 rounded bg-secondary text-muted-foreground">
                                                {tier.name}
                                            </code>
                                            {!tier.isActive && (
                                                <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-500">
                                                    {t('retired')}
                                                </span>
                                            )}
                                        </div>
                                        <div className="text-[11px] text-muted-foreground mt-0.5">
                                            {t('quotaSummary', {
                                                users: showQuota(tier.limits.maxUsers, t('unlimited')),
                                                borrowers: showQuota(tier.limits.maxBorrowers, t('unlimited')),
                                                products: showQuota(tier.limits.maxLoanProducts, t('unlimited')),
                                                loans: showQuota(tier.limits.maxLoans, t('unlimited')),
                                            })}
                                        </div>
                                        <div className="text-[11px] text-muted-foreground mt-0.5">
                                            {t('organizations', { count: tier.organizations })}
                                        </div>
                                    </div>

                                    <div className="text-sm font-semibold text-foreground whitespace-nowrap">
                                        {tier.requiresPayment ? t('pricePerMonthValue', { currency: tier.currency, amount: tier.amount }) : t('free')}
                                    </div>

                                    <div className="flex items-center gap-1 shrink-0">
                                        <Button variant="outline" size="sm" onClick={() => startEdit(tier)} disabled={busy}>
                                            {tc('edit')}
                                        </Button>
                                        <button
                                            onClick={() => void toggleActive(tier)}
                                            disabled={busy}
                                            className="p-1.5 text-muted-foreground hover:text-foreground disabled:opacity-40"
                                            aria-label={tier.isActive ? t('retirePlan') : t('reenablePlan')}
                                            title={tier.isActive ? t('retire') : t('reenable')}
                                        >
                                            {tier.isActive ? <EyeOff size={14} /> : <Eye size={14} />}
                                        </button>
                                        <button
                                            onClick={() => void remove(tier)}
                                            disabled={busy || tier.organizations > 0}
                                            className="p-1.5 text-muted-foreground hover:text-destructive disabled:opacity-30"
                                            aria-label={t('deletePlan')}
                                            title={
                                                tier.organizations > 0
                                                    ? t('deleteBlocked')
                                                    : tc('delete')
                                            }
                                        >
                                            <Trash2 size={14} />
                                        </button>
                                    </div>
                                </div>

                                {editingId === tier.id && (
                                    <div className="border-t border-border px-3 py-3 space-y-3">
                                        {commonFields}
                                        <div className="flex gap-2">
                                            <Button size="sm" onClick={() => void submitUpdate(tier.id)} disabled={busy}>
                                                {busy ? <Loader2 size={13} className="mr-1.5 animate-spin" /> : <Save size={13} className="mr-1.5" />}
                                                {tc('save')}
                                            </Button>
                                            <Button variant="outline" size="sm" onClick={cancel} disabled={busy}>
                                                <X size={13} className="mr-1.5" /> {tc('cancel')}
                                            </Button>
                                        </div>
                                    </div>
                                )}
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}
