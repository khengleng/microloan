import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Loader2 } from "lucide-react";
import api from "@/lib/api";
import { useToast } from "@/components/ui/toast";
import { clarityEvent, claritySetTag } from "@/lib/clarity";
import { useWorkspace } from "@/lib/workspace";


interface Borrower {
    id: string;
    firstName: string;
    lastName: string;
    phone: string;
    idNumber: string;
    address: string;
    monthlyIncome?: number | null;
    monthlyExpenses?: number | null;
    dateOfBirth?: string | null;
    idType?: string | null;
    occupation?: string | null;
    branchId?: string | null;
    amlStatus?: string | null;
}

interface BranchOption { id: string; name: string; code: string | null }

/** Identity document types the borrower record accepts (free text on the API; these are the usual ones). */
const ID_TYPES = ['NATIONAL_ID', 'PASSPORT', 'FAMILY_BOOK', 'RESIDENCE_BOOK', 'DRIVING_LICENCE', 'OTHER'] as const;
const AML_STATUSES = ['NOT_SCREENED', 'CLEAR', 'FLAGGED'] as const;

/** Today in the browser's calendar, as YYYY-MM-DD (the date-of-birth upper bound). */
const todayLocal = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/** A server error message, which class-validator may send as a list. */
const serverMessage = (error: any): string | null => {
    const m = error?.response?.data?.message;
    if (Array.isArray(m)) return m.join(' ');
    return typeof m === 'string' ? m : null;
};

const EMPTY_FORM = { firstName: '', lastName: '', phone: '', idNumber: '', address: '', monthlyIncome: '', monthlyExpenses: '', dateOfBirth: '', idType: '', occupation: '', branchId: '', amlStatus: '' };

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
    const tc = useTranslations('Customers');
    const { showToast } = useToast();
    const { access, legacyCan } = useWorkspace();
    const [loading, setLoading] = useState(false);
    const [formData, setFormData] = useState(EMPTY_FORM);
    const [dirty, setDirty] = useState(false);
    const [problems, setProblems] = useState<string[]>([]);
    const [branches, setBranches] = useState<BranchOption[] | null>(null);
    // AML screening status is recorded through the KYC/AML update, which needs CUSTOMER_UPDATE.
    const mayRecordAml = !!borrower && legacyCan('CUSTOMER_UPDATE');
    const ownBranchId = access?.principal.branchId ?? '';

    useEffect(() => {
        if (!open) return;
        let live = true;
        api.get<BranchOption[]>('/borrowers/branches')
            .then((r) => { if (live) setBranches(Array.isArray(r.data) ? r.data : []); })
            .catch(() => { if (live) setBranches([]); });
        return () => { live = false; };
    }, [open]);

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
                address: borrower.address || '',
                monthlyIncome: borrower.monthlyIncome != null ? String(borrower.monthlyIncome) : '',
                monthlyExpenses: borrower.monthlyExpenses != null ? String(borrower.monthlyExpenses) : '',
                dateOfBirth: borrower.dateOfBirth ? String(borrower.dateOfBirth).slice(0, 10) : '',
                idType: borrower.idType || '',
                occupation: borrower.occupation || '',
                branchId: borrower.branchId || '',
                amlStatus: borrower.amlStatus || 'NOT_SCREENED',
            });
        } else {
            setFormData({ ...EMPTY_FORM, branchId: ownBranchId });
        }
        setDirty(false);
        setProblems([]);
    }, [borrower, open, ownBranchId]);

    /** Friendly checks before the server sees the form. */
    const validate = (): string[] => {
        const errs: string[] = [];
        if (formData.dateOfBirth) {
            if (!/^\d{4}-\d{2}-\d{2}$/.test(formData.dateOfBirth)) errs.push(tc('errDobFormat'));
            else if (formData.dateOfBirth > todayLocal()) errs.push(tc('errDobFuture'));
            else if (formData.dateOfBirth < '1900-01-01') errs.push(tc('errDobPast'));
        }
        if (formData.monthlyIncome.trim() && !(Number(formData.monthlyIncome) >= 0)) errs.push(tc('errAmount', { field: tc('monthlyIncome') }));
        if (formData.monthlyExpenses.trim() && !(Number(formData.monthlyExpenses) >= 0)) errs.push(tc('errAmount', { field: tc('monthlyExpenses') }));
        return errs;
    };

    useEffect(() => {
        if (!open && dirty && !loading) {
            clarityEvent('kyc_form_dropoff');
            setDirty(false);
        }
    }, [open, dirty, loading]);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        clarityEvent('kyc_submit_attempt');
        const errs = validate();
        setProblems(errs);
        if (errs.length) return;
        setLoading(true);
        try {
            const { amlStatus, ...fields } = formData;
            const payload: any = {
                ...fields,
                monthlyIncome: formData.monthlyIncome === '' ? undefined : Number(formData.monthlyIncome),
                monthlyExpenses: formData.monthlyExpenses === '' ? undefined : Number(formData.monthlyExpenses),
                // A blank date of birth is left out on create and cleared on edit.
                dateOfBirth: formData.dateOfBirth || (borrower?.dateOfBirth ? null : undefined),
                idType: formData.idType || undefined,
                occupation: formData.occupation.trim() || undefined,
                branchId: formData.branchId || undefined,
            };
            if (borrower) {
                await api.put(`/borrowers/${borrower.id}`, payload);
                if (mayRecordAml && amlStatus && amlStatus !== (borrower.amlStatus || 'NOT_SCREENED')) {
                    await api.patch(`/borrowers/${borrower.id}/kyc`, { amlStatus });
                }
            } else {
                await api.post('/borrowers', payload);
            }
            clarityEvent('kyc_submit_success');
            setDirty(false);
            onSuccess();
            onOpenChange(false);
        } catch (error: any) {
            clarityEvent('kyc_submit_failed');
            const msg = serverMessage(error) || tc('saveFailed');
            setProblems([msg]);
            showToast(msg, 'error');
        } finally {
            setLoading(false);
        }
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto bg-white border border-border rounded-lg p-0 shadow-lg overflow-hidden">
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

                        {/* Identity and KYC details: product eligibility rules (e.g. age) read these */}
                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <label htmlFor="idType" className={labelCls}>{tc('idType')}</label>
                                <select id="idType" className={fieldCls} value={formData.idType} onChange={e => {
                                    setDirty(true);
                                    setFormData({ ...formData, idType: e.target.value });
                                }}>
                                    <option value="">{tc('notRecorded')}</option>
                                    {ID_TYPES.map((v) => <option key={v} value={v}>{tc(`idTypes.${v}`)}</option>)}
                                    {formData.idType && !(ID_TYPES as readonly string[]).includes(formData.idType) && <option value={formData.idType}>{formData.idType}</option>}
                                </select>
                            </div>
                            <div>
                                <label htmlFor="dateOfBirth" className={labelCls}>{tc('dateOfBirth')}</label>
                                <input id="dateOfBirth" type="date" max={todayLocal()} data-clarity-mask="true" className={fieldCls} value={formData.dateOfBirth} onChange={e => {
                                    setDirty(true);
                                    setFormData({ ...formData, dateOfBirth: e.target.value });
                                }} />
                            </div>
                        </div>
                        <p className="text-xs text-muted-foreground -mt-2">{tc('dobHint')}</p>

                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <label htmlFor="occupation" className={labelCls}>{tc('occupation')}</label>
                                <input id="occupation" data-clarity-mask="true" className={fieldCls} maxLength={120} placeholder={tc('occupationPlaceholder')} value={formData.occupation} onChange={e => {
                                    setDirty(true);
                                    setFormData({ ...formData, occupation: e.target.value });
                                }} />
                            </div>
                            <div>
                                <label htmlFor="branchId" className={labelCls}>{tc('branch')}</label>
                                <select id="branchId" className={fieldCls} value={formData.branchId} disabled={branches === null} onChange={e => {
                                    setDirty(true);
                                    setFormData({ ...formData, branchId: e.target.value });
                                }}>
                                    <option value="">{branches === null ? tc('loading') : tc('noBranch')}</option>
                                    {(branches ?? []).map((b) => <option key={b.id} value={b.id}>{b.name}{b.code ? ` (${b.code})` : ''}</option>)}
                                    {formData.branchId && branches && !branches.some((b) => b.id === formData.branchId) && (
                                        <option value={formData.branchId}>{tc('otherBranch')}</option>
                                    )}
                                </select>
                            </div>
                        </div>
                        <p className="text-xs text-muted-foreground -mt-2">{tc('branchHint')}</p>

                        {mayRecordAml && (
                            <div>
                                <label htmlFor="amlStatus" className={labelCls}>{tc('amlStatus')}</label>
                                <select id="amlStatus" className={fieldCls} value={formData.amlStatus} onChange={e => {
                                    setDirty(true);
                                    setFormData({ ...formData, amlStatus: e.target.value });
                                }}>
                                    {AML_STATUSES.map((v) => <option key={v} value={v}>{tc(`aml.${v}`)}</option>)}
                                </select>
                                <p className="text-xs text-muted-foreground mt-1">{tc('amlHint')}</p>
                            </div>
                        )}

                        {/* Affordability inputs (feed the risk scorecard / DSR) */}
                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <label htmlFor="monthlyIncome" className={labelCls}>Monthly Income (USD)</label>
                                <input id="monthlyIncome" type="number" min="0" step="0.01" data-clarity-mask="true" className={fieldCls} placeholder="0.00" value={formData.monthlyIncome} onChange={e => {
                                    setDirty(true);
                                    setFormData({ ...formData, monthlyIncome: e.target.value });
                                }} />
                            </div>
                            <div>
                                <label htmlFor="monthlyExpenses" className={labelCls}>Monthly Expenses (USD)</label>
                                <input id="monthlyExpenses" type="number" min="0" step="0.01" data-clarity-mask="true" className={fieldCls} placeholder="0.00" value={formData.monthlyExpenses} onChange={e => {
                                    setDirty(true);
                                    setFormData({ ...formData, monthlyExpenses: e.target.value });
                                }} />
                            </div>
                        </div>
                    </div>

                    {problems.length > 0 && (
                        <div role="alert" className="mx-6 mb-4 rounded border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
                            <p className="font-medium">{tc('pleaseFix')}</p>
                            <ul className="list-disc pl-5">{problems.map((p) => <li key={p}>{p}</li>)}</ul>
                        </div>
                    )}

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
