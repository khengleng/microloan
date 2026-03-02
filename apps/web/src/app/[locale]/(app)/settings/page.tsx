"use client";

import { useState, useEffect } from 'react';
import api from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Building2, MessageSquare, Save, Settings, Loader2, CreditCard, ShieldCheck, Zap, Globe, Link2 } from 'lucide-react';
import { MfaSetup } from '@/components/auth/mfa-setup';

export default function SettingsPage() {
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [settings, setSettings] = useState({
        name: '',
        telegramBotToken: '',
        plan: 'FREE'
    });

    useEffect(() => {
        api.get('/settings')
            .then(res => setSettings(res.data))
            .catch(err => console.error('Failed to load settings', err))
            .finally(() => setLoading(false));
    }, []);

    const handleSave = async (e: React.FormEvent) => {
        e.preventDefault();
        setSaving(true);
        try {
            await api.put('/settings', settings);
            alert('Settings updated successfully!');
        } catch (err: any) {
            alert('Failed to update settings: ' + (err.response?.data?.message || err.message));
        } finally {
            setSaving(false);
        }
    };

    const handleUpgrade = async (plan: string) => {
        try {
            const res = await api.post('/billing/checkout', { plan });
            window.location.href = res.data.url;
        } catch (err: any) {
            alert('Checkout failed: ' + (err.response?.data?.message || err.message));
        }
    };

    if (loading) return <div className="flex h-64 items-center justify-center text-slate-400 font-black animate-pulse uppercase tracking-[0.2em]">Accessing Core Configuration...</div>;

    return (
        <div className="max-w-6xl mx-auto space-y-10 animate-in fade-in slide-in-from-bottom-4 duration-700">
            {/* Header Area */}
            <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-6">
                <div>
                    <h1 className="text-3xl font-black text-slate-900 tracking-tight flex items-center gap-3">
                        <Settings className="text-indigo-600" size={32} /> System Configuration
                    </h1>
                    <p className="text-slate-500 font-medium mt-1">Manage global environment variables and organizational parameters</p>
                </div>
            </div>

            <div className="grid lg:grid-cols-12 gap-10">
                <div className="lg:col-span-7 space-y-10">
                    <form onSubmit={handleSave} className="space-y-10">
                        {/* Branding & Identity */}
                        <div className="glass p-8 rounded-[2.5rem] premium-shadow border-indigo-100/10 relative overflow-hidden group">
                            <div className="flex items-center gap-4 mb-8">
                                <div className="w-12 h-12 rounded-2xl bg-indigo-50 text-indigo-600 flex items-center justify-center shadow-sm">
                                    <Building2 size={22} />
                                </div>
                                <div>
                                    <h3 className="text-xl font-black text-slate-900 tracking-tight">Entity Branding</h3>
                                    <p className="text-[11px] font-black text-slate-400 uppercase tracking-widest mt-0.5 italic">Public Identity Logic</p>
                                </div>
                            </div>

                            <div className="space-y-6">
                                <div className="space-y-2">
                                    <Label htmlFor="orgName" className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Legal Organization Name</Label>
                                    <Input
                                        id="orgName"
                                        value={settings.name}
                                        onChange={e => setSettings({ ...settings, name: e.target.value })}
                                        className="h-14 rounded-2xl border-slate-200/50 focus:ring-4 focus:ring-indigo-500/10 font-bold px-6 shadow-sm"
                                        placeholder="Acme Global Finance"
                                    />
                                </div>
                            </div>
                        </div>

                        {/* Telegram Engine */}
                        <div className="glass p-8 rounded-[2.5rem] premium-shadow border-indigo-100/10 relative overflow-hidden group">
                            <div className="flex items-center gap-4 mb-8">
                                <div className="w-12 h-12 rounded-2xl bg-indigo-50 text-indigo-600 flex items-center justify-center shadow-sm">
                                    <MessageSquare size={22} />
                                </div>
                                <div>
                                    <h3 className="text-xl font-black text-slate-900 tracking-tight">Communication Engine</h3>
                                    <p className="text-[11px] font-black text-slate-400 uppercase tracking-widest mt-0.5 italic">Real-time Client Protocols</p>
                                </div>
                            </div>

                            <div className="space-y-6">
                                <div className="space-y-2 relative group">
                                    <Label htmlFor="tgToken" className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Encrypted Bot Token</Label>
                                    <Input
                                        id="tgToken"
                                        type="password"
                                        value={settings.telegramBotToken || ''}
                                        onChange={e => setSettings({ ...settings, telegramBotToken: e.target.value })}
                                        className="h-14 rounded-2xl border-slate-200/50 focus:ring-4 focus:ring-indigo-500/10 font-bold px-6 shadow-sm font-mono tracking-widest"
                                        placeholder="••••••••••••••••••••••••••••"
                                    />
                                    <div className="flex items-center gap-2 mt-3 ml-1">
                                        <Link2 size={12} className="text-indigo-400" />
                                        <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest italic">
                                            Handshake required via <a href="https://t.me/BotFather" target="_blank" className="text-indigo-600 hover:text-indigo-500 underline decoration-indigo-200">@BotFather</a>
                                        </span>
                                    </div>
                                </div>
                            </div>
                        </div>

                        <div className="flex justify-start">
                            <Button
                                type="submit"
                                disabled={saving}
                                className="h-14 rounded-2xl bg-indigo-600 hover:bg-indigo-700 text-white font-black text-xs uppercase tracking-[0.2em] px-10 shadow-lg shadow-indigo-600/20 transition-all hover:scale-[1.02]"
                            >
                                {saving ? <Loader2 className="animate-spin mr-3" size={18} /> : <Save className="mr-3" size={18} />}
                                Commit Changes
                            </Button>
                        </div>
                    </form>

                    {/* Subscription Matrix */}
                    <div className="glass p-8 rounded-[2.5rem] premium-shadow border-indigo-100/10 bg-indigo-600 text-white relative overflow-hidden group">
                        <div className="absolute top-0 right-0 w-64 h-64 bg-white/5 rounded-full -mr-20 -mt-20 group-hover:scale-110 transition-transform duration-700" />
                        <div className="flex items-center gap-4 mb-8">
                            <div className="w-12 h-12 rounded-2xl bg-white/10 text-white flex items-center justify-center backdrop-blur-md">
                                <CreditCard size={22} />
                            </div>
                            <div>
                                <h3 className="text-xl font-black tracking-tight">Subscription Matrix</h3>
                                <p className="text-[11px] font-black text-white/50 uppercase tracking-widest mt-0.5 italic">Platform Access Allocation</p>
                            </div>
                        </div>

                        <div className="bg-white/10 backdrop-blur-xl p-8 rounded-3xl border border-white/10 flex flex-col md:flex-row items-center justify-between gap-6 transition-all group-hover:bg-white/15">
                            <div>
                                <p className="text-[10px] font-black text-white/60 uppercase tracking-widest mb-1.5 flex items-center gap-2">
                                    <Zap size={12} className="fill-white/40" /> Active Platform Tier
                                </p>
                                <p className="text-3xl font-black tracking-tight uppercase">{settings.plan}</p>
                            </div>
                            {settings.plan === 'FREE' ? (
                                <Button onClick={() => handleUpgrade('PRO')} className="h-12 rounded-2xl bg-white text-indigo-600 hover:bg-slate-100 font-black text-xs uppercase tracking-widest px-8 shadow-xl">Elevate to PRO</Button>
                            ) : (
                                <Button variant="ghost" onClick={() => handleUpgrade('ENTERPRISE')} className="h-12 rounded-2xl border border-white/20 text-white hover:bg-white/10 font-black text-xs uppercase tracking-widest px-8">Enterprise Request</Button>
                            )}
                        </div>
                        <p className="text-[10px] font-black text-white/40 uppercase tracking-widest mt-6 italic flex items-center gap-2">
                            <ShieldCheck size={12} /> Securely Managed via Distributed Ledger & Stripe Logic
                        </p>
                    </div>
                </div>

                <div className="lg:col-span-5 space-y-10">
                    <MfaSetup />

                    <div className="glass p-8 rounded-[2.5rem] bg-indigo-50 border border-indigo-100 shadow-sm relative overflow-hidden">
                        <div className="flex items-center gap-3 text-indigo-900 font-black uppercase tracking-widest text-[11px] mb-4">
                            <Globe size={14} /> Global Consistency
                        </div>
                        <p className="text-sm text-indigo-700/70 font-medium leading-relaxed italic">
                            Branding and communication identifiers updated here are reflected across all regional digital interfaces. Ensure all regulatory metadata is correct before committing.
                        </p>
                    </div>
                </div>
            </div>
        </div>
    );
}
