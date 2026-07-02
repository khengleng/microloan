"use client";

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import api from '@/lib/api';
import { useToast } from '@/components/ui/toast';
import { QrCode, Plus, Trash2, Star, Loader2, Save, X } from 'lucide-react';

const fieldCls = "w-full h-9 px-3 bg-white border border-border rounded text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 transition-colors";
const labelCls = "block text-sm font-medium text-foreground mb-1";

type Instrument = {
    id: string;
    label: string;
    bankName?: string | null;
    accountName?: string | null;
    accountNumber?: string | null;
    qrPayload?: string | null;
    qrImage?: string | null;
    currency: 'USD' | 'KHR';
    isActive: boolean;
    isDefault: boolean;
    qrRendered?: string | null;
};

type FormState = {
    label: string;
    bankName: string;
    accountName: string;
    accountNumber: string;
    qrPayload: string;
    qrImage: string;
    currency: 'USD' | 'KHR';
    isDefault: boolean;
};

const emptyForm: FormState = {
    label: '', bankName: '', accountName: '', accountNumber: '',
    qrPayload: '', qrImage: '', currency: 'USD', isDefault: false,
};

export function PaymentInstruments() {
    const t = useTranslations('Payments');
    const { showToast } = useToast();
    const [items, setItems] = useState<Instrument[]>([]);
    const [loading, setLoading] = useState(true);
    const [showForm, setShowForm] = useState(false);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [form, setForm] = useState<FormState>(emptyForm);
    const [saving, setSaving] = useState(false);

    const load = () => {
        setLoading(true);
        api.get('/payment-instruments')
            .then(res => setItems(res.data))
            .catch(() => showToast(t('loadFailed'), 'error'))
            .finally(() => setLoading(false));
    };
    useEffect(load, []);

    const openAdd = () => { setForm(emptyForm); setEditingId(null); setShowForm(true); };
    const openEdit = (i: Instrument) => {
        setForm({
            label: i.label, bankName: i.bankName || '', accountName: i.accountName || '',
            accountNumber: i.accountNumber || '', qrPayload: i.qrPayload || '', qrImage: i.qrImage || '',
            currency: i.currency, isDefault: i.isDefault,
        });
        setEditingId(i.id);
        setShowForm(true);
    };

    const onFile = (file?: File) => {
        if (!file) return;
        if (file.size > 1_000_000) { showToast(t('imageTooLarge'), 'error'); return; }
        const reader = new FileReader();
        reader.onload = () => setForm(f => ({ ...f, qrImage: String(reader.result || ''), qrPayload: '' }));
        reader.readAsDataURL(file);
    };

    const save = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!form.qrPayload.trim() && !form.qrImage.trim()) { showToast(t('qrRequired'), 'error'); return; }
        setSaving(true);
        try {
            if (editingId) await api.put(`/payment-instruments/${editingId}`, form);
            else await api.post('/payment-instruments', form);
            showToast(t('saved'), 'success');
            setShowForm(false);
            load();
        } catch (err: any) {
            showToast((err.response?.data?.message) || t('saveFailed'), 'error');
        } finally { setSaving(false); }
    };

    const remove = async (id: string) => {
        try {
            await api.delete(`/payment-instruments/${id}`);
            showToast(t('deleted'), 'success');
            load();
        } catch (err: any) {
            showToast((err.response?.data?.message) || t('deleteFailed'), 'error');
        }
    };

    return (
        <div className="bg-white border border-border rounded-md">
            <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-border">
                <div className="flex items-center gap-3">
                    <QrCode size={16} className="text-primary" />
                    <div>
                        <h3 className="text-sm font-bold text-foreground">{t('title')}</h3>
                        <p className="text-xs text-muted-foreground">{t('subtitle')}</p>
                    </div>
                </div>
                {!showForm && (
                    <button onClick={openAdd} className="flex items-center gap-1.5 text-sm font-semibold text-primary hover:underline">
                        <Plus size={14} /> {t('add')}
                    </button>
                )}
            </div>

            <div className="px-5 py-4 space-y-4">
                {loading ? (
                    <div className="flex items-center text-muted-foreground text-sm py-4">
                        <Loader2 className="animate-spin mr-2" size={14} /> {t('loading')}
                    </div>
                ) : (
                    <>
                        {!showForm && items.length === 0 && (
                            <p className="text-sm text-muted-foreground py-2">{t('empty')}</p>
                        )}

                        {!showForm && items.map(i => (
                            <div key={i.id} className="flex items-center gap-4 p-3 border border-border rounded-lg">
                                {i.qrRendered
                                    ? <img src={i.qrRendered} alt="QR" className="w-16 h-16 rounded border border-border bg-white object-contain" />
                                    : <div className="w-16 h-16 rounded border border-dashed border-border flex items-center justify-center text-muted-foreground"><QrCode size={20} /></div>}
                                <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-2">
                                        <p className="text-sm font-semibold text-foreground truncate">{i.label}</p>
                                        {i.isDefault && <span className="inline-flex items-center gap-1 text-[11px] font-medium text-amber-700 bg-amber-100 px-1.5 py-0.5 rounded"><Star size={10} /> {t('default')}</span>}
                                        {!i.isActive && <span className="text-[11px] text-muted-foreground bg-slate-100 px-1.5 py-0.5 rounded">{t('inactive')}</span>}
                                    </div>
                                    <p className="text-xs text-muted-foreground truncate">
                                        {[i.bankName, i.accountName, i.accountNumber].filter(Boolean).join(' · ') || '—'} · {i.currency}
                                    </p>
                                </div>
                                <button onClick={() => openEdit(i)} className="text-xs font-medium text-primary hover:underline">{t('edit')}</button>
                                <button onClick={() => remove(i.id)} className="text-muted-foreground hover:text-red-600"><Trash2 size={15} /></button>
                            </div>
                        ))}

                        {showForm && (
                            <form onSubmit={save} className="space-y-3 p-3 bg-slate-50 rounded-lg border border-border">
                                <div>
                                    <label className={labelCls}>{t('label')}</label>
                                    <input className={fieldCls} required maxLength={120} placeholder={t('labelPlaceholder')}
                                        value={form.label} onChange={e => setForm({ ...form, label: e.target.value })} />
                                </div>
                                <div className="grid grid-cols-2 gap-3">
                                    <div>
                                        <label className={labelCls}>{t('bankName')}</label>
                                        <input className={fieldCls} placeholder="ABA / Bakong" value={form.bankName} onChange={e => setForm({ ...form, bankName: e.target.value })} />
                                    </div>
                                    <div>
                                        <label className={labelCls}>{t('currency')}</label>
                                        <select className={fieldCls} value={form.currency} onChange={e => setForm({ ...form, currency: e.target.value as 'USD' | 'KHR' })}>
                                            <option value="USD">USD</option>
                                            <option value="KHR">KHR</option>
                                        </select>
                                    </div>
                                    <div>
                                        <label className={labelCls}>{t('accountName')}</label>
                                        <input className={fieldCls} value={form.accountName} onChange={e => setForm({ ...form, accountName: e.target.value })} />
                                    </div>
                                    <div>
                                        <label className={labelCls}>{t('accountNumber')}</label>
                                        <input className={fieldCls} value={form.accountNumber} onChange={e => setForm({ ...form, accountNumber: e.target.value })} />
                                    </div>
                                </div>
                                <div>
                                    <label className={labelCls}>{t('qrPayload')}</label>
                                    <textarea className={`${fieldCls} h-20 py-2 font-mono text-xs`} placeholder={t('qrPayloadPlaceholder')}
                                        value={form.qrPayload} onChange={e => setForm({ ...form, qrPayload: e.target.value, qrImage: e.target.value ? '' : form.qrImage })} />
                                    <p className="text-xs text-muted-foreground mt-1">{t('qrPayloadHelp')}</p>
                                </div>
                                <div>
                                    <label className={labelCls}>{t('orUploadImage')}</label>
                                    <input type="file" accept="image/*" className="text-xs" onChange={e => onFile(e.target.files?.[0])} />
                                    {form.qrImage && !form.qrPayload && (
                                        <img src={form.qrImage} alt="QR preview" className="w-20 h-20 mt-2 rounded border border-border object-contain bg-white" />
                                    )}
                                </div>
                                <label className="flex items-center gap-2 text-sm text-foreground">
                                    <input type="checkbox" checked={form.isDefault} onChange={e => setForm({ ...form, isDefault: e.target.checked })} />
                                    {t('setDefault')}
                                </label>
                                <div className="flex items-center gap-2 pt-1">
                                    <button type="submit" disabled={saving} className="btn-primary">
                                        {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                                        {t('save')}
                                    </button>
                                    <button type="button" onClick={() => setShowForm(false)} className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground px-3 py-2">
                                        <X size={14} /> {t('cancel')}
                                    </button>
                                </div>
                            </form>
                        )}
                    </>
                )}
            </div>
        </div>
    );
}
