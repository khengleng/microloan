"use client";

import { useTranslations } from 'next-intl';
import { LendingShell } from '@/components/lending/LendingShell';
import { GoLiveSetupView } from '@/components/lending/setup/GoLiveSetupView';

/** The go-live setup checklist for a new lender (tenant_setup.read). */
export default function GoLiveSetupPage() {
    const tw = useTranslations('Workspace.nav');
    const tp = useTranslations('LendingPages');
    return (
        <LendingShell title={tw('goLiveSetup')} subtitle={tp('goLiveSetup')}>
            <GoLiveSetupView />
        </LendingShell>
    );
}
