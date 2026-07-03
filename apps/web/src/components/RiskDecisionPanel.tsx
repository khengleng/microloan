"use client";

import { useCallback, useEffect, useState } from 'react';
import api from '@/lib/api';
import { useToast } from '@/components/ui/toast';
import { Gauge, Loader2, PlayCircle, RefreshCw, CheckCircle2, AlertTriangle, XCircle } from 'lucide-react';

type Factor = { key: string; label: string; points: number; max: number; detail: string };
type Score = {
    score: number; grade: string; decision: string; dsr: number | null;
    recommendedRate: number | null; factors: Factor[]; reasons?: string[]; createdAt?: string;
};

const DECISION_STYLE: Record<string, { cls: string; icon: any }> = {
    APPROVE: { cls: 'text-emerald-700 bg-emerald-50 border-emerald-200', icon: <CheckCircle2 size={15} /> },
    REFER: { cls: 'text-amber-700 bg-amber-50 border-amber-200', icon: <AlertTriangle size={15} /> },
    DECLINE: { cls: 'text-red-700 bg-red-50 border-red-200', icon: <XCircle size={15} /> },
};

export function RiskDecisionPanel({ loanId, loanStatus, onRestructured }: { loanId: string; loanStatus: string; onRestructured?: () => void }) {
    const { showToast } = useToast();
    const [latest, setLatest] = useState<Score | null>(null);
    const [loading, setLoading] = useState(true);
    const [running, setRunning] = useState(false);
    const [showRestruct, setShowRestruct] = useState(false);
    const [rform, setRform] = useState({ newTermMonths: '', newAnnualInterestRate: '', reason: '' });
    const [restructuring, setRestructuring] = useState(false);

    const load = useCallback(() => {
        setLoading(true);
        api.get(`/risk/loan/${loanId}/scores`)
            .then(res => setLatest(res.data?.[0] || null))
            .catch(() => {})
            .finally(() => setLoading(false));
    }, [loanId]);
    useEffect(load, [load]);

    const runScore = async () => {
        setRunning(true);
        try {
            const res = await api.post(`/risk/loan/${loanId}/score`);
            setLatest(res.data);
        } catch (err: any) {
            showToast(err.response?.data?.message || 'Could not score this loan', 'error');
        } finally { setRunning(false); }
    };

    const submitRestructure = async (e: React.FormEvent) => {
        e.preventDefault();
        setRestructuring(true);
        try {
            const res = await api.post(`/risk/loan/${loanId}/restructure`, {
                newTermMonths: Number(rform.newTermMonths),
                newAnnualInterestRate: rform.newAnnualInterestRate ? Number(rform.newAnnualInterestRate) : undefined,
                reason: rform.reason,
            });
            showToast(`Loan rescheduled: ${res.data.newInstallmentCount} new installments on ${res.data.newRate}%`, 'success');
            setShowRestruct(false);
            setRform({ newTermMonths: '', newAnnualInterestRate: '', reason: '' });
            onRestructured?.();
        } catch (err: any) {
            showToast(err.response?.data?.message || 'Restructure failed', 'error');
        } finally { setRestructuring(false); }
    };

    const decisionStyle = latest ? DECISION_STYLE[latest.decision] : null;

    return (
        <div className="bg-white border border-border rounded-md">
            <div className="flex items-center justify-between px-4 py-3 border-b border-border">
                <div className="flex items-center gap-2">
                    <Gauge size={15} className="text-primary" />
                    <h3 className="text-sm font-bold text-foreground">Risk & Decision</h3>
                </div>
                <button onClick={runScore} disabled={running} className="flex items-center gap-1.5 text-sm font-semibold text-primary hover:underline disabled:opacity-50">
                    {running ? <Loader2 size={13} className="animate-spin" /> : latest ? <RefreshCw size={13} /> : <PlayCircle size={13} />}
                    {latest ? 'Re-score' : 'Run scorecard'}
                </button>
            </div>

            <div className="px-4 py-4 space-y-3">
                {loading ? (
                    <div className="flex items-center text-muted-foreground text-sm"><Loader2 className="animate-spin mr-2" size={14} /> Loading…</div>
                ) : !latest ? (
                    <p className="text-sm text-muted-foreground">No scorecard yet. Run one to get a grade, decision and recommended rate.</p>
                ) : (
                    <>
                        <div className="flex items-center gap-3">
                            <div className="flex flex-col items-center justify-center w-16 h-16 rounded-full border-4 border-primary/20">
                                <span className="text-xl font-black text-foreground leading-none">{latest.score}</span>
                                <span className="text-[10px] text-muted-foreground">/100</span>
                            </div>
                            <div className="flex-1">
                                <div className="flex items-center gap-2">
                                    <span className="text-sm font-bold text-foreground">Grade {latest.grade}</span>
                                    {decisionStyle && (
                                        <span className={`inline-flex items-center gap-1 text-[11px] font-bold px-2 py-0.5 rounded-full border ${decisionStyle.cls}`}>
                                            {decisionStyle.icon} {latest.decision}
                                        </span>
                                    )}
                                </div>
                                <p className="text-xs text-muted-foreground mt-1">
                                    {latest.dsr != null ? `DSR ${(latest.dsr * 100).toFixed(0)}% · ` : ''}
                                    {latest.recommendedRate != null ? `Recommended rate ${latest.recommendedRate}%` : 'No policy rate for grade'}
                                </p>
                            </div>
                        </div>

                        <div className="space-y-1.5 pt-1">
                            {latest.factors?.map(f => (
                                <div key={f.key}>
                                    <div className="flex justify-between text-xs">
                                        <span className="text-muted-foreground">{f.label} <span className="text-muted-foreground/60">· {f.detail}</span></span>
                                        <span className="font-semibold text-foreground">{f.points}/{f.max}</span>
                                    </div>
                                    <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                                        <div className="h-full bg-primary rounded-full" style={{ width: `${f.max ? (f.points / f.max) * 100 : 0}%` }} />
                                    </div>
                                </div>
                            ))}
                        </div>

                        {latest.reasons && latest.reasons.length > 0 && (
                            <ul className="text-xs text-amber-700 bg-amber-50 border border-amber-100 rounded px-3 py-2 list-disc list-inside">
                                {latest.reasons.map((r, i) => <li key={i}>{r}</li>)}
                            </ul>
                        )}
                    </>
                )}

                {/* Restructure */}
                {loanStatus === 'DISBURSED' && (
                    <div className="pt-2 border-t border-border">
                        {!showRestruct ? (
                            <button onClick={() => setShowRestruct(true)} className="text-sm font-medium text-primary hover:underline">
                                Restructure / reschedule…
                            </button>
                        ) : (
                            <form onSubmit={submitRestructure} className="space-y-2 pt-1">
                                <p className="text-xs text-muted-foreground">Reschedules the outstanding principal onto new terms. Marks the loan restructured.</p>
                                <div className="grid grid-cols-2 gap-2">
                                    <input type="number" min="1" required placeholder="New term (months)" className="h-9 px-2 border border-border rounded text-sm"
                                        value={rform.newTermMonths} onChange={e => setRform({ ...rform, newTermMonths: e.target.value })} />
                                    <input type="number" min="0" step="0.01" placeholder="New rate % (optional)" className="h-9 px-2 border border-border rounded text-sm"
                                        value={rform.newAnnualInterestRate} onChange={e => setRform({ ...rform, newAnnualInterestRate: e.target.value })} />
                                </div>
                                <input required placeholder="Reason" className="w-full h-9 px-2 border border-border rounded text-sm"
                                    value={rform.reason} onChange={e => setRform({ ...rform, reason: e.target.value })} />
                                <div className="flex gap-2">
                                    <button type="submit" disabled={restructuring} className="btn-primary text-sm">
                                        {restructuring && <Loader2 size={13} className="animate-spin" />} Apply
                                    </button>
                                    <button type="button" onClick={() => setShowRestruct(false)} className="text-sm text-muted-foreground px-3">Cancel</button>
                                </div>
                            </form>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}
