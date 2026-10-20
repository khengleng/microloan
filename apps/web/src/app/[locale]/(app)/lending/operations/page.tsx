"use client";

import { useTranslations } from 'next-intl';
import { LendingShell } from '@/components/lending/LendingShell';
import { OperationsView } from '@/components/lending/operations/OperationsView';

export default function LendingOperationsPage() {
    const tw = useTranslations('Workspace.nav');
    const tp = useTranslations('LendingPages');
    return (
        <LendingShell
            title={tw('operations')}
            subtitle={tp('operations')}
        >
            <OperationsView />
        </LendingShell>
    );
}
