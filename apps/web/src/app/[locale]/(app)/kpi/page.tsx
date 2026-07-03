"use client";

import { useEffect, useState } from 'react';
import api from '@/lib/api';
import { useToast } from '@/components/ui/toast';
import {
    Loader2, Wallet, Users, TrendingUp, ShieldCheck, AlertTriangle,
    PiggyBank, Percent, Info,
} from 'lucide-react';

type Kpi = {
    asOf: string;
    portfolio: { grossOutstanding: number; activeLoans: number; borrowers: number; totalDisbursed: number; totalCollected: number };
    par: { buckets: { current: number; d1_30: number; d31_60: number; d61_90: number; d90plus: number }; par30Pct: number; par90Pct: number };
    income: { interest: number; penalty: number; fee: number; total: number };
    expense: { provision: number; writeOff: number; total: number };
    netOperatingIncome: number;
    ratios: { interestYieldPct: number; provisionCoveragePct: number; collectionRatePct: number; onTimeRepaymentPct: number; writeOffRatePct: number };
    notes: string[];
};

const money = (n: number) => `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function Stat({ icon, label, value, sub, tone }: { icon: any; label: string; value: string; sub?: string; tone?: string }) {
    return (
        <div className="bg-white border border-border rounded-md p-4">
            <div className="flex items-center gap-2 text-muted-foreground mb-2">{icon}<span className="text-xs font-medium">{label}</span></div>
            <p className={`text-2xl font-black ${tone || 'text-foreground'}`}>{value}</p>
            {sub && <p className="text-xs text-muted-foreground mt-1">{sub}</p>}
        </div>
    );
}

export default function KpiPage() {
    const { showToast } = useToast();
    const [k, setK] = useState<Kpi | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        api.get('/kpi/overview')
            .then(res => setK(res.data))
            .catch((e) => showToast(e.response?.data?.message || 'Failed to load KPIs', 'error'))
            .finally(() => setLoading(false));
    }, []);

    if (loading) return <div className="flex h-64 items-center justify-center text-muted-foreground text-sm"><Loader2 className="animate-spin mr-2" size={16} /> Loading performance…</div>;
    if (!k) return null;

    const b = k.par.buckets;
    const maxBucket = Math.max(b.current, b.d1_30, b.d31_60, b.d61_90, b.d90plus, 1);
    const bucketRows = [
        { label: 'Current', val: b.current, cls: 'bg-emerald-500' },
        { label: '1–30 days', val: b.d1_30, cls: 'bg-lime-500' },
        { label: '31–60 days', val: b.d31_60, cls: 'bg-amber-500' },
        { label: '61–90 days', val: b.d61_90, cls: 'bg-orange-500' },
        { label: '90+ days', val: b.d90plus, cls: 'bg-red-500' },
    ];

    return (
        <div className="max-w-6xl space-y-6">
            <div>
                <h1 className="text-xl font-bold text-foreground">Portfolio Performance</h1>
                <p className="text-sm text-muted-foreground mt-0.5">As of {new Date(k.asOf).toLocaleString()}</p>
            </div>

            {/* Portfolio */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                <Stat icon={<Wallet size={14} />} label="Gross portfolio" value={money(k.portfolio.grossOutstanding)} sub={`${k.portfolio.activeLoans} active loans`} />
                <Stat icon={<Users size={14} />} label="Borrowers" value={String(k.portfolio.borrowers)} />
                <Stat icon={<TrendingUp size={14} />} label="Total disbursed" value={money(k.portfolio.totalDisbursed)} />
                <Stat icon={<PiggyBank size={14} />} label="Total collected" value={money(k.portfolio.totalCollected)} />
            </div>

            {/* PAR + ratios */}
            <div className="grid lg:grid-cols-3 gap-4">
                <div className="lg:col-span-2 bg-white border border-border rounded-md p-5">
                    <div className="flex items-center justify-between mb-4">
                        <h3 className="text-sm font-bold text-foreground flex items-center gap-2"><AlertTriangle size={15} className="text-amber-500" /> Portfolio at Risk (aging)</h3>
                        <div className="flex gap-4 text-sm">
                            <span className="text-muted-foreground">PAR30 <b className={k.par.par30Pct > 5 ? 'text-red-600' : 'text-foreground'}>{k.par.par30Pct}%</b></span>
                            <span className="text-muted-foreground">PAR90 <b className={k.par.par90Pct > 3 ? 'text-red-600' : 'text-foreground'}>{k.par.par90Pct}%</b></span>
                        </div>
                    </div>
                    <div className="space-y-2">
                        {bucketRows.map(r => (
                            <div key={r.label} className="flex items-center gap-3">
                                <span className="text-xs text-muted-foreground w-24">{r.label}</span>
                                <div className="flex-1 h-4 bg-muted rounded overflow-hidden">
                                    <div className={`h-full ${r.cls} rounded`} style={{ width: `${(r.val / maxBucket) * 100}%` }} />
                                </div>
                                <span className="text-xs font-semibold text-foreground w-24 text-right">{money(r.val)}</span>
                            </div>
                        ))}
                    </div>
                </div>

                <div className="bg-white border border-border rounded-md p-5 space-y-3">
                    <h3 className="text-sm font-bold text-foreground flex items-center gap-2"><Percent size={15} className="text-primary" /> Key ratios</h3>
                    {[
                        { l: 'Interest yield (to date)', v: `${k.ratios.interestYieldPct}%` },
                        { l: 'Collection rate', v: `${k.ratios.collectionRatePct}%` },
                        { l: 'On-time repayment', v: `${k.ratios.onTimeRepaymentPct}%` },
                        { l: 'Provision coverage', v: `${k.ratios.provisionCoveragePct}%` },
                        { l: 'Write-off rate', v: `${k.ratios.writeOffRatePct}%` },
                    ].map(r => (
                        <div key={r.l} className="flex justify-between items-center border-b border-border/60 last:border-0 py-1.5">
                            <span className="text-xs text-muted-foreground">{r.l}</span>
                            <span className="text-sm font-bold text-foreground">{r.v}</span>
                        </div>
                    ))}
                </div>
            </div>

            {/* Income statement (GL) */}
            <div className="grid lg:grid-cols-3 gap-4">
                <div className="lg:col-span-2 bg-white border border-border rounded-md p-5">
                    <h3 className="text-sm font-bold text-foreground flex items-center gap-2 mb-4"><ShieldCheck size={15} className="text-emerald-500" /> Operating result (from GL)</h3>
                    <div className="grid grid-cols-2 gap-x-8 gap-y-2 text-sm">
                        <div className="flex justify-between"><span className="text-muted-foreground">Interest income</span><span className="font-semibold">{money(k.income.interest)}</span></div>
                        <div className="flex justify-between"><span className="text-muted-foreground">Provision expense</span><span className="font-semibold text-red-600">−{money(k.expense.provision)}</span></div>
                        <div className="flex justify-between"><span className="text-muted-foreground">Penalty income</span><span className="font-semibold">{money(k.income.penalty)}</span></div>
                        <div className="flex justify-between"><span className="text-muted-foreground">Write-off expense</span><span className="font-semibold text-red-600">−{money(k.expense.writeOff)}</span></div>
                        <div className="flex justify-between"><span className="text-muted-foreground">Fee income</span><span className="font-semibold">{money(k.income.fee)}</span></div>
                        <div />
                        <div className="flex justify-between border-t border-border pt-2 mt-1"><span className="font-semibold">Total income</span><span className="font-bold">{money(k.income.total)}</span></div>
                        <div className="flex justify-between border-t border-border pt-2 mt-1"><span className="font-semibold">Total expense</span><span className="font-bold text-red-600">−{money(k.expense.total)}</span></div>
                    </div>
                    <div className="flex justify-between items-center mt-4 pt-3 border-t border-border">
                        <span className="text-sm font-bold text-foreground">Net operating income</span>
                        <span className={`text-lg font-black ${k.netOperatingIncome >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>{money(k.netOperatingIncome)}</span>
                    </div>
                </div>

                <div className="bg-amber-50 border border-amber-100 rounded-md p-4">
                    <p className="text-xs font-semibold text-amber-800 flex items-center gap-1.5 mb-2"><Info size={13} /> Notes</p>
                    <ul className="text-xs text-amber-700 space-y-2 list-disc list-inside">
                        {k.notes.map((n, i) => <li key={i}>{n}</li>)}
                    </ul>
                </div>
            </div>
        </div>
    );
}
