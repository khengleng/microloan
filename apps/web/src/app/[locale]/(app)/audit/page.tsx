"use client";

import { useEffect, useState, useCallback } from 'react';
import api from '@/lib/api';
import { useToast } from '@/components/ui/toast';
import {
    Shield, Search, Download, LogIn, LogOut, RefreshCcw,
    FileText, Users, Building2, CreditCard, ChevronLeft, ChevronRight,
    AlertTriangle, CheckCircle, XCircle, Info, Calendar, Filter, Activity, Fingerprint
} from 'lucide-react';
import { Button } from '@/components/ui/button';

const ACTION_META: Record<string, { color: string; bg: string; icon: any; label: string }> = {
    LOGIN: { color: 'text-indigo-700', bg: 'bg-indigo-50 border-indigo-100/50', icon: LogIn, label: 'Auth' },
    CREATE: { color: 'text-emerald-700', bg: 'bg-emerald-50 border-emerald-100/50', icon: CheckCircle, label: 'Create' },
    UPDATE: { color: 'text-amber-700', bg: 'bg-amber-50 border-amber-100/50', icon: RefreshCcw, label: 'Update' },
    DELETE: { color: 'text-rose-700', bg: 'bg-rose-50 border-rose-100/50', icon: XCircle, label: 'Delete' },
};

const EVENT_COLORS: Record<string, string> = {
    LOGIN_SUCCESS: 'text-emerald-600',
    MFA_SUCCESS: 'text-emerald-600',
    MFA_ENABLED: 'text-emerald-600',
    LOGIN_FAILED: 'text-rose-600 font-black',
    MFA_FAILED: 'text-rose-600 font-black',
    LOGIN_CHALLENGE_ISSUED: 'text-amber-600',
    TENANT_SUSPENDED: 'text-rose-600',
    TENANT_SOFT_DELETED: 'text-rose-600',
    PROMOTED_TO_SUPERADMIN: 'text-indigo-600 font-black',
};

const ENTITIES = ['All', 'User', 'Borrower', 'Loan', 'Repayment', 'Document', 'Tenant', 'LoanProduct'];
const ACTIONS = ['All', 'LOGIN', 'CREATE', 'UPDATE', 'DELETE'];

interface AuditLog {
    id: string;
    action: string;
    entity: string;
    entityId: string;
    userId: string;
    createdAt: string;
    metadata?: any;
    user?: { email: string; role: string };
}

interface Meta { total: number; page: number; pageSize: number; pages: number; }
interface Summary { totalEvents: number; loginEvents: number; failedLogins: number; today: number; }

export default function AuditPage() {
    const { showToast } = useToast();
    const [logs, setLogs] = useState<AuditLog[]>([]);
    const [meta, setMeta] = useState<Meta | null>(null);
    const [summary, setSummary] = useState<Summary | null>(null);
    const [loading, setLoading] = useState(true);
    const [page, setPage] = useState(1);
    const [search, setSearch] = useState('');
    const [action, setAction] = useState('All');
    const [entity, setEntity] = useState('All');
    const [from, setFrom] = useState('');
    const [to, setTo] = useState('');
    const [expanded, setExpanded] = useState<string | null>(null);

    const fetchSummary = useCallback(async () => {
        try {
            const r = await api.get('/audit-logs/summary');
            setSummary(r.data);
        } catch { }
    }, []);

    const fetchLogs = useCallback(async (pg = 1) => {
        setLoading(true);
        try {
            const params: any = { page: pg, limit: 50 };
            if (action !== 'All') params.action = action;
            if (entity !== 'All') params.entity = entity;
            if (from) params.from = from;
            if (to) params.to = to;
            const r = await api.get('/audit-logs', { params });
            setLogs(r.data.data);
            setMeta(r.data.meta);
        } catch {
            showToast('Failed to load audit logs', 'error');
        } finally {
            setLoading(false);
        }
    }, [action, entity, from, to]);

    useEffect(() => {
        fetchSummary();
        fetchLogs(1);
        setPage(1);
    }, [action, entity, from, to]);

    const handleExportCsv = async () => {
        try {
            const params: any = {};
            if (action !== 'All') params.action = action;
            if (entity !== 'All') params.entity = entity;
            if (from) params.from = from;
            if (to) params.to = to;
            const r = await api.get('/audit-logs/export/csv', {
                params,
                responseType: 'blob'
            });
            const url = window.URL.createObjectURL(new Blob([r.data]));
            const a = document.createElement('a');
            a.href = url;
            a.download = `audit-vault-${new Date().toISOString().slice(0, 10)}.csv`;
            a.click();
            window.URL.revokeObjectURL(url);
            showToast('Audit vault exported', 'success');
        } catch {
            showToast('Export failed', 'error');
        }
    };

    const filtered = search
        ? logs.filter(l =>
            (l.user?.email || l.userId).toLowerCase().includes(search.toLowerCase()) ||
            l.entity.toLowerCase().includes(search.toLowerCase()) ||
            l.action.toLowerCase().includes(search.toLowerCase()) ||
            JSON.stringify(l.metadata || {}).toLowerCase().includes(search.toLowerCase())
        )
        : logs;

    const getEventLabel = (log: AuditLog) => {
        return log.metadata?.event || log.action;
    };

    const getEventColor = (log: AuditLog) => {
        const evt = log.metadata?.event || '';
        return EVENT_COLORS[evt] || 'text-slate-600';
    };

    return (
        <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-700">
            {/* Header Area */}
            <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-6">
                <div>
                    <h1 className="text-3xl font-black text-slate-900 tracking-tight flex items-center gap-3">
                        <Fingerprint className="text-indigo-600" size={32} /> Security Audit Vault
                    </h1>
                    <p className="text-slate-500 font-medium mt-1">Immutable activity ledger for platform governance and compliance</p>
                </div>
                <Button
                    onClick={handleExportCsv}
                    variant="secondary"
                    className="rounded-2xl font-black px-8 h-12 shadow-sm flex items-center gap-2"
                >
                    <Download size={18} />
                    Export Ledger
                </Button>
            </div>

            {/* Summary KPIs */}
            {summary && (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                    <div className="glass p-6 rounded-[2rem] premium-shadow border-indigo-100/10">
                        <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-3">Total Events</div>
                        <div className="text-3xl font-black text-slate-900 tracking-tight">{summary.totalEvents.toLocaleString()}</div>
                        <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mt-2 italic">Historical Aggregate</p>
                    </div>
                    <div className="glass p-6 rounded-[2rem] premium-shadow border-indigo-100/10">
                        <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-3">Daily Volume</div>
                        <div className="text-3xl font-black text-indigo-600 tracking-tight">{summary.today.toLocaleString()}</div>
                        <p className="text-[10px] font-black text-indigo-400 uppercase tracking-widest mt-2 italic">Events Ingested Today</p>
                    </div>
                    <div className="glass p-6 rounded-[2rem] premium-shadow border-indigo-100/10">
                        <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-3">Authentication</div>
                        <div className="text-3xl font-black text-slate-900 tracking-tight">{summary.loginEvents.toLocaleString()}</div>
                        <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mt-2 italic">Identity Verifications</p>
                    </div>
                    <div className={`glass p-6 rounded-[2rem] premium-shadow border-rose-100/20 ${summary.failedLogins > 0 ? 'bg-rose-50/30' : ''}`}>
                        <div className="text-[10px] font-black text-rose-500 uppercase tracking-widest mb-3 flex items-center gap-2">
                            <AlertTriangle size={12} strokeWidth={3} /> Security Alerts
                        </div>
                        <div className={`text-3xl font-black tracking-tight ${summary.failedLogins > 0 ? 'text-rose-600' : 'text-slate-900'}`}>
                            {summary.failedLogins.toLocaleString()}
                        </div>
                        <p className={`text-[10px] font-black uppercase tracking-widest mt-2 italic ${summary.failedLogins > 0 ? 'text-rose-400' : 'text-slate-400'}`}>
                            FAILED ACCESS ATTEMPTS
                        </p>
                    </div>
                </div>
            )}

            {/* Filters */}
            <div className="glass p-6 rounded-[2.5rem] premium-shadow border-indigo-100/10 space-y-6">
                <div className="flex items-center gap-2 text-[11px] font-black text-slate-400 uppercase tracking-widest">
                    <Filter size={14} /> Vault Inspection Filters
                </div>
                <div className="flex flex-wrap gap-4">
                    <div className="relative flex-1 min-w-[280px] group">
                        <Search size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-indigo-500 transition-colors" />
                        <input
                            type="text"
                            placeholder="Universal search by user, entity or event hash..."
                            value={search}
                            onChange={e => setSearch(e.target.value)}
                            className="w-full pl-12 pr-4 h-12 text-sm font-bold border-slate-200/50 rounded-2xl focus:outline-none focus:ring-4 focus:ring-indigo-500/10 bg-white"
                        />
                    </div>
                    <div className="flex flex-wrap gap-3">
                        <select
                            value={action}
                            onChange={e => setAction(e.target.value)}
                            className="px-5 h-12 text-[11px] font-black uppercase tracking-widest border border-slate-200/50 rounded-2xl focus:ring-4 focus:ring-indigo-500/10 bg-white cursor-pointer"
                        >
                            {ACTIONS.map(a => <option key={a} value={a}>{a === 'All' ? 'All Actions' : a}</option>)}
                        </select>
                        <select
                            value={entity}
                            onChange={e => setEntity(e.target.value)}
                            className="px-5 h-12 text-[11px] font-black uppercase tracking-widest border border-slate-200/50 rounded-2xl focus:ring-4 focus:ring-indigo-500/10 bg-white cursor-pointer"
                        >
                            {ENTITIES.map(e => <option key={e} value={e}>{e === 'All' ? 'All Types' : e}</option>)}
                        </select>
                        <div className="flex gap-2">
                            <input
                                type="date"
                                value={from}
                                onChange={e => setFrom(e.target.value)}
                                className="px-4 h-12 text-xs font-bold border border-slate-200/50 rounded-2xl focus:ring-4 focus:ring-indigo-500/10 bg-white"
                                title="From date"
                            />
                            <input
                                type="date"
                                value={to}
                                onChange={e => setTo(e.target.value)}
                                className="px-4 h-12 text-xs font-bold border border-slate-200/50 rounded-2xl focus:ring-4 focus:ring-indigo-500/10 bg-white"
                                title="To date"
                            />
                        </div>
                    </div>
                </div>
            </div>

            {/* Log Register */}
            <div className="glass rounded-[2.5rem] premium-shadow border-indigo-100/10 overflow-hidden">
                <div className="px-8 py-5 border-b border-slate-100/50 flex items-center justify-between bg-slate-50/30">
                    <span className="text-[11px] font-black text-slate-400 uppercase tracking-widest">
                        {meta ? `${meta.total.toLocaleString()} Registry Entries` : 'Accessing Vault...'}
                    </span>
                    {meta && meta.pages > 1 && (
                        <span className="text-[10px] font-black text-indigo-400 uppercase tracking-widest bg-white px-3 py-1 rounded-full shadow-sm">
                            Block {meta.page} of {meta.pages}
                        </span>
                    )}
                </div>

                {loading ? (
                    <div className="divide-y divide-slate-100/30">
                        {Array.from({ length: 8 }).map((_, i) => (
                            <div key={i} className="px-8 py-6 h-20 bg-slate-50/20 animate-pulse" />
                        ))}
                    </div>
                ) : filtered.length === 0 ? (
                    <div className="py-32 text-center">
                        <Activity size={48} strokeWidth={1} className="mx-auto text-slate-200 mb-4" />
                        <h2 className="text-xl font-black text-slate-900 tracking-tight">Vault Query Empty</h2>
                        <p className="text-xs font-black text-slate-400 uppercase tracking-widest mt-1">No historical events match the specified criteria.</p>
                    </div>
                ) : (
                    <div className="divide-y divide-slate-100/50">
                        {filtered.map(log => {
                            const am = ACTION_META[log.action] || ACTION_META.UPDATE;
                            const Icon = am.icon;
                            const isExpanded = expanded === log.id;
                            const evt = getEventLabel(log);
                            const isSecurityAlert = log.metadata?.event?.includes('FAILED') ||
                                log.metadata?.event?.includes('SUSPENDED') ||
                                log.metadata?.event?.includes('PROMOTED');

                            return (
                                <div
                                    key={log.id}
                                    className={`px-8 py-5 hover:bg-slate-50/50 cursor-pointer transition-all duration-300 relative group ${isSecurityAlert ? 'bg-rose-50/10' : ''}`}
                                    onClick={() => setExpanded(isExpanded ? null : log.id)}
                                >
                                    {isSecurityAlert && <div className="absolute left-0 top-0 w-1 h-full bg-rose-500" />}

                                    <div className="flex items-start gap-6 relative">
                                        {/* Action Icon Cluster */}
                                        <div className={`w-12 h-12 rounded-2xl flex items-center justify-center border flex-shrink-0 transition-all ${am.bg} ${am.color} group-hover:scale-110`}>
                                            <Icon size={18} />
                                        </div>

                                        {/* Content Cluster */}
                                        <div className="flex-1 min-w-0">
                                            <div className="flex items-center gap-3 flex-wrap">
                                                <span className={`text-base font-black tracking-tight ${getEventColor(log)} transition-colors`}>
                                                    {evt}
                                                </span>
                                                <span className="flex items-center gap-1 text-[10px] font-black text-slate-300 uppercase tracking-widest bg-slate-100 px-2 py-0.5 rounded-full">
                                                    Target: {log.entity}
                                                </span>
                                            </div>

                                            <div className="flex gap-6 mt-2 text-[11px] font-bold text-slate-500 flex-wrap">
                                                <span className="flex items-center gap-2 group/user">
                                                    <Users size={13} className="text-slate-300" />
                                                    <span className="group-hover/user:text-indigo-600 transition-colors">{log.user?.email || log.userId}</span>
                                                    {log.user?.role && <span className="px-2 py-0.5 bg-slate-950 text-white rounded-lg text-[8px] font-black uppercase tracking-tighter">{log.user.role}</span>}
                                                </span>
                                                <span className="flex items-center gap-2">
                                                    <Calendar size={13} className="text-slate-300" />
                                                    {new Date(log.createdAt).toLocaleString()}
                                                </span>
                                                <span className="font-mono text-[10px] text-slate-300 bg-slate-50 px-2 rounded-lg border border-slate-100 uppercase">
                                                    UUID: {log.entityId?.slice(0, 12)}
                                                </span>
                                            </div>

                                            {/* Advanced Payload Exposure */}
                                            {isExpanded && log.metadata && (
                                                <div className="mt-5 p-5 glass rounded-3xl border border-indigo-100/10 bg-slate-950/90 text-indigo-400 font-mono text-xs overflow-hidden relative shadow-2xl animate-in fade-in slide-in-from-top-2 duration-300">
                                                    <div className="absolute top-0 right-0 p-3 opacity-20"><Fingerprint size={48} /></div>
                                                    <p className="text-[9px] uppercase font-black tracking-[0.2em] mb-4 text-indigo-200/50">Cryptographic Metadata Payload</p>
                                                    <pre className="whitespace-pre-wrap leading-relaxed">
                                                        {JSON.stringify(log.metadata, null, 2)}
                                                    </pre>
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}

                {/* Secure Pagination */}
                {meta && meta.pages > 1 && (
                    <div className="px-8 py-6 border-t border-slate-100/50 flex items-center justify-between bg-slate-50/20">
                        <Button
                            onClick={() => { const p = Math.max(1, page - 1); setPage(p); fetchLogs(p); }}
                            disabled={page === 1}
                            variant="secondary"
                            className="rounded-2xl font-black text-[10px] uppercase tracking-widest h-11 px-6 shadow-sm disabled:opacity-30"
                        >
                            <ChevronLeft size={16} className="mr-2" /> Prev Block
                        </Button>
                        <span className="text-[11px] font-black text-slate-400 uppercase tracking-widest italic">
                            Viewing block {((page - 1) * meta.pageSize) + 1}–{Math.min(page * meta.pageSize, meta.total)} of {meta.total.toLocaleString()}
                        </span>
                        <Button
                            onClick={() => { const p = Math.min(meta.pages, page + 1); setPage(p); fetchLogs(p); }}
                            disabled={page === meta.pages}
                            variant="secondary"
                            className="rounded-2xl font-black text-[10px] uppercase tracking-widest h-11 px-6 shadow-sm disabled:opacity-30"
                        >
                            Next Block <ChevronRight size={16} className="ml-2" />
                        </Button>
                    </div>
                )}
            </div>
        </div>
    );
}
