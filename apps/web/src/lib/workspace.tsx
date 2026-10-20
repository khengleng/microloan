"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import api from '@/lib/api';
import { useAuth } from '@/lib/auth-context';

/** GET /me/access — the signed-in person's effective lending access. */
export interface MyAccess {
    principal: { type: 'USER' | 'PLATFORM'; id: string; email: string | null; branchId: string | null; branchName: string | null };
    tenant: { id: string; name: string } | null;
    businessDate: string | null;
    hasLending: boolean;
    roles: { code: string; name: string; description: string; sources: string[] }[];
    permissions: string[];
    scope: {
        all: boolean;
        allBranches: boolean;
        branches: { id: string; name: string; code: string | null }[];
        portfolioIds: string[];
        legalEntities: { id: string; code: string; name: string }[];
    };
    authorities: { permission: string; currency: string; maxAmount: string; familyCode: string | null; source: string }[];
    delegations: {
        received: { id: string; fromUserId: string; fromEmail: string | null; permissions: string[]; maxAmount: string | null; currency: string | null; validTo: string }[];
        given: { id: string; toUserId: string; toEmail: string | null; permissions: string[]; validTo: string }[];
    };
    assurance: { current: string; mfaEnrolled: boolean; mfaGatedPermissions: string[]; stepUpNeeded: boolean };
    flags: { key: string; enabled: boolean; source: string }[];
    legacy: { role: string | null; permissions: string[] };
}

export interface WorkItem {
    id: string;
    reference: string;
    label: string;
    amount?: string | null;
    currency?: string | null;
    href: string;
    since?: string | null;
    aboveLimit?: boolean;
}

export interface WorkQueue {
    code: string;
    title: string;
    permission: string;
    action: string;
    kind: 'MAKER' | 'CHECKER' | 'INFO';
    money: boolean;
    needsMfa: boolean;
    count: number;
    href: string;
    items: WorkItem[];
}

/** GET /me/work — what is waiting for this person. */
export interface MyWork {
    businessDate: string | null;
    total: number;
    queues: WorkQueue[];
}

interface WorkspaceValue {
    access: MyAccess | null;
    work: MyWork | null;
    /** The access call has settled (successfully or not). */
    ready: boolean;
    reloadWork: () => void;
    /** Lending permissions held; empty until /me/access answers. */
    can: (permission: string) => boolean;
    /** Legacy (original app) permissions, from /auth/me while /me/access loads. */
    legacyCan: (permission: string) => boolean;
    legacyRole: string | null;
    /** Loans in the legacy loan archive this person can read (D-154); null until known or without access. */
    legacyLoans: number | null;
    isPlatform: boolean;
}

const WorkspaceContext = createContext<WorkspaceValue>({
    access: null,
    work: null,
    ready: false,
    reloadWork: () => undefined,
    can: () => false,
    legacyCan: () => false,
    legacyRole: null,
    legacyLoans: null,
    isPlatform: false,
});

const WORK_REFRESH_MS = 60_000;

/** Loads /me/access once and /me/work every minute for the shell, home and menus. */
export function WorkspaceProvider({ children }: { children: React.ReactNode }) {
    const { user } = useAuth();
    const [access, setAccess] = useState<MyAccess | null>(null);
    const [accessSettled, setAccessSettled] = useState(false);
    const [work, setWork] = useState<MyWork | null>(null);
    const [workVersion, setWorkVersion] = useState(0);
    const [legacyLoans, setLegacyLoans] = useState<number | null>(null);
    // Until a required authenticator is set up (D-128) only My account
    // answers; asking for access and work would just be refused (403). An
    // enrolled person on an older session still asks: the refusal is a
    // step-up, which prompts for a code (D-129).
    const signedIn = !!user && !(user.mfaEnrolmentRequired && !user.mfaEnrolled);

    useEffect(() => {
        if (!signedIn) return;
        let cancelled = false;
        api.get<MyAccess>('/me/access').then(
            (r) => { if (!cancelled) { setAccess(r.data); setAccessSettled(true); } },
            () => { if (!cancelled) setAccessSettled(true); },
        );
        return () => { cancelled = true; };
    }, [signedIn]);

    // The legacy loan archive is in the menu only while the organisation still
    // has loans of the original module (D-154).
    const archiveReader = !!access?.permissions.includes('legacy_loan.read');
    useEffect(() => {
        if (!signedIn || !archiveReader) return;
        let cancelled = false;
        api.get<{ total: number }>('/lending/legacy-archive/summary').then(
            (r) => { if (!cancelled) setLegacyLoans(r.data.total); },
            () => undefined,
        );
        return () => { cancelled = true; };
    }, [signedIn, archiveReader]);

    useEffect(() => {
        if (!signedIn) return;
        let cancelled = false;
        const load = () => api.get<MyWork>('/me/work').then(
            (r) => { if (!cancelled) setWork(r.data); },
            () => undefined,
        );
        void load();
        const timer = setInterval(load, WORK_REFRESH_MS);
        return () => { cancelled = true; clearInterval(timer); };
    }, [signedIn, workVersion]);

    const value = useMemo<WorkspaceValue>(() => {
        const perms = new Set(access?.permissions ?? []);
        const legacy = new Set(access?.legacy.permissions ?? (user as { permissions?: string[] } | null)?.permissions ?? []);
        return {
            access,
            work,
            ready: accessSettled || !signedIn,
            reloadWork: () => setWorkVersion((v) => v + 1),
            can: (p) => perms.has(p),
            legacyCan: (p) => legacy.has(p),
            legacyRole: access?.legacy.role ?? user?.role ?? null,
            legacyLoans: archiveReader ? legacyLoans : null,
            isPlatform: !!user?.isPlatform,
        };
    }, [access, work, accessSettled, signedIn, user, archiveReader, legacyLoans]);

    return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

export function useWorkspace() {
    return useContext(WorkspaceContext);
}

/** Count of a set of queues, ignoring information-only ones. */
export function useQueueCount() {
    const { work } = useWorkspace();
    return useCallback((codes: string[] | undefined) => {
        if (!codes?.length || !work) return 0;
        return work.queues
            .filter((q) => q.kind !== 'INFO' && codes.includes(q.code))
            .reduce((a, q) => a + q.count, 0);
    }, [work]);
}
