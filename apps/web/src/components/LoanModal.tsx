"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import api from "@/lib/api";

interface LoanModalProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onSuccess: () => void;
}

interface Borrower {
    id: string;
    firstName: string;
    lastName: string;
}

export function LoanModal({ open, onOpenChange, onSuccess }: LoanModalProps) {
    const t = useTranslations('Loans');
    const [loading, setLoading] = useState(false);
    const [borrowers, setBorrowers] = useState<Borrower[]>([]);
    const [formData, setFormData] = useState({
        borrowerId: '',
        principal: '',
        annualInterestRate: '',
        termMonths: '',
        startDate: new Date().toISOString().split('T')[0],
        interestMethod: 'FLAT'
    });

    useEffect(() => {
        if (open) {
            api.get('/borrowers').then(res => setBorrowers(res.data));
        }
    }, [open]);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        try {
            await api.post('/loans', {
                ...formData,
                principal: parseFloat(formData.principal),
                annualInterestRate: parseFloat(formData.annualInterestRate),
                termMonths: parseInt(formData.termMonths),
            });
            onSuccess();
            onOpenChange(false);
            setFormData({
                borrowerId: '',
                principal: '',
                annualInterestRate: '',
                termMonths: '',
                startDate: new Date().toISOString().split('T')[0],
                interestMethod: 'FLAT'
            });
        } catch (error) {
            console.error('Failed to issue loan', error);
            alert('Failed to issue loan');
        } finally {
            setLoading(false);
        }
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-2xl">
                <DialogHeader>
                    <DialogTitle>{t('add_new')}</DialogTitle>
                    <DialogDescription className="sr-only">
                        Create a new loan application.
                    </DialogDescription>
                </DialogHeader>
                <form onSubmit={handleSubmit} className="space-y-4">
                    <div className="space-y-2">
                        <Label htmlFor="borrowerId">{t('borrower')}</Label>
                        <Select
                            id="borrowerId"
                            value={formData.borrowerId}
                            onChange={e => setFormData({ ...formData, borrowerId: e.target.value })}
                            required
                        >
                            <option value="">Select Borrower</option>
                            {borrowers.map(b => (
                                <option key={b.id} value={b.id}>{b.firstName} {b.lastName}</option>
                            ))}
                        </Select>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                            <Label htmlFor="principal">{t('principal')}</Label>
                            <Input
                                id="principal"
                                type="number"
                                step="0.01"
                                value={formData.principal}
                                onChange={e => setFormData({ ...formData, principal: e.target.value })}
                                required
                            />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="annualInterestRate">{t('interest_rate')}</Label>
                            <Input
                                id="annualInterestRate"
                                type="number"
                                step="0.01"
                                value={formData.annualInterestRate}
                                onChange={e => setFormData({ ...formData, annualInterestRate: e.target.value })}
                                required
                            />
                        </div>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                            <Label htmlFor="termMonths">{t('term')}</Label>
                            <Input
                                id="termMonths"
                                type="number"
                                value={formData.termMonths}
                                onChange={e => setFormData({ ...formData, termMonths: e.target.value })}
                                required
                            />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="startDate">{t('start_date')}</Label>
                            <Input
                                id="startDate"
                                type="date"
                                value={formData.startDate}
                                onChange={e => setFormData({ ...formData, startDate: e.target.value })}
                                required
                            />
                        </div>
                    </div>

                    <div className="space-y-2">
                        <Label htmlFor="interestMethod">{t('method')}</Label>
                        <Select
                            id="interestMethod"
                            value={formData.interestMethod}
                            onChange={e => setFormData({ ...formData, interestMethod: e.target.value })}
                            required
                        >
                            <option value="FLAT">{t('flat')}</option>
                            <option value="REDUCING_BALANCE">{t('reducing_balance')}</option>
                        </Select>
                    </div>

                    <DialogFooter>
                        <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                            Cancel
                        </Button>
                        <Button type="submit" disabled={loading}>
                            {loading ? 'Issuing...' : t('add_new')}
                        </Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    );
}
