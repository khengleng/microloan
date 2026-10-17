"use client";

import { LendingShell } from '@/components/lending/LendingShell';
import { HolidayProgrammes } from '@/components/lending/relief/HolidayProgrammes';

export default function LendingReliefPage() {
    return (
        <LendingShell
            title="Payment-holiday programmes"
            subtitle="Published relief offers: who qualifies, for how long, and who pays the interest that arises."
        >
            <HolidayProgrammes />
        </LendingShell>
    );
}
