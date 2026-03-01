"use client";

import { useEffect, useState, useCallback } from 'react';
import api from '@/lib/api';
import { useToast } from '@/components/ui/toast';
import {
    Shield, Search, Download, LogIn, LogOut, RefreshCcw,
    FileText, Users, Building2, CreditCard, ChevronLeft, ChevronRight,
    AlertTriangle, CheckCircle, XCircle, Info, Calendar, Filter
} from 'lucide-react';

const ACTION_META: Record<string, { color: string; bg: string; icon: any; label: string }> = {
    LOGIN: { color: 'text-blue-700', bg: 'bg-blue-50 border-blue-100', icon: LogIn, label: 'Auth' },
    CREATE: { color: 'text-emerald-700', bg: 'bg-emerald-50 border-emerald-100', icon: CheckCircle, label: 'Create' },
    UPDATE: { color: 'text-amber-700', bg: 'bg-amber-50 border-amber-100', icon: RefreshCcw, label: 'Update' },
    DELETE: { color: 'text-red-700', bg: 'bg-red-50 border-red-100', icon: XCircle, label: 'Delete' },
};

const EVENT_COLORS: Record<string, string> = {
    LOGIN_SUCCESS: 'text-emerald-600',
    MFA_SUCCESS: 'text-emerald-600',
    MFA_ENABLED: 'text-emerald-600',
    LOGIN_FAILED: 'text-red-600 font-semibold',
    MFA_FAILED: 'text-red-600 font-semibold',
    LOGIN_CHALLENGE_ISSUED: 'text-amber-600',
    TENANT_SUSPENDED: 'text-red-600',
    TENANT_SOFT_DELETED: 'text-red-600',
    PROMOTED_TO_SUPERADMIN: 'text-purple-600 font-semibold',
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
            a.download = `audit-log-${new Date().toISOString().slice(0, 10)}.csv`;
            a.click();
            window.URL.revokeObjectURL(url);
            showToast('Audit log exported', 'success');
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
        <div className="space-y-6">
            {/* Header */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                    <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
                        <Shield size={24} className="text-slate-400" /> Audit Trail
                    </h1>
                    <p className="text-sm text-slate-500 mt-0.5">Complete activity log for compliance and security review</p>
                </div>
                <button
                    onClick={handleExportCsv}
                    className="flex items-center gap-2 px-4 py-2 text-sm font-semibold bg-slate-900 text-white rounded-lg hover:bg-slate-700 transition-colors flex-shrink-0"
                >
                    <Download size={15} /> Export CSV
                </button>
            </div>

            {/* Summary KPIs */}
            {summary && (
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                    <div className="bg-white rounded-xl border border-slate-100 shadow-sm p-5">
                        <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Total Events</div>
                        <div className="text-3xl font-bold text-slate-900">{summary.totalEvents.toLocaleString()}</div>
                        <div className="text-xs text-slate-400 mt-1">All time</div>
                    </div>
                    <div className="bg-white rounded-xl border border-slate-100 shadow-sm p-5">
                        <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Today</div>
                        <div className="text-3xl font-bold text-blue-600">{summary.today.toLocaleString()}</div>
                        <div className="text-xs text-slate-400 mt-1">Events today</div>
                    </div>
                    <div className="bg-white rounded-xl border border-slate-100 shadow-sm p-5">
                        <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Auth Events</div>
                        <div className="text-3xl font-bold text-slate-900">{summary.loginEvents.toLocaleString()}</div>
                        <div className="text-xs text-slate-400 mt-1">Login attempts</div>
                    </div>
                    <div className="bg-white rounded-xl border border-emerald-100 shadow-sm p-5 bg-gradient-to-br from-white to-red-50">
                        <div className="text-xs font-semibold text-red-500 uppercase tracking-wider mb-2">Failed Logins</div>
                        <div className={`text-3xl font-bold ${summary.failedLogins > 0 ? 'text-red-600' : 'text-slate-900'}`}>
                            {summary.failedLogins.toLocaleString()}
                        </div>
                        {summary.failedLogins > 0 && (
                            <div className="text-xs text-red-500 mt-1 flex items-center gap-1">
                                <AlertTriangle size={10} /> Security alert
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* Filters */}
            <div className="bg-white border border-slate-100 rounded-xl p-4 space-y-3 shadow-sm">
                <div className="flex items-center gap-2 text-sm font-semibold text-slate-600">
                    <Filter size={14} /> Filters
                </div>
                <div className="flex flex-wrap gap-3">
                    <div className="relative flex-1 min-w-48">
                        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                        <input
                            type="text"
                            placeholder="Search user, entity, event..."
                            value={search}
                            onChange={e => setSearch(e.target.value)}
                            className="w-full pl-8 pr-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                        />
                    </div>
                    <select
                        value={action}
                        onChange={e => setAction(e.target.value)}
                        className="px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                    >
                        {ACTIONS.map(a => <option key={a} value={a}>{a === 'All' ? 'All Actions' : a}</option>)}
                    </select>
                    <select
                        value={entity}
                        onChange={e => setEntity(e.target.value)}
                        className="px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                    >
                        {ENTITIES.map(e => <option key={e} value={e}>{e === 'All' ? 'All Types' : e}</option>)}
                    </select>
                    <input
                        type="date"
                        value={from}
                        onChange={e => setFrom(e.target.value)}
                        className="px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                        title="From date"
                    />
                    <input
                        type="date"
                        value={to}
                        onChange={e => setTo(e.target.value)}
                        className="px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                        title="To date"
                    />
                    {(from || to || action !== 'All' || entity !== 'All') && (
                        <button
                            onClick={() => { setFrom(''); setTo(''); setAction('All'); setEntity('All'); }}
                            className="px-3 py-2 text-xs font-medium text-slate-500 border border-slate-200 rounded-lg hover:bg-slate-50"
                        >
                            Clear
                        </button>
                    )}
                </div>
            </div>

            {/* Log Table */}
            <div className="bg-white rounded-xl border border-slate-100 shadow-sm overflow-hidden">
                <div className="px-5 py-3.5 border-b border-slate-100 flex items-center justify-between">
                    <span className="text-sm font-semibold text-slate-700">
                        {meta ? `${meta.total.toLocaleString()} events` : 'Loading...'}
                    </span>
                    {meta && meta.pages > 1 && (
                        <span className="text-xs text-slate-400">
                            Page {meta.page} of {meta.pages}
                        </span>
                    )}
                </div>

                {loading ? (
                    <div className="divide-y divide-slate-50">
                        {Array.from({ length: 8 }).map((_, i) => (
                            <div key={i} className="px-5 py-4 flex gap-3 animate-pulse">
                                <div className="w-20 h-6 bg-slate-100 rounded-full" />
                                <div className="flex-1 space-y-2">
                                    <div className="h-4 bg-slate-100 rounded w-1/3" />
                                    <div className="h-3 bg-slate-50 rounded w-1/4" />
                                </div>
                            </div>
                        ))}
                    </div>
                ) : filtered.length === 0 ? (
                    <div className="py-20 text-center">
                        <Shield size={36} className="mx-auto text-slate-200 mb-3" />
                        <p className="text-slate-400">No audit events found</p>
                    </div>
                ) : (
                    <div className="divide-y divide-slate-50">
                        {filtered.map(log => {
                            const am = ACTION_META[log.action] || ACTION_META.UPDATE;
                            const Icon = am.icon;
                            const isExpanded = expanded === log.id;
                            const evt = getEventLabel(log);
                            const isSecurity = log.metadata?.event?.includes('FAILED') ||
                                log.metadata?.event?.includes('SUSPENDED') ||
                                log.metadata?.event?.includes('PROMOTED');

                            return (
                                <div
                                    key={log.id}
                                    className={`px-5 py-3.5 hover:bg-slate-50 cursor-pointer transition-colors ${isSecurity ? 'border-l-2 border-red-300' : ''}`}
                                    onClick={() => setExpanded(isExpanded ? null : log.id)}
                                >
                                    <div className="flex items-start gap-3">
                                        {/* Action badge */}
                                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 text-xs font-bold rounded-full border flex-shrink-0 mt-0.5 ${am.bg} ${am.color}`}>
                                            <Icon size={10} />
                                            {log.action}
                                        </span>

                                        {/* Content */}
                                        <div className="flex-1 min-w-0">
                                            <div className="flex items-center gap-2 flex-wrap">
                                                <span className={`text-sm font-semibold ${getEventColor(log)}`}>
                                                    {evt}
                                                </span>
                                                <span className="text-xs text-slate-400">
                                                    on <span className="font-medium text-slate-600">{log.entity}</span>
                                                </span>
                                                {log.metadata?.email && log.metadata.email !== log.user?.email && (
                                                    <span className="text-xs text-slate-400">
                                                        → <span className="font-medium">{log.metadata.email}</span>
                                                    </span>
                                                )}
                                            </div>
                                            <div className="flex gap-3 mt-0.5 text-xs text-slate-400 flex-wrap">
                                                <span className="flex items-center gap-1">
                                                    <Users size={10} />
                                                    {log.user?.email || log.userId}
                                                    {log.user?.role && <span className="ml-1 px-1 py-0 bg-slate-100 text-slate-500 rounded text-[9px] font-bold">{log.user.role}</span>}
                                                </span>
                                                <span className="flex items-center gap-1">
                                                    <Calendar size={10} />
                                                    {new Date(log.createdAt).toLocaleString()}
                                                </span>
                                                <span className="font-mono text-[10px] text-slate-300">{log.entityId?.slice(0, 8)}…</span>
                                            </div>

                                            {/* Expanded metadata */}
                                            {isExpanded && log.metadata && (
                                                <div className="mt-3 p-3 bg-slate-50 rounded-lg border border-slate-100">
                                                    <p className="text-[10px] uppercase font-bold text-slate-400 mb-2">Metadata</p>
                                                    <pre className="text-xs text-slate-700 whitespace-pre-wrap font-mono leading-relaxed overflow-x-auto">
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

                {/* Pagination */}
                {meta && meta.pages > 1 && (
                    <div className="px-5 py-4 border-t border-slate-100 flex items-center justify-between">
                        <button
                            onClick={() => { const p = Math.max(1, page - 1); setPage(p); fetchLogs(p); }}
                            disabled={page === 1}
                            className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-slate-600 border border-slate-200 rounded-lg hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                            <ChevronLeft size={14} /> Previous
                        </button>
                        <span className="text-sm text-slate-500">
                            {((page - 1) * meta.pageSize) + 1}–{Math.min(page * meta.pageSize, meta.total)} of {meta.total.toLocaleString()}
                        </span>
                        <button
                            onClick={() => { const p = Math.min(meta.pages, page + 1); setPage(p); fetchLogs(p); }}
                            disabled={page === meta.pages}
                            className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-slate-600 border border-slate-200 rounded-lg hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                            Next <ChevronRight size={14} />
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
}
