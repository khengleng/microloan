"use client";

import { Suspense } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import { Spinner } from '@/components/lending/ui';
import { PolicyDetailView } from '@/components/lending/policies/PolicyDetailView';

function PolicyDetail() {
    const { id } = useParams<{ id: string }>();
    const versionId = useSearchParams().get('v');
    return <PolicyDetailView key={`${id}:${versionId ?? ''}`} id={id} initialVersionId={versionId} />;
}

export default function LendingPolicyDetailPage() {
    return <Suspense fallback={<Spinner />}><PolicyDetail /></Suspense>;
}
