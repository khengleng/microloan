"use client";

import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { BrandMark } from '@/components/brand-mark';
import { Loader2, RefreshCw } from 'lucide-react';
import { SignupPaymentPanel, type SignupPayment } from '@/components/auth/signup-payment-panel';

type PaymentView = SignupPayment & { plan: string; organizationName: string; status: string };

/**
 * Activation status for a pending workspace.
 *
 * Reachable without a session by design: the applicant cannot sign in until a
 * SUPERADMIN confirms their transfer, so the unguessable payment reference in
 * the URL is the only credential they have. The API throttles this route.
 */
export default function SignupPaymentStatusPage() {
    const { locale, reference } = useParams();
    const [payment, setPayment] = useState<PaymentView | null>(null);
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(true);

    const load = useCallback(async () => {
        setLoading(true);
        setError('');
        try {
            const res = await fetch(`/api/proxy/auth/signup/payment/${reference}`);
            const data = await res.json();
            if (!res.ok) throw new Error(data?.message || 'Payment reference not found.');
            setPayment(data);
        } catch (err: unknown) {
            setError(err instanceof Error ? err.message : 'Could not load payment status.');
        } finally {
            setLoading(false);
        }
    }, [reference]);

    useEffect(() => {
        void load();
    }, [load]);

    return (
        <div className="min-h-screen flex items-center justify-center bg-background py-10">
            <div className="w-full max-w-[420px] px-4">
                <BrandMark className="mb-8" />

                <div className="bg-card border border-border rounded-lg p-7">
                    <h1 className="text-[18px] font-bold text-foreground mb-1">Activation status</h1>

                    {loading && (
                        <div className="flex items-center gap-2 text-[13px] text-muted-foreground py-8 justify-center">
                            <Loader2 size={14} className="animate-spin" /> Loading...
                        </div>
                    )}

                    {!loading && error && (
                        <div className="text-[12px] text-destructive bg-destructive/10 border border-destructive/20 px-3 py-2 rounded mt-4">
                            {error}
                        </div>
                    )}

                    {!loading && payment && (
                        <>
                            <p className="text-[13px] text-muted-foreground mb-6">
                                <strong className="text-foreground">{payment.organizationName}</strong> on the{' '}
                                {payment.plan} plan.
                            </p>

                            {payment.status === 'CONFIRMED' ? (
                                <div className="space-y-4">
                                    <div className="text-[13px] text-foreground bg-[#26a69a]/10 border border-[#26a69a]/20 px-3 py-3 rounded">
                                        Payment confirmed — your workspace is active. You can sign in now.
                                    </div>
                                    <Link
                                        href={`/${locale}/login`}
                                        className="tv-button w-full h-10 text-[13px] flex items-center justify-center"
                                    >
                                        Sign in
                                    </Link>
                                </div>
                            ) : (
                                <SignupPaymentPanel payment={payment} locale={String(locale)} />
                            )}

                            <button
                                type="button"
                                onClick={() => void load()}
                                className="w-full h-10 mt-3 text-[13px] flex items-center justify-center gap-2 border border-border rounded text-muted-foreground hover:text-foreground hover:border-primary transition-colors"
                            >
                                <RefreshCw size={13} /> Refresh
                            </button>
                        </>
                    )}
                </div>

                <p className="text-center text-[13px] text-muted-foreground mt-5">
                    <Link href={`/${locale}/login`} className="text-primary hover:text-primary/80 font-semibold transition-colors">
                        Back to sign in
                    </Link>
                </p>
            </div>
        </div>
    );
}
