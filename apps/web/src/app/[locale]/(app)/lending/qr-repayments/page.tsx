"use client";

import { Suspense } from 'react';
import { QrRepaymentsView } from '@/components/lending/qr/QrRepaymentsView';

export default function LendingQrRepaymentsPage() {
    // The view reads ?tab=… from the search params, which Next requires inside Suspense.
    return (
        <Suspense>
            <QrRepaymentsView />
        </Suspense>
    );
}
