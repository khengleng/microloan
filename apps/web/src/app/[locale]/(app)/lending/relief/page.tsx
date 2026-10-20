"use client";

import { useTranslations } from 'next-intl';
import { LendingShell } from '@/components/lending/LendingShell';
import { HolidayProgrammes } from '@/components/lending/relief/HolidayProgrammes';

export default function LendingReliefPage() {
    const tw = useTranslations('Workspace.nav');
    const tp = useTranslations('LendingPages');
    return (
        <LendingShell
            title={tw('relief')}
            subtitle={tp('relief')}
        >
            <HolidayProgrammes />
        </LendingShell>
    );
}
