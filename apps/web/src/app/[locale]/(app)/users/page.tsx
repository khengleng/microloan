"use client";

import { useEffect, useState, useCallback } from 'react';
import { useTranslations } from 'next-intl';
import api from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/components/ui/toast';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Plus, Trash2, ShieldCheck, Users, Mail, Loader2, ChevronDown, UserX, UserPlus, Fingerprint, Shield, Activity, Calendar, KeyRound } from 'lucide-react';
import { useAuth } from '@/lib/auth-context';

const TENANT_ROLES = ['ADMIN', 'FINANCE', 'SALES', 'CX', 'OPERATOR'];
// Platform team can hold any tenant-equivalent role; they operate against platform data
const PLATFORM_ROLES = ['ADMIN', 'FINANCE', 'SALES', 'CX', 'OPERATOR'];
const ROLE_COLORS: Record<string, string> = {
    ADMIN: 'bg-indigo-100 text-indigo-700 shadow-sm',
    FINANCE: 'bg-purple-100 text-purple-700 shadow-sm',
    SALES: 'bg-emerald-100 text-emerald-700 shadow-sm',
    CX: 'bg-amber-100 text-amber-700 shadow-sm',
    OPERATOR: 'bg-slate-100 text-slate-500 shadow-sm',
};

interface TeamMember {
    id: string;
    email: string;
    role: string;
    isActive: boolean;
    twoFactorEnabled: boolean;
    createdAt: string;
}

export default function UsersPage() {
    const t = useTranslations('Users');
    const { showToast } = useToast();
    const { user, loading: authLoading } = useAuth();
    const [users, setUsers] = useState<TeamMember[]>([]);
    const [loading, setLoading] = useState(true);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [submitting, setSubmitting] = useState(false);
    const [deletingId, setDeletingId] = useState<string | null>(null);
    const [resettingId, setResettingId] = useState<string | null>(null);
    const [form, setForm] = useState({ email: '', password: '', role: 'SALES' });

    const isSuperAdmin = user?.role === 'SUPERADMIN';
    const ROLES = isSuperAdmin ? PLATFORM_ROLES : TENANT_ROLES;

    const fetchUsers = useCallback(async () => {
        setLoading(true);
        try {
            const res = await api.get('/users');
            setUsers(res.data);
        } catch {
            showToast(t('loadFailed'), 'error');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { fetchUsers(); }, [fetchUsers]);

    const handleInvite = async (e: React.FormEvent) => {
        e.preventDefault();
        setSubmitting(true);
        try {
            await api.post('/users', form);
            showToast(t('invited', { email: form.email, role: form.role }), 'success');
            setIsModalOpen(false);
            setForm({ email: '', password: '', role: 'SALES' });
            fetchUsers();
        } catch (err: any) {
            showToast(err.response?.data?.message || t('createFailed'), 'error');
        } finally {
            setSubmitting(false);
        }
    };

    const handleResetPassword = async (id: string, email: string) => {
        const pw = window.prompt(`Set a new password for ${email} (minimum 12 characters).\nThey will be signed out of all sessions and must use the new password.`);
        if (pw === null) return; // cancelled
        if (pw.length < 12) { showToast('Password must be at least 12 characters', 'error'); return; }
        setResettingId(id);
        try {
            await api.patch(`/users/${id}/password`, { password: pw });
            showToast(t('resetSuccess', { email }), 'success');
        } catch (err: any) {
            showToast(err.response?.data?.message || t('resetFailed'), 'error');
        } finally {
            setResettingId(null);
        }
    };

    const handleDelete = async (id: string, email: string) => {
        if (!confirm(`Suspend ${email}'s access? They will no longer be able to log in.`)) return;
        setDeletingId(id);
        try {
            await api.delete(`/users/${id}`);
            showToast(t('suspended', { email }), 'success');
            fetchUsers();
        } catch (err: any) {
            showToast(err.response?.data?.message || t('suspendFailed'), 'error');
        } finally {
            setDeletingId(null);
        }
    };

    const handleRoleChange = async (id: string, newRole: string) => {
        try {
            await api.put(`/users/${id}/role`, { role: newRole });
            showToast(t('roleUpdated'), 'success');
            fetchUsers();
        } catch {
            showToast(t('roleUpdateFailed'), 'error');
        }
    };

    if (authLoading) return (
        <div className="flex h-[50vh] items-center justify-center">
            <Loader2 className="animate-spin text-primary" />
        </div>
    );

    return (
        <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-700">
            {/* Header Area */}
            <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-6">
                <div>
                    <h1 className="text-3xl font-black text-slate-900 tracking-tight flex items-center gap-3">
                        <Users className="text-indigo-600" size={32} />
                        {isSuperAdmin ? t('platformTeam') : t('teamMembers')}
                    </h1>
                    <p className="text-slate-500 font-medium mt-1">
                        {isSuperAdmin
                            ? t('platformSubtitle')
                            : t('teamSubtitle')}
                    </p>
                </div>
                <Button
                    onClick={() => setIsModalOpen(true)}
                    className="rounded-2xl font-black px-8 h-12 bg-indigo-600 hover:bg-indigo-700 shadow-lg shadow-indigo-600/20 transition-all hover:scale-[1.02] flex items-center gap-2"
                >
                    <UserPlus size={18} />
                    {t('onboardMember')}
                </Button>
            </div>

            {/* Team Summary KPIs */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div className="glass p-6 rounded-[2rem] premium-shadow border-indigo-100/10">
                    <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-3">{t('activeSeats')}</div>
                    <div className="text-3xl font-black text-slate-900 tracking-tight">{users.filter(u => u.isActive).length}</div>
                    <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mt-2 italic flex items-center gap-1.5"><Activity size={10} className="text-emerald-500" /> {t('systemAccess')}</p>
                </div>
                <div className="glass p-6 rounded-[2rem] premium-shadow border-indigo-100/10">
                    <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-3">{t('identityStrength')}</div>
                    <div className="text-3xl font-black text-indigo-600 tracking-tight">
                        {users.length > 0 ? Math.round((users.filter(u => u.twoFactorEnabled).length / users.length) * 100) : 0}%
                    </div>
                    <p className="text-[10px] font-black text-indigo-400 uppercase tracking-widest mt-2 italic flex items-center gap-1.5"><Fingerprint size={10} /> {t('mfaAdoption')}</p>
                </div>
                <div className="glass p-6 rounded-[2rem] premium-shadow border-indigo-100/10">
                    <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-3">{t('logicTiers')}</div>
                    <div className="text-3xl font-black text-slate-900 tracking-tight">{new Set(users.map(u => u.role)).size}</div>
                    <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mt-2 italic flex items-center gap-1.5"><Shield size={10} className="text-purple-500" /> {t('rbacEnforced')}</p>
                </div>
            </div>

            {/* User Registry Table */}
            <div className="glass rounded-[2.5rem] premium-shadow border-indigo-100/10 overflow-hidden">
                <div className="overflow-x-auto no-scrollbar">
                    <table className="w-full border-collapse">
                        <thead>
                            <tr className="border-b border-slate-100/50 bg-slate-50/30">
                                <th className="text-left px-8 py-5 text-[10px] font-black text-slate-400 uppercase tracking-widest">{t('colIdentity')}</th>
                                <th className="text-left py-5 text-[10px] font-black text-slate-400 uppercase tracking-widest">{t('colRole')}</th>
                                <th className="text-center py-5 text-[10px] font-black text-slate-400 uppercase tracking-widest hidden md:table-cell">{t('colVault')}</th>
                                <th className="text-left py-5 text-[10px] font-black text-slate-400 uppercase tracking-widest hidden lg:table-cell">{t('colJoined')}</th>
                                <th className="text-right px-8 py-5 text-[10px] font-black text-slate-400 uppercase tracking-widest">{t('colGovernance')}</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100/30">
                            {loading ? (
                                Array.from({ length: 3 }).map((_, i) => (
                                    <tr key={i} className="animate-pulse">
                                        <td colSpan={5} className="px-8 py-6 h-16 bg-slate-50/20" />
                                    </tr>
                                ))
                            ) : users.length === 0 ? (
                                <tr>
                                    <td colSpan={5} className="py-24 text-center">
                                        <Users size={48} strokeWidth={1} className="mx-auto text-slate-200 mb-4" />
                                        <p className="text-xs font-black text-slate-400 uppercase tracking-widest italic">{t('noUsers')}</p>
                                    </td>
                                </tr>
                            ) : (
                                users.map(user => (
                                    <tr key={user.id} className="group hover:bg-slate-50/50 transition-all duration-300">
                                        <td className="px-8 py-5">
                                            <div className="flex items-center gap-4">
                                                <div className={`w-12 h-12 rounded-2xl flex items-center justify-center text-lg font-black shadow-sm transition-all group-hover:scale-110 ${user.isActive ? 'bg-indigo-600 text-white' : 'bg-rose-100 text-rose-500'}`}>
                                                    {user.email.charAt(0).toUpperCase()}
                                                </div>
                                                <div className="min-w-0">
                                                    <p className={`text-base font-black tracking-tight truncate max-w-[200px] ${user.isActive ? 'text-slate-900' : 'text-slate-400 line-through decoration-rose-500/50'}`}>{user.email}</p>
                                                    {!user.isActive && <p className="text-[10px] font-black text-rose-500 uppercase tracking-widest mt-0.5">{t('accessSuspended')}</p>}
                                                    {user.isActive && <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-0.5">{t('activeInstance')}</p>}
                                                </div>
                                            </div>
                                        </td>
                                        <td className="py-5">
                                            <div className="relative inline-block group/role">
                                                <select
                                                    value={user.role}
                                                    onChange={e => handleRoleChange(user.id, e.target.value)}
                                                    className={`appearance-none pl-4 pr-10 py-1.5 text-[10px] font-black uppercase tracking-[0.1em] rounded-full border-0 cursor-pointer focus:outline-none focus:ring-4 focus:ring-white/50 transition-all ${ROLE_COLORS[user.role] || 'bg-slate-100 text-slate-400'}`}
                                                    disabled={user.role === 'ADMIN' || user.role === 'SUPERADMIN'}
                                                >
                                                    {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
                                                </select>
                                                <ChevronDown size={14} className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-slate-400/50 group-hover/role:text-slate-900 transition-colors" />
                                            </div>
                                        </td>
                                        <td className="py-5 text-center hidden md:table-cell">
                                            {user.twoFactorEnabled
                                                ? <div className="w-10 h-10 mx-auto rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center shadow-sm"><ShieldCheck size={18} /></div>
                                                : <div className="w-10 h-10 mx-auto rounded-xl bg-slate-50 text-slate-200 flex items-center justify-center border border-dashed border-slate-200"><Shield size={16} /></div>}
                                        </td>
                                        <td className="py-5 text-[11px] font-bold text-slate-400 hidden lg:table-cell">
                                            <div className="flex items-center gap-2">
                                                <Calendar size={13} className="text-slate-300" />
                                                {new Date(user.createdAt).toLocaleDateString()}
                                            </div>
                                        </td>
                                        <td className="px-8 py-5 text-right">
                                            <div className="flex items-center justify-end gap-2">
                                                {user.isActive && (
                                                    <button
                                                        onClick={() => handleResetPassword(user.id, user.email)}
                                                        disabled={resettingId === user.id}
                                                        className="w-10 h-10 rounded-xl bg-white text-slate-300 hover:text-indigo-600 hover:bg-indigo-50 transition-all shadow-sm border border-slate-100 flex items-center justify-center"
                                                        title={t('resetPasswordTitle')}
                                                    >
                                                        {resettingId === user.id ? <Loader2 size={16} className="animate-spin" /> : <KeyRound size={16} />}
                                                    </button>
                                                )}
                                                {user.role !== 'ADMIN' && user.role !== 'SUPERADMIN' && user.isActive && (
                                                    <button
                                                        onClick={() => handleDelete(user.id, user.email)}
                                                        disabled={deletingId === user.id}
                                                        className="w-10 h-10 rounded-xl bg-white text-slate-300 hover:text-rose-500 hover:bg-rose-50 transition-all shadow-sm border border-slate-100 flex items-center justify-center"
                                                        title={t('suspendTitle')}
                                                    >
                                                        {deletingId === user.id ? <Loader2 size={16} className="animate-spin" /> : <UserX size={16} />}
                                                    </button>
                                                )}
                                            </div>
                                        </td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* Invite Modal */}
            <Dialog open={isModalOpen} onOpenChange={setIsModalOpen}>
                <DialogContent className="rounded-[2.5rem] border-none shadow-2xl glass p-8">
                    <DialogHeader>
                        <DialogTitle className="text-2xl font-black text-slate-900 tracking-tight">{t('onboardTitle')}</DialogTitle>
                        <DialogDescription className="text-slate-500 font-medium">{t('onboardDesc')}</DialogDescription>
                    </DialogHeader>
                    <form onSubmit={handleInvite} className="space-y-6 pt-6">
                        <div className="space-y-3">
                            <Label htmlFor="inv-email" className="text-[11px] font-black text-slate-500 uppercase tracking-widest ml-1">{t('emailLabel')}</Label>
                            <div className="relative group">
                                <Mail size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-indigo-600 transition-colors" />
                                <Input
                                    id="inv-email"
                                    type="email"
                                    autoComplete="email"
                                    required
                                    className="h-14 rounded-2xl border-slate-200/50 focus:ring-4 focus:ring-indigo-500/10 font-bold pl-12 pr-5"
                                    placeholder={t('emailPlaceholder')}
                                    value={form.email}
                                    onChange={e => setForm({ ...form, email: e.target.value })}
                                />
                            </div>
                        </div>
                        <div className="space-y-3">
                            <Label htmlFor="inv-pass" className="text-[11px] font-black text-slate-500 uppercase tracking-widest ml-1">{t('credentialLabel')}</Label>
                            <Input
                                id="inv-pass"
                                type="password"
                                autoComplete="new-password"
                                required
                                minLength={6}
                                className="h-14 rounded-2xl border-slate-200/50 focus:ring-4 focus:ring-indigo-500/10 font-bold px-5"
                                placeholder={t('credentialPlaceholder')}
                                value={form.password}
                                onChange={e => setForm({ ...form, password: e.target.value })}
                            />
                        </div>
                        <div className="space-y-3">
                            <Label htmlFor="inv-role" className="text-[11px] font-black text-slate-500 uppercase tracking-widest ml-1">{t('roleLabel')}</Label>
                            <div className="relative">
                                <select
                                    id="inv-role"
                                    value={form.role}
                                    onChange={e => setForm({ ...form, role: e.target.value })}
                                    className="w-full h-14 pl-5 pr-10 appearance-none text-sm font-black border border-slate-200/50 rounded-2xl focus:outline-none focus:ring-4 focus:ring-indigo-500/10 bg-white"
                                >
                                    {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
                                </select>
                                <ChevronDown className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" size={18} />
                            </div>
                            <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest pl-1">
                                {t('roleHint')}
                            </p>
                        </div>
                        <div className="flex flex-col gap-3 pt-4">
                            <Button type="submit" disabled={submitting} className="h-14 bg-slate-950 hover:bg-slate-800 text-white rounded-2xl font-black text-xs uppercase tracking-widest shadow-lg shadow-slate-950/20">
                                {submitting && <Loader2 size={16} className="animate-spin mr-3" />}
                                {submitting ? t('registering') : t('registerDispatch')}
                            </Button>
                            <Button type="button" variant="ghost" onClick={() => setIsModalOpen(false)} className="h-12 rounded-2xl font-bold text-slate-400 hover:text-slate-600">{t('dismiss')}</Button>
                        </div>
                    </form>
                </DialogContent>
            </Dialog>
        </div>
    );
}
