import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { UserPlus, UserCheck, Phone, CreditCard, MapPin, Loader2 } from "lucide-react";
import api from "@/lib/api";

interface Borrower {
    id: string;
    firstName: string;
    lastName: string;
    phone: string;
    idNumber: string;
    address: string;
}

interface BorrowerModalProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onSuccess: () => void;
    borrower?: Borrower | null;
}

export function BorrowerModal({ open, onOpenChange, onSuccess, borrower }: BorrowerModalProps) {
    const t = useTranslations('Borrowers');
    const [loading, setLoading] = useState(false);
    const [formData, setFormData] = useState({
        firstName: '',
        lastName: '',
        phone: '',
        idNumber: '',
        address: ''
    });

    useEffect(() => {
        if (borrower) {
            setFormData({
                firstName: borrower.firstName || '',
                lastName: borrower.lastName || '',
                phone: borrower.phone || '',
                idNumber: borrower.idNumber || '',
                address: borrower.address || ''
            });
        } else {
            setFormData({
                firstName: '',
                lastName: '',
                phone: '',
                idNumber: '',
                address: ''
            });
        }
    }, [borrower, open]);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        try {
            if (borrower) {
                await api.put(`/borrowers/${borrower.id}`, formData);
            } else {
                await api.post('/borrowers', formData);
            }
            onSuccess();
            onOpenChange(false);
        } catch (error) {
            console.error('Failed to save borrower', error);
            alert('Failed to save borrower');
        } finally {
            setLoading(false);
        }
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-xl rounded-[2.5rem] border-none glass p-0 shadow-2xl overflow-hidden">
                <div className="p-8 space-y-8">
                    <DialogHeader>
                        <DialogTitle className="text-2xl font-black text-slate-900 tracking-tight flex items-center gap-3">
                            <UserPlus className="text-indigo-600" size={28} /> {borrower ? 'Digital ID Re-verification' : 'Digital ID Provisioning'}
                        </DialogTitle>
                        <DialogDescription className="text-slate-500 font-medium">
                            Register new KYC-compliant client identifiers into the organizational ledger.
                        </DialogDescription>
                    </DialogHeader>

                    <form onSubmit={handleSubmit} className="space-y-6">
                        <div className="grid grid-cols-2 gap-6">
                            <div className="space-y-2">
                                <Label htmlFor="firstName" className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Legal First Name</Label>
                                <Input
                                    id="firstName"
                                    value={formData.firstName}
                                    onChange={e => setFormData({ ...formData, firstName: e.target.value })}
                                    required
                                    className="h-12 rounded-xl border-slate-200/50 focus:ring-4 focus:ring-indigo-500/10 font-bold px-4"
                                />
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="lastName" className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Legal Family Name</Label>
                                <Input
                                    id="lastName"
                                    value={formData.lastName}
                                    onChange={e => setFormData({ ...formData, lastName: e.target.value })}
                                    required
                                    className="h-12 rounded-xl border-slate-200/50 focus:ring-4 focus:ring-indigo-500/10 font-bold px-4"
                                />
                            </div>
                        </div>

                        <div className="space-y-6">
                            <div className="space-y-2">
                                <Label htmlFor="phone" className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">{t('phone')}</Label>
                                <div className="relative group">
                                    <Phone size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-indigo-600 transition-colors" />
                                    <Input
                                        id="phone"
                                        value={formData.phone}
                                        onChange={e => setFormData({ ...formData, phone: e.target.value })}
                                        required
                                        className="h-12 rounded-xl border-slate-200/50 focus:ring-4 focus:ring-indigo-500/10 font-bold pl-12 pr-4 shadow-sm"
                                        placeholder="+855 ..."
                                    />
                                </div>
                            </div>

                            <div className="space-y-2">
                                <Label htmlFor="idNumber" className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">{t('id_number')}</Label>
                                <div className="relative group">
                                    <CreditCard size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-indigo-600 transition-colors" />
                                    <Input
                                        id="idNumber"
                                        value={formData.idNumber}
                                        onChange={e => setFormData({ ...formData, idNumber: e.target.value })}
                                        required
                                        className="h-12 rounded-xl border-slate-200/50 focus:ring-4 focus:ring-indigo-500/10 font-bold pl-12 pr-4 shadow-sm"
                                        placeholder="National ID / Passport Hash"
                                    />
                                </div>
                            </div>

                            <div className="space-y-2">
                                <Label htmlFor="address" className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">{t('address')}</Label>
                                <div className="relative group">
                                    <MapPin size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-indigo-600 transition-colors" />
                                    <Input
                                        id="address"
                                        value={formData.address}
                                        onChange={e => setFormData({ ...formData, address: e.target.value })}
                                        required
                                        className="h-12 rounded-xl border-slate-200/50 focus:ring-4 focus:ring-indigo-500/10 font-bold pl-12 pr-4 shadow-sm"
                                        placeholder="Physical Residence Vector"
                                    />
                                </div>
                            </div>
                        </div>

                        <div className="flex justify-end gap-3 pt-6 border-t border-slate-100/50">
                            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} className="rounded-xl font-bold h-12 px-6">
                                {t('cancel')}
                            </Button>
                            <Button type="submit" disabled={loading} className="rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-black text-xs uppercase tracking-widest h-12 px-8 shadow-lg shadow-indigo-600/20">
                                {loading && <Loader2 className="animate-spin mr-2" size={16} />}
                                {loading ? 'Committing...' : borrower ? 'Update Digital ID' : 'Provision Identity'}
                            </Button>
                        </div>
                    </form>
                </div>
            </DialogContent>
        </Dialog>
    );
}
