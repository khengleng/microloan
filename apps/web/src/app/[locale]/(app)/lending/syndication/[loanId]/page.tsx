"use client";

import { useParams } from 'next/navigation';
import { SyndicateDetail } from '@/components/lending/syndication/SyndicationViews';

export default function LendingSyndicatePage() {
    const { loanId } = useParams<{ loanId: string }>();
    return <SyndicateDetail key={loanId} loanId={loanId} />;
}
