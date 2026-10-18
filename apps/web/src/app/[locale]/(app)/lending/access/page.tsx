"use client";

import { Suspense } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { RefreshCw } from 'lucide-react';
import { LendingShell } from '@/components/lending/LendingShell';
import { Btn, ErrorBox, Spinner, Tabs } from '@/components/lending/ui';
import { useApi } from '@/components/lending/useAsync';
import type { AccessOverview } from '@/components/lending/types';
import { RolesTab } from '@/components/lending/access/RolesTab';
import { AssignmentsTab } from '@/components/lending/access/AssignmentsTab';
import { DelegationsTab } from '@/components/lending/access/DelegationsTab';
import { AuthoritiesTab } from '@/components/lending/access/AuthoritiesTab';
import { PoliciesTab } from '@/components/lending/access/PoliciesTab';
import { FlagsTab } from '@/components/lending/access/FlagsTab';
import { ServiceAccountsTab } from '@/components/lending/access/ServiceAccountsTab';
import { SimulatorTab } from '@/components/lending/access/SimulatorTab';
import { BranchesTab } from '@/components/lending/access/BranchesTab';
import { useTranslations } from 'next-intl';

const TAB_KEYS = ['roles', 'assignments', 'delegations', 'authorities', 'policies', 'flags', 'service-accounts', 'branches', 'simulator'] as const;
type TabKey = (typeof TAB_KEYS)[number];

function isTab(v: string | null): v is TabKey {
    return !!v && (TAB_KEYS as readonly string[]).includes(v);
}

export default function AccessPage() {
    return (
        <Suspense fallback={<Spinner />}>
            <AccessPageInner />
        </Suspense>
    );
}

function AccessPageInner() {
    const params = useSearchParams();
    const router = useRouter();
    const pathname = usePathname();
    const raw = params.get('tab');
    const tab: TabKey = isTab(raw) ? raw : 'roles';
    const { data, error, loading, reload } = useApi<AccessOverview>('/lending/access');
    const tg = useTranslations('Governance');

    const setTab = (t: TabKey) => {
        const next = new URLSearchParams(params.toString());
        next.set('tab', t);
        router.replace(`${pathname}?${next.toString()}`, { scroll: false });
    };

    const pendingCount = (n: number) => (n > 0 ? <span className="ml-1.5 inline-flex min-w-[18px] justify-center rounded-full bg-amber-100 px-1 text-[10px] font-bold text-amber-800">{n}</span> : null);
    const pendingPolicies = data?.policies.reduce((n, p) => n + p.versions.filter((v) => v.status === 'SUBMITTED').length, 0) ?? 0;

    const tabs: { value: TabKey; label: React.ReactNode }[] = [
        { value: 'roles', label: 'Role matrix' },
        { value: 'assignments', label: <span data-tour="access-tab-assignments">Assignments{pendingCount(data?.assignments.filter((a) => a.status === 'PENDING').length ?? 0)}</span> },
        { value: 'delegations', label: <span data-tour="access-tab-delegations">Delegations{pendingCount(data?.delegations.filter((d) => d.status === 'PENDING').length ?? 0)}</span> },
        { value: 'authorities', label: <span data-tour="access-tab-authorities">Approval authorities{pendingCount(data?.authorities.filter((a) => a.status === 'PENDING').length ?? 0)}</span> },
        { value: 'policies', label: <>ABAC policies{pendingCount(pendingPolicies)}</> },
        { value: 'flags', label: 'Feature flags' },
        { value: 'service-accounts', label: 'Service accounts' },
        { value: 'branches', label: tg('branches.tab') },
        { value: 'simulator', label: <span data-tour="access-tab-simulator">Policy simulator</span> },
    ];

    // Service accounts load their own list and don't need the overview.
    const needsOverview = tab !== 'service-accounts' && tab !== 'branches';

    return (
        <LendingShell
            title="Access & policy"
            subtitle="Roles, scoped assignments, delegations, approval limits, ABAC policies and feature flags. Every change is maker-checker controlled."
            actions={<Btn size="sm" onClick={reload} busy={loading}><RefreshCw size={13} /> Refresh</Btn>}
        >
            <Tabs tabs={tabs} value={tab} onChange={setTab} />
            {tab === 'service-accounts' && <ServiceAccountsTab />}
            {tab === 'branches' && <BranchesTab onChanged={reload} />}
            {needsOverview && (
                <>
                    <ErrorBox error={error} />
                    {!data ? (loading ? <Spinner /> : null) : (
                        <>
                            {tab === 'roles' && <RolesTab data={data} reload={reload} />}
                            {tab === 'assignments' && <AssignmentsTab data={data} reload={reload} />}
                            {tab === 'delegations' && <DelegationsTab data={data} reload={reload} />}
                            {tab === 'authorities' && <AuthoritiesTab data={data} reload={reload} />}
                            {tab === 'policies' && <PoliciesTab data={data} reload={reload} />}
                            {tab === 'flags' && <FlagsTab data={data} reload={reload} />}
                            {tab === 'simulator' && <SimulatorTab data={data} reload={reload} />}
                        </>
                    )}
                </>
            )}
        </LendingShell>
    );
}
