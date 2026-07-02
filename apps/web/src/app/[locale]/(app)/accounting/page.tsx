"use client";

import { useEffect, useState, useCallback } from 'react';
import api from '@/lib/api';
import { money } from '@/lib/currency';
import { Loader2, BookOpen, Scale, ListTree } from 'lucide-react';

interface Account {
    id: string;
    code: string;
    name: string;
    type: string;
    isActive: boolean;
}

interface TrialBalanceRow {
    code: string;
    name: string;
    type: string;
    debit: number;
    credit: number;
    balance: number;
}

interface TrialBalance {
    rows: TrialBalanceRow[];
    totals: { debit: number; credit: number; balanced: boolean };
}

interface JournalLine {
    debit: number;
    credit: number;
    account: { code: string; name: string };
}

interface JournalEntry {
    id: string;
    date: string;
    source: string;
    currency: string;
    description: string | null;
    loanId: string | null;
    lines: JournalLine[];
}

type Tab = 'accounts' | 'trial-balance' | 'journal';

export default function AccountingPage() {
    const [tab, setTab] = useState<Tab>('accounts');
    const [loading, setLoading] = useState(true);
    const [accounts, setAccounts] = useState<Account[]>([]);
    const [trialBalance, setTrialBalance] = useState<TrialBalance | null>(null);
    const [journal, setJournal] = useState<JournalEntry[]>([]);

    const fetchData = useCallback(() => {
        setLoading(true);
        Promise.all([
            api.get('/ledger/accounts'),
            api.get('/ledger/trial-balance'),
            api.get('/ledger/journal', { params: { page: 1, limit: 25 } }),
        ])
            .then(([acc, tb, jr]) => {
                setAccounts(acc.data);
                setTrialBalance(tb.data);
                setJournal(jr.data?.data ?? []);
            })
            .catch(err => console.error(err))
            .finally(() => setLoading(false));
    }, []);

    useEffect(() => { fetchData(); }, [fetchData]);

    if (loading) return (
        <div className="flex flex-col h-[60vh] items-center justify-center space-y-4">
            <Loader2 className="animate-spin text-[#635BFF]" size={40} />
            <p className="text-[#697386] font-medium">Loading accounting data...</p>
        </div>
    );

    const tabs: { key: Tab; label: string; Icon: any }[] = [
        { key: 'accounts', label: 'Chart of Accounts', Icon: ListTree },
        { key: 'trial-balance', label: 'Trial Balance', Icon: Scale },
        { key: 'journal', label: 'Journal', Icon: BookOpen },
    ];

    return (
        <div className="max-w-[1200px] mx-auto space-y-8 animate-in fade-in duration-500 pb-10">
            <div>
                <h1 className="text-2xl font-bold text-[#1A1F36] tracking-tight">Accounting</h1>
                <p className="text-[#697386] text-[14px]">General ledger, trial balance, and journal entries.</p>
            </div>

            {/* Tabs */}
            <div className="flex items-center gap-1 border-b border-[#E3E8EE]">
                {tabs.map(({ key, label, Icon }) => (
                    <button
                        key={key}
                        onClick={() => setTab(key)}
                        className={`flex items-center gap-2 px-4 py-2.5 text-[13px] font-semibold border-b-2 -mb-px transition-colors ${tab === key
                            ? 'border-[#635BFF] text-[#635BFF]'
                            : 'border-transparent text-[#697386] hover:text-[#1A1F36]'
                            }`}
                    >
                        <Icon size={15} /> {label}
                    </button>
                ))}
            </div>

            {tab === 'accounts' && (
                <div className="bg-white border border-[#E3E8EE] rounded-lg shadow-sm overflow-hidden">
                    <div className="overflow-x-auto no-scrollbar">
                        <table className="min-w-full border-collapse">
                            <thead>
                                <tr className="border-b border-[#E3E8EE] bg-[#F7FAFC]">
                                    <th className="text-left px-6 py-3 text-[11px] font-bold text-[#AAB7C4] uppercase tracking-wider">Code</th>
                                    <th className="text-left px-6 py-3 text-[11px] font-bold text-[#AAB7C4] uppercase tracking-wider">Name</th>
                                    <th className="text-left px-6 py-3 text-[11px] font-bold text-[#AAB7C4] uppercase tracking-wider">Type</th>
                                    <th className="text-right px-6 py-3 text-[11px] font-bold text-[#AAB7C4] uppercase tracking-wider">Status</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-[#F7FAFC]">
                                {accounts.length === 0 ? (
                                    <tr><td colSpan={4} className="px-6 py-12 text-center text-[14px] text-[#697386]">No accounts found.</td></tr>
                                ) : accounts.map(a => (
                                    <tr key={a.id} className="hover:bg-[#F7FAFC]/50 transition-colors">
                                        <td className="px-6 py-4 text-[13px] font-bold text-[#635BFF] font-mono">{a.code}</td>
                                        <td className="px-6 py-4 text-[14px] font-medium text-[#1A1F36]">{a.name}</td>
                                        <td className="px-6 py-4 text-[12px] font-bold text-[#4F566B] uppercase tracking-wider">{a.type}</td>
                                        <td className="px-6 py-4 text-right">
                                            {a.isActive ? (
                                                <span className="px-2 py-0.5 rounded bg-[#E6F9F1] text-[#3ECF8E] text-[11px] font-bold">Active</span>
                                            ) : (
                                                <span className="px-2 py-0.5 rounded bg-[#FFF0F0] text-[#FF5D5D] text-[11px] font-bold">Inactive</span>
                                            )}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}

            {tab === 'trial-balance' && trialBalance && (
                <div className="bg-white border border-[#E3E8EE] rounded-lg shadow-sm overflow-hidden">
                    <div className="flex items-center justify-between px-6 py-4 border-b border-[#E3E8EE]">
                        <h2 className="text-[15px] font-bold text-[#1A1F36]">Trial Balance</h2>
                        {trialBalance.totals.balanced ? (
                            <span className="px-3 py-1 rounded bg-[#E6F9F1] text-[#3ECF8E] text-[12px] font-bold">Balanced</span>
                        ) : (
                            <span className="px-3 py-1 rounded bg-[#FFF0F0] text-[#FF5D5D] text-[12px] font-bold">Unbalanced</span>
                        )}
                    </div>
                    <div className="overflow-x-auto no-scrollbar">
                        <table className="min-w-full border-collapse">
                            <thead>
                                <tr className="border-b border-[#E3E8EE] bg-[#F7FAFC]">
                                    <th className="text-left px-6 py-3 text-[11px] font-bold text-[#AAB7C4] uppercase tracking-wider">Code</th>
                                    <th className="text-left px-6 py-3 text-[11px] font-bold text-[#AAB7C4] uppercase tracking-wider">Name</th>
                                    <th className="text-right px-6 py-3 text-[11px] font-bold text-[#AAB7C4] uppercase tracking-wider">Debit</th>
                                    <th className="text-right px-6 py-3 text-[11px] font-bold text-[#AAB7C4] uppercase tracking-wider">Credit</th>
                                    <th className="text-right px-6 py-3 text-[11px] font-bold text-[#AAB7C4] uppercase tracking-wider">Balance</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-[#F7FAFC]">
                                {trialBalance.rows.length === 0 ? (
                                    <tr><td colSpan={5} className="px-6 py-12 text-center text-[14px] text-[#697386]">No data.</td></tr>
                                ) : trialBalance.rows.map(r => (
                                    <tr key={r.code} className="hover:bg-[#F7FAFC]/50 transition-colors">
                                        <td className="px-6 py-4 text-[13px] font-bold text-[#635BFF] font-mono">{r.code}</td>
                                        <td className="px-6 py-4 text-[14px] font-medium text-[#1A1F36]">{r.name}</td>
                                        <td className="px-6 py-4 text-right text-[13px] text-[#4F566B] font-medium">{money(r.debit, 'USD')}</td>
                                        <td className="px-6 py-4 text-right text-[13px] text-[#4F566B] font-medium">{money(r.credit, 'USD')}</td>
                                        <td className="px-6 py-4 text-right text-[13px] font-bold text-[#1A1F36]">{money(r.balance, 'USD')}</td>
                                    </tr>
                                ))}
                            </tbody>
                            <tfoot>
                                <tr className="border-t-2 border-[#E3E8EE] bg-[#F7FAFC]">
                                    <td className="px-6 py-4 text-[12px] font-bold text-[#1A1F36] uppercase tracking-wider" colSpan={2}>Totals</td>
                                    <td className="px-6 py-4 text-right text-[13px] font-bold text-[#1A1F36]">{money(trialBalance.totals.debit, 'USD')}</td>
                                    <td className="px-6 py-4 text-right text-[13px] font-bold text-[#1A1F36]">{money(trialBalance.totals.credit, 'USD')}</td>
                                    <td className="px-6 py-4"></td>
                                </tr>
                            </tfoot>
                        </table>
                    </div>
                </div>
            )}

            {tab === 'journal' && (
                <div className="space-y-4">
                    {journal.length === 0 ? (
                        <div className="bg-white border border-[#E3E8EE] rounded-lg p-16 text-center shadow-sm">
                            <div className="w-16 h-16 bg-[#F7FAFC] text-[#AAB7C4] rounded-full flex items-center justify-center mx-auto mb-4">
                                <BookOpen size={32} />
                            </div>
                            <h2 className="text-[18px] font-bold text-[#1A1F36]">No journal entries</h2>
                            <p className="text-[#697386] text-[14px] mt-1">Journal entries will appear here as transactions are posted.</p>
                        </div>
                    ) : journal.map(entry => (
                        <div key={entry.id} className="bg-white border border-[#E3E8EE] rounded-lg shadow-sm overflow-hidden">
                            <div className="flex flex-wrap items-center justify-between gap-3 px-6 py-4 border-b border-[#F7FAFC]">
                                <div className="flex items-center gap-3">
                                    <span className="text-[13px] font-bold text-[#1A1F36]">{new Date(entry.date).toLocaleDateString()}</span>
                                    <span className="px-2 py-0.5 rounded bg-[#F0F5FF] text-[#635BFF] text-[11px] font-bold uppercase tracking-wider">{entry.source}</span>
                                    {entry.description && <span className="text-[13px] text-[#697386]">{entry.description}</span>}
                                </div>
                                <span className="text-[11px] font-medium text-[#AAB7C4]">{entry.currency}</span>
                            </div>
                            <div className="overflow-x-auto no-scrollbar">
                                <table className="min-w-full border-collapse">
                                    <thead>
                                        <tr className="border-b border-[#F7FAFC]">
                                            <th className="text-left px-6 py-2.5 text-[11px] font-bold text-[#AAB7C4] uppercase tracking-wider">Account</th>
                                            <th className="text-right px-6 py-2.5 text-[11px] font-bold text-[#AAB7C4] uppercase tracking-wider">Debit</th>
                                            <th className="text-right px-6 py-2.5 text-[11px] font-bold text-[#AAB7C4] uppercase tracking-wider">Credit</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-[#F7FAFC]">
                                        {entry.lines.map((line, i) => (
                                            <tr key={i}>
                                                <td className="px-6 py-3 text-[13px] text-[#1A1F36]">
                                                    <span className="font-mono font-bold text-[#635BFF]">{line.account.code}</span>{' '}
                                                    <span className="text-[#4F566B]">{line.account.name}</span>
                                                </td>
                                                <td className="px-6 py-3 text-right text-[13px] font-medium text-[#4F566B]">{line.debit ? money(line.debit, entry.currency) : '—'}</td>
                                                <td className="px-6 py-3 text-right text-[13px] font-medium text-[#4F566B]">{line.credit ? money(line.credit, entry.currency) : '—'}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}
