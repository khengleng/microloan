"use client";

import { useEffect, useState, useCallback } from 'react';
import api from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/components/ui/toast';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Plus, Trash2, ShieldCheck, Users, Mail, Loader2, ChevronDown, UserX } from 'lucide-react';

const ROLES = ['ADMIN', 'FINANCE', 'SALES', 'CX', 'OPERATOR'];
const ROLE_COLORS: Record<string, string> = {
    ADMIN: 'bg-purple-100 text-purple-700',
    FINANCE: 'bg-blue-100 text-blue-700',
    SALES: 'bg-emerald-100 text-emerald-700',
    CX: 'bg-amber-100 text-amber-700',
    OPERATOR: 'bg-slate-100 text-slate-700',
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
    const { showToast } = useToast();
    const [users, setUsers] = useState<TeamMember[]>([]);
    const [loading, setLoading] = useState(true);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [submitting, setSubmitting] = useState(false);
    const [deletingId, setDeletingId] = useState<string | null>(null);
    const [form, setForm] = useState({ email: '', password: '', role: 'SALES' });

    const fetchUsers = useCallback(async () => {
        setLoading(true);
        try {
            const res = await api.get('/users');
            setUsers(res.data);
        } catch {
            showToast('Failed to load team members', 'error');
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
            showToast(`${form.email} has been invited as ${form.role}`, 'success');
            setIsModalOpen(false);
            setForm({ email: '', password: '', role: 'SALES' });
            fetchUsers();
        } catch (err: any) {
            showToast(err.response?.data?.message || 'Failed to create user', 'error');
        } finally {
            setSubmitting(false);
        }
    };

    const handleDelete = async (id: string, email: string) => {
        if (!confirm(`Suspend ${email}'s access? They will no longer be able to log in.`)) return;
        setDeletingId(id);
        try {
            await api.delete(`/users/${id}`);
            showToast(`${email} has been suspended`, 'success');
            fetchUsers();
        } catch (err: any) {
            showToast(err.response?.data?.message || 'Cannot suspend this user', 'error');
        } finally {
            setDeletingId(null);
        }
    };

    const handleRoleChange = async (id: string, newRole: string) => {
        try {
            await api.put(`/users/${id}/role`, { role: newRole });
            showToast('Role updated', 'success');
            fetchUsers();
        } catch {
            showToast('Failed to update role', 'error');
        }
    };

    return (
        <div className="space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                    <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
                        <Users size={24} className="text-slate-400" /> Team Members
                    </h1>
                    <p className="text-sm text-slate-500 mt-0.5">{users.length} member{users.length !== 1 ? 's' : ''} in your organization</p>
                </div>
                <Button
                    onClick={() => setIsModalOpen(true)}
                    className="flex items-center gap-2 bg-slate-900 hover:bg-slate-700 flex-shrink-0"
                >
                    <Plus size={15} /> Invite Member
                </Button>
            </div>

            <div className="bg-white rounded-xl border border-slate-100 shadow-sm overflow-hidden">
                <table className="min-w-full">
                    <thead>
                        <tr className="bg-slate-50 border-b border-slate-100">
                            <th className="px-5 py-3.5 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">Member</th>
                            <th className="px-5 py-3.5 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">Role</th>
                            <th className="px-5 py-3.5 text-center text-xs font-semibold text-slate-500 uppercase tracking-wider hidden md:table-cell">MFA</th>
                            <th className="px-5 py-3.5 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider hidden lg:table-cell">Joined</th>
                            <th className="px-5 py-3.5 text-right text-xs font-semibold text-slate-500 uppercase tracking-wider">Actions</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-50">
                        {loading ? (
                            Array.from({ length: 3 }).map((_, i) => (
                                <tr key={i}>
                                    {Array.from({ length: 5 }).map((_, j) => (
                                        <td key={j} className="px-5 py-4">
                                            <div className="h-4 bg-slate-100 rounded animate-pulse" style={{ width: `${50 + (i + j) * 10}%` }} />
                                        </td>
                                    ))}
                                </tr>
                            ))
                        ) : users.length === 0 ? (
                            <tr>
                                <td colSpan={5} className="px-5 py-16 text-center">
                                    <Users size={40} className="mx-auto text-slate-200 mb-3" />
                                    <p className="text-slate-400 font-medium">No team members yet. Invite your first member.</p>
                                </td>
                            </tr>
                        ) : (
                            users.map(user => (
                                <tr key={user.id} className="hover:bg-slate-50 transition-colors">
                                    <td className="px-5 py-4">
                                        <div className="flex items-center gap-3">
                                            <div className={`w-9 h-9 rounded-full ${user.isActive ? 'bg-slate-200 text-slate-600' : 'bg-red-50 text-red-600 border border-red-100'} flex items-center justify-center text-sm font-bold flex-shrink-0`}>
                                                {user.email.charAt(0).toUpperCase()}
                                            </div>
                                            <div>
                                                <div className={`text-sm font-medium ${user.isActive ? 'text-slate-900' : 'text-slate-500 line-through'}`}>{user.email}</div>
                                                {!user.isActive && <div className="text-xs text-red-500 mt-0.5">Suspended</div>}
                                            </div>
                                        </div>
                                    </td>
                                    <td className="px-5 py-4">
                                        <div className="relative inline-block">
                                            <select
                                                value={user.role}
                                                onChange={e => handleRoleChange(user.id, e.target.value)}
                                                className={`appearance-none pl-2.5 pr-6 py-1 text-xs font-semibold rounded-full border-0 cursor-pointer focus:outline-none focus:ring-2 focus:ring-blue-500 ${ROLE_COLORS[user.role] || 'bg-gray-100 text-gray-600'}`}
                                                disabled={user.role === 'ADMIN' || user.role === 'SUPERADMIN'}
                                            >
                                                {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
                                            </select>
                                            <ChevronDown size={10} className="absolute right-1.5 top-1/2 -translate-y-1/2 pointer-events-none opacity-60" />
                                        </div>
                                    </td>
                                    <td className="px-5 py-4 text-center hidden md:table-cell">
                                        {user.twoFactorEnabled
                                            ? <ShieldCheck size={16} className="mx-auto text-emerald-500" />
                                            : <span className="text-slate-300 text-xs">—</span>}
                                    </td>
                                    <td className="px-5 py-4 text-sm text-slate-400 hidden lg:table-cell">
                                        {new Date(user.createdAt).toLocaleDateString()}
                                    </td>
                                    <td className="px-5 py-4 text-right">
                                        {user.role !== 'ADMIN' && user.role !== 'SUPERADMIN' && user.isActive && (
                                            <button
                                                onClick={() => handleDelete(user.id, user.email)}
                                                disabled={deletingId === user.id}
                                                className="p-1.5 rounded-md text-slate-400 hover:text-red-600 hover:bg-red-50 transition-colors disabled:opacity-50"
                                                title="Suspend member"
                                            >
                                                {deletingId === user.id ? <Loader2 size={14} className="animate-spin" /> : <UserX size={14} />}
                                            </button>
                                        )}
                                    </td>
                                </tr>
                            ))
                        )}
                    </tbody>
                </table>
            </div>

            <Dialog open={isModalOpen} onOpenChange={setIsModalOpen}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Invite Team Member</DialogTitle>
                        <DialogDescription>Create a new account for a team member. They can log in immediately with these credentials.</DialogDescription>
                    </DialogHeader>
                    <form onSubmit={handleInvite} className="space-y-4 pt-2">
                        <div className="space-y-2">
                            <Label htmlFor="inv-email">Email Address</Label>
                            <div className="relative">
                                <Mail size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                                <Input
                                    id="inv-email"
                                    type="email"
                                    autoComplete="email"
                                    required
                                    className="pl-9"
                                    placeholder="team@example.com"
                                    value={form.email}
                                    onChange={e => setForm({ ...form, email: e.target.value })}
                                />
                            </div>
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="inv-pass">Temporary Password</Label>
                            <Input
                                id="inv-pass"
                                type="password"
                                autoComplete="new-password"
                                required
                                minLength={6}
                                placeholder="min. 6 characters"
                                value={form.password}
                                onChange={e => setForm({ ...form, password: e.target.value })}
                            />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="inv-role">Role</Label>
                            <select
                                id="inv-role"
                                value={form.role}
                                onChange={e => setForm({ ...form, role: e.target.value })}
                                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                            >
                                {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
                            </select>
                            <p className="text-xs text-slate-400">
                                FINANCE: repayments & reports · SALES: borrowers & loans · CX: view-only
                            </p>
                        </div>
                        <div className="flex justify-end gap-2 pt-2">
                            <Button type="button" variant="outline" onClick={() => setIsModalOpen(false)}>Cancel</Button>
                            <Button type="submit" disabled={submitting} className="bg-slate-900 text-white">
                                {submitting ? <Loader2 size={15} className="animate-spin mr-2" /> : null}
                                {submitting ? 'Creating...' : 'Create Account'}
                            </Button>
                        </div>
                    </form>
                </DialogContent>
            </Dialog>
        </div>
    );
}
