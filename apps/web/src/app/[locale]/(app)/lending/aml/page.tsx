"use client";

import { Suspense } from 'react';
import { AmlView } from '@/components/lending/aml/AmlView';

export default function LendingAmlPage() {
    return (
        <Suspense>
            <AmlView />
        </Suspense>
    );
}
