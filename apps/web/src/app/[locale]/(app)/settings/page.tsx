"use client";

import { useState, useEffect } from 'react';
import { useTranslations } from 'next-intl';
import api from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { Input } from '@/components/ui/input';
import {
    Building2, MessageSquare, Save, Loader2, CreditCard,
    Link2, Zap, ShieldCheck, ExternalLink, Globe, Key, Users, Server
} from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { MfaSetup } from '@/components/auth/mfa-setup';
import { PaymentInstruments } from '@/components/PaymentInstruments';
import { useToast } from '@/components/ui/toast';

const fieldCls = "w-full h-9 px-3 bg-white border border-border rounded text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 transition-colors";
const labelCls = "block text-sm font-medium text-foreground mb-1";

/** ── SUPERADMIN: Platform-level configuration panel ────────────────────── */
function PlatformSettings() {
    const { locale } = useParams();
    const t = useTranslations('Settings');
    const { showToast } = useToast();
    return (
        <div className="max-w-4xl space-y-6">
            <div>
                <h1 className="text-xl font-bold text-foreground">{t('platformTitle')}</h1>
                <p className="text-sm text-muted-foreground mt-0.5">
                    {t('platformSubtitle')}
                </p>
            </div>

            <div className="grid lg:grid-cols-3 gap-6">
                <div className="lg:col-span-2 space-y-5">
                    {/* Platform info */}
                    <div className="bg-white border border-border rounded-md">
                        <div className="flex items-center gap-3 px-5 py-4 border-b border-border">
                            <Globe size={16} className="text-primary" />
                            <div>
                                <h3 className="text-sm font-bold text-foreground">{t('platformIdentity')}</h3>
                                <p className="text-xs text-muted-foreground">{t('platformIdentityDesc')}</p>
                            </div>
                        </div>
                        <div className="px-5 py-5 space-y-4">
                            <div className="grid grid-cols-2 gap-4 p-4 bg-slate-50 rounded-lg">
                                <div>
                                    <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1">{t('platformRole')}</p>
                                    <p className="text-sm font-bold text-foreground">SUPERADMIN</p>
                                </div>
                                <div>
                                    <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1">{t('accessLevel')}</p>
                                    <p className="text-sm font-bold text-emerald-600">{t('fullControl')}</p>
                                </div>
                            </div>
                            <div className="flex items-start gap-3 p-4 bg-indigo-50 border border-indigo-100 rounded-lg text-sm">
                                <Server size={16} className="text-indigo-500 mt-0.5 flex-shrink-0" />
                                <div>
                                    <p className="font-semibold text-indigo-800">{t('tenantBilling')}</p>
                                    <p className="text-indigo-600 text-xs mt-0.5">
                                        {t('tenantBillingDesc')}
                                    </p>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Platform quick actions */}
                    <div className="bg-white border border-border rounded-md">
                        <div className="flex items-center gap-3 px-5 py-4 border-b border-border">
                            <Key size={16} className="text-primary" />
                            <div>
                                <h3 className="text-sm font-bold text-foreground">{t('platformManagement')}</h3>
                                <p className="text-xs text-muted-foreground">{t('platformManagementDesc')}</p>
                            </div>
                        </div>
                        <div className="px-5 py-4 space-y-3">
                            <Link
                                href={`/${locale}/tenants`}
                                className="flex items-center justify-between p-3 rounded-lg border border-border hover:bg-slate-50 transition-colors group"
                            >
                                <div className="flex items-center gap-3">
                                    <Building2 size={15} className="text-muted-foreground" />
                                    <div>
                                        <p className="text-sm font-semibold text-foreground">{t('manageOrgs')}</p>
                                        <p className="text-xs text-muted-foreground">{t('manageOrgsDesc')}</p>
                                    </div>
                                </div>
                                <ExternalLink size={14} className="text-muted-foreground group-hover:text-primary transition-colors" />
                            </Link>
                            <Link
                                href={`/${locale}/users`}
                                className="flex items-center justify-between p-3 rounded-lg border border-border hover:bg-slate-50 transition-colors group"
                            >
                                <div className="flex items-center gap-3">
                                    <Users size={15} className="text-muted-foreground" />
                                    <div>
                                        <p className="text-sm font-semibold text-foreground">{t('managePlatformTeam')}</p>
                                        <p className="text-xs text-muted-foreground">{t('managePlatformTeamDesc')}</p>
                                    </div>
                                </div>
                                <ExternalLink size={14} className="text-muted-foreground group-hover:text-primary transition-colors" />
                            </Link>
                        </div>
                    </div>
                </div>

                {/* Right — MFA */}
                <div className="space-y-5">
                    <MfaSetup />
                    <div className="bg-white border border-border rounded-md px-5 py-4">
                        <h4 className="text-sm font-bold text-foreground mb-1 flex items-center gap-2">
                            <ShieldCheck size={14} className="text-emerald-500" /> {t('platformSecurity')}
                        </h4>
                        <p className="text-sm text-muted-foreground leading-relaxed">
                            {t('platformSecurityDesc')}
                        </p>
                    </div>
                </div>
            </div>
        </div>
    );
}

/** ── Tenant ADMIN: existing settings flow ──────────────────────────────── */
function TenantSettings() {
    const t = useTranslations('Settings');
    const { showToast } = useToast();
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [settings, setSettings] = useState<{ name: string; telegramBotToken: string; plan: string; billingEnabled?: boolean }>({ name: '', telegramBotToken: '', plan: 'FREE', billingEnabled: false });

    useEffect(() => {
        api.get('/settings')
            .then(res => setSettings(res.data))
            .catch(() => showToast(t('loadFailed'), 'error'))
            .finally(() => setLoading(false));
    }, []);

    const handleSave = async (e: React.FormEvent) => {
        e.preventDefault();
        setSaving(true);
        try {
            await api.put('/settings', settings);
            showToast(t('saved'), 'success');
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

    const handleManageSubscription = async () => {
        try {
            const res = await api.post('/billing/portal');
            window.location.href = res.data.url;
        } catch (err: any) {
            showToast('Could not open billing portal: ' + (err.response?.data?.message || err.message), 'error');
        }
    };

    if (loading) return (
        <div className="flex h-64 items-center justify-center text-muted-foreground text-sm">
            <Loader2 className="animate-spin mr-2" size={16} /> {t('loadingSettings')}
        </div>
    );

    return (
        <div className="max-w-4xl space-y-6">
            <div>
                <h1 className="text-xl font-bold text-foreground">{t('title')}</h1>
                <p className="text-sm text-muted-foreground mt-0.5">{t('subtitle')}</p>
            </div>

            <div className="grid lg:grid-cols-3 gap-6">
                <div className="lg:col-span-2 space-y-5">
                    <form onSubmit={handleSave} className="space-y-5">
                        {/* Organization */}
                        <div className="bg-white border border-border rounded-md">
                            <div className="flex items-center gap-3 px-5 py-4 border-b border-border">
                                <Building2 size={16} className="text-primary" />
                                <div>
                                    <h3 className="text-sm font-bold text-foreground">{t('organization')}</h3>
                                    <p className="text-xs text-muted-foreground">{t('organizationDesc')}</p>
                                </div>
                            </div>
                            <div className="px-5 py-4">
                                <label htmlFor="orgName" className={labelCls}>{t('orgName')}</label>
                                <input
                                    id="orgName"
                                    className={fieldCls}
                                    placeholder={t('orgNamePlaceholder')}
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
                                    <h3 className="text-sm font-bold text-foreground">{t('telegram')}</h3>
                                    <p className="text-xs text-muted-foreground">{t('telegramDesc')}</p>
                                </div>
                            </div>
                            <div className="px-5 py-4 space-y-3">
                                <label htmlFor="tgToken" className={labelCls}>{t('botToken')}</label>
                                <input
                                    id="tgToken"
                                    type="password"
                                    autoComplete="off"
                                    className={fieldCls}
                                    placeholder={t('botTokenPlaceholder')}
                                    value={settings.telegramBotToken || ''}
                                    onChange={e => setSettings({ ...settings, telegramBotToken: e.target.value })}
                                />
                                <p className="text-xs text-muted-foreground flex items-center gap-1.5">
                                    <Link2 size={12} />
                                    {t('getTokenPre')}{' '}
                                    <a href="https://t.me/BotFather" target="_blank" className="text-primary hover:underline">@BotFather</a>{' '}
                                    {t('getTokenPost')}
                                </p>
                            </div>
                        </div>

                        <div className="flex justify-start">
                            <button type="submit" disabled={saving} className="btn-primary">
                                {saving && <Loader2 size={14} className="animate-spin" />}
                                <Save size={14} />
                                {saving ? t('saving') : t('saveChanges')}
                            </button>
                        </div>
                    </form>

                    {/* Static-QR collection instruments (display-only payment rail) */}
                    <PaymentInstruments />

                    {/* Subscription */}
                    <div className="bg-primary text-primary-foreground border border-primary rounded-md">
                        <div className="flex items-center gap-3 px-5 py-4 border-b border-white/20">
                            <CreditCard size={16} />
                            <div>
                                <h3 className="text-sm font-bold">{t('subscription')}</h3>
                                <p className="text-xs text-primary-foreground/70">{t('subscriptionDesc')}</p>
                            </div>
                        </div>
                        <div className="px-5 py-4 flex items-center justify-between gap-4">
                            <div>
                                <p className="text-xs text-primary-foreground/60 uppercase tracking-wide mb-1 flex items-center gap-1.5">
                                    <Zap size={12} /> {t('currentPlan')}
                                </p>
                                <p className="text-2xl font-bold">{settings.plan}</p>
                            </div>
                            <div className="flex flex-col gap-2">
                                {settings.billingEnabled === false ? (
                                    <span className="text-xs font-semibold text-white/70 bg-white/10 border border-white/20 px-4 py-2 rounded">
                                        {t('billingSoon')}
                                    </span>
                                ) : settings.plan === 'FREE' ? (
                                    <button
                                        onClick={() => handleUpgrade('PRO')}
                                        className="bg-white text-primary font-bold text-sm px-5 py-2 rounded hover:bg-white/90 transition-colors"
                                    >
                                        {t('upgradePro')}
                                    </button>
                                ) : (
                                    <>
                                        <button
                                            onClick={() => handleUpgrade('ENTERPRISE')}
                                            className="border border-white/30 text-white font-semibold text-sm px-5 py-2 rounded hover:bg-white/10 transition-colors"
                                        >
                                            {t('upgradeEnterprise')}
                                        </button>
                                        <button
                                            onClick={handleManageSubscription}
                                            className="flex items-center justify-center gap-1.5 border border-white/20 text-white/80 font-medium text-xs px-5 py-1.5 rounded hover:bg-white/10 transition-colors"
                                        >
                                            <ExternalLink size={11} /> {t('manageSubscription')}
                                        </button>
                                    </>
                                )}
                            </div>
                        </div>
                        <div className="px-5 pb-4">
                            <p className="text-xs text-primary-foreground/50 flex items-center gap-1.5">
                                <ShieldCheck size={12} />
                                {settings.billingEnabled === false
                                    ? t('billingNotEnabled')
                                    : t('billingStripe')}
                            </p>
                        </div>
                    </div>
                </div>

                <div className="space-y-5">
                    <MfaSetup />
                    <div className="bg-white border border-border rounded-md px-5 py-4">
                        <h4 className="text-sm font-bold text-foreground mb-1">{t('globalScope')}</h4>
                        <p className="text-sm text-muted-foreground leading-relaxed">
                            {t('globalScopeDesc')}
                        </p>
                    </div>
                </div>
            </div>
        </div>
    );
}

/** ── Root: detect role from AuthProvider and render the right panel ───────── */
export default function SettingsPage() {
    const t = useTranslations('Settings');
    const { user, loading } = useAuth(); // single /auth/me from AuthProvider

    if (loading) return (
        <div className="flex h-64 items-center justify-center text-muted-foreground text-sm">
            <Loader2 className="animate-spin mr-2" size={16} /> {t('loading')}
        </div>
    );

    return user?.role === 'SUPERADMIN' ? <PlatformSettings /> : <TenantSettings />;
}
