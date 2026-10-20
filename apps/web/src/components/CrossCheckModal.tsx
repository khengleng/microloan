"use client";

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Search, Loader2, AlertCircle, CheckCircle2, Building2 } from 'lucide-react';
import api from '@/lib/api';
import { useToast } from '@/components/ui/toast';
import { useTranslations } from 'next-intl';

interface CreditCheckResult {
    scope: string;
    found: boolean;
    loans: { status: string; date: string }[];
    bureau: { available: boolean; message: string };
}

export function CrossCheckModal({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
    const { showToast } = useToast();
    const t = useTranslations('Borrowers.crossCheck');
    const ts = useTranslations('Status');
    const [idNumber, setIdNumber] = useState('');
    const [phone, setPhone] = useState('');
    const [loading, setLoading] = useState(false);
    const [results, setResults] = useState<CreditCheckResult | null>(null);

    const handleSearch = async () => {
        if (!idNumber && !phone) return;
        setLoading(true);
        setResults(null);
        try {
            const res = await api.get('/borrowers/cross-check', {
                params: { idNumber, phone }
            });
            setResults(res.data);
        } catch (err) {
            showToast(t('failed'), 'error');
        } finally {
            setLoading(false);
        }
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <Search className="text-blue-600" size={20} />
                        {t('title')}
                    </DialogTitle>
                    <DialogDescription>
                        {t('description')}
                    </DialogDescription>
                </DialogHeader>

                <div className="grid grid-cols-2 gap-4 mt-4">
                    <div className="space-y-2">
                        <Label>{t('idNumber')}</Label>
                        <Input
                            placeholder={t('idPlaceholder')}
                            value={idNumber}
                            onChange={e => setIdNumber(e.target.value)}
                        />
                    </div>
                    <div className="space-y-2">
                        <Label>{t('phone')}</Label>
                        <Input
                            placeholder={t('phonePlaceholder')}
                            value={phone}
                            onChange={e => setPhone(e.target.value)}
                        />
                    </div>
                </div>

                <Button onClick={handleSearch} disabled={loading || (!idNumber && !phone)} className="w-full mt-4 bg-slate-900">
                    {loading ? <Loader2 className="animate-spin mr-2" size={18} /> : <Search className="mr-2" size={18} />}
                    {t('verify')}
                </Button>

                {results && (
                    <div className="mt-8 space-y-4 animate-in fade-in slide-in-from-top-4">
                        <h4 className="text-sm font-bold uppercase tracking-wider text-slate-500">{t('resultsTitle')}</h4>
                        {!results.found ? (
                            <div className="p-6 text-center border-2 border-dashed rounded-xl bg-green-50/30 border-green-100">
                                <CheckCircle2 className="mx-auto text-green-500 mb-2" size={32} />
                                <p className="font-semibold text-green-700">{t('noActivity')}</p>
                                <p className="text-xs text-green-600">{t('noLoans')}</p>
                            </div>
                        ) : (
                            <div className="border rounded-xl p-4 bg-white shadow-sm border-slate-100">
                                <div className="flex justify-between items-center mb-3">
                                    <div className="flex items-center gap-2 font-bold text-slate-900">
                                        <Building2 size={16} className="text-slate-400" />
                                        {t('yourOrg')}
                                    </div>
                                    <div className="text-xs text-slate-400">{t('loanRecords', { count: results.loans.length })}</div>
                                </div>
                                <div className="grid grid-cols-2 gap-2">
                                    {results.loans.map((loan, li) => (
                                        <div key={li} className="flex items-center gap-2 p-2 bg-slate-50 rounded text-xs">
                                            <div className={`w-2 h-2 rounded-full ${loan.status === 'DISBURSED' ? 'bg-blue-500' : loan.status === 'DEFAULTED' ? 'bg-red-500' : 'bg-slate-300'}`} />
                                            <span className="font-medium">{ts.has(loan.status) ? ts(loan.status) : loan.status}</span>
                                            <span className="text-slate-400">({new Date(loan.date).toLocaleDateString()})</span>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}
                        <div className="flex items-start gap-2 p-3 bg-amber-50 rounded-lg border border-amber-100 text-[11px] text-amber-700">
                            <AlertCircle size={14} className="mt-0.5 shrink-0" />
                            <span>{results.bureau.message}</span>
                        </div>
                    </div>
                )}
            </DialogContent>
        </Dialog>
    );
}
