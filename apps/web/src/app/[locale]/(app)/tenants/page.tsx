"use client";

import { useEffect, useState, useCallback } from 'react';
import api from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Plus, Edit2, Trash2, Building, Users, Wallet, Calendar } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

interface Tenant {
    id: string;
    name: string;
    createdAt: string;
    _count: {
        users: number;
        borrowers: number;
        loans: number;
    }
}

export default function TenantsPage() {
    const [tenants, setTenants] = useState<Tenant[]>([]);
    const [loading, setLoading] = useState(true);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [editingTenant, setEditingTenant] = useState<Tenant | null>(null);
    const [tenantName, setTenantName] = useState('');
    const [submitting, setSubmitting] = useState(false);

    const fetchTenants = useCallback(async () => {
        setLoading(true);
        try {
            const res = await api.get('/tenants');
            setTenants(res.data);
        } catch (err) {
            console.error('Failed to fetch tenants', err);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        fetchTenants();
    }, [fetchTenants]);

    const handleOpenModal = (tenant: Tenant | null = null) => {
        setEditingTenant(tenant);
        setTenantName(tenant ? tenant.name : '');
        setIsModalOpen(true);
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setSubmitting(true);
        try {
            if (editingTenant) {
                await api.put(`/tenants/${editingTenant.id}`, { name: tenantName });
            } else {
                await api.post('/tenants', { name: tenantName });
            }
            setIsModalOpen(false);
            fetchTenants();
        } catch (err) {
            console.error('Failed to save tenant', err);
            alert('Error: Likely not authorized to edit tenants.');
        } finally {
            setSubmitting(false);
        }
    };

    const handleDelete = async (id: string, name: string) => {
        if (!confirm(`Delete tenant ${name}? This will only work if it has no data.`)) return;
        try {
            await api.delete(`/tenants/${id}`);
            fetchTenants();
        } catch (err) {
            console.error('Failed to delete tenant', err);
            alert('Cannot delete tenant with existing records.');
        }
    };

    if (loading) return <div className="p-8 text-center text-gray-500 animate-pulse">Loading tenant management portal...</div>;

    return (
        <div className="space-y-6">
            <div className="flex justify-between items-center">
                <div className="flex items-center gap-3">
                    <Building className="text-slate-700" size={32} />
                    <div>
                        <h1 className="text-2xl font-bold">Tenants Management</h1>
                        <p className="text-sm text-gray-500">Manage multi-tenant isolation and organizations.</p>
                    </div>
                </div>
                <Button onClick={() => handleOpenModal()} className="flex items-center gap-2">
                    <Plus size={16} /> New Tenant
                </Button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {tenants.map(tenant => (
                    <div key={tenant.id} className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden hover:shadow-md transition group">
                        <div className="p-6">
                            <div className="flex justify-between items-start mb-4">
                                <h3 className="text-lg font-bold group-hover:text-blue-600 transition">{tenant.name}</h3>
                                <div className="flex gap-1">
                                    <Button size="icon" variant="ghost" onClick={() => handleOpenModal(tenant)} className="h-8 w-8 text-gray-400 hover:text-blue-600">
                                        <Edit2 size={14} />
                                    </Button>
                                    <Button size="icon" variant="ghost" onClick={() => handleDelete(tenant.id, tenant.name)} className="h-8 w-8 text-gray-400 hover:text-red-600">
                                        <Trash2 size={14} />
                                    </Button>
                                </div>
                            </div>

                            <div className="grid grid-cols-3 gap-2 px-2 py-4 bg-gray-50 rounded-lg">
                                <div className="text-center border-r border-gray-200">
                                    <div className="text-sm font-bold text-gray-900">{tenant._count.users}</div>
                                    <div className="text-[10px] text-gray-500 uppercase">Users</div>
                                </div>
                                <div className="text-center border-r border-gray-200">
                                    <div className="text-sm font-bold text-gray-900">{tenant._count.borrowers}</div>
                                    <div className="text-[10px] text-gray-500 uppercase">Clients</div>
                                </div>
                                <div className="text-center">
                                    <div className="text-sm font-bold text-gray-900">{tenant._count.loans}</div>
                                    <div className="text-[10px] text-gray-500 uppercase">Loans</div>
                                </div>
                            </div>

                            <div className="mt-4 flex items-center gap-2 text-xs text-gray-400">
                                <Calendar size={12} />
                                Joined {new Date(tenant.createdAt).toLocaleDateString()}
                            </div>
                            <div className="mt-2 text-[10px] font-mono text-gray-300 break-all">{tenant.id}</div>
                        </div>
                    </div>
                ))}
            </div>

            <Dialog open={isModalOpen} onOpenChange={setIsModalOpen}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>{editingTenant ? 'Edit Tenant Branding' : 'Register New Tenant'}</DialogTitle>
                        <DialogDescription>
                            Create a separate isolated environment for another microfinance organization.
                        </DialogDescription>
                    </DialogHeader>
                    <form onSubmit={handleSubmit} className="space-y-4 pt-4">
                        <div className="space-y-2">
                            <Label htmlFor="tenantName">Organization/Branch Name</Label>
                            <Input
                                id="tenantName"
                                required
                                value={tenantName}
                                onChange={(e) => setTenantName(e.target.value)}
                                placeholder="e.g. Phnom Penh Branch"
                            />
                        </div>
                        <div className="flex justify-end gap-2 pt-4">
                            <Button type="button" variant="outline" onClick={() => setIsModalOpen(false)}>Cancel</Button>
                            <Button type="submit" disabled={submitting}>
                                {submitting ? 'Processing...' : (editingTenant ? 'Save Changes' : 'Create Organization')}
                            </Button>
                        </div>
                    </form>
                </DialogContent>
            </Dialog>
        </div>
    );
}
