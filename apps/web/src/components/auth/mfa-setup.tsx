"use client";

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ShieldAlert, ShieldCheck, Loader2, Key } from 'lucide-react';
import api from '@/lib/api';

export function MfaSetup() {
    const [step, setStep] = useState<'IDLE' | 'GENERATING' | 'VERIFYING'>('IDLE');
    const [mfaData, setMfaData] = useState<{ secret: string; qrCodeDataUrl: string } | null>(null);
    const [code, setCode] = useState('');
    const [enabled, setEnabled] = useState(false);

    const handleStart = async () => {
        setStep('GENERATING');
        try {
            const res = await api.post('/auth/mfa/generate');
            setMfaData(res.data);
            setStep('VERIFYING');
        } catch (err) {
            alert('Failed to initiate MFA setup');
            setStep('IDLE');
        }
    };

    const handleVerify = async () => {
        try {
            await api.post('/auth/mfa/enable', { code });
            setEnabled(true);
            setStep('IDLE');
            alert('MFA enabled successfully!');
        } catch (err) {
            alert('Invalid code. Please try again.');
        }
    };

    if (enabled) {
        return (
            <Card className="border-green-100 bg-green-50/30">
                <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-green-700">
                        <ShieldCheck size={20} />
                        MFA Active
                    </CardTitle>
                    <CardDescription>Your account is protected with Multi-Factor Authentication.</CardDescription>
                </CardHeader>
            </Card>
        );
    }

    return (
        <Card>
            <CardHeader>
                <CardTitle className="flex items-center gap-2">
                    <ShieldAlert size={20} className="text-amber-500" />
                    Security Verification
                </CardTitle>
                <CardDescription>Add an extra layer of security to your organization account.</CardDescription>
            </CardHeader>
            <CardContent>
                {step === 'IDLE' && (
                    <Button onClick={handleStart} className="bg-slate-900">
                        Setup Authenticator
                    </Button>
                )}

                {step === 'GENERATING' && (
                    <div className="flex items-center gap-2 text-slate-500">
                        <Loader2 className="animate-spin" size={18} />
                        Generating security keys...
                    </div>
                )}

                {step === 'VERIFYING' && mfaData && (
                    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2">
                        <div className="flex flex-col items-center gap-4 p-4 bg-slate-50 rounded-xl">
                            <img src={mfaData.qrCodeDataUrl} alt="MFA QR Code" className="w-48 h-48 border-4 border-white shadow-sm rounded-lg" />
                            <div className="text-center">
                                <p className="text-sm font-medium">Scan this with your Auth App</p>
                                <code className="text-[10px] text-slate-400 block mt-1">Manual Key: {mfaData.secret}</code>
                            </div>
                        </div>

                        <div className="space-y-4">
                            <div className="space-y-2">
                                <Label htmlFor="mfaCode">Enter 6-digit Verification Code</Label>
                                <div className="relative">
                                    <Key className="absolute left-3 top-3 text-slate-400" size={18} />
                                    <Input
                                        id="mfaCode"
                                        placeholder="000000"
                                        maxLength={6}
                                        value={code}
                                        onChange={e => setCode(e.target.value)}
                                        className="pl-10 h-11"
                                    />
                                </div>
                            </div>
                            <Button onClick={handleVerify} className="w-full bg-blue-600 hover:bg-blue-700 h-11">
                                Complete Security Setup
                            </Button>
                        </div>
                    </div>
                )}
            </CardContent>
        </Card>
    );
}
