"use client";

import { useEffect, useState, useCallback } from 'react';
import api from '@/lib/api';
import { money } from '@/lib/currency';
import { useToast } from '@/components/ui/toast';
import { Loader2, Play } from 'lucide-react';

interface ProvisioningRun {
    id: string;
    runDate: string;
    totalProvision: number;
    loanCount: number;
}

interface Provision {
    loanId: string;
    daysOverdue: number;
    classification: string;
    outstandingPrincipal: number;
    provisionRate: number;
    provisionAmount: number;
    currency: string;
    loan: { borrower: { firstName: string; lastName: string } };
}

interface RunDetail extends ProvisioningRun {
    provisions: Provision[];
}

const CLASSIFICATION_STYLES: Record<string, string> = {
    STANDARD: 'bg-[#E6F9F1] text-[#3ECF8E]',
    SPECIAL_MENTION: 'bg-[#FEF9E7] text-[#C9A227]',
    SUBSTANDARD: 'bg-[#FFF4E5] text-[#E8833A]',
    DOUBTFUL: 'bg-[#FFF0F0] text-[#FF5D5D]',
    LOSS: 'bg-[#7A1F1F] text-white',
};

export default function ProvisioningPage() {
    const { showToast } = useToast();
    const [runs, setRuns] = useState<ProvisioningRun[]>([]);
    const [loading, setLoading] = useState(true);
    const [running, setRunning] = useState(false);
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [detail, setDetail] = useState<RunDetail | null>(null);
    const [detailLoading, setDetailLoading] = useState(false);

    const fetchRuns = useCallback(() => {
        setLoading(true);
        api.get('/provisioning/runs')
            .then(res => setRuns(res.data))
            .catch(err => console.error(err))
            .finally(() => setLoading(false));
    }, []);

    useEffect(() => { fetchRuns(); }, [fetchRuns]);

    const loadDetail = useCallback((id: string) => {
        setSelectedId(id);
        setDetailLoading(true);
        api.get(`/provisioning/runs/${id}`)
            .then(res => setDetail(res.data))
            .catch(() => showToast('Failed to load run detail', 'error'))
            .finally(() => setDetailLoading(false));
    }, [showToast]);

    const handleRun = async () => {
        setRunning(true);
        try {
            const res = await api.post('/provisioning/run');
            const movement = Number(res.data.movement);
            const sign = movement >= 0 ? '+' : '';
            showToast(`Provisioning run complete. Movement: ${sign}${money(movement, 'USD')}`, 'success');
            fetchRuns();
            if (res.data.id) loadDetail(res.data.id);
        } catch {
            showToast('Failed to run provisioning', 'error');
        } finally {
            setRunning(false);
        }
    };

    if (loading) return (
        <div className="flex flex-col h-[60vh] items-center justify-center space-y-4">
            <Loader2 className="animate-spin text-[#635BFF]" size={40} />
            <p className="text-[#697386] font-medium">Loading provisioning runs...</p>
        </div>
    );

    return (
        <div className="max-w-[1200px] mx-auto space-y-8 animate-in fade-in duration-500 pb-10">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                    <h1 className="text-2xl font-bold text-[#1A1F36] tracking-tight">Loan-Loss Provisioning</h1>
                    <p className="text-[#697386] text-[14px]">Run and review expected credit loss provisioning.</p>
                </div>
                <button
                    onClick={handleRun}
                    disabled={running}
                    className="bg-[#635BFF] hover:bg-[#5D55EF] disabled:opacity-60 text-white text-[13px] font-semibold py-2 px-4 rounded shadow-sm transition-all flex items-center gap-2"
                >
                    {running ? <Loader2 size={16} className="animate-spin" /> : <Play size={16} />}
                    {running ? 'Running...' : 'Run Provisioning'}
                </button>
            </div>

            {/* Runs table */}
            <div className="bg-white border border-[#E3E8EE] rounded-lg shadow-sm overflow-hidden">
                <div className="px-6 py-4 border-b border-[#E3E8EE]">
                    <h2 className="text-[15px] font-bold text-[#1A1F36]">Provisioning Runs</h2>
                </div>
                <div className="overflow-x-auto no-scrollbar">
                    <table className="min-w-full border-collapse">
                        <thead>
                            <tr className="border-b border-[#E3E8EE] bg-[#F7FAFC]">
                                <th className="text-left px-6 py-3 text-[11px] font-bold text-[#AAB7C4] uppercase tracking-wider">Run Date</th>
                                <th className="text-right px-6 py-3 text-[11px] font-bold text-[#AAB7C4] uppercase tracking-wider">Loans</th>
                                <th className="text-right px-6 py-3 text-[11px] font-bold text-[#AAB7C4] uppercase tracking-wider">Total Provision</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-[#F7FAFC]">
                            {runs.length === 0 ? (
                                <tr><td colSpan={3} className="px-6 py-12 text-center text-[14px] text-[#697386]">No runs yet. Click &quot;Run Provisioning&quot; to start.</td></tr>
                            ) : runs.map(run => (
                                <tr
                                    key={run.id}
                                    onClick={() => loadDetail(run.id)}
                                    className={`cursor-pointer transition-colors ${selectedId === run.id ? 'bg-[#F0F5FF]' : 'hover:bg-[#F7FAFC]/50'}`}
                                >
                                    <td className="px-6 py-4 text-[14px] font-medium text-[#1A1F36]">{new Date(run.runDate).toLocaleDateString()}</td>
                                    <td className="px-6 py-4 text-right text-[13px] text-[#4F566B] font-medium">{run.loanCount}</td>
                                    <td className="px-6 py-4 text-right text-[13px] font-bold text-[#1A1F36]">{money(run.totalProvision, 'USD')}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* Detail */}
            {selectedId && (
                <div className="bg-white border border-[#E3E8EE] rounded-lg shadow-sm overflow-hidden">
                    <div className="px-6 py-4 border-b border-[#E3E8EE]">
                        <h2 className="text-[15px] font-bold text-[#1A1F36]">Run Detail</h2>
                    </div>
                    {detailLoading ? (
                        <div className="flex items-center justify-center py-16">
                            <Loader2 className="animate-spin text-[#635BFF]" size={28} />
                        </div>
                    ) : detail && detail.provisions.length > 0 ? (
                        <div className="overflow-x-auto no-scrollbar">
                            <table className="min-w-full border-collapse">
                                <thead>
                                    <tr className="border-b border-[#E3E8EE] bg-[#F7FAFC]">
                                        <th className="text-left px-6 py-3 text-[11px] font-bold text-[#AAB7C4] uppercase tracking-wider">Borrower</th>
                                        <th className="text-left px-6 py-3 text-[11px] font-bold text-[#AAB7C4] uppercase tracking-wider">Classification</th>
                                        <th className="text-right px-6 py-3 text-[11px] font-bold text-[#AAB7C4] uppercase tracking-wider">Days Overdue</th>
                                        <th className="text-right px-6 py-3 text-[11px] font-bold text-[#AAB7C4] uppercase tracking-wider">Outstanding</th>
                                        <th className="text-right px-6 py-3 text-[11px] font-bold text-[#AAB7C4] uppercase tracking-wider">Rate</th>
                                        <th className="text-right px-6 py-3 text-[11px] font-bold text-[#AAB7C4] uppercase tracking-wider">Provision</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-[#F7FAFC]">
                                    {detail.provisions.map((p, i) => (
                                        <tr key={`${p.loanId}-${i}`} className="hover:bg-[#F7FAFC]/50 transition-colors">
                                            <td className="px-6 py-4 text-[14px] font-medium text-[#1A1F36]">{p.loan.borrower.firstName} {p.loan.borrower.lastName}</td>
                                            <td className="px-6 py-4">
                                                <span className={`px-2 py-0.5 rounded text-[11px] font-bold ${CLASSIFICATION_STYLES[p.classification] || 'bg-slate-100 text-slate-600'}`}>
                                                    {p.classification.replace(/_/g, ' ')}
                                                </span>
                                            </td>
                                            <td className="px-6 py-4 text-right text-[13px] text-[#4F566B] font-medium">{p.daysOverdue}</td>
                                            <td className="px-6 py-4 text-right text-[13px] text-[#4F566B] font-medium">{money(p.outstandingPrincipal, p.currency)}</td>
                                            <td className="px-6 py-4 text-right text-[13px] text-[#4F566B] font-medium">{(p.provisionRate * 100).toFixed(1)}%</td>
                                            <td className="px-6 py-4 text-right text-[13px] font-bold text-[#1A1F36]">{money(p.provisionAmount, p.currency)}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    ) : (
                        <div className="py-12 text-center text-[14px] text-[#697386]">No provisions in this run.</div>
                    )}
                </div>
            )}
        </div>
    );
}
