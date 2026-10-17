"use client";

import { Suspense } from 'react';
import { ApplicationsList } from '@/components/lending/origination/ApplicationsList';

export default function LendingApplicationsPage() {
    // ApplicationsList reads search params (?refinance=…), which Next requires inside Suspense.
    return (
        <Suspense>
            <ApplicationsList />
        </Suspense>
    );
}
