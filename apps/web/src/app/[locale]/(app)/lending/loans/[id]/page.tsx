"use client";

import { useParams } from 'next/navigation';
import { LoanDetailView } from '@/components/lending/servicing/LoanDetailView';

export default function LendingLoanDetailPage() {
    const { id } = useParams<{ id: string }>();
    return <LoanDetailView key={id} id={id} />;
}
