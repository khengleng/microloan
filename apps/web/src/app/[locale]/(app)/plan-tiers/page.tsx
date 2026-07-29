"use client";

import { useCallback, useEffect, useState } from 'react';
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

const showQuota = (n: number | null) => (n === null ? 'Unlimited' : n.toLocaleString());

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
            showToast(`Plan ${form.name.toUpperCase()} created.`, 'success');
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
            showToast('Plan updated.', 'success');
            cancel();
            await load();
        } finally {
            setBusy(false);
        }
    };

    const toggleActive = async (tier: Tier) => {
        if (tier.isActive) {
            const ok = await confirm({
                title: `Retire ${tier.displayName}?`,
                message:
                    tier.organizations > 0
                        ? `${tier.organizations} organization${tier.organizations === 1 ? '' : 's'} will keep this plan and its limits. It just stops being offered to new signups.`
                        : 'It stops being offered to new signups. You can re-enable it at any time.',
                confirmLabel: 'Retire',
                variant: 'warning',
            });
            if (!ok) return;
        }
        setBusy(true);
        try {
            await api.patch(`/platform/plan-tiers/${tier.id}`, { isActive: !tier.isActive });
            showToast(tier.isActive ? 'Plan retired.' : 'Plan re-enabled.', 'success');
            await load();
        } finally {
            setBusy(false);
        }
    };

    const remove = async (tier: Tier) => {
        const ok = await confirm({
            title: `Delete ${tier.displayName}?`,
            message: 'This cannot be undone. Retiring keeps the plan valid for existing customers — deleting does not.',
            confirmLabel: 'Delete',
            variant: 'danger',
        });
        if (!ok) return;
        setBusy(true);
        try {
            await api.delete(`/platform/plan-tiers/${tier.id}`);
            showToast('Plan deleted.', 'success');
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
                ['maxUsers', 'Users'],
                ['maxBorrowers', 'Borrowers'],
                ['maxLoanProducts', 'Loan products'],
                ['maxLoans', 'Loans'],
            ] as const).map(([key, label]) => (
                <div key={key}>
                    <label className={labelClass}>{label}</label>
                    <input
                        type="number"
                        min={1}
                        value={form[key]}
                        placeholder="Unlimited"
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
                    <label className={labelClass}>Display name</label>
                    <input
                        value={form.displayName}
                        onChange={e => set('displayName')(e.target.value)}
                        placeholder="Professional"
                        className={inputClass}
                    />
                </div>
                <div className="grid grid-cols-[1fr_auto] gap-2">
                    <div>
                        <label className={labelClass}>Price / month</label>
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
                        <label className={labelClass}>Currency</label>
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
                <label className={labelClass}>Description</label>
                <input
                    value={form.description}
                    onChange={e => set('description')(e.target.value)}
                    placeholder="Shown on the signup page"
                    className={inputClass}
                />
            </div>
            {quotaFields}
            <p className="text-[11px] text-muted-foreground">
                Leave a quota blank for unlimited. A price of 0 activates the workspace immediately;
                anything above 0 puts it behind the KHQR payment gate.
            </p>
        </>
    );

    return (
        <div className="space-y-6 p-6 max-w-5xl">
            <div className="flex items-start justify-between gap-4">
                <div>
                    <h1 className="text-xl font-bold text-foreground">Subscription plans</h1>
                    <p className="text-sm text-muted-foreground mt-1">
                        The tiers offered at signup. Prices here set the amount on each KHQR payment
                        code, and the quotas here are what every organization on that plan is held to.
                    </p>
                </div>
                <div className="flex gap-2 shrink-0">
                    <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
                        <RefreshCcw size={13} className="mr-1.5" /> Refresh
                    </Button>
                    <Button size="sm" onClick={startCreate} disabled={busy}>
                        <Plus size={13} className="mr-1.5" /> New plan
                    </Button>
                </div>
            </div>

            {creating && (
                <div className={cardClass}>
                    <h2 className="text-base font-semibold text-foreground flex items-center gap-2 mb-4">
                        <Plus size={16} /> New plan
                    </h2>
                    <div className="space-y-3">
                        <div>
                            <label className={labelClass}>Plan key</label>
                            <input
                                value={form.name}
                                onChange={e => set('name')(e.target.value)}
                                placeholder="PROFESSIONAL"
                                className={inputClass}
                            />
                            <p className="text-[11px] text-muted-foreground mt-1">
                                Letters, numbers and underscores. Stored on every organization on this
                                plan and <strong>cannot be changed later</strong> — the display name can.
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
                                Create plan
                            </Button>
                            <Button variant="outline" size="sm" onClick={cancel} disabled={busy}>
                                <X size={13} className="mr-1.5" /> Cancel
                            </Button>
                        </div>
                    </div>
                </div>
            )}

            <div className={cardClass}>
                <h2 className="text-base font-semibold text-foreground flex items-center gap-2 mb-4">
                    <Layers size={16} /> Plans
                </h2>

                {loading ? (
                    <div className="flex items-center gap-2 text-sm text-muted-foreground py-6">
                        <Loader2 size={14} className="animate-spin" /> Loading...
                    </div>
                ) : tiers.length === 0 ? (
                    <div className="flex items-start gap-3 p-3 rounded border border-amber-500/20 bg-amber-500/5">
                        <AlertTriangle size={16} className="text-amber-500 mt-0.5 shrink-0" />
                        <div className="text-sm text-foreground">
                            No plans are defined, so nobody can sign up. Create at least one — a plan
                            priced at 0 gives you a free tier.
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
                                            aria-label="Move up"
                                        >
                                            <ChevronUp size={14} />
                                        </button>
                                        <button
                                            onClick={() => void move(index, 1)}
                                            disabled={busy || index === tiers.length - 1}
                                            className="text-muted-foreground hover:text-foreground disabled:opacity-30"
                                            aria-label="Move down"
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
                                                    Retired
                                                </span>
                                            )}
                                        </div>
                                        <div className="text-[11px] text-muted-foreground mt-0.5">
                                            {showQuota(tier.limits.maxUsers)} users · {showQuota(tier.limits.maxBorrowers)} borrowers ·{' '}
                                            {showQuota(tier.limits.maxLoanProducts)} products · {showQuota(tier.limits.maxLoans)} loans
                                        </div>
                                        <div className="text-[11px] text-muted-foreground mt-0.5">
                                            {tier.organizations} organization{tier.organizations === 1 ? '' : 's'}
                                        </div>
                                    </div>

                                    <div className="text-sm font-semibold text-foreground whitespace-nowrap">
                                        {tier.requiresPayment ? `${tier.currency} ${tier.amount}/mo` : 'Free'}
                                    </div>

                                    <div className="flex items-center gap-1 shrink-0">
                                        <Button variant="outline" size="sm" onClick={() => startEdit(tier)} disabled={busy}>
                                            Edit
                                        </Button>
                                        <button
                                            onClick={() => void toggleActive(tier)}
                                            disabled={busy}
                                            className="p-1.5 text-muted-foreground hover:text-foreground disabled:opacity-40"
                                            aria-label={tier.isActive ? 'Retire plan' : 'Re-enable plan'}
                                            title={tier.isActive ? 'Retire' : 'Re-enable'}
                                        >
                                            {tier.isActive ? <EyeOff size={14} /> : <Eye size={14} />}
                                        </button>
                                        <button
                                            onClick={() => void remove(tier)}
                                            disabled={busy || tier.organizations > 0}
                                            className="p-1.5 text-muted-foreground hover:text-destructive disabled:opacity-30"
                                            aria-label="Delete plan"
                                            title={
                                                tier.organizations > 0
                                                    ? 'Organizations are on this plan — retire it instead'
                                                    : 'Delete'
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
                                                Save
                                            </Button>
                                            <Button variant="outline" size="sm" onClick={cancel} disabled={busy}>
                                                <X size={13} className="mr-1.5" /> Cancel
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
