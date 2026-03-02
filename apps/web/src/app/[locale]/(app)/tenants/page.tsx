"use client";

import { useEffect, useState } from 'react';
import api from '@/lib/api';
import { useToast } from '@/components/ui/toast';
import {
    Building2, Users, FileText, CreditCard, TrendingUp,
    CheckCircle, AlertTriangle, Plus, Search, MoreVertical,
    Edit2, Ban, RefreshCcw, Trash2, ChevronDown, Loader2, Calendar, ShieldCheck, Activity, Globe
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useConfirm } from '@/components/ui/confirm-dialog';

const PLANS = ['FREE', 'BASIC', 'PROFESSIONAL', 'ENTERPRISE'];
const PLAN_COLORS: Record<string, string> = {
    FREE: 'bg-slate-100 text-slate-500',
    BASIC: 'bg-indigo-100 text-indigo-700',
    PROFESSIONAL: 'bg-purple-100 text-purple-700',
    ENTERPRISE: 'bg-amber-100 text-amber-700',
};
const STATUS_COLORS: Record<string, string> = {
    ACTIVE: 'bg-emerald-100 text-emerald-700',
    SUSPENDED: 'bg-rose-100 text-rose-700',
};

interface Tenant {
    id: string;
    name: string;
    status: string;
    plan: string;
    createdAt: string;
    _count: { users: number; borrowers: number; loans: number; repayments: number; };
    performance: { disbursed: number; collected: number; };
}

interface Stats {
    totalTenants: number;
    activeTenants: number;
    suspendedTenants: number;
    totalBorrowers: number;
    totalLoans: number;
    disbursedLoans: number;
    totalRepaymentsCollected: number;
}

export default function TenantsPage() {
    const { showToast } = useToast();
    const confirm = useConfirm();
    const [stats, setStats] = useState<Stats | null>(null);
    const [tenants, setTenants] = useState<Tenant[]>([]);
    const [loading, setLoading] = useState(true);
    const [searchQuery, setSearch] = useState('');
    const [statusFilter, setStatus] = useState('ALL');
    const [isModalOpen, setModal] = useState(false);
    const [editTenant, setEdit] = useState<Tenant | null>(null);
    const [form, setForm] = useState({ name: '', plan: 'FREE' });
    const [submitting, setSub] = useState(false);
    const [menuOpen, setMenu] = useState<string | null>(null);

    const fetchAll = async () => {
        setLoading(true);
        try {
            const [statsRes, tenantsRes] = await Promise.all([
                api.get('/tenants/stats/platform'),
                api.get('/tenants'),
            ]);
            setStats(statsRes.data);
            setTenants(tenantsRes.data);
        } catch {
            showToast('Failed to load platform data', 'error');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => { fetchAll(); }, []);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setSub(true);
        try {
            if (editTenant) {
                await api.put(`/tenants/${editTenant.id}`, { name: form.name, plan: form.plan });
                showToast('Organization updated', 'success');
            } else {
                await api.post('/tenants', { name: form.name });
                showToast('Organization registered', 'success');
            }
            setModal(false);
            fetchAll();
        } catch (err: any) {
            showToast(err.response?.data?.message || 'Operation failed', 'error');
        } finally {
            setSub(false);
        }
    };

    const handleSuspend = async (t: Tenant) => {
        try {
            await api.put(`/tenants/${t.id}/suspend`);
            showToast(`${t.name} has been suspended`, 'success');
            fetchAll();
        } catch { showToast('Failed to suspend tenant', 'error'); }
        setMenu(null);
    };

    const handleActivate = async (t: Tenant) => {
        try {
            await api.put(`/tenants/${t.id}/activate`);
            showToast(`${t.name} has been activated`, 'success');
            fetchAll();
        } catch { showToast('Failed to activate tenant', 'error'); }
        setMenu(null);
    };

    const handleDelete = async (t: Tenant) => {
        const ok = await confirm({
            title: `Remove "${t.name}"?`,
            message: 'The organization will be suspended and disabled. This action cannot be undone.',
            confirmLabel: 'Remove',
            variant: 'danger',
        });
        if (!ok) return;
        try {
            await api.delete(`/tenants/${t.id}`);
            showToast(`${t.name} has been removed`, 'success');
            fetchAll();
        } catch { showToast('Cannot delete tenant with data', 'error'); }
        setMenu(null);
    };

    const handleEdit = (t: Tenant) => {
        setEdit(t);
        setForm({ name: t.name, plan: t.plan });
        setModal(true);
        setMenu(null);
    };

    const filtered = tenants.filter(t => {
        const matchSearch = t.name.toLowerCase().includes(searchQuery.toLowerCase());
        const matchStatus = statusFilter === 'ALL' || t.status === statusFilter;
        return matchSearch && matchStatus;
    });

    return (
        <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-700" onClick={() => setMenu(null)}>
            {/* Header Area */}
            <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-6">
                <div>
                    <h1 className="text-3xl font-black text-slate-900 tracking-tight flex items-center gap-3">
                        <Globe className="text-indigo-600" size={32} /> Platform Governance
                    </h1>
                    <p className="text-slate-500 font-medium mt-1">Global oversight of all tenant organizations and distributed assets</p>
                </div>
                <Button
                    onClick={() => { setEdit(null); setForm({ name: '', plan: 'FREE' }); setModal(true); }}
                    className="rounded-2xl font-black px-8 h-12 bg-slate-950 text-white hover:bg-slate-800 shadow-lg shadow-slate-950/20 transition-all hover:scale-[1.02] flex items-center gap-2"
                >
                    <Plus size={18} />
                    Register New Org
                </Button>
            </div>

            {/* Platform KPI Cards */}
            {stats && (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                    <div className="glass p-6 rounded-[2rem] premium-shadow border-indigo-100/10">
                        <div className="flex items-center justify-between mb-4">
                            <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Total Orgs</span>
                            <Building2 size={16} className="text-indigo-500" />
                        </div>
                        <div className="text-3xl font-black text-slate-900 tracking-tight">{stats.totalTenants}</div>
                        <div className="flex gap-3 mt-3">
                            <span className="text-[10px] font-black text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full">{stats.activeTenants} Active</span>
                            {stats.suspendedTenants > 0 && <span className="text-[10px] font-black text-rose-500 bg-rose-50 px-2 py-0.5 rounded-full">{stats.suspendedTenants} Suspended</span>}
                        </div>
                    </div>
                    <div className="glass p-6 rounded-[2rem] premium-shadow border-indigo-100/10">
                        <div className="flex items-center justify-between mb-4">
                            <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Global Users</span>
                            <Users size={16} className="text-purple-500" />
                        </div>
                        <div className="text-3xl font-black text-slate-900 tracking-tight">{stats.totalBorrowers.toLocaleString()}</div>
                        <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mt-3 italic">Total KYC Clients</p>
                    </div>
                    <div className="glass p-6 rounded-[2rem] premium-shadow border-indigo-100/10">
                        <div className="flex items-center justify-between mb-4">
                            <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Active Assets</span>
                            <FileText size={16} className="text-emerald-500" />
                        </div>
                        <div className="text-3xl font-black text-slate-900 tracking-tight">{stats.disbursedLoans.toLocaleString()}</div>
                        <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mt-3 italic">{stats.totalLoans} Total Issued</p>
                    </div>
                    <div className="glass p-6 rounded-[2rem] premium-shadow border-indigo-100/10">
                        <div className="flex items-center justify-between mb-4">
                            <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Platform Flow</span>
                            <TrendingUp size={16} className="text-amber-500" />
                        </div>
                        <div className="text-2xl font-black text-slate-900 tracking-tight">${Number(stats.totalRepaymentsCollected).toLocaleString()}</div>
                        <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mt-3 italic">Gross Recovery</p>
                    </div>
                </div>
            )}

            {/* Filters */}
            <div className="flex flex-col lg:flex-row gap-4 items-center">
                <div className="relative group flex-1 w-full">
                    <Search size={20} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-indigo-500 transition-colors" />
                    <input
                        type="text"
                        placeholder="Search global organizations by name, ID or domain..."
                        value={searchQuery}
                        onChange={e => setSearch(e.target.value)}
                        className="w-full pl-12 pr-4 h-14 text-sm font-medium border-slate-200/50 rounded-2xl focus:outline-none focus:ring-4 focus:ring-indigo-500/10 bg-white glass shadow-sm transition-all text-slate-900 placeholder:text-slate-400"
                    />
                </div>
                <div className="flex gap-2 p-1.5 glass bg-slate-100/50 rounded-2xl border-slate-200/50">
                    {['ALL', 'ACTIVE', 'SUSPENDED'].map(s => (
                        <button
                            key={s}
                            onClick={() => setStatus(s)}
                            className={`px-6 py-2.5 text-[10px] font-black uppercase tracking-widest rounded-xl transition-all ${statusFilter === s ? 'bg-white text-slate-950 shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}
                        >
                            {s}
                        </button>
                    ))}
                </div>
            </div>

            {/* Tenant Cards Grid */}
            {loading ? (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
                    {Array.from({ length: 3 }).map((_, i) => (
                        <div key={i} className="glass h-64 rounded-[2.5rem] bg-slate-50/50 animate-pulse" />
                    ))}
                </div>
            ) : filtered.length === 0 ? (
                <div className="glass rounded-[2.5rem] p-24 text-center premium-shadow border-slate-100/10">
                    <Building2 size={48} className="mx-auto text-slate-200 mb-4" strokeWidth={1} />
                    <h2 className="text-xl font-black text-slate-900 tracking-tight">Zero Orgs Found</h2>
                    <p className="text-slate-400 font-medium mt-1 uppercase tracking-widest text-[10px]">Adjust your filters or register a new environment</p>
                </div>
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
                    {filtered.map(tenant => (
                        <div
                            key={tenant.id}
                            className={`glass p-8 rounded-[2.5rem] premium-shadow relative overflow-hidden transition-all duration-500 hover:-translate-y-1 group ${tenant.status === 'SUSPENDED' ? 'border-rose-100/50' : 'border-indigo-100/10'}`}
                        >
                            <div className="absolute top-0 right-0 w-24 h-24 bg-slate-500/5 rounded-full -mr-10 -mt-10" />

                            <div className="flex items-start justify-between mb-6">
                                <div className="flex items-center gap-4">
                                    <div className={`w-14 h-14 rounded-2xl flex items-center justify-center text-xl font-black shadow-sm transition-all ${tenant.status === 'SUSPENDED' ? 'bg-rose-100 text-rose-600' : 'bg-indigo-600 text-white group-hover:bg-indigo-700'}`}>
                                        {tenant.name.charAt(0).toUpperCase()}
                                    </div>
                                    <div className="min-w-0">
                                        <h3 className="text-xl font-black text-slate-900 tracking-tight truncate max-w-[150px]">{tenant.name}</h3>
                                        <div className="flex gap-2 mt-1.5">
                                            <span className={`px-2.5 py-0.5 text-[9px] font-black uppercase tracking-widest rounded-full shadow-sm ${STATUS_COLORS[tenant.status] || 'bg-gray-100 text-gray-600'}`}>
                                                {tenant.status}
                                            </span>
                                            <span className={`px-2.5 py-0.5 text-[9px] font-black uppercase tracking-widest rounded-full shadow-sm ${PLAN_COLORS[tenant.plan] || 'bg-gray-100 text-gray-600'}`}>
                                                {tenant.plan}
                                            </span>
                                        </div>
                                    </div>
                                </div>
                                <div className="relative flex-shrink-0">
                                    <button
                                        onClick={(e) => { e.stopPropagation(); setMenu(menuOpen === tenant.id ? null : tenant.id); }}
                                        className="w-10 h-10 rounded-2xl bg-slate-50 flex items-center justify-center text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-all border border-slate-100"
                                    >
                                        <MoreVertical size={18} />
                                    </button>
                                    {menuOpen === tenant.id && (
                                        <div className="absolute right-0 top-12 bg-white border border-slate-100 rounded-2xl shadow-2xl z-20 w-52 py-2 text-xs font-bold animate-in fade-in zoom-in duration-200">
                                            <button onClick={() => handleEdit(tenant)} className="w-full text-left px-5 py-3 hover:bg-slate-50 flex items-center gap-3 text-slate-700">
                                                <Edit2 size={14} /> Edit Org Logic
                                            </button>
                                            {tenant.status === 'ACTIVE' ? (
                                                <button onClick={() => handleSuspend(tenant)} className="w-full text-left px-5 py-3 hover:bg-rose-50 flex items-center gap-3 text-rose-600">
                                                    <Ban size={14} /> Suspend Instance
                                                </button>
                                            ) : (
                                                <button onClick={() => handleActivate(tenant)} className="w-full text-left px-5 py-3 hover:bg-emerald-50 flex items-center gap-3 text-emerald-600">
                                                    <RefreshCcw size={14} /> Reactivate Data
                                                </button>
                                            )}
                                            <hr className="my-2 border-slate-100" />
                                            <button onClick={() => handleDelete(tenant)} className="w-full text-left px-5 py-3 hover:bg-rose-50 flex items-center gap-3 text-rose-500">
                                                <Trash2 size={14} /> Purge Environment
                                            </button>
                                        </div>
                                    )}
                                </div>
                            </div>

                            {/* Stats Grid */}
                            <div className="grid grid-cols-2 gap-4 bg-slate-50/50 p-6 rounded-3xl border border-slate-100/50">
                                <div>
                                    <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1.5 flex items-center gap-1.5">
                                        <Users size={10} /> Client Base
                                    </p>
                                    <p className="font-black text-slate-800 text-lg tracking-tight">{tenant._count.borrowers}</p>
                                </div>
                                <div className="border-l border-slate-200/50 pl-4">
                                    <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1.5 flex items-center gap-1.5">
                                        <TrendingUp size={10} /> Gross Volume
                                    </p>
                                    <p className="font-black text-indigo-600 text-lg tracking-tight">${(tenant.performance?.disbursed || 0).toLocaleString()}</p>
                                </div>
                            </div>

                            <div className="flex items-center justify-between mt-6 px-1">
                                <div className="flex items-center gap-2">
                                    <Calendar size={12} className="text-slate-300" />
                                    <span className="text-[10px] font-bold text-slate-400">Joined {new Date(tenant.createdAt).toLocaleDateString()}</span>
                                </div>
                                <div className="flex items-center gap-1.5 text-emerald-600 font-black text-[10px] uppercase tracking-widest bg-emerald-50 px-2 py-0.5 rounded-full">
                                    <Activity size={10} /> ${(tenant.performance?.collected || 0).toLocaleString()}
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {/* Modal */}
            <Dialog open={isModalOpen} onOpenChange={setModal}>
                <DialogContent className="rounded-[2rem] border-none shadow-2xl glass p-8">
                    <DialogHeader>
                        <DialogTitle className="text-2xl font-black text-slate-900 tracking-tight">{editTenant ? 'Re-Engineer Organization' : 'Provision Isolated Environment'}</DialogTitle>
                        <DialogDescription className="text-slate-500 font-medium">
                            {editTenant ? 'Direct modification of organization parameters and logic tier.' : 'Deploy a new cryptographically isolated environment for a financial entity.'}
                        </DialogDescription>
                    </DialogHeader>
                    <form onSubmit={handleSubmit} className="space-y-6 pt-6">
                        <div className="space-y-3">
                            <Label htmlFor="org-name" className="text-[11px] font-black text-slate-500 uppercase tracking-widest ml-1">Entity Branding Name</Label>
                            <Input
                                id="org-name"
                                required
                                placeholder="e.g. Sunrise Global Microfinance"
                                value={form.name}
                                onChange={e => setForm({ ...form, name: e.target.value })}
                                className="h-14 rounded-2xl border-slate-200/50 focus:ring-4 focus:ring-indigo-500/10 font-bold px-5"
                            />
                        </div>
                        {editTenant && (
                            <div className="space-y-3">
                                <Label htmlFor="org-plan" className="text-[11px] font-black text-slate-500 uppercase tracking-widest ml-1">Subscription Matrix</Label>
                                <div className="relative">
                                    <select
                                        id="org-plan"
                                        value={form.plan}
                                        onChange={e => setForm({ ...form, plan: e.target.value })}
                                        className="w-full h-14 pl-5 pr-10 appearance-none text-sm font-black border border-slate-200/50 rounded-2xl focus:outline-none focus:ring-4 focus:ring-indigo-500/10 bg-white"
                                    >
                                        {PLANS.map(p => <option key={p} value={p}>{p}</option>)}
                                    </select>
                                    <ChevronDown className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" size={18} />
                                </div>
                            </div>
                        )}
                        <div className="flex flex-col gap-3 pt-4">
                            <Button type="submit" disabled={submitting} className="h-14 bg-indigo-600 hover:bg-indigo-700 text-white rounded-2xl font-black text-xs uppercase tracking-widest shadow-lg shadow-indigo-600/20">
                                {submitting && <Loader2 size={16} className="animate-spin mr-3" />}
                                {submitting ? 'Proccessing...' : (editTenant ? 'Update Logic Matrix' : 'Deploy environment')}
                            </Button>
                            <Button type="button" variant="ghost" onClick={() => setModal(false)} className="h-12 rounded-2xl font-bold text-slate-400 hover:text-slate-600">Dismiss</Button>
                        </div>
                    </form>
                </DialogContent>
            </Dialog>
        </div>
    );
}
