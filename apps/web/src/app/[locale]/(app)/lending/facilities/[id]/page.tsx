"use client";

import { useParams } from 'next/navigation';
import { FacilityDetailView } from '@/components/lending/facilities/FacilityDetailView';

export default function LendingFacilityDetailPage() {
    const { id } = useParams<{ id: string }>();
    return <FacilityDetailView key={id} id={id} />;
}
