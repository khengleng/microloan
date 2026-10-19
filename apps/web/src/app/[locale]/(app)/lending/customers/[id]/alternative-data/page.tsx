"use client";

import { useParams } from 'next/navigation';
import { AlternativeDataView } from '@/components/lending/scoring/AlternativeDataPanel';

export default function CustomerAlternativeDataPage() {
    const { id } = useParams<{ id: string }>();
    return <AlternativeDataView borrowerId={String(id)} />;
}
