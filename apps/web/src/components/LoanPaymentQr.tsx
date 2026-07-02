"use client";

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import api from '@/lib/api';
import { QrCode } from 'lucide-react';

type Instrument = {
    label: string;
    bankName?: string | null;
    accountName?: string | null;
    accountNumber?: string | null;
    currency: string;
    qrRendered?: string | null;
    branch?: { name: string } | null;
};

/** Display-only static-QR panel shown on a loan so an officer can present the
 *  collection QR to the borrower. Payments are still posted manually. */
export function LoanPaymentQr({ loanId }: { loanId: string }) {
    const t = useTranslations('Payments');
    const [inst, setInst] = useState<Instrument | null>(null);
    const [loaded, setLoaded] = useState(false);

    useEffect(() => {
        api.get(`/payment-instruments/for-loan/${loanId}`)
            .then(res => setInst(res.data))
            .catch(() => setInst(null))
            .finally(() => setLoaded(true));
    }, [loanId]);

    // Render nothing until we know, and nothing if no instrument / QR configured.
    if (!loaded || !inst || !inst.qrRendered) return null;

    return (
        <div className="bg-white border border-border rounded-md">
            <div className="flex items-center gap-2 px-4 py-3 border-b border-border">
                <QrCode size={14} className="text-primary" />
                <h3 className="text-sm font-bold text-foreground">{t('payViaQr')}</h3>
            </div>
            <div className="px-4 py-4 flex flex-col items-center gap-3">
                <img src={inst.qrRendered} alt={t('payViaQr')} className="w-44 h-44 rounded border border-border bg-white object-contain" />
                <div className="text-center">
                    <p className="text-sm font-semibold text-foreground">{inst.label}</p>
                    <p className="text-xs text-muted-foreground">
                        {[inst.bankName, inst.accountName, inst.accountNumber].filter(Boolean).join(' · ')}
                    </p>
                    <p className="text-[11px] text-muted-foreground mt-1">{t('qrScanHint')}</p>
                </div>
            </div>
        </div>
    );
}
