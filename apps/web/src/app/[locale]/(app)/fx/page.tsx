"use client";

import { useEffect, useState, useCallback } from 'react';
import api from '@/lib/api';
import { CURRENCY_OPTIONS } from '@/lib/currency';
import { useToast } from '@/components/ui/toast';
import { Loader2, Plus, Coins } from 'lucide-react';

interface FxRate {
    id: string;
    fromCurrency: string;
    toCurrency: string;
    rate: number;
    effectiveDate: string;
}

const fieldCls = "h-9 px-3 bg-white border border-[#E3E8EE] rounded text-sm text-[#1A1F36] focus:outline-none focus:border-[#635BFF] focus:ring-2 focus:ring-[#635BFF]/20 transition-colors";

export default function FxRatesPage() {
    const { showToast } = useToast();
    const [rates, setRates] = useState<FxRate[]>([]);
    const [loading, setLoading] = useState(true);
    const [submitting, setSubmitting] = useState(false);

    const [fromCurrency, setFromCurrency] = useState<string>(CURRENCY_OPTIONS[0]?.value ?? 'USD');
    const [toCurrency, setToCurrency] = useState<string>(CURRENCY_OPTIONS[1]?.value ?? CURRENCY_OPTIONS[0]?.value ?? 'KHR');
    const [rate, setRate] = useState('');
    const [effectiveDate, setEffectiveDate] = useState('');

    const fetchRates = useCallback(() => {
        setLoading(true);
        api.get('/fx/rates')
            .then(res => setRates(res.data))
            .catch(err => console.error(err))
            .finally(() => setLoading(false));
    }, []);

    useEffect(() => { fetchRates(); }, [fetchRates]);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        const rateNum = Number(rate);
        if (!Number.isFinite(rateNum) || rateNum <= 0) {
            showToast('Enter a valid rate greater than 0', 'error');
            return;
        }
        setSubmitting(true);
        try {
            await api.post('/fx/rates', {
                fromCurrency,
                toCurrency,
                rate: rateNum,
                ...(effectiveDate ? { effectiveDate } : {}),
            });
            showToast('Exchange rate added', 'success');
            setRate('');
            setEffectiveDate('');
            fetchRates();
        } catch {
            showToast('Failed to add exchange rate', 'error');
        } finally {
            setSubmitting(false);
        }
    };

    if (loading) return (
        <div className="flex flex-col h-[60vh] items-center justify-center space-y-4">
            <Loader2 className="animate-spin text-[#635BFF]" size={40} />
            <p className="text-[#697386] font-medium">Loading exchange rates...</p>
        </div>
    );

    return (
        <div className="max-w-[1200px] mx-auto space-y-8 animate-in fade-in duration-500 pb-10">
            <div>
                <h1 className="text-2xl font-bold text-[#1A1F36] tracking-tight">Exchange Rates</h1>
                <p className="text-[#697386] text-[14px]">Manage currency conversion rates used across the ledger.</p>
            </div>

            {/* Add rate form */}
            <div className="bg-white border border-[#E3E8EE] rounded-lg shadow-sm p-6">
                <h2 className="text-[15px] font-bold text-[#1A1F36] mb-4 flex items-center gap-2"><Coins size={16} className="text-[#635BFF]" /> Add Rate</h2>
                <form onSubmit={handleSubmit} className="flex flex-wrap items-end gap-4">
                    <div className="flex flex-col gap-1.5">
                        <label className="text-[11px] font-bold text-[#697386] uppercase tracking-wider">From</label>
                        <select value={fromCurrency} onChange={e => setFromCurrency(e.target.value)} className={`${fieldCls} appearance-none`}>
                            {CURRENCY_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                        </select>
                    </div>
                    <div className="flex flex-col gap-1.5">
                        <label className="text-[11px] font-bold text-[#697386] uppercase tracking-wider">To</label>
                        <select value={toCurrency} onChange={e => setToCurrency(e.target.value)} className={`${fieldCls} appearance-none`}>
                            {CURRENCY_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                        </select>
                    </div>
                    <div className="flex flex-col gap-1.5">
                        <label className="text-[11px] font-bold text-[#697386] uppercase tracking-wider">Rate</label>
                        <input type="number" step="any" min="0" value={rate} onChange={e => setRate(e.target.value)} placeholder="4100" className={`${fieldCls} w-36`} required />
                    </div>
                    <div className="flex flex-col gap-1.5">
                        <label className="text-[11px] font-bold text-[#697386] uppercase tracking-wider">Effective Date</label>
                        <input type="date" value={effectiveDate} onChange={e => setEffectiveDate(e.target.value)} className={fieldCls} />
                    </div>
                    <button
                        type="submit"
                        disabled={submitting}
                        className="bg-[#635BFF] hover:bg-[#5D55EF] disabled:opacity-60 text-white text-[13px] font-semibold py-2 px-4 rounded shadow-sm transition-all flex items-center gap-2 h-9"
                    >
                        {submitting ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />} Add Rate
                    </button>
                </form>
            </div>

            {/* Rates table */}
            <div className="bg-white border border-[#E3E8EE] rounded-lg shadow-sm overflow-hidden">
                <div className="overflow-x-auto no-scrollbar">
                    <table className="min-w-full border-collapse">
                        <thead>
                            <tr className="border-b border-[#E3E8EE] bg-[#F7FAFC]">
                                <th className="text-left px-6 py-3 text-[11px] font-bold text-[#AAB7C4] uppercase tracking-wider">From</th>
                                <th className="text-left px-6 py-3 text-[11px] font-bold text-[#AAB7C4] uppercase tracking-wider">To</th>
                                <th className="text-right px-6 py-3 text-[11px] font-bold text-[#AAB7C4] uppercase tracking-wider">Rate</th>
                                <th className="text-right px-6 py-3 text-[11px] font-bold text-[#AAB7C4] uppercase tracking-wider">Effective Date</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-[#F7FAFC]">
                            {rates.length === 0 ? (
                                <tr><td colSpan={4} className="px-6 py-12 text-center text-[14px] text-[#697386]">No exchange rates defined.</td></tr>
                            ) : rates.map(r => (
                                <tr key={r.id} className="hover:bg-[#F7FAFC]/50 transition-colors">
                                    <td className="px-6 py-4 text-[14px] font-bold text-[#1A1F36]">{r.fromCurrency}</td>
                                    <td className="px-6 py-4 text-[14px] font-bold text-[#1A1F36]">{r.toCurrency}</td>
                                    <td className="px-6 py-4 text-right text-[13px] font-bold text-[#635BFF]">{Number(r.rate).toLocaleString(undefined, { maximumFractionDigits: 6 })}</td>
                                    <td className="px-6 py-4 text-right text-[13px] text-[#4F566B] font-medium">{new Date(r.effectiveDate).toLocaleDateString()}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
}
