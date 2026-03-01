"use client";

import { useEffect, useState, useMemo } from 'react';
import api from '@/lib/api';
import { useToast } from '@/components/ui/toast';
import { Search, Shield, User, FileText, CreditCard, AlertCircle } from 'lucide-react';

interface AuditEntry {
    id: string;
    action: string;
    entity: string;
    entityId: string;
    createdAt: string;
    user: { email: string; role: string; };
    metadata: any;
}

const ACTION_STYLES: Record<string, string> = {
    CREATE: 'bg-emerald-100 text-emerald-700',
    UPDATE: 'bg-blue-100 text-blue-700',
    DELETE: 'bg-red-100 text-red-700',
    LOGIN: 'bg-slate-100 text-slate-600',
};

const ENTITY_ICONS: Record<string, any> = {
    Borrower: User,
    Loan: FileText,
    Repayment: CreditCard,
};

export default function AuditLogPage() {
    const { showToast } = useToast();
    const [entries, setEntries] = useState<AuditEntry[]>([]);
    const [loading, setLoading] = useState(true);
    const [searchQuery, setSearchQuery] = useState('');
    const [actionFilter, setActionFilter] = useState('ALL');

    useEffect(() => {
        api.get('/audit-logs')
            .then(res => setEntries(res.data))
            .catch(() => showToast('Failed to load audit log', 'error'))
            .finally(() => setLoading(false));
    }, []);

    const filtered = useMemo(() =>
        entries.filter(e => {
            const matchSearch = e.user.email.toLowerCase().includes(searchQuery.toLowerCase())
                || e.entity.toLowerCase().includes(searchQuery.toLowerCase());
            const matchAction = actionFilter === 'ALL' || e.action === actionFilter;
            return matchSearch && matchAction;
        }), [entries, searchQuery, actionFilter]);

    return (
        <div className="space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                    <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
                        <Shield size={22} className="text-slate-400" /> Audit Log
                    </h1>
                    <p className="text-sm text-slate-500 mt-0.5">{entries.length} events recorded</p>
                </div>
            </div>

            <div className="flex flex-col sm:flex-row gap-3">
                <div className="relative flex-1">
                    <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                    <input
                        type="text"
                        placeholder="Search by user or entity..."
                        value={searchQuery}
                        onChange={e => setSearchQuery(e.target.value)}
                        className="w-full pl-9 pr-4 py-2.5 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                    />
                </div>
                <div className="flex gap-1.5">
                    {['ALL', 'CREATE', 'UPDATE', 'DELETE'].map(a => (
                        <button
                            key={a}
                            onClick={() => setActionFilter(a)}
                            className={`px-3 py-2 text-xs font-semibold rounded-lg transition-all ${actionFilter === a ? 'bg-slate-900 text-white' : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'}`}
                        >
                            {a}
                        </button>
                    ))}
                </div>
            </div>

            <div className="bg-white rounded-xl border border-slate-100 shadow-sm overflow-hidden">
                <table className="min-w-full">
                    <thead>
                        <tr className="bg-slate-50 border-b border-slate-100">
                            <th className="px-5 py-3.5 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">When</th>
                            <th className="px-5 py-3.5 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">User</th>
                            <th className="px-5 py-3.5 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">Action</th>
                            <th className="px-5 py-3.5 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">Entity</th>
                            <th className="px-5 py-3.5 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider hidden lg:table-cell">ID</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-50">
                        {loading ? (
                            Array.from({ length: 5 }).map((_, i) => (
                                <tr key={i}>
                                    {Array.from({ length: 5 }).map((_, j) => (
                                        <td key={j} className="px-5 py-4">
                                            <div className="h-4 bg-slate-100 rounded animate-pulse" style={{ width: `${40 + (i + j) * 9}%` }} />
                                        </td>
                                    ))}
                                </tr>
                            ))
                        ) : filtered.length === 0 ? (
                            <tr>
                                <td colSpan={5} className="px-5 py-16 text-center">
                                    <AlertCircle size={40} className="mx-auto text-slate-200 mb-3" />
                                    <p className="text-slate-400 font-medium">No audit events found</p>
                                </td>
                            </tr>
                        ) : (
                            filtered.map(entry => {
                                const Icon = ENTITY_ICONS[entry.entity] || FileText;
                                return (
                                    <tr key={entry.id} className="hover:bg-slate-50 transition-colors">
                                        <td className="px-5 py-3.5 text-xs text-slate-400 whitespace-nowrap">
                                            {new Date(entry.createdAt).toLocaleString()}
                                        </td>
                                        <td className="px-5 py-3.5">
                                            <div className="text-sm font-medium text-slate-700">{entry.user.email}</div>
                                            <div className="text-[10px] text-slate-400 uppercase">{entry.user.role}</div>
                                        </td>
                                        <td className="px-5 py-3.5">
                                            <span className={`px-2 py-0.5 text-[11px] font-bold rounded-full ${ACTION_STYLES[entry.action] || 'bg-gray-100 text-gray-600'}`}>
                                                {entry.action}
                                            </span>
                                        </td>
                                        <td className="px-5 py-3.5">
                                            <div className="flex items-center gap-1.5 text-sm text-slate-700">
                                                <Icon size={13} className="text-slate-400" />
                                                {entry.entity}
                                            </div>
                                        </td>
                                        <td className="px-5 py-3.5 hidden lg:table-cell">
                                            <span className="text-[10px] font-mono text-slate-300">{entry.entityId.slice(0, 8)}...</span>
                                        </td>
                                    </tr>
                                );
                            })
                        )}
                    </tbody>
                </table>
            </div>
        </div>
    );
}
