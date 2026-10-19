"use client";

import { useParams } from 'next/navigation';
import { LetterOfCreditView } from '@/components/lending/trade/LetterOfCreditView';

export default function LendingLetterOfCreditPage() {
    const { id } = useParams<{ id: string }>();
    return <LetterOfCreditView key={id} id={id} />;
}
