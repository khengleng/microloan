"use client";

import { useParams } from 'next/navigation';
import { CardDetailView } from '@/components/lending/cards/CardDetailView';

export default function LendingCardDetailPage() {
    const { id } = useParams<{ id: string }>();
    return <CardDetailView key={id} id={id} />;
}
