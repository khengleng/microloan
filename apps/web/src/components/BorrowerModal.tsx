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
            <DialogContent className="max-w-xl rounded-[32px] border-border bg-card/90 backdrop-blur-2xl p-0 shadow-2xl overflow-hidden border shadow-[0_0_50px_rgba(0,0,0,0.5)] font-sans">
                <div className="p-10 space-y-10">
                    <DialogHeader>
                        <DialogTitle className="text-3xl font-black text-foreground tracking-tighter flex items-center gap-4">
                            <div className="p-3 bg-primary/10 rounded-2xl">
                                <UserPlus className="text-primary" size={32} />
                            </div>
                            Digital <span className="text-primary italic">Identity</span>
                        </DialogTitle>
                        <DialogDescription className="text-muted-foreground font-bold text-[15px] opacity-70">
                            {borrower ? 'Update and re-verify client identifiers in the organizational ledger.' : 'Register new KYC-compliant client identifiers into the organizational ledger.'}
                        </DialogDescription>
                    </DialogHeader>

                    <form onSubmit={handleSubmit} className="space-y-8">
                        <div className="grid grid-cols-2 gap-6">
                            <div className="space-y-3">
                                <Label htmlFor="firstName" className="text-[11px] font-black text-muted-foreground uppercase tracking-[0.2em] ml-2 opacity-50">First Name</Label>
                                <Input
                                    id="firstName"
                                    value={formData.firstName}
                                    onChange={e => setFormData({ ...formData, firstName: e.target.value })}
                                    required
                                    className="h-14 rounded-2xl border-border/50 bg-background/50 focus:ring-4 focus:ring-primary/10 focus:border-primary font-black px-5 text-foreground transition-all"
                                />
                            </div>
                            <div className="space-y-3">
                                <Label htmlFor="lastName" className="text-[11px] font-black text-muted-foreground uppercase tracking-[0.2em] ml-2 opacity-50">Last Name</Label>
                                <Input
                                    id="lastName"
                                    value={formData.lastName}
                                    onChange={e => setFormData({ ...formData, lastName: e.target.value })}
                                    required
                                    className="h-14 rounded-2xl border-border/50 bg-background/50 focus:ring-4 focus:ring-primary/10 focus:border-primary font-black px-5 text-foreground transition-all"
                                />
                            </div>
                        </div>

                        <div className="space-y-6">
                            <div className="space-y-3">
                                <Label htmlFor="phone" className="text-[11px] font-black text-muted-foreground uppercase tracking-[0.2em] ml-2 opacity-50">Contact Anchor</Label>
                                <div className="relative group">
                                    <Phone size={18} className="absolute left-5 top-1/2 -translate-y-1/2 text-muted-foreground group-focus-within:text-primary transition-colors" />
                                    <Input
                                        id="phone"
                                        value={formData.phone}
                                        onChange={e => setFormData({ ...formData, phone: e.target.value })}
                                        required
                                        className="h-14 rounded-2xl border-border/50 bg-background/50 focus:ring-4 focus:ring-primary/10 focus:border-primary font-black pl-14 pr-6 text-foreground shadow-inner transition-all"
                                        placeholder="+855 ..."
                                    />
                                </div>
                            </div>

                            <div className="space-y-3">
                                <Label htmlFor="idNumber" className="text-[11px] font-black text-muted-foreground uppercase tracking-[0.2em] ml-2 opacity-50">Identity Serial</Label>
                                <div className="relative group">
                                    <CreditCard size={18} className="absolute left-5 top-1/2 -translate-y-1/2 text-muted-foreground group-focus-within:text-primary transition-colors" />
                                    <Input
                                        id="idNumber"
                                        value={formData.idNumber}
                                        onChange={e => setFormData({ ...formData, idNumber: e.target.value })}
                                        required
                                        className="h-14 rounded-2xl border-border/50 bg-background/50 focus:ring-4 focus:ring-primary/10 focus:border-primary font-black pl-14 pr-6 text-foreground shadow-inner transition-all"
                                        placeholder="National ID / Passport Hash"
                                    />
                                </div>
                            </div>

                            <div className="space-y-3">
                                <Label htmlFor="address" className="text-[11px] font-black text-muted-foreground uppercase tracking-[0.2em] ml-2 opacity-50">Geographic Node</Label>
                                <div className="relative group">
                                    <MapPin size={18} className="absolute left-5 top-1/2 -translate-y-1/2 text-muted-foreground group-focus-within:text-primary transition-colors" />
                                    <Input
                                        id="address"
                                        value={formData.address}
                                        onChange={e => setFormData({ ...formData, address: e.target.value })}
                                        required
                                        className="h-14 rounded-2xl border-border/50 bg-background/50 focus:ring-4 focus:ring-primary/10 focus:border-primary font-black pl-14 pr-6 text-foreground shadow-inner transition-all"
                                        placeholder="Primary Residence Address"
                                    />
                                </div>
                            </div>
                        </div>

                        <div className="flex justify-end gap-4 pt-8 border-t border-border/50">
                            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} className="rounded-2xl font-black h-14 px-8 text-muted-foreground hover:text-foreground hover:bg-border/20 uppercase tracking-widest text-[12px]">
                                Discard
                            </Button>
                            <Button type="submit" disabled={loading} className="premium-button h-14 px-10 group uppercase tracking-[0.2em] text-[12px]">
                                {loading ? <Loader2 className="animate-spin mr-3" size={18} /> : <UserCheck className="mr-3 group-hover:scale-110 transition-transform" size={18} />}
                                {loading ? 'Committing...' : borrower ? 'Update Registry' : 'Provision Identity'}
                            </Button>
                        </div>
                    </form>
                </div>
            </DialogContent>
        </Dialog>
    );
}
