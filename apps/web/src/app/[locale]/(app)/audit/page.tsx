"use client";

import { useEffect, useState, useCallback } from 'react';
import { useTranslations } from 'next-intl';
import api from '@/lib/api';
import { HelpLink } from '@/components/help/HelpLink';
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

/**
 * Who did it: the user, or — when no user is joined — "Platform operator"
 * for platform staff acting in a lender's workspace (their identity is kept
 * from the lender), or a system actor's label such as "Telegram bot".
 */
function actorOf(log: AuditLog, platformLabel: string): { name: string; platform: boolean } {
    const platform = log.metadata?.platformOperator === true;
    if (log.user?.email) return { name: log.user.email, platform };
    if (platform) return { name: platformLabel, platform };
    const label = log.metadata?.newValue?.actorLabel;
    return { name: typeof label === 'string' && label ? label : log.userId, platform };
}

export default function AuditPage() {
    const ts = useTranslations('Security.audit');
    const t = useTranslations('Security.auditLog');
    const { showToast } = useToast();
    const [logs, setLogs] = useState<AuditLog[]>([]);
    const [meta, setMeta] = useState<Meta | null>(null);
    const [summary, setSummary] = useState<Summary | null>(null);
    const [loading, setLoading] = useState(true);
    const [page, setPage] = useState(1);
    const [search, setSearch] = useState('');
    // Search runs on the server over the whole log; debounce typing.
    const [query, setQuery] = useState('');
    useEffect(() => {
        const timer = setTimeout(() => setQuery(search.trim()), 350);
        return () => clearTimeout(timer);
    }, [search]);
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
            if (query) params.search = query;
            const r = await api.get('/audit-logs', { params });
            setLogs(r.data.data);
            setMeta(r.data.meta);
        } catch { showToast(t('loadFailed'), 'error'); }
        finally { setLoading(false); }
    }, [action, entity, from, to, query]);

    useEffect(() => { fetchSummary(); fetchLogs(1); setPage(1); }, [action, entity, from, to, query]);

    const handleExport = async () => {
        try {
            const params: any = {};
            if (action !== 'All') params.action = action;
            if (entity !== 'All') params.entity = entity;
            if (from) params.from = from;
            if (to) params.to = to;
            if (query) params.search = query;
            const r = await api.get('/audit-logs/export/csv', { params, responseType: 'blob' });
            const url = window.URL.createObjectURL(new Blob([r.data]));
            const a = document.createElement('a'); a.href = url;
            a.download = `audit-log-${new Date().toISOString().slice(0, 10)}.csv`;
            a.click(); window.URL.revokeObjectURL(url);
            showToast(t('exported'), 'success');
        } catch { showToast(t('exportFailed'), 'error'); }
    };

    const filtered = logs;

    return (
        <div className="max-w-6xl space-y-5">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-xl font-bold text-foreground flex items-center gap-2">
                        <Shield size={18} className="text-primary" /> {t('title')}
                    </h1>
                    <p className="text-sm text-muted-foreground mt-0.5">{t('subtitle')}</p>
                </div>
                <div className="flex items-center gap-2">
                    <HelpLink chapter="19-audit-trail" anchor="2-audit-log-risk--audit--audit-log" />
                    <button onClick={handleExport} className="btn-ghost">
                        <Download size={14} /> {t('exportCsv')}
                    </button>
                </div>
            </div>

            {/* Summary KPIs */}
            {summary && (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    {[
                        { label: t('kpiTotal'), value: summary.totalEvents.toLocaleString(), cls: 'text-foreground' },
                        { label: t('kpiToday'), value: summary.today.toLocaleString(), cls: 'text-primary' },
                        { label: t('kpiAuth'), value: summary.loginEvents.toLocaleString(), cls: 'text-foreground' },
                        { label: t('kpiFailedLogins'), value: summary.failedLogins.toLocaleString(), cls: summary.failedLogins > 0 ? 'text-destructive' : 'text-foreground' },
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
                    <Filter size={12} /> {t('filters')}
                </div>
                <div className="flex flex-wrap gap-2">
                    <div className="relative flex-1 min-w-[220px]">
                        <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                        <input
                            type="text"
                            placeholder={t('searchPlaceholder')}
                            className={`${fieldCls} w-full pl-8`}
                            value={search}
                            onChange={e => setSearch(e.target.value)}
                        />
                    </div>
                    <select value={action} onChange={e => setAction(e.target.value)} className={`${fieldCls} appearance-none`}>
                        {ACTIONS.map(a => <option key={a} value={a}>{a === 'All' ? t('allActions') : a}</option>)}
                    </select>
                    <select value={entity} onChange={e => setEntity(e.target.value)} className={`${fieldCls} appearance-none`}>
                        {ENTITIES.map(e => <option key={e} value={e}>{e === 'All' ? t('allTypes') : t(`entity.${e}`)}</option>)}
                    </select>
                    <div className="flex items-center gap-1.5">
                        <input type="date" value={from} onChange={e => setFrom(e.target.value)} className={fieldCls} title={t('fromDate')} />
                        <span className="text-muted-foreground text-xs">{t('to')}</span>
                        <input type="date" value={to} onChange={e => setTo(e.target.value)} className={fieldCls} title={t('toDate')} />
                    </div>
                </div>
            </div>

            {/* Log Table */}
            <div className="bg-white border border-border rounded-md overflow-hidden">
                <div className="px-4 py-3 border-b border-border flex items-center justify-between bg-muted/30">
                    <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                        {meta ? t('eventCount', { count: meta.total }) : t('loading')}
                    </span>
                    {meta && meta.pages > 1 && (
                        <span className="text-xs text-muted-foreground">{t('pageOf', { page: meta.page, pages: meta.pages })}</span>
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
                        <p className="text-sm font-medium text-foreground">{t('noEvents')}</p>
                        <p className="text-xs text-muted-foreground mt-1">{t('noEventsHint')}</p>
                    </div>
                ) : (
                    <div className="divide-y divide-border">
                        {filtered.map(log => {
                            const am = ACTION_META[log.action] || ACTION_META.UPDATE;
                            const Icon = am.icon;
                            const isExpanded = expanded === log.id;
                            const evt = log.metadata?.event || log.action;
                            const isAlert = evt?.includes('FAILED') || evt?.includes('SUSPENDED') || evt?.includes('PROMOTED');
                            const actor = actorOf(log, ts('platformOperator'));
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
                                                {isAlert && <span className="badge-danger text-[11px]">{t('alert')}</span>}
                                            </div>
                                            <div className="flex gap-4 mt-1 text-xs text-muted-foreground flex-wrap">
                                                <span className="flex items-center gap-1">
                                                    <Users size={11} /> {!(actor.platform && !log.user) && actor.name}
                                                    {log.user?.role && <span className="badge-neutral text-[10px] ml-1">{log.user.role}</span>}
                                                    {actor.platform && (
                                                        <span className="badge-warning text-[10px] ml-1" title={ts('platformOperatorHint')}>{ts('platformOperator')}</span>
                                                    )}
                                                </span>
                                                <span className="flex items-center gap-1">
                                                    <Calendar size={11} /> {new Date(log.createdAt).toLocaleString()}
                                                </span>
                                                <span className="text-[11px] text-muted-foreground/60">
                                                    {t('idLabel', { id: log.entityId?.slice(0, 12) ?? '' })}
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
                            <ChevronLeft size={14} /> {t('previous')}
                        </button>
                        <span className="text-xs text-muted-foreground">
                            {t('range', { from: ((page - 1) * meta.pageSize) + 1, to: Math.min(page * meta.pageSize, meta.total), total: meta.total })}
                        </span>
                        <button
                            onClick={() => { const p = Math.min(meta.pages, page + 1); setPage(p); fetchLogs(p); }}
                            disabled={page === meta.pages}
                            className="btn-ghost text-sm disabled:opacity-40"
                        >
                            {t('next')} <ChevronRight size={14} />
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
}
