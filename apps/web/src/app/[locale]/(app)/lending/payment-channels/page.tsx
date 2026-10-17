"use client";

import { Suspense } from 'react';
import { PaymentChannelsView } from '@/components/lending/channels/PaymentChannelsView';

export default function LendingPaymentChannelsPage() {
    // The view reads ?file=… from the search params, which Next requires inside Suspense.
    return (
        <Suspense>
            <PaymentChannelsView />
        </Suspense>
    );
}
