"use client";

import { useParams } from 'next/navigation';
import { InvoiceRegisterView } from '@/components/lending/trade/InvoiceRegisterView';

export default function LendingInvoiceRegisterPage() {
    const { facilityId } = useParams<{ facilityId: string }>();
    return <InvoiceRegisterView key={facilityId} facilityId={facilityId} />;
}
