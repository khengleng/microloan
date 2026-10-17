"use client";

import { useParams } from 'next/navigation';
import { CounterpartyDetailView } from '@/components/lending/institutional/CounterpartyViews';

export default function LendingCounterpartyPage() {
    const { id } = useParams<{ id: string }>();
    return <CounterpartyDetailView key={id} id={id} />;
}
