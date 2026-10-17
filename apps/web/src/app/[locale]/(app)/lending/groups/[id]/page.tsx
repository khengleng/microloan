"use client";

import { useParams } from 'next/navigation';
import { GroupDetailView } from '@/components/lending/groups/GroupDetailView';

export default function LendingGroupDetailPage() {
    const { id } = useParams<{ id: string }>();
    return <GroupDetailView key={id} id={id} />;
}
