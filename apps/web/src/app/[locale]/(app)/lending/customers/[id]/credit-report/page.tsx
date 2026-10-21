"use client";

import { useParams } from 'next/navigation';
import { CreditReportView } from '@/components/lending/scoring/CreditReportView';

export default function CustomerCreditReportPage() {
    const { id } = useParams<{ id: string }>();
    return <CreditReportView borrowerId={String(id)} />;
}
