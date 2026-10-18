"use client";

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ShieldAlert, ShieldCheck, Loader2, Key } from 'lucide-react';
import api from '@/lib/api';
import { useToast } from '@/components/ui/toast';

type Status = 'LOADING' | 'ENROLLED' | 'NOT_ENROLLED' | 'UNKNOWN';

/**
 * Authenticator (TOTP) enrolment for the signed-in person. Asks the API
 * whether a factor is already enrolled, so an enrolled person sees the active
 * state instead of a setup button that can only fail.
 */
export function MfaSetup() {
    const t = useTranslations('Account.mfa');
    const { showToast } = useToast();
    const [status, setStatus] = useState<Status>('LOADING');
    const [step, setStep] = useState<'IDLE' | 'GENERATING' | 'VERIFYING' | 'SUBMITTING'>('IDLE');
    const [mfaData, setMfaData] = useState<{ secret: string; qrCodeDataUrl: string } | null>(null);
    const [code, setCode] = useState('');
    const [error, setError] = useState('');
    const [justEnabled, setJustEnabled] = useState(false);

    useEffect(() => {
        let cancelled = false;
        api.get<{ enabled: boolean }>('/auth/mfa/status', { quiet: true }).then(
            (r) => { if (!cancelled) setStatus(r.data.enabled ? 'ENROLLED' : 'NOT_ENROLLED'); },
            () => { if (!cancelled) setStatus('UNKNOWN'); },
        );
        return () => { cancelled = true; };
    }, []);

    const handleStart = async () => {
        setError('');
        setStep('GENERATING');
        try {
            const res = await api.post('/auth/mfa/generate', undefined, { quiet: true });
            setMfaData(res.data);
            setCode('');
            setStep('VERIFYING');
        } catch (err: any) {
            if (err?.response?.status === 409) {
                setStatus('ENROLLED');
            } else {
                setError(t('startFailed'));
            }
            setStep('IDLE');
        }
    };

    const handleVerify = async (e: React.FormEvent) => {
        e.preventDefault();
        setError('');
        const digits = code.replace(/\s+/g, '');
        if (!/^\d{6}$/.test(digits)) { setError(t('codeFormat')); return; }
        setStep('SUBMITTING');
        try {
            await api.post('/auth/mfa/enable', { code: digits }, { quiet: true });
            setStatus('ENROLLED');
            setJustEnabled(true);
            setMfaData(null);
            setStep('IDLE');
            showToast(t('enabled'), 'success');
        } catch (err: any) {
            const httpStatus = err?.response?.status;
            if (httpStatus === 409) {
                setStatus('ENROLLED');
                setMfaData(null);
                setStep('IDLE');
                return;
            }
            const message: string = String(err?.response?.data?.message ?? '');
            if (httpStatus === 400 && /not been started/i.test(message)) {
                setMfaData(null);
                setStep('IDLE');
                setError(t('notStarted'));
                return;
            }
            setError(httpStatus === 400 ? t('wrongCode') : t('verifyFailed'));
            setStep('VERIFYING');
        }
    };

    if (status === 'ENROLLED') {
        return (
            <Card className="border-green-100 bg-green-50/30">
                <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-green-700">
                        <ShieldCheck size={20} />
                        {t('activeTitle')}
                    </CardTitle>
                    <CardDescription>{t('activeDesc')}</CardDescription>
                </CardHeader>
                <CardContent className="space-y-2 text-sm text-muted-foreground">
                    {justEnabled && <p className="text-green-800">{t('afterEnable')}</p>}
                    <p>{t('lostPhone')}</p>
                </CardContent>
            </Card>
        );
    }

    return (
        <Card>
            <CardHeader>
                <CardTitle className="flex items-center gap-2">
                    <ShieldAlert size={20} className="text-amber-500" />
                    {t('title')}
                </CardTitle>
                <CardDescription>{t('desc')}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
                {error && (
                    <p role="alert" className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
                )}

                {status === 'LOADING' && (
                    <div className="flex items-center gap-2 text-slate-500 text-sm">
                        <Loader2 className="animate-spin" size={16} />
                        {t('loading')}
                    </div>
                )}

                {status === 'UNKNOWN' && step === 'IDLE' && (
                    <p className="text-sm text-muted-foreground">{t('statusFailed')}</p>
                )}

                {status !== 'LOADING' && step === 'IDLE' && (
                    <Button onClick={handleStart} className="bg-slate-900">
                        {t('start')}
                    </Button>
                )}

                {step === 'GENERATING' && (
                    <div className="flex items-center gap-2 text-slate-500 text-sm">
                        <Loader2 className="animate-spin" size={16} />
                        {t('generating')}
                    </div>
                )}

                {(step === 'VERIFYING' || step === 'SUBMITTING') && mfaData && (
                    <form onSubmit={handleVerify} className="space-y-6 animate-in fade-in slide-in-from-bottom-2">
                        <div className="flex flex-col items-center gap-4 p-4 bg-slate-50 rounded-xl">
                            <img src={mfaData.qrCodeDataUrl} alt={t('qrAlt')} className="w-48 h-48 border-4 border-white shadow-sm rounded-lg" />
                            <div className="text-center">
                                <p className="text-sm font-medium">{t('scan')}</p>
                                <code className="text-[11px] text-slate-500 block mt-1 break-all">{t('manualKey', { secret: mfaData.secret })}</code>
                            </div>
                        </div>

                        <div className="space-y-2">
                            <Label htmlFor="mfaCode">{t('codeLabel')}</Label>
                            <div className="relative">
                                <Key className="absolute left-3 top-3 text-slate-400" size={18} />
                                <Input
                                    id="mfaCode"
                                    placeholder="000000"
                                    inputMode="numeric"
                                    autoComplete="one-time-code"
                                    maxLength={7}
                                    value={code}
                                    onChange={e => setCode(e.target.value)}
                                    className="pl-10 h-11"
                                />
                            </div>
                        </div>
                        <div className="flex gap-2">
                            <Button type="submit" disabled={step === 'SUBMITTING'} className="flex-1 bg-blue-600 hover:bg-blue-700 h-11">
                                {step === 'SUBMITTING' && <Loader2 className="animate-spin mr-2" size={16} />}
                                {t('verify')}
                            </Button>
                            <Button type="button" variant="ghost" className="h-11" onClick={() => { setMfaData(null); setStep('IDLE'); setError(''); }}>
                                {t('cancel')}
                            </Button>
                        </div>
                    </form>
                )}
            </CardContent>
        </Card>
    );
}
