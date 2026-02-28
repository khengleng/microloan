"use client";

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Search, Loader2, AlertCircle, CheckCircle2, Building2 } from 'lucide-react';
import api from '@/lib/api';

interface CrossCheckResult {
    organization: string;
    organizationName: string;
    loans: {
        status: string;
        date: string;
    }[];
}

export function CrossCheckModal({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
    const [idNumber, setIdNumber] = useState('');
    const [phone, setPhone] = useState('');
    const [loading, setLoading] = useState(false);
    const [results, setResults] = useState<CrossCheckResult[] | null>(null);

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
            console.error(err);
            alert('Failed to perform credit check');
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
                        Global Credit Check
                    </DialogTitle>
                    <DialogDescription>
                        Search across all organizations on the platform to identify existing loan obligations or defaults.
                    </DialogDescription>
                </DialogHeader>

                <div className="grid grid-cols-2 gap-4 mt-4">
                    <div className="space-y-2">
                        <Label>ID Number</Label>
                        <Input
                            placeholder="Enter ID number"
                            value={idNumber}
                            onChange={e => setIdNumber(e.target.value)}
                        />
                    </div>
                    <div className="space-y-2">
                        <Label>Phone Number</Label>
                        <Input
                            placeholder="Enter phone"
                            value={phone}
                            onChange={e => setPhone(e.target.value)}
                        />
                    </div>
                </div>

                <Button onClick={handleSearch} disabled={loading || (!idNumber && !phone)} className="w-full mt-4 bg-slate-900">
                    {loading ? <Loader2 className="animate-spin mr-2" size={18} /> : <Search className="mr-2" size={18} />}
                    Verify Borrower Reliability
                </Button>

                {results && (
                    <div className="mt-8 space-y-4 animate-in fade-in slide-in-from-top-4">
                        <h4 className="text-sm font-bold uppercase tracking-wider text-slate-500">Platform-wide Results</h4>
                        {results.length === 0 ? (
                            <div className="p-6 text-center border-2 border-dashed rounded-xl bg-green-50/30 border-green-100">
                                <CheckCircle2 className="mx-auto text-green-500 mb-2" size={32} />
                                <p className="font-semibold text-green-700">No cross-tenant obligations found.</p>
                                <p className="text-xs text-green-600">This borrower currently has no recorded activity with other organizations.</p>
                            </div>
                        ) : (
                            <div className="space-y-4">
                                {results.map((res, i) => (
                                    <div key={i} className="border rounded-xl p-4 bg-white shadow-sm border-slate-100">
                                        <div className="flex justify-between items-center mb-3">
                                            <div className="flex items-center gap-2 font-bold text-slate-900">
                                                <Building2 size={16} className="text-slate-400" />
                                                {res.organizationName}
                                                <span className="text-[10px] bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded uppercase">{res.organization}</span>
                                            </div>
                                            <div className="text-xs text-slate-400">
                                                {res.loans.length} Loan Records
                                            </div>
                                        </div>
                                        <div className="grid grid-cols-2 gap-2">
                                            {res.loans.map((loan, li) => (
                                                <div key={li} className="flex items-center gap-2 p-2 bg-slate-50 rounded text-xs">
                                                    <div className={`w-2 h-2 rounded-full ${loan.status === 'DISBURSED' ? 'bg-blue-500' : loan.status === 'DEFAULTED' ? 'bg-red-500' : 'bg-slate-300'}`} />
                                                    <span className="font-medium">{loan.status}</span>
                                                    <span className="text-slate-400">({new Date(loan.date).toLocaleDateString()})</span>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                        <div className="flex items-start gap-2 p-3 bg-amber-50 rounded-lg border border-amber-100 text-[10px] text-amber-700">
                            <AlertCircle size={14} className="mt-0.5 shrink-0" />
                            <span>Privacy Notice: External organization names are masked unless the borrower is already registered in your organization. Specific financial amounts and repayment histories are strictly confidential.</span>
                        </div>
                    </div>
                )}
            </DialogContent>
        </Dialog>
    );
}
