"use client";

import { useParams } from 'next/navigation';
import { ApplicationDetailView } from '@/components/lending/origination/ApplicationDetailView';

export default function LendingApplicationDetailPage() {
    const { id } = useParams<{ id: string }>();
    return <ApplicationDetailView key={id} id={id} />;
}
