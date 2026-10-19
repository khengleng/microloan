"use client";

import { use } from 'react';
import { CertificateView } from '@/components/learning/CertificateView';

/** A printable certificate for a completed learning path. */
export default function CertificatePage({ params }: { params: Promise<{ pathId: string }> }) {
    const { pathId } = use(params);
    return <CertificateView pathId={pathId} />;
}
