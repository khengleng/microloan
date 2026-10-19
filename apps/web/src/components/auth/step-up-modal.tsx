"use client";

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { KeyRound, Loader2, ShieldCheck } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { registerStepUpHandler, submitStepUpCode } from '@/lib/step-up';

/**
 * Asks for a 6-digit authenticator code when the API answers
 * MFA_STEP_UP_REQUIRED (see lib/step-up). Mounted once in the app shell; the
 * axios interceptor replays the refused request after a code is accepted.
 */
export function StepUpModal() {
    const t = useTranslations('Security.stepUp');
    const [open, setOpen] = useState(false);
    const [reason, setReason] = useState<string | undefined>();
    const [code, setCode] = useState('');
    const [error, setError] = useState('');
    const [busy, setBusy] = useState(false);
    const resolver = useRef<((ok: boolean) => void) | null>(null);

    useEffect(() => {
        const unregister = registerStepUpHandler((message) => new Promise<boolean>((resolve) => {
            resolver.current = resolve;
            setReason(message);
            setCode('');
            setError('');
            setBusy(false);
            setOpen(true);
        }));
        return () => {
            unregister();
            resolver.current?.(false);
            resolver.current = null;
        };
    }, []);

    const finish = (ok: boolean) => {
        const resolve = resolver.current;
        resolver.current = null;
        setOpen(false);
        setBusy(false);
        resolve?.(ok);
    };

    const submit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (busy) return;
        const digits = code.replace(/\s+/g, '');
        if (!/^\d{6}$/.test(digits)) { setError(t('codeFormat')); return; }
        setBusy(true);
        setError('');
        const res = await submitStepUpCode(digits);
        if (res.ok) { finish(true); return; }
        setBusy(false);
        setCode('');
        setError(res.message || (res.status === 0 ? t('unreachable') : t('failed')));
    };

    return (
        <Dialog open={open} onOpenChange={(next) => { if (!next && !busy) finish(false); }}>
            <DialogContent className="max-w-sm">
                <form onSubmit={submit} className="space-y-4">
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2 text-base">
                            <ShieldCheck size={18} className="text-primary" />
                            {t('title')}
                        </DialogTitle>
                        <DialogDescription>{t('desc')}</DialogDescription>
                    </DialogHeader>
                    {reason && <p className="text-xs text-muted-foreground">{reason}</p>}
                    <div className="space-y-2">
                        <Label htmlFor="step-up-code">{t('codeLabel')}</Label>
                        <div className="relative">
                            <KeyRound className="absolute left-3 top-3 text-slate-400" size={16} aria-hidden />
                            <Input
                                id="step-up-code"
                                autoFocus
                                placeholder="000000"
                                inputMode="numeric"
                                autoComplete="one-time-code"
                                pattern="[0-9 ]*"
                                maxLength={7}
                                value={code}
                                onChange={(e) => setCode(e.target.value)}
                                aria-invalid={!!error}
                                aria-describedby={error ? 'step-up-error' : undefined}
                                className="pl-9 h-10 tracking-widest"
                            />
                        </div>
                    </div>
                    {error && (
                        <p id="step-up-error" role="alert" className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
                    )}
                    <div className="flex gap-2 justify-end">
                        <Button type="button" variant="ghost" disabled={busy} onClick={() => finish(false)}>{t('cancel')}</Button>
                        <Button type="submit" disabled={busy}>
                            {busy && <Loader2 className="animate-spin mr-2" size={14} />}
                            {t('submit')}
                        </Button>
                    </div>
                </form>
            </DialogContent>
        </Dialog>
    );
}
