"use client";

import { LendingShell } from '@/components/lending/LendingShell';
import { OperationsView } from '@/components/lending/operations/OperationsView';

export default function LendingOperationsPage() {
    return (
        <LendingShell
            title="Operations"
            subtitle="Business date and end of day, benchmark rates, holiday calendars and integration adapters."
        >
            <OperationsView />
        </LendingShell>
    );
}
