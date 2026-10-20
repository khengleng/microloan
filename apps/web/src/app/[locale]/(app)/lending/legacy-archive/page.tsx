"use client";

import { Suspense } from 'react';
import { LegacyArchiveView } from '@/components/lending/migration/LegacyArchiveView';

export default function LegacyArchivePage() {
    // The view reads ?loan=… and ?borrowerId=… from the search params, which Next requires inside Suspense.
    return (
        <Suspense>
            <LegacyArchiveView />
        </Suspense>
    );
}
