"use client";

import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { PENDING_KINDS, PendingApprovalsView, type PendingKind } from '@/components/lending/servicing/PendingApprovalsView';

function Approvals() {
    const action = useSearchParams().get('action');
    const initial = PENDING_KINDS.includes(action as PendingKind) ? (action as PendingKind) : 'FEE_WAIVER';
    return <PendingApprovalsView key={initial} initial={initial} />;
}

export default function LendingApprovalsPage() {
    // ?action=… is read from the search params, which Next requires inside Suspense.
    return (
        <Suspense>
            <Approvals />
        </Suspense>
    );
}
