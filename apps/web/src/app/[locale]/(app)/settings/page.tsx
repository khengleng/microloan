"use client";

import { useState, useEffect } from 'react';
import api from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Building2, MessageSquare, Save, Settings, Loader2, CreditCard } from 'lucide-react';
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

    if (loading) {
        return <div className="p-12 text-center text-slate-500">Loading your settings...</div>;
    }

    return (
        <div className="max-w-4xl mx-auto space-y-8 animate-in fade-in duration-500">
            <header className="flex items-center gap-3">
                <Settings className="text-slate-400" size={32} />
                <div>
                    <h1 className="text-3xl font-bold tracking-tight">Organization Settings</h1>
                    <p className="text-slate-500">Manage your organization's identity and communication channels.</p>
                </div>
            </header>

            <div className="grid md:grid-cols-2 gap-8">
                <div className="space-y-8">
                    <form onSubmit={handleSave} className="space-y-8">
                        {/* Branding & Logo */}
                        <Card>
                            <CardHeader>
                                <CardTitle className="flex items-center gap-2">
                                    <Building2 size={20} className="text-blue-500" />
                                    Identity
                                </CardTitle>
                                <CardDescription>Update your public-facing organization details.</CardDescription>
                            </CardHeader>
                            <CardContent className="space-y-4">
                                <div className="space-y-2">
                                    <Label htmlFor="orgName">Organization Name</Label>
                                    <Input
                                        id="orgName"
                                        value={settings.name}
                                        onChange={e => setSettings({ ...settings, name: e.target.value })}
                                        placeholder="Acme Finance"
                                    />
                                </div>
                            </CardContent>
                        </Card>

                        {/* Telegram Bot */}
                        <Card className="border-blue-100 shadow-md">
                            <CardHeader>
                                <CardTitle className="flex items-center gap-2">
                                    <MessageSquare size={20} className="text-blue-600" />
                                    Telegram Bot
                                </CardTitle>
                                <CardDescription>Connect your organization's dedicated bot for client interactions.</CardDescription>
                            </CardHeader>
                            <CardContent className="space-y-4">
                                <div className="space-y-2">
                                    <Label htmlFor="tgToken">Bot Token</Label>
                                    <Input
                                        id="tgToken"
                                        type="password"
                                        value={settings.telegramBotToken || ''}
                                        onChange={e => setSettings({ ...settings, telegramBotToken: e.target.value })}
                                        placeholder="123456789:ABCDE..."
                                    />
                                    <p className="text-[10px] text-slate-400">
                                        Get a token from <a href="https://t.me/BotFather" target="_blank" className="text-blue-600 hover:underline">@BotFather</a> on Telegram.
                                    </p>
                                </div>
                            </CardContent>
                        </Card>

                        <div className="flex justify-start">
                            <Button
                                type="submit"
                                disabled={saving}
                                className="bg-slate-900 hover:bg-slate-800 text-white min-w-[150px]"
                            >
                                {saving ? <Loader2 className="animate-spin mr-2" size={18} /> : <Save className="mr-2" size={18} />}
                                Save Branding
                            </Button>
                        </div>
                    </form>

                    {/* Billing & Subscriptions */}
                    <Card className="border-green-100 shadow-md">
                        <CardHeader>
                            <CardTitle className="flex items-center gap-2">
                                <CreditCard size={20} className="text-emerald-600" />
                                Billing & Plan
                            </CardTitle>
                            <CardDescription>Manage your platform subscription.</CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <div className="p-4 bg-slate-50 rounded-lg flex items-center justify-between">
                                <div>
                                    <p className="text-sm font-semibold text-slate-700">Current Plan</p>
                                    <p className="text-2xl font-bold text-slate-900">{settings.plan}</p>
                                </div>
                                {settings.plan === 'FREE' ? (
                                    <Button onClick={() => handleUpgrade('PRO')} className="bg-emerald-600 hover:bg-emerald-700 text-white">Upgrade to PRO</Button>
                                ) : (
                                    <Button variant="outline" onClick={() => handleUpgrade('ENTERPRISE')}>Switch to Enterprise</Button>
                                )}
                            </div>
                            <p className="text-xs text-slate-500">
                                Upgrading your plan will safely redirect you to our Stripe checkout portal.
                            </p>
                        </CardContent>
                    </Card>
                </div>

                <div className="space-y-8">
                    <MfaSetup />
                </div>
            </div>
        </div>
    );
}
