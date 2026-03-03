"use client";

import { useEffect, useState, useCallback } from 'react';
import api from '@/lib/api';
import { useToast } from '@/components/ui/toast';
import {
    Shield, Search, Download, LogIn, RefreshCcw,
    Users, Calendar, ChevronLeft, ChevronRight,
    AlertTriangle, CheckCircle, XCircle, Filter, Activity, Info
} from 'lucide-react';

const ACTION_META: Record<string, { color: string; bg: string; icon: any; }> = {
    LOGIN: { color: 'text-primary', bg: 'bg-primary/10', icon: LogIn },
    CREATE: { color: 'text-[#006644]', bg: 'bg-[#E3FCEF]', icon: CheckCircle },
    UPDATE: { color: 'text-[#974F0C]', bg: 'bg-[#FFFAE6]', icon: RefreshCcw },
    DELETE: { color: 'text-destructive', bg: 'bg-destructive/10', icon: XCircle },
};

const ENTITIES = ['All', 'User', 'Borrower', 'Loan', 'Repayment', 'Document', 'Tenant', 'LoanProduct'];
const ACTIONS = ['All', 'LOGIN', 'CREATE', 'UPDATE', 'DELETE'];

interface AuditLog {
    id: string; action: string; entity: string; entityId: string;
    userId: string; createdAt: string; metadata?: any;
    user?: { email: string; role: string };
}
interface Meta { total: number; page: number; pageSize: number; pages: number; }
interface Summary { totalEvents: number; loginEvents: number; failedLogins: number; today: number; }

const fieldCls = "h-9 px-3 bg-white border border-border rounded text-sm text-foreground focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 transition-colors";

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
        try { const r = await api.get('/audit-logs/summary'); setSummary(r.data); } catch { }
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
        } catch { showToast('Failed to load audit logs', 'error'); }
        finally { setLoading(false); }
    }, [action, entity, from, to]);

    useEffect(() => { fetchSummary(); fetchLogs(1); setPage(1); }, [action, entity, from, to]);

    const handleExport = async () => {
        try {
            const params: any = {};
            if (action !== 'All') params.action = action;
            if (entity !== 'All') params.entity = entity;
            if (from) params.from = from;
            if (to) params.to = to;
            const r = await api.get('/audit-logs/export/csv', { params, responseType: 'blob' });
            const url = window.URL.createObjectURL(new Blob([r.data]));
            const a = document.createElement('a'); a.href = url;
            a.download = `audit-log-${new Date().toISOString().slice(0, 10)}.csv`;
            a.click(); window.URL.revokeObjectURL(url);
            showToast('Audit log exported', 'success');
        } catch { showToast('Export failed', 'error'); }
    };

    const filtered = search
        ? logs.filter(l =>
            (l.user?.email || l.userId).toLowerCase().includes(search.toLowerCase()) ||
            l.entity.toLowerCase().includes(search.toLowerCase()) ||
            l.action.toLowerCase().includes(search.toLowerCase()) ||
            JSON.stringify(l.metadata || {}).toLowerCase().includes(search.toLowerCase())
        )
        : logs;

    return (
        <div className="max-w-6xl space-y-5">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-xl font-bold text-foreground flex items-center gap-2">
                        <Shield size={18} className="text-primary" /> Audit Log
                    </h1>
                    <p className="text-sm text-muted-foreground mt-0.5">Immutable activity log for compliance and security.</p>
                </div>
                <button onClick={handleExport} className="btn-ghost">
                    <Download size={14} /> Export CSV
                </button>
            </div>

            {/* Summary KPIs */}
            {summary && (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    {[
                        { label: 'Total Events', value: summary.totalEvents.toLocaleString(), cls: 'text-foreground' },
                        { label: 'Today', value: summary.today.toLocaleString(), cls: 'text-primary' },
                        { label: 'Auth Events', value: summary.loginEvents.toLocaleString(), cls: 'text-foreground' },
                        { label: 'Failed Logins', value: summary.failedLogins.toLocaleString(), cls: summary.failedLogins > 0 ? 'text-destructive' : 'text-foreground' },
                    ].map(kpi => (
                        <div key={kpi.label} className="bg-white border border-border rounded-md px-4 py-3">
                            <p className="text-xs text-muted-foreground mb-1">{kpi.label}</p>
                            <p className={`text-xl font-bold ${kpi.cls}`}>{kpi.value}</p>
                        </div>
                    ))}
                </div>
            )}

            {/* Filters */}
            <div className="bg-white border border-border rounded-md p-4">
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground font-semibold uppercase tracking-wide mb-3">
                    <Filter size={12} /> Filters
                </div>
                <div className="flex flex-wrap gap-2">
                    <div className="relative flex-1 min-w-[220px]">
                        <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                        <input
                            type="text"
                            placeholder="Search by user, entity, action..."
                            className={`${fieldCls} w-full pl-8`}
                            value={search}
                            onChange={e => setSearch(e.target.value)}
                        />
                    </div>
                    <select value={action} onChange={e => setAction(e.target.value)} className={`${fieldCls} appearance-none`}>
                        {ACTIONS.map(a => <option key={a} value={a}>{a === 'All' ? 'All Actions' : a}</option>)}
                    </select>
                    <select value={entity} onChange={e => setEntity(e.target.value)} className={`${fieldCls} appearance-none`}>
                        {ENTITIES.map(e => <option key={e} value={e}>{e === 'All' ? 'All Types' : e}</option>)}
                    </select>
                    <div className="flex items-center gap-1.5">
                        <input type="date" value={from} onChange={e => setFrom(e.target.value)} className={fieldCls} title="From date" />
                        <span className="text-muted-foreground text-xs">to</span>
                        <input type="date" value={to} onChange={e => setTo(e.target.value)} className={fieldCls} title="To date" />
                    </div>
                </div>
            </div>

            {/* Log Table */}
            <div className="bg-white border border-border rounded-md overflow-hidden">
                <div className="px-4 py-3 border-b border-border flex items-center justify-between bg-muted/30">
                    <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                        {meta ? `${meta.total.toLocaleString()} events` : 'Loading...'}
                    </span>
                    {meta && meta.pages > 1 && (
                        <span className="text-xs text-muted-foreground">Page {meta.page} of {meta.pages}</span>
                    )}
                </div>

                {loading ? (
                    <div className="divide-y divide-border">
                        {Array.from({ length: 8 }).map((_, i) => (
                            <div key={i} className="px-4 py-4 h-16 bg-muted/20 animate-pulse" />
                        ))}
                    </div>
                ) : filtered.length === 0 ? (
                    <div className="py-20 text-center">
                        <Activity size={32} className="mx-auto text-muted-foreground/30 mb-3" />
                        <p className="text-sm font-medium text-foreground">No events found</p>
                        <p className="text-xs text-muted-foreground mt-1">Try adjusting your filters.</p>
                    </div>
                ) : (
                    <div className="divide-y divide-border">
                        {filtered.map(log => {
                            const am = ACTION_META[log.action] || ACTION_META.UPDATE;
                            const Icon = am.icon;
                            const isExpanded = expanded === log.id;
                            const evt = log.metadata?.event || log.action;
                            const isAlert = evt?.includes('FAILED') || evt?.includes('SUSPENDED') || evt?.includes('PROMOTED');
                            return (
                                <div
                                    key={log.id}
                                    className={`px-4 py-3 hover:bg-muted/30 cursor-pointer transition-colors relative ${isAlert ? 'border-l-2 border-l-destructive' : ''}`}
                                    onClick={() => setExpanded(isExpanded ? null : log.id)}
                                >
                                    <div className="flex items-start gap-3">
                                        <div className={`w-8 h-8 rounded flex items-center justify-center flex-shrink-0 ${am.bg} ${am.color}`}>
                                            <Icon size={14} />
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <div className="flex items-center gap-2 flex-wrap">
                                                <span className={`text-sm font-semibold ${am.color}`}>{evt}</span>
                                                <span className="badge-neutral text-[11px]">{log.entity}</span>
                                                {isAlert && <span className="badge-danger text-[11px]">Alert</span>}
                                            </div>
                                            <div className="flex gap-4 mt-1 text-xs text-muted-foreground flex-wrap">
                                                <span className="flex items-center gap-1">
                                                    <Users size={11} /> {log.user?.email || log.userId}
                                                    {log.user?.role && <span className="badge-neutral text-[10px] ml-1">{log.user.role}</span>}
                                                </span>
                                                <span className="flex items-center gap-1">
                                                    <Calendar size={11} /> {new Date(log.createdAt).toLocaleString()}
                                                </span>
                                                <span className="text-[11px] text-muted-foreground/60">
                                                    ID: {log.entityId?.slice(0, 12)}
                                                </span>
                                            </div>
                                            {isExpanded && log.metadata && (
                                                <div className="mt-3 p-3 bg-muted rounded border border-border text-xs text-foreground overflow-auto max-h-40">
                                                    <pre className="whitespace-pre-wrap">{JSON.stringify(log.metadata, null, 2)}</pre>
                                                </div>
                                            )}
                                        </div>
                                        <Info size={14} className="text-muted-foreground/40 flex-shrink-0 mt-0.5" />
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}

                {/* Pagination */}
                {meta && meta.pages > 1 && (
                    <div className="px-4 py-3 border-t border-border flex items-center justify-between bg-muted/30">
                        <button
                            onClick={() => { const p = Math.max(1, page - 1); setPage(p); fetchLogs(p); }}
                            disabled={page === 1}
                            className="btn-ghost text-sm disabled:opacity-40"
                        >
                            <ChevronLeft size={14} /> Previous
                        </button>
                        <span className="text-xs text-muted-foreground">
                            {((page - 1) * meta.pageSize) + 1}–{Math.min(page * meta.pageSize, meta.total)} of {meta.total.toLocaleString()}
                        </span>
                        <button
                            onClick={() => { const p = Math.min(meta.pages, page + 1); setPage(p); fetchLogs(p); }}
                            disabled={page === meta.pages}
                            className="btn-ghost text-sm disabled:opacity-40"
                        >
                            Next <ChevronRight size={14} />
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
}
