"use client";
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useParams, usePathname } from 'next/navigation';
import { useState } from 'react';
import { AuthProvider, useAuth } from '@/lib/auth-context';
import { LogOut, Menu, X, ChevronRight, CircleHelp } from 'lucide-react';
import { ApiErrorListener } from '@/components/ApiErrorListener';
import { useEffect } from 'react';
import { clarityIdentify, claritySetTag } from '@/lib/clarity';
import { WorkspaceProvider, useQueueCount, useWorkspace } from '@/lib/workspace';
import { NAV, PLATFORM_NAV, visibleNav, type NavItem } from '@/lib/nav';
import { GlobalSearch } from '@/components/workspace/GlobalSearch';
import { ShellBanners, ShellChips } from '@/components/workspace/ShellStatus';
import { LearningProvider } from '@/lib/learning';
import { TourProvider } from '@/components/learning/TourProvider';
import { TourButton } from '@/components/learning/TourButton';
import { OrientationPrompt } from '@/components/learning/OrientationPrompt';

function AppShell({ children }: { children: React.ReactNode }) {
    const { locale } = useParams();
    const t = useTranslations('Nav');
    const tw = useTranslations('Workspace');
    const ws = useWorkspace();
    const queueCount = useQueueCount();
    const pathname = usePathname();
    const { user } = useAuth(); // single /auth/me — no per-page duplicate calls
    const [sidebarOpen, setSidebarOpen] = useState(false);

    // Swap the leading locale segment of the current path so switching language
    // keeps the user on the same page (instead of always jumping to /dashboard).
    const localizedPath = (target: string) => {
        const parts = (pathname || `/${locale}`).split('/');
        if (parts.length > 1) parts[1] = target;
        const next = parts.join('/');
        return next || `/${target}`;
    };

    const isPlatform = user?.isPlatform;
    // Menus come from the lending permission engine (GET /me/access) and the
    // legacy screens' own permissions — never from legacy role names alone.
    const sections = visibleNav(isPlatform ? PLATFORM_NAV : NAV, ws);

    useEffect(() => {
        if (!user) return;
        // Identify with stable internal subject only; never send raw PII to analytics.
        clarityIdentify(user.sub);
        claritySetTag('user_role', user.role);
        claritySetTag('is_platform', !!user.isPlatform);
        claritySetTag('tenant_scope', user.tenantId || 'platform');
    }, [user]);

    const navItem = (item: NavItem) => {
        const { href, icon: Icon } = item;
        const label = tw(`nav.${item.key}`);
        const active = pathname === `/${locale}${href}` || ((href.startsWith('/lending/') || href === '/help' || href === '/learn') && pathname.startsWith(`/${locale}${href}/`));
        const count = queueCount(item.queues);
        return (
            <Link
                key={href}
                href={`/${locale}${href}`}
                {...(item.tour ? { 'data-tour': 'nav-learn' } : {})}
                onClick={() => setSidebarOpen(false)}
                className={`flex items-center gap-2.5 px-3 py-2 rounded text-sm transition-colors ${active
                    ? 'bg-sidebar-accent text-white font-semibold'
                    : 'text-sidebar-foreground hover:bg-sidebar-accent/60 hover:text-white'
                    }`}
            >
                <Icon size={15} className={active ? 'text-sidebar-primary' : 'text-sidebar-foreground/70'} />
                <span className="flex-1 min-w-0 truncate">{label}</span>
                {count > 0 && (
                    <span className="text-[10.5px] font-bold rounded-full px-1.5 min-w-[18px] text-center tabular-nums bg-sidebar-primary text-white" aria-label={tw('shell.waiting', { count })}>
                        {count > 99 ? '99+' : count}
                    </span>
                )}
            </Link>
        );
    };

    const navSection = (title: string) => (
        <p key={`sec-${title}`} className="px-3 pt-4 pb-1 text-[10px] font-bold uppercase tracking-wider text-sidebar-foreground/40">{title}</p>
    );

    return (
        <div className="flex h-screen overflow-hidden" style={{ fontFamily: 'Arial, Helvetica, sans-serif', background: '#F4F5F7' }}>
            {/* Mobile overlay */}
            {sidebarOpen && (
                <div className="fixed inset-0 bg-black/40 z-40 lg:hidden" onClick={() => setSidebarOpen(false)} />
            )}

            {/* Sidebar */}
            <aside
                className={`fixed lg:relative inset-y-0 left-0 z-50 w-56 flex flex-col flex-shrink-0 transition-transform duration-200 ${sidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'
                    }`}
                style={{ background: '#253858', borderRight: '1px solid #344563' }}
            >
                {/* Brand */}
                <div className="h-14 flex items-center justify-between px-4" style={{ borderBottom: '1px solid #344563' }}>
                    <div className="flex items-center gap-2.5">
                        <div className="w-7 h-7 bg-sidebar-primary rounded flex items-center justify-center text-white text-xs font-bold flex-shrink-0">
                            {user?.tenantName?.charAt(0)?.toUpperCase() ?? 'M'}
                        </div>
                        <span className="text-[14px] font-bold text-white truncate">
                            {user?.tenantName ?? 'MicroLoan'}
                        </span>
                    </div>
                    <button onClick={() => setSidebarOpen(false)} className="lg:hidden text-sidebar-foreground/60 hover:text-white">
                        <X size={16} />
                    </button>
                </div>

                {/* Nav */}
                <nav data-tour="nav-menu" className="flex-1 p-2 overflow-y-auto no-scrollbar space-y-0.5">
                    {sections.map((sec) => (
                        <div key={sec.key}>
                            {navSection(tw(`sections.${sec.key}`))}
                            {sec.items.map(navItem)}
                        </div>
                    ))}
                </nav>

                {/* User */}
                <div className="p-3" style={{ borderTop: '1px solid #344563' }}>
                    <div className="flex items-center gap-2.5 px-2 py-2 mb-1 rounded" style={{ background: '#344563' }}>
                        <div className="w-7 h-7 rounded bg-sidebar-primary/30 flex items-center justify-center text-xs font-bold text-white flex-shrink-0">
                            {user?.email?.charAt(0)?.toUpperCase()}
                        </div>
                        <div className="min-w-0 flex-1">
                            <p className="text-[13px] font-semibold text-white truncate capitalize leading-tight">
                                {user?.email?.split('@')[0]}
                            </p>
                            <p className="text-[11px] text-sidebar-foreground/60 truncate tracking-wide" title={ws.access?.roles.map((r) => r.name).join(', ') || user?.role}>
                                {ws.access?.roles.length ? ws.access.roles.map((r) => r.name).join(', ') : user?.role}
                            </p>
                        </div>
                    </div>
                    <button
                        onClick={async () => {
                            await fetch('/api/auth/logout', { method: 'POST' });
                            window.location.href = `/${locale}/login`;
                        }}
                        className="flex items-center gap-2 w-full px-2 py-1.5 text-sm text-sidebar-foreground/70 hover:text-white hover:bg-sidebar-accent/60 rounded transition-colors"
                    >
                        <LogOut size={14} />
                        {t('signOut')}
                    </button>
                </div>
            </aside>

            {/* Main content */}
            <div className="flex-1 flex flex-col min-w-0 overflow-auto">
                {/* Topbar */}
                <header className="h-14 bg-white border-b border-border flex items-center justify-between gap-3 px-5 sticky top-0 z-30 flex-shrink-0">
                    <div className="flex items-center gap-3">
                        <button
                            onClick={() => setSidebarOpen(true)}
                            className="lg:hidden p-1.5 rounded text-muted-foreground hover:bg-accent transition-colors"
                        >
                            <Menu size={18} />
                        </button>
                        {/* Breadcrumb */}
                        <nav className="hidden xl:flex items-center gap-1 text-sm text-muted-foreground">
                            <span>MicroLoan</span>
                            <ChevronRight size={14} />
                            <span className="text-foreground font-medium capitalize">
                                {pathname.split('/').filter(Boolean).pop()?.replace(/-/g, ' ')}
                            </span>
                        </nav>
                    </div>
                    <GlobalSearch platform={!!isPlatform} />
                    <ShellChips />
                    {!pathname.startsWith(`/${locale}/lending`) && <TourButton compact />}
                    <Link
                        data-tour="help-link"
                        href={`/${locale}/help`}
                        title={tw('nav.userGuide')}
                        aria-label={tw('nav.userGuide')}
                        className="flex items-center gap-1.5 px-2 py-1.5 rounded text-sm text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                    >
                        <CircleHelp size={17} />
                        <span className="hidden md:inline text-xs font-semibold">{tw('nav.help')}</span>
                    </Link>
                    {/* Locale switcher */}
                    <div data-tour="language-switch" className="flex items-center gap-0.5 border border-border rounded p-0.5 bg-muted">
                        <Link
                            href={localizedPath('en')}
                            className={`px-3 py-1 text-xs rounded font-semibold transition-colors ${locale === 'en' ? 'bg-white text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
                                }`}
                        >EN</Link>
                        <Link
                            href={localizedPath('km')}
                            className={`px-3 py-1 text-xs rounded font-semibold transition-colors ${locale === 'km' ? 'bg-white text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
                                }`}
                        >KM</Link>
                    </div>
                </header>

                <ShellBanners />

                {/* Page content */}
                <main className="flex-1 p-6">
                    {children}
                </main>
            </div>
            <ApiErrorListener />
            {!isPlatform && <OrientationPrompt />}
        </div>
    );
}

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
    return (
        <AuthProvider>
            <WorkspaceProvider>
                <LearningProvider>
                    <TourProvider>
                        <AppShell>{children}</AppShell>
                    </TourProvider>
                </LearningProvider>
            </WorkspaceProvider>
        </AuthProvider>
    );
}
