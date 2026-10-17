"use client";

import { useParams } from 'next/navigation';
import { TradeTransactionView } from '@/components/lending/trade/TradeTransactionView';

export default function LendingTradeTransactionPage() {
    const { loanId } = useParams<{ loanId: string }>();
    return <TradeTransactionView key={loanId} loanId={loanId} />;
}
