"use client";

import { useState } from 'react';
import Link from 'next/link';
import { Check, Copy } from 'lucide-react';

export type SignupPayment = {
    reference: string;
    amount: number | string;
    currency: string;
    qrPayload: string;
    qrImage: string;
    status?: string;
    expiresAt?: string;
};

const STATUS_COPY: Record<string, { label: string; tone: string }> = {
    PENDING: { label: 'Awaiting payment', tone: 'text-[#f59e0b]' },
    CONFIRMED: { label: 'Payment confirmed', tone: 'text-[#26a69a]' },
    REJECTED: { label: 'Payment rejected', tone: 'text-destructive' },
    EXPIRED: { label: 'QR expired', tone: 'text-destructive' },
};

/**
 * The KHQR payment gate shown after a paid workspace is created.
 *
 * The reference is the applicant's only handle on their pending workspace —
 * they cannot sign in until it is confirmed — so it is displayed prominently
 * and made copyable rather than buried in the QR payload.
 */
export function SignupPaymentPanel({
    payment,
    locale,
}: {
    payment: SignupPayment;
    locale: string;
}) {
    const [copied, setCopied] = useState(false);
    const status = payment.status ?? 'PENDING';
    const statusCopy = STATUS_COPY[status] ?? STATUS_COPY.PENDING;

    const copyReference = async () => {
        try {
            await navigator.clipboard.writeText(payment.reference);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        } catch {
            /* clipboard blocked — the reference is visible on screen regardless */
        }
    };

    return (
        <div className="space-y-4">
            <div className="flex flex-col items-center gap-3 p-4 bg-secondary border border-border rounded">
                {/* eslint-disable-next-line @next/next/no-img-element -- data: URI from our API, not a remote asset */}
                <img
                    src={payment.qrImage}
                    alt={`KHQR payment code for ${payment.currency} ${payment.amount}`}
                    className="w-[220px] h-[220px] bg-white rounded p-2"
                />
                <div className="text-center">
                    <div className="text-[18px] font-bold text-foreground">
                        {payment.currency} {payment.amount}
                    </div>
                    <div className={`text-[12px] font-semibold ${statusCopy.tone}`}>
                        {statusCopy.label}
                    </div>
                </div>
            </div>

            <div>
                <div className="text-[12px] font-semibold text-muted-foreground mb-1.5">
                    Payment reference
                </div>
                <button
                    type="button"
                    onClick={copyReference}
                    className="w-full flex items-center justify-between gap-2 h-10 px-3 bg-secondary border border-border rounded text-[13px] font-mono text-foreground hover:border-primary transition-colors"
                >
                    <span className="truncate">{payment.reference}</span>
                    {copied ? (
                        <Check size={14} className="text-[#26a69a] shrink-0" />
                    ) : (
                        <Copy size={14} className="text-muted-foreground shrink-0" />
                    )}
                </button>
                <p className="text-[11px] text-muted-foreground mt-2 leading-relaxed">
                    Include this reference with your transfer. Save it — it is how you
                    check your activation status before you can sign in.
                </p>
            </div>

            <Link
                href={`/${locale}/signup/payment/${payment.reference}`}
                className="tv-button w-full h-10 text-[13px] flex items-center justify-center"
            >
                Check activation status
            </Link>
        </div>
    );
}
