"use client";

import { ReactNode, useState } from 'react';
import { AlertTriangle, ChevronDown, ChevronRight, Loader2, Inbox, ShieldAlert } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { ApiErrorInfo } from './useAsync';

/* ── Layout primitives ───────────────────────────────────────────────────── */

export function Card({ title, subtitle, actions, children, className = '', bodyClass = 'p-5' }: {
    title?: ReactNode; subtitle?: ReactNode; actions?: ReactNode; children?: ReactNode; className?: string; bodyClass?: string;
}) {
    return (
        <section className={`bg-white border border-[#E3E8EE] rounded-lg shadow-sm ${className}`}>
            {(title || actions) && (
                <header className="flex flex-wrap items-start justify-between gap-3 px-5 py-3.5 border-b border-[#E3E8EE]">
                    <div className="min-w-0">
                        {title && <h2 className="text-[15px] font-bold text-[#1A1F36]">{title}</h2>}
                        {subtitle && <p className="text-[12px] text-[#697386] mt-0.5">{subtitle}</p>}
                    </div>
                    {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
                </header>
            )}
            <div className={bodyClass}>{children}</div>
        </section>
    );
}

export function Spinner({ label }: { label?: string }) {
    const t = useTranslations('LendingUi');
    if (label === undefined) label = t('loading');
    return (
        <div className="flex items-center justify-center gap-2 py-12 text-[#697386] text-sm">
            <Loader2 className="animate-spin text-[#635BFF]" size={20} /> {label}
        </div>
    );
}

export function Empty({ children }: { children: ReactNode }) {
    return (
        <div className="flex flex-col items-center justify-center gap-2 py-10 text-center text-[13px] text-[#697386]">
            <Inbox size={22} className="text-[#AAB7C4]" />
            {children}
        </div>
    );
}

export function Notice({ tone = 'info', title, children }: { tone?: 'info' | 'warn' | 'danger' | 'success'; title?: ReactNode; children?: ReactNode }) {
    const cls = {
        info: 'bg-[#F0F5FF] border-[#C9D7FF] text-[#3A4161]',
        warn: 'bg-amber-50 border-amber-200 text-amber-900',
        danger: 'bg-red-50 border-red-200 text-red-900',
        success: 'bg-emerald-50 border-emerald-200 text-emerald-900',
    }[tone];
    return (
        <div className={`border rounded-md px-4 py-3 text-[13px] ${cls}`}>
            {title && <p className="font-bold mb-0.5 flex items-center gap-1.5">{tone !== 'info' && tone !== 'success' && <AlertTriangle size={14} />}{title}</p>}
            {children}
        </div>
    );
}

/** Inline API error: message, code, policy layers that blocked, and validation issues. */
export function ErrorBox({ error, onDismiss }: { error: ApiErrorInfo | null | undefined; onDismiss?: () => void }) {
    const t = useTranslations('LendingUi');
    if (!error) return null;
    return (
        <div className="border border-red-200 bg-red-50 rounded-md px-4 py-3 text-[13px] text-red-900 space-y-2" role="alert">
            <div className="flex items-start justify-between gap-3">
                <p className="font-semibold flex items-center gap-1.5">
                    <ShieldAlert size={14} /> {error.message}
                    {error.code && <span className="ml-1 font-mono text-[11px] px-1.5 py-0.5 rounded bg-red-100">{error.code}</span>}
                </p>
                {onDismiss && <button onClick={onDismiss} className="text-[12px] underline opacity-70 hover:opacity-100">{t('dismiss')}</button>}
            </div>
            {error.blockedBy && error.blockedBy.length > 0 && (
                <div>
                    <p className="text-[11px] font-bold uppercase tracking-wide opacity-70">{t('blockedBy')}</p>
                    <ul className="mt-1 space-y-0.5">
                        {error.blockedBy.map((b, i) => (
                            <li key={i} className="flex gap-2"><span className="font-mono text-[11px] font-bold px-1.5 rounded bg-red-100 h-fit">{b.layer}</span><span>{b.message}</span></li>
                        ))}
                    </ul>
                </div>
            )}
            {error.issues && error.issues.length > 0 && (
                <div>
                    <p className="text-[11px] font-bold uppercase tracking-wide opacity-70">{t('validationIssues')}</p>
                    <IssueList issues={error.issues} />
                </div>
            )}
        </div>
    );
}

/**
 * Validation and assessment issues. A field path is shown as a readable label
 * ("terms › principal"); an issue about the whole request (no path — e.g. an
 * eligibility or document check) shows its message alone.
 */
export function IssueList({ issues }: { issues: { path?: string; code?: string; message: string }[] }) {
    const label = (path: string) => path.replace(/\[(\d+)\]/g, ' $1').split('.').map((p) => p.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase()).join(' › ');
    return (
        <ul className="mt-1 space-y-0.5 list-disc pl-4">
            {issues.map((i, k) => (
                <li key={k} className="text-[12px]">{i.path ? <><span className="font-semibold text-red-700">{label(i.path)}</span>: </> : null}{i.message}</li>
            ))}
        </ul>
    );
}

/* ── Buttons ─────────────────────────────────────────────────────────────── */

type BtnVariant = 'primary' | 'secondary' | 'danger' | 'ghost';
const btnCls: Record<BtnVariant, string> = {
    primary: 'bg-[#635BFF] hover:bg-[#5D55EF] text-white border border-[#635BFF]',
    secondary: 'bg-white hover:bg-slate-50 text-[#3C4257] border border-[#E3E8EE]',
    danger: 'bg-white hover:bg-red-50 text-red-600 border border-red-200',
    ghost: 'bg-transparent hover:bg-slate-100 text-[#4F566B] border border-transparent',
};

export function Btn({ variant = 'secondary', busy, disabled, reason, children, className = '', size = 'md', ...rest }: {
    variant?: BtnVariant; busy?: boolean; disabled?: boolean; reason?: string; size?: 'sm' | 'md';
    children: ReactNode; className?: string;
} & Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'disabled' | 'children' | 'className'>) {
    const sz = size === 'sm' ? 'text-[12px] px-2.5 py-1' : 'text-[13px] px-3.5 py-1.5';
    return (
        <button
            type="button"
            {...rest}
            disabled={disabled || busy}
            title={reason || rest.title}
            className={`inline-flex items-center justify-center gap-1.5 rounded font-semibold shadow-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${sz} ${btnCls[variant]} ${className}`}
        >
            {busy && <Loader2 size={13} className="animate-spin" />}
            {children}
        </button>
    );
}

/* ── Form controls ───────────────────────────────────────────────────────── */

export const inputCls = 'w-full rounded border border-[#E3E8EE] bg-white px-2.5 py-1.5 text-[13px] text-[#1A1F36] focus:outline-none focus:ring-2 focus:ring-[#635BFF]/30 focus:border-[#635BFF] disabled:bg-slate-50';

export function Field({ label, hint, error, children, className = '' }: { label: ReactNode; hint?: ReactNode; error?: string; children: ReactNode; className?: string }) {
    return (
        <label className={`block ${className}`}>
            <span className="block text-[12px] font-semibold text-[#3C4257] mb-1">{label}</span>
            {children}
            {hint && !error && <span className="block text-[11px] text-[#697386] mt-0.5">{hint}</span>}
            {error && <span className="block text-[11px] text-red-600 mt-0.5">{error}</span>}
        </label>
    );
}

export function TextInput({ value, onChange, ...rest }: { value: string; onChange: (v: string) => void } & Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'>) {
    return <input {...rest} value={value} onChange={(e) => onChange(e.target.value)} className={`${inputCls} ${rest.className ?? ''}`} />;
}

export function TextArea({ value, onChange, rows = 3, ...rest }: { value: string; onChange: (v: string) => void; rows?: number } & Omit<React.TextareaHTMLAttributes<HTMLTextAreaElement>, 'value' | 'onChange'>) {
    return <textarea {...rest} rows={rows} value={value} onChange={(e) => onChange(e.target.value)} className={`${inputCls} ${rest.className ?? ''}`} />;
}

export function SelectInput({ value, onChange, options, placeholder, ...rest }: {
    value: string; onChange: (v: string) => void; options: (string | { value: string; label: string })[]; placeholder?: string;
} & Omit<React.SelectHTMLAttributes<HTMLSelectElement>, 'value' | 'onChange'>) {
    return (
        <select {...rest} value={value} onChange={(e) => onChange(e.target.value)} className={`${inputCls} ${rest.className ?? ''}`}>
            {placeholder !== undefined && <option value="">{placeholder}</option>}
            {options.map((o) => {
                const opt = typeof o === 'string' ? { value: o, label: o } : o;
                return <option key={opt.value} value={opt.value}>{opt.label}</option>;
            })}
        </select>
    );
}

export function Checkbox({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: ReactNode; disabled?: boolean }) {
    return (
        <label className={`inline-flex items-center gap-2 text-[13px] text-[#3C4257] ${disabled ? 'opacity-60' : 'cursor-pointer'}`}>
            <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} className="accent-[#635BFF]" />
            {label}
        </label>
    );
}

/* ── Tabs & disclosure ───────────────────────────────────────────────────── */

/** Tab strip: announced as tabs, the selected one marked (aria-selected). */
export function Tabs<T extends string>({ tabs, value, onChange }: { tabs: { value: T; label: ReactNode }[]; value: T; onChange: (v: T) => void }) {
    return (
        <div role="tablist" className="flex flex-wrap gap-1 border-b border-[#E3E8EE]">
            {tabs.map((t) => (
                <button
                    key={t.value}
                    type="button"
                    role="tab"
                    aria-selected={value === t.value}
                    onClick={() => onChange(t.value)}
                    className={`px-3 py-2 text-[13px] font-semibold -mb-px border-b-2 transition-colors ${value === t.value ? 'border-[#635BFF] text-[#635BFF]' : 'border-transparent text-[#697386] hover:text-[#1A1F36]'}`}
                >
                    {t.label}
                </button>
            ))}
        </div>
    );
}

export function Disclosure({ summary, children, defaultOpen = false }: { summary: ReactNode; children: ReactNode; defaultOpen?: boolean }) {
    const [open, setOpen] = useState(defaultOpen);
    return (
        <div>
            <button type="button" onClick={() => setOpen((o) => !o)} className="flex items-center gap-1 text-[12px] font-semibold text-[#4F566B] hover:text-[#1A1F36]">
                {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />} {summary}
            </button>
            {open && <div className="mt-2">{children}</div>}
        </div>
    );
}

export function JsonBlock({ value }: { value: unknown }) {
    return (
        <pre className="text-[11px] leading-relaxed bg-[#F7FAFC] border border-[#E3E8EE] rounded p-3 overflow-auto max-h-80 whitespace-pre-wrap break-all">
            {JSON.stringify(value, null, 2)}
        </pre>
    );
}

/* ── Tables & key/value ──────────────────────────────────────────────────── */

export const th = 'px-3 py-2 text-left text-[11px] font-bold text-[#697386] uppercase tracking-wide whitespace-nowrap';
export const thR = `${th} text-right`;
export const td = 'px-3 py-2 text-[13px] text-[#3C4257] align-top';
export const tdR = `${td} text-right tabular-nums whitespace-nowrap`;

export function Table({ children, className = '' }: { children: ReactNode; className?: string }) {
    return (
        <div className={`overflow-x-auto ${className}`}>
            <table className="min-w-full border-collapse">{children}</table>
        </div>
    );
}

export function KV({ items, cols = 3 }: { items: [ReactNode, ReactNode][]; cols?: 2 | 3 | 4 }) {
    const grid = { 2: 'sm:grid-cols-2', 3: 'sm:grid-cols-2 lg:grid-cols-3', 4: 'sm:grid-cols-2 lg:grid-cols-4' }[cols];
    return (
        <dl className={`grid grid-cols-1 ${grid} gap-x-6 gap-y-3`}>
            {items.map(([k, v], i) => (
                <div key={i} className="min-w-0">
                    <dt className="text-[11px] font-bold uppercase tracking-wide text-[#8792A2]">{k}</dt>
                    <dd className="text-[13px] text-[#1A1F36] mt-0.5 break-words">{v ?? '—'}</dd>
                </div>
            ))}
        </dl>
    );
}

/** A modal-less inline panel used for small action forms. */
export function ActionPanel({ title, children, onClose }: { title: ReactNode; children: ReactNode; onClose?: () => void }) {
    const t = useTranslations('LendingUi');
    return (
        <div className="border border-[#C9D7FF] bg-[#F8F9FF] rounded-md p-4 space-y-3">
            <div className="flex items-center justify-between">
                <p className="text-[13px] font-bold text-[#1A1F36]">{title}</p>
                {onClose && <button type="button" onClick={onClose} className="text-[12px] text-[#697386] hover:text-[#1A1F36]">{t('close')}</button>}
            </div>
            {children}
        </div>
    );
}
