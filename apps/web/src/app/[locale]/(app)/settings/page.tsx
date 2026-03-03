"use client";

import { useState, useEffect } from 'react';
import api from '@/lib/api';
import { Input } from '@/components/ui/input';
import { Building2, MessageSquare, Save, Settings, Loader2, CreditCard, Link2, Zap, ShieldCheck } from 'lucide-react';
import { MfaSetup } from '@/components/auth/mfa-setup';
import { useToast } from '@/components/ui/toast';

const fieldCls = "w-full h-9 px-3 bg-white border border-border rounded text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 transition-colors";
const labelCls = "block text-sm font-medium text-foreground mb-1";

export default function SettingsPage() {
    const { showToast } = useToast();
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [settings, setSettings] = useState({ name: '', telegramBotToken: '', plan: 'FREE' });

    useEffect(() => {
        api.get('/settings')
            .then(res => setSettings(res.data))
            .catch(() => showToast('Failed to load settings', 'error'))
            .finally(() => setLoading(false));
    }, []);

    const handleSave = async (e: React.FormEvent) => {
        e.preventDefault();
        setSaving(true);
        try {
            await api.put('/settings', settings);
            showToast('Settings saved successfully', 'success');
        } catch (err: any) {
            showToast('Failed to save: ' + (err.response?.data?.message || err.message), 'error');
        } finally {
            setSaving(false);
        }
    };

    const handleUpgrade = async (plan: string) => {
        try {
            const res = await api.post('/billing/checkout', { plan });
            window.location.href = res.data.url;
        } catch (err: any) {
            showToast('Checkout failed: ' + (err.response?.data?.message || err.message), 'error');
        }
    };

    if (loading) return (
        <div className="flex h-64 items-center justify-center text-muted-foreground text-sm">
            <Loader2 className="animate-spin mr-2" size={16} /> Loading settings...
        </div>
    );

    return (
        <div className="max-w-4xl space-y-6">
            <div>
                <h1 className="text-xl font-bold text-foreground">Settings</h1>
                <p className="text-sm text-muted-foreground mt-0.5">Manage your organization configuration and integrations.</p>
            </div>

            <div className="grid lg:grid-cols-3 gap-6">
                {/* Left column — forms */}
                <div className="lg:col-span-2 space-y-5">
                    <form onSubmit={handleSave} className="space-y-5">
                        {/* Organization */}
                        <div className="bg-white border border-border rounded-md">
                            <div className="flex items-center gap-3 px-5 py-4 border-b border-border">
                                <Building2 size={16} className="text-primary" />
                                <div>
                                    <h3 className="text-sm font-bold text-foreground">Organization</h3>
                                    <p className="text-xs text-muted-foreground">Your organization's display name.</p>
                                </div>
                            </div>
                            <div className="px-5 py-4">
                                <label htmlFor="orgName" className={labelCls}>Organization Name</label>
                                <input
                                    id="orgName"
                                    className={fieldCls}
                                    placeholder="Acme Microfinance"
                                    value={settings.name}
                                    onChange={e => setSettings({ ...settings, name: e.target.value })}
                                />
                            </div>
                        </div>

                        {/* Telegram */}
                        <div className="bg-white border border-border rounded-md">
                            <div className="flex items-center gap-3 px-5 py-4 border-b border-border">
                                <MessageSquare size={16} className="text-primary" />
                                <div>
                                    <h3 className="text-sm font-bold text-foreground">Telegram Notifications</h3>
                                    <p className="text-xs text-muted-foreground">Receive alerts via your Telegram bot.</p>
                                </div>
                            </div>
                            <div className="px-5 py-4 space-y-3">
                                <div>
                                    <label htmlFor="tgToken" className={labelCls}>Bot Token</label>
                                    <input
                                        id="tgToken"
                                        type="password"
                                        className={fieldCls}
                                        placeholder="Paste your bot token..."
                                        value={settings.telegramBotToken || ''}
                                        onChange={e => setSettings({ ...settings, telegramBotToken: e.target.value })}
                                    />
                                </div>
                                <p className="text-xs text-muted-foreground flex items-center gap-1.5">
                                    <Link2 size={12} />
                                    Get your token from{' '}
                                    <a href="https://t.me/BotFather" target="_blank" className="text-primary hover:underline">
                                        @BotFather
                                    </a>{' '}
                                    on Telegram.
                                </p>
                            </div>
                        </div>

                        <div className="flex justify-start">
                            <button type="submit" disabled={saving} className="btn-primary">
                                {saving && <Loader2 size={14} className="animate-spin" />}
                                <Save size={14} />
                                {saving ? 'Saving...' : 'Save Changes'}
                            </button>
                        </div>
                    </form>

                    {/* Subscription */}
                    <div className="bg-primary text-primary-foreground border border-primary rounded-md">
                        <div className="flex items-center gap-3 px-5 py-4 border-b border-white/20">
                            <CreditCard size={16} />
                            <div>
                                <h3 className="text-sm font-bold">Subscription Plan</h3>
                                <p className="text-xs text-primary-foreground/70">Your current platform tier.</p>
                            </div>
                        </div>
                        <div className="px-5 py-4 flex items-center justify-between gap-4">
                            <div>
                                <p className="text-xs text-primary-foreground/60 uppercase tracking-wide mb-1 flex items-center gap-1.5">
                                    <Zap size={12} /> Current Plan
                                </p>
                                <p className="text-2xl font-bold">{settings.plan}</p>
                            </div>
                            {settings.plan === 'FREE' ? (
                                <button
                                    onClick={() => handleUpgrade('PRO')}
                                    className="bg-white text-primary font-bold text-sm px-5 py-2 rounded hover:bg-white/90 transition-colors"
                                >
                                    Upgrade to PRO
                                </button>
                            ) : (
                                <button
                                    onClick={() => handleUpgrade('ENTERPRISE')}
                                    className="border border-white/30 text-white font-semibold text-sm px-5 py-2 rounded hover:bg-white/10 transition-colors"
                                >
                                    Enterprise
                                </button>
                            )}
                        </div>
                        <div className="px-5 pb-4">
                            <p className="text-xs text-primary-foreground/50 flex items-center gap-1.5">
                                <ShieldCheck size={12} /> Billing managed securely via Stripe.
                            </p>
                        </div>
                    </div>
                </div>

                {/* Right column — MFA */}
                <div className="space-y-5">
                    <MfaSetup />
                    <div className="bg-white border border-border rounded-md px-5 py-4">
                        <h4 className="text-sm font-bold text-foreground mb-1">Global Scope</h4>
                        <p className="text-sm text-muted-foreground leading-relaxed">
                            Changes here apply across all users in your organization. Ensure settings are correct before saving.
                        </p>
                    </div>
                </div>
            </div>
        </div>
    );
}
