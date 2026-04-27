import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Loader2 } from "lucide-react";
import api from "@/lib/api";
import { useToast } from "@/components/ui/toast";
import { clarityEvent, claritySetTag } from "@/lib/clarity";


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

const fieldCls = "w-full h-9 px-3 bg-white border border-border rounded text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 transition-colors";
const labelCls = "block text-sm font-medium text-foreground mb-1";

export function BorrowerModal({ open, onOpenChange, onSuccess, borrower }: BorrowerModalProps) {
    const t = useTranslations('Borrowers');
    const { showToast } = useToast();
    const [loading, setLoading] = useState(false);
    const [formData, setFormData] = useState({
        firstName: '',
        lastName: '',
        phone: '',
        idNumber: '',
        address: ''
    });
    const [dirty, setDirty] = useState(false);

    useEffect(() => {
        if (open) {
            claritySetTag('journey_stage', 'kyc_borrower_form');
            clarityEvent(borrower ? 'borrower_edit_start' : 'borrower_create_start');
        }
    }, [open, borrower]);

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
            setFormData({ firstName: '', lastName: '', phone: '', idNumber: '', address: '' });
        }
        setDirty(false);
    }, [borrower, open]);

    useEffect(() => {
        if (!open && dirty && !loading) {
            clarityEvent('kyc_form_dropoff');
            setDirty(false);
        }
    }, [open, dirty, loading]);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        clarityEvent('kyc_submit_attempt');
        setLoading(true);
        try {
            if (borrower) {
                await api.put(`/borrowers/${borrower.id}`, formData);
            } else {
                await api.post('/borrowers', formData);
            }
            clarityEvent('kyc_submit_success');
            setDirty(false);
            onSuccess();
            onOpenChange(false);
        } catch (error: any) {
            clarityEvent('kyc_submit_failed');
            showToast(error.response?.data?.message || 'Failed to save borrower', 'error');
        } finally {
            setLoading(false);
        }
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-lg bg-white border border-border rounded-lg p-0 shadow-lg overflow-hidden">
                {/* Header */}
                <div className="px-6 py-4 border-b border-border">
                    <DialogTitle className="text-base font-bold text-foreground">
                        {borrower ? 'Edit Borrower' : 'Add New Borrower'}
                    </DialogTitle>
                    <DialogDescription className="text-sm text-muted-foreground mt-0.5">
                        {borrower ? 'Update borrower information.' : "Enter the borrower's details to register them."}
                    </DialogDescription>
                </div>

                {/* Form */}
                <form onSubmit={handleSubmit}>
                    <div className="px-6 py-5 space-y-4">
                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <label htmlFor="firstName" className={labelCls}>First Name <span className="text-destructive">*</span></label>
                                <input id="firstName" data-clarity-mask="true" className={fieldCls} value={formData.firstName} onChange={e => {
                                    setDirty(true);
                                    setFormData({ ...formData, firstName: e.target.value });
                                }} required />
                            </div>
                            <div>
                                <label htmlFor="lastName" className={labelCls}>Last Name <span className="text-destructive">*</span></label>
                                <input id="lastName" data-clarity-mask="true" className={fieldCls} value={formData.lastName} onChange={e => {
                                    setDirty(true);
                                    setFormData({ ...formData, lastName: e.target.value });
                                }} required />
                            </div>
                        </div>

                        <div>
                            <label htmlFor="phone" className={labelCls}>Phone Number <span className="text-destructive">*</span></label>
                            <input id="phone" type="tel" data-clarity-mask="true" className={fieldCls} placeholder="+855 ..." value={formData.phone} onChange={e => {
                                setDirty(true);
                                setFormData({ ...formData, phone: e.target.value });
                            }} required />
                        </div>

                        <div>
                            <label htmlFor="idNumber" className={labelCls}>National ID / Passport <span className="text-destructive">*</span></label>
                            <input id="idNumber" data-clarity-mask="true" className={fieldCls} placeholder="ID number" value={formData.idNumber} onChange={e => {
                                setDirty(true);
                                setFormData({ ...formData, idNumber: e.target.value });
                            }} required />
                        </div>

                        <div>
                            <label htmlFor="address" className={labelCls}>Address <span className="text-destructive">*</span></label>
                            <input id="address" data-clarity-mask="true" className={fieldCls} placeholder="Street, City" value={formData.address} onChange={e => {
                                setDirty(true);
                                setFormData({ ...formData, address: e.target.value });
                            }} required />
                        </div>
                    </div>

                    {/* Footer */}
                    <div className="px-6 py-4 border-t border-border bg-muted/40 flex justify-end gap-2">
                        <button type="button" onClick={() => onOpenChange(false)} className="btn-ghost">
                            Cancel
                        </button>
                        <button type="submit" disabled={loading} className="btn-primary">
                            {loading && <Loader2 size={14} className="animate-spin" />}
                            {loading ? 'Saving...' : borrower ? 'Save Changes' : 'Add Borrower'}
                        </button>
                    </div>
                </form>
            </DialogContent>
        </Dialog>
    );
}
