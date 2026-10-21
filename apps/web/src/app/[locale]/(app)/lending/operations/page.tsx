"use client";

import { Suspense } from 'react';
import { useTranslations } from 'next-intl';
import { LendingShell } from '@/components/lending/LendingShell';
import { OperationsView } from '@/components/lending/operations/OperationsView';
import { Spinner } from '@/components/lending/ui';

export default function LendingOperationsPage() {
    const tw = useTranslations('Workspace.nav');
    const tp = useTranslations('LendingPages');
    return (
        <LendingShell
            title={tw('operations')}
            subtitle={tp('operations')}
        >
            {/* OperationsView reads ?tab= (useSearchParams needs a Suspense boundary). */}
            <Suspense fallback={<Spinner />}>
                <OperationsView />
            </Suspense>
        </LendingShell>
    );
}
