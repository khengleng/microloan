import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>{borrower ? 'Edit Borrower' : t('add_new')}</DialogTitle>
                </DialogHeader>
                <form onSubmit={handleSubmit} className="space-y-4">
                    <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                            <Label htmlFor="firstName">First Name</Label>
                            <Input
                                id="firstName"
                                value={formData.firstName}
                                onChange={e => setFormData({ ...formData, firstName: e.target.value })}
                                required
                            />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="lastName">Last Name</Label>
                            <Input
                                id="lastName"
                                value={formData.lastName}
                                onChange={e => setFormData({ ...formData, lastName: e.target.value })}
                                required
                            />
                        </div>
                    </div>
                    <div className="space-y-2">
                        <Label htmlFor="phone">{t('phone')}</Label>
                        <Input
                            id="phone"
                            value={formData.phone}
                            onChange={e => setFormData({ ...formData, phone: e.target.value })}
                            required
                        />
                    </div>
                    <div className="space-y-2">
                        <Label htmlFor="idNumber">{t('id_number')}</Label>
                        <Input
                            id="idNumber"
                            value={formData.idNumber}
                            onChange={e => setFormData({ ...formData, idNumber: e.target.value })}
                            required
                        />
                    </div>
                    <div className="space-y-2">
                        <Label htmlFor="address">{t('address')}</Label>
                        <Input
                            id="address"
                            value={formData.address}
                            onChange={e => setFormData({ ...formData, address: e.target.value })}
                            required
                        />
                    </div>
                    <DialogFooter>
                        <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                            {t('cancel')}
                        </Button>
                        <Button type="submit" disabled={loading}>
                            {loading ? 'Saving...' : t('save')}
                        </Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    );
}
