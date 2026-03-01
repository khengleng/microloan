"use client";

import { useEffect, useState } from 'react';
import api from '@/lib/api';
import { useToast } from '@/components/ui/toast';
import {
    Building2, Users, FileText, CreditCard, TrendingUp,
    CheckCircle, AlertTriangle, Plus, Search, MoreVertical,
    Edit2, Ban, RefreshCcw, Trash2, ChevronDown, Loader2, Calendar
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useConfirm } from '@/components/ui/confirm-dialog';

const PLANS = ['FREE', 'BASIC', 'PROFESSIONAL', 'ENTERPRISE'];
const PLAN_COLORS: Record<string, string> = {
    FREE: 'bg-slate-100 text-slate-600',
    BASIC: 'bg-blue-100 text-blue-700',
    PROFESSIONAL: 'bg-purple-100 text-purple-700',
    ENTERPRISE: 'bg-amber-100 text-amber-700',
};
const STATUS_COLORS: Record<string, string> = {
    ACTIVE: 'bg-emerald-100 text-emerald-700',
    SUSPENDED: 'bg-red-100 text-red-700',
};

interface Tenant {
    id: string;
    name: string;
    status: string;
    plan: string;
    createdAt: string;
    _count: { users: number; borrowers: number; loans: number; repayments: number; };
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
        <div className="space-y-6" onClick={() => setMenu(null)}>
            {/* Header */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                    <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
                        <Building2 size={24} className="text-slate-400" /> Platform Management
                    </h1>
                    <p className="text-sm text-slate-500 mt-0.5">Manage all tenant organizations on Magic Money</p>
                </div>
                <Button
                    onClick={() => { setEdit(null); setForm({ name: '', plan: 'FREE' }); setModal(true); }}
                    className="flex items-center gap-2 bg-slate-900 hover:bg-slate-700 flex-shrink-0"
                >
                    <Plus size={15} /> Register Organization
                </Button>
            </div>

            {/* Platform KPI Cards */}
            {stats && (
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                    <div className="bg-white rounded-xl border border-slate-100 shadow-sm p-5">
                        <div className="flex items-center justify-between mb-3">
                            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Organizations</span>
                            <Building2 size={16} className="text-blue-400" />
                        </div>
                        <div className="text-3xl font-bold text-slate-900">{stats.totalTenants}</div>
                        <div className="flex gap-2 mt-2 text-xs">
                            <span className="text-emerald-600 font-medium">{stats.activeTenants} active</span>
                            {stats.suspendedTenants > 0 && <span className="text-red-500 font-medium">{stats.suspendedTenants} suspended</span>}
                        </div>
                    </div>
                    <div className="bg-white rounded-xl border border-slate-100 shadow-sm p-5">
                        <div className="flex items-center justify-between mb-3">
                            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Borrowers</span>
                            <Users size={16} className="text-purple-400" />
                        </div>
                        <div className="text-3xl font-bold text-slate-900">{stats.totalBorrowers.toLocaleString()}</div>
                        <div className="text-xs text-slate-400 mt-2">Across all orgs</div>
                    </div>
                    <div className="bg-white rounded-xl border border-slate-100 shadow-sm p-5">
                        <div className="flex items-center justify-between mb-3">
                            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Active Loans</span>
                            <FileText size={16} className="text-emerald-400" />
                        </div>
                        <div className="text-3xl font-bold text-slate-900">{stats.disbursedLoans.toLocaleString()}</div>
                        <div className="text-xs text-slate-400 mt-2">{stats.totalLoans} total issued</div>
                    </div>
                    <div className="bg-white rounded-xl border border-slate-100 shadow-sm p-5">
                        <div className="flex items-center justify-between mb-3">
                            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Total Collected</span>
                            <CreditCard size={16} className="text-amber-400" />
                        </div>
                        <div className="text-2xl font-bold text-slate-900">${Number(stats.totalRepaymentsCollected).toLocaleString()}</div>
                        <div className="text-xs text-slate-400 mt-2">All repayments</div>
                    </div>
                </div>
            )}

            {/* Filters */}
            <div className="flex flex-col sm:flex-row gap-3">
                <div className="relative flex-1">
                    <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                    <input
                        type="text"
                        placeholder="Search organizations..."
                        value={searchQuery}
                        onChange={e => setSearch(e.target.value)}
                        className="w-full pl-9 pr-4 py-2.5 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                    />
                </div>
                <div className="flex gap-1.5">
                    {['ALL', 'ACTIVE', 'SUSPENDED'].map(s => (
                        <button
                            key={s}
                            onClick={() => setStatus(s)}
                            className={`px-3 py-2 text-xs font-semibold rounded-lg transition-all ${statusFilter === s ? 'bg-slate-900 text-white' : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'}`}
                        >
                            {s}
                        </button>
                    ))}
                </div>
            </div>

            {/* Tenant Cards Grid */}
            {loading ? (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {Array.from({ length: 3 }).map((_, i) => (
                        <div key={i} className="bg-white rounded-xl border border-slate-100 p-6 animate-pulse">
                            <div className="h-5 bg-slate-100 rounded w-2/3 mb-4" />
                            <div className="grid grid-cols-3 gap-2">
                                {Array.from({ length: 3 }).map((_, j) => <div key={j} className="h-10 bg-slate-100 rounded" />)}
                            </div>
                        </div>
                    ))}
                </div>
            ) : filtered.length === 0 ? (
                <div className="bg-white rounded-xl border border-slate-100 p-16 text-center">
                    <Building2 size={40} className="mx-auto text-slate-200 mb-3" />
                    <p className="text-slate-400 font-medium">No organizations found</p>
                </div>
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {filtered.map(tenant => (
                        <div
                            key={tenant.id}
                            className={`bg-white rounded-xl border shadow-sm overflow-hidden transition-all hover:shadow-md ${tenant.status === 'SUSPENDED' ? 'border-red-100 opacity-75' : 'border-slate-100'}`}
                        >
                            <div className="p-5">
                                <div className="flex items-start justify-between mb-3">
                                    <div className="flex items-center gap-3 min-w-0">
                                        <div className={`w-10 h-10 rounded-xl flex items-center justify-center text-base font-bold flex-shrink-0 ${tenant.status === 'SUSPENDED' ? 'bg-red-100 text-red-600' : 'bg-blue-600 text-white'}`}>
                                            {tenant.name.charAt(0).toUpperCase()}
                                        </div>
                                        <div className="min-w-0">
                                            <h3 className="font-bold text-slate-900 truncate">{tenant.name}</h3>
                                            <div className="flex gap-1.5 mt-1">
                                                <span className={`px-1.5 py-0.5 text-[10px] font-bold rounded-full ${STATUS_COLORS[tenant.status] || 'bg-gray-100 text-gray-600'}`}>
                                                    {tenant.status}
                                                </span>
                                                <span className={`px-1.5 py-0.5 text-[10px] font-bold rounded-full ${PLAN_COLORS[tenant.plan] || 'bg-gray-100 text-gray-600'}`}>
                                                    {tenant.plan}
                                                </span>
                                            </div>
                                        </div>
                                    </div>
                                    {/* Actions Menu */}
                                    <div className="relative flex-shrink-0" onClick={e => e.stopPropagation()}>
                                        <button
                                            onClick={() => setMenu(menuOpen === tenant.id ? null : tenant.id)}
                                            className="p-1.5 rounded-md text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"
                                        >
                                            <MoreVertical size={15} />
                                        </button>
                                        {menuOpen === tenant.id && (
                                            <div className="absolute right-0 top-8 bg-white border border-slate-100 rounded-xl shadow-lg z-20 w-44 py-1 text-sm">
                                                <button onClick={() => handleEdit(tenant)} className="w-full text-left px-4 py-2 hover:bg-slate-50 flex items-center gap-2 text-slate-700">
                                                    <Edit2 size={13} /> Edit Details
                                                </button>
                                                {tenant.status === 'ACTIVE' ? (
                                                    <button onClick={() => handleSuspend(tenant)} className="w-full text-left px-4 py-2 hover:bg-red-50 flex items-center gap-2 text-red-600">
                                                        <Ban size={13} /> Suspend
                                                    </button>
                                                ) : (
                                                    <button onClick={() => handleActivate(tenant)} className="w-full text-left px-4 py-2 hover:bg-emerald-50 flex items-center gap-2 text-emerald-600">
                                                        <RefreshCcw size={13} /> Reactivate
                                                    </button>
                                                )}
                                                <hr className="my-1 border-slate-100" />
                                                <button onClick={() => handleDelete(tenant)} className="w-full text-left px-4 py-2 hover:bg-red-50 flex items-center gap-2 text-red-500">
                                                    <Trash2 size={13} /> Remove
                                                </button>
                                            </div>
                                        )}
                                    </div>
                                </div>

                                {/* Stats */}
                                <div className="grid grid-cols-4 gap-1 bg-slate-50 rounded-lg p-3 mt-3">
                                    <div className="text-center">
                                        <div className="text-sm font-bold text-slate-800">{tenant._count.users}</div>
                                        <div className="text-[9px] text-slate-400 uppercase mt-0.5">Users</div>
                                    </div>
                                    <div className="text-center border-l border-slate-200">
                                        <div className="text-sm font-bold text-slate-800">{tenant._count.borrowers}</div>
                                        <div className="text-[9px] text-slate-400 uppercase mt-0.5">Clients</div>
                                    </div>
                                    <div className="text-center border-l border-slate-200">
                                        <div className="text-sm font-bold text-slate-800">{tenant._count.loans}</div>
                                        <div className="text-[9px] text-slate-400 uppercase mt-0.5">Loans</div>
                                    </div>
                                    <div className="text-center border-l border-slate-200">
                                        <div className="text-sm font-bold text-slate-800">{tenant._count.repayments}</div>
                                        <div className="text-[9px] text-slate-400 uppercase mt-0.5">Payments</div>
                                    </div>
                                </div>

                                <div className="flex items-center gap-1.5 mt-3 text-[11px] text-slate-400">
                                    <Calendar size={11} />
                                    Joined {new Date(tenant.createdAt).toLocaleDateString()}
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {/* Modal */}
            <Dialog open={isModalOpen} onOpenChange={setModal}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>{editTenant ? 'Edit Organization' : 'Register New Organization'}</DialogTitle>
                        <DialogDescription>
                            {editTenant ? 'Update the organization name or subscription plan.' : 'Create a new isolated multi-tenant environment for a microfinance organization.'}
                        </DialogDescription>
                    </DialogHeader>
                    <form onSubmit={handleSubmit} className="space-y-4 pt-2">
                        <div className="space-y-2">
                            <Label htmlFor="org-name">Organization Name</Label>
                            <Input
                                id="org-name"
                                required
                                placeholder="e.g. Sunrise Microfinance Co."
                                value={form.name}
                                onChange={e => setForm({ ...form, name: e.target.value })}
                            />
                        </div>
                        {editTenant && (
                            <div className="space-y-2">
                                <Label htmlFor="org-plan">Subscription Plan</Label>
                                <select
                                    id="org-plan"
                                    value={form.plan}
                                    onChange={e => setForm({ ...form, plan: e.target.value })}
                                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                                >
                                    {PLANS.map(p => <option key={p} value={p}>{p}</option>)}
                                </select>
                                <p className="text-xs text-slate-400">FREE → BASIC → PROFESSIONAL → ENTERPRISE</p>
                            </div>
                        )}
                        <div className="flex justify-end gap-2 pt-2">
                            <Button type="button" variant="outline" onClick={() => setModal(false)}>Cancel</Button>
                            <Button type="submit" disabled={submitting} className="bg-slate-900 text-white">
                                {submitting && <Loader2 size={14} className="animate-spin mr-2" />}
                                {submitting ? 'Saving...' : (editTenant ? 'Save Changes' : 'Register Org')}
                            </Button>
                        </div>
                    </form>
                </DialogContent>
            </Dialog>
        </div>
    );
}
