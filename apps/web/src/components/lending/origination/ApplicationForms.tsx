"use client";

import { useBusinessDate } from '../useBusinessDate';
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import api from '@/lib/api';
import { ActionPanel, Btn, ErrorBox, Field, Notice, SelectInput, TextArea, TextInput } from '../ui';
import { clean, useAction } from '../useAsync';
import type { Terms } from '../types';
import { draftFromTerms, TermsFields, termsFromDraft, validateTerms } from './TermsFields';
import { PolicyChoices, policyProblems, usePolicyMenus, type PolicyChoicesValue } from './PolicyChoices';

const MONEY_RE = /^\d+(\.\d{1,4})?$/;

function Problems({ items }: { items: string[] }) {
    const t = useTranslations('LendingOrigination');
    if (items.length === 0) return null;
    return (
        <Notice tone="warn" title={t('common.pleaseFix')}>
            <ul className="list-disc pl-4">{items.map((e) => <li key={e}>{e}</li>)}</ul>
        </Notice>
    );
}

/* ── Edit terms ──────────────────────────────────────────────────────────── */

export function EditTermsForm({ appId, terms, purpose, currency, productVersionId, onDone, onClose }: {
    appId: string; terms: Partial<Terms> | null; purpose: string | null | undefined; currency?: string; productVersionId?: string | null; onDone: () => void; onClose: () => void;
}) {
    const tc = useTranslations('Customers');
    const t = useTranslations('LendingOrigination');
    const [draft, setDraft] = useState(() => draftFromTerms(terms));
    const [purp, setPurp] = useState(purpose ?? '');
    const [policies, setPolicies] = useState<PolicyChoicesValue | undefined>(terms?.policies ?? undefined);
    const { menus } = usePolicyMenus(productVersionId);
    const [problems, setProblems] = useState<string[]>([]);
    const { busy, error, run, clearError } = useAction();

    const save = async () => {
        const errs = [...validateTerms(draft, t), ...policyProblems(policies, menus, tc)];
        setProblems(errs);
        if (errs.length) return;
        // The policy choice replaces the stored one; leaving every policy on its default removes it.
        const next = { ...termsFromDraft(draft, terms), policies };
        const res = await run('terms', () => api.put(`/lending/applications/${appId}/terms`, clean({ terms: next, purpose: purp.trim() })));
        if (res) onDone();
    };

    return (
        <ActionPanel title={t('forms.editTerms')} onClose={onClose}>
            <TermsFields value={draft} onChange={setDraft} currency={currency} />
            <PolicyChoices productVersionId={productVersionId} value={policies} onChange={setPolicies} />
            <Field label={t('common.purpose')} hint={t('common.optional')}>
                <TextArea value={purp} onChange={setPurp} rows={2} maxLength={500} />
            </Field>
            <Problems items={problems} />
            <ErrorBox error={error} onDismiss={clearError} />
            <Btn variant="primary" onClick={save} busy={busy === 'terms'}>{t('forms.saveTerms')}</Btn>
        </ActionPanel>
    );
}

/* ── Document upload ─────────────────────────────────────────────────────── */

const ALLOWED_MIME = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'];
const MAX_BYTES = 3.5 * 1024 * 1024;

export interface RequiredDocument { code: string; label: string; stage?: string; mandatory?: boolean }

function readBase64(file: File, readError: string): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
            const result = String(reader.result ?? '');
            const comma = result.indexOf(',');
            resolve(comma >= 0 ? result.slice(comma + 1) : result);
        };
        reader.onerror = () => reject(reader.error ?? new Error(readError));
        reader.readAsDataURL(file);
    });
}

export function DocumentUploadForm({ appId, required, onDone, onClose }: {
    appId: string; required: RequiredDocument[] | null; onDone: () => void; onClose: () => void;
}) {
    const t = useTranslations('LendingOrigination');
    const [code, setCode] = useState(required?.[0]?.code ?? '');
    const [file, setFile] = useState<File | null>(null);
    const [problems, setProblems] = useState<string[]>([]);
    const [inputKey, setInputKey] = useState(0);
    const { busy, error, run, clearError } = useAction();

    const upload = async () => {
        const errs: string[] = [];
        if (!/^[A-Z0-9_]{2,40}$/.test(code)) errs.push(t('forms.errDocCode'));
        if (!file) errs.push(t('forms.errNoFile'));
        else {
            if (!ALLOWED_MIME.includes(file.type)) errs.push(t('forms.errFileType'));
            if (file.size === 0 || file.size > MAX_BYTES) errs.push(t('forms.errFileSize'));
        }
        setProblems(errs);
        if (errs.length || !file) return;
        const res = await run('upload', async () => {
            const contentBase64 = await readBase64(file, t('forms.errRead'));
            return api.post(`/lending/applications/${appId}/documents`, {
                code,
                fileName: file.name.slice(0, 200),
                mimeType: file.type,
                contentBase64,
            });
        });
        if (res) {
            setFile(null);
            setInputKey((k) => k + 1);
            onDone();
        }
    };

    return (
        <ActionPanel title={t('forms.uploadDocument')} onClose={onClose}>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Field label={t('forms.documentType')}>
                    {required && required.length > 0 ? (
                        <SelectInput
                            value={code}
                            onChange={setCode}
                            options={required.map((d) => ({ value: d.code, label: `${d.label} (${d.code})${d.mandatory ? ` · ${t('forms.mandatory')}` : ''}${d.stage ? ` · ${d.stage}` : ''}` }))}
                        />
                    ) : (
                        <TextInput value={code} onChange={(v) => setCode(v.toUpperCase())} placeholder={t('forms.docCodePlaceholder')} className="font-mono" />
                    )}
                </Field>
                <Field label={t('forms.file')} hint={t('forms.fileHint')}>
                    <input
                        key={inputKey}
                        type="file"
                        accept={ALLOWED_MIME.join(',')}
                        onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                        className="block w-full text-[13px] text-[#3C4257] file:mr-3 file:rounded file:border file:border-[#E3E8EE] file:bg-white file:px-3 file:py-1 file:text-[12px] file:font-semibold"
                    />
                </Field>
            </div>
            <Problems items={problems} />
            <ErrorBox error={error} onDismiss={clearError} />
            <Btn variant="primary" onClick={upload} busy={busy === 'upload'}>{t('forms.upload')}</Btn>
        </ActionPanel>
    );
}

/* ── Collateral ──────────────────────────────────────────────────────────── */

export function CollateralForm({ appId, currency, onDone, onClose, endpoint }: {
    appId: string; currency?: string; onDone: () => void; onClose: () => void;
    /** Where to post; defaults to the application. A running loan pledges at /lending/loans/:id/collateral. */
    endpoint?: string;
}) {
    // Valuations are dated on the organisation's business date, never later (the API refuses future dates).
    const t = useTranslations('LendingOrigination');
    const businessDate = useBusinessDate();
    const [f, setF] = useState({ type: '', description: '', marketValue: '', valuationDate: businessDate, valuer: '', method: 'MARKET', priorLienAmount: '' });
    const [problems, setProblems] = useState<string[]>([]);
    const { busy, error, run, clearError } = useAction();
    const set = (k: keyof typeof f) => (v: string) => setF((s) => ({ ...s, [k]: v }));

    const save = async () => {
        const errs: string[] = [];
        if (!f.type.trim()) errs.push(t('forms.errType'));
        if (!f.description.trim()) errs.push(t('forms.errDescription'));
        if (!MONEY_RE.test(f.marketValue.trim())) errs.push(t('forms.errMarketValue'));
        if (!f.valuationDate) errs.push(t('forms.errValuationDate'));
        if (!f.valuer.trim()) errs.push(t('forms.errValuer'));
        if (!f.method.trim()) errs.push(t('forms.errMethod'));
        if (f.priorLienAmount.trim() && !MONEY_RE.test(f.priorLienAmount.trim())) errs.push(t('forms.errPriorLiens'));
        setProblems(errs);
        if (errs.length) return;
        const res = await run('collateral', () => api.post(endpoint ?? `/lending/applications/${appId}/collateral`, {
            type: f.type.trim(), description: f.description.trim(), marketValue: f.marketValue.trim(),
            valuationDate: f.valuationDate, valuer: f.valuer.trim(), method: f.method.trim(),
            ...(f.priorLienAmount.trim() ? { priorLienAmount: f.priorLienAmount.trim() } : {}),
        }));
        if (res) onDone();
    };

    return (
        <ActionPanel title={t('forms.addCollateral')} onClose={onClose}>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                <Field label={t('forms.type')}><TextInput value={f.type} onChange={(v) => set('type')(v.toUpperCase())} placeholder={t('forms.collateralTypePlaceholder')} maxLength={48} /></Field>
                <Field label={t('forms.description')} className="lg:col-span-2"><TextInput value={f.description} onChange={set('description')} maxLength={300} /></Field>
                <Field label={currency ? t('forms.marketValueIn', { currency }) : t('forms.marketValue')}><TextInput value={f.marketValue} onChange={set('marketValue')} inputMode="decimal" /></Field>
                <Field label={t('forms.valuationDate')}><TextInput type="date" value={f.valuationDate} onChange={set('valuationDate')} /></Field>
                <Field label={t('forms.valuer')}><TextInput value={f.valuer} onChange={set('valuer')} maxLength={120} /></Field>
                <Field label={t('forms.method')}><TextInput value={f.method} onChange={set('method')} maxLength={40} /></Field>
                <Field label={t('forms.priorLiens')} hint={t('forms.priorLiensHint')}>
                    <TextInput value={f.priorLienAmount} onChange={set('priorLienAmount')} inputMode="decimal" />
                </Field>
            </div>
            <Problems items={problems} />
            <ErrorBox error={error} onDismiss={clearError} />
            <Btn variant="primary" onClick={save} busy={busy === 'collateral'}>{t('forms.addCollateral')}</Btn>
        </ActionPanel>
    );
}

/* ── Guarantee ───────────────────────────────────────────────────────────── */

const GUARANTEE_TYPES = ['PERSONAL', 'CORPORATE'];

export function GuaranteeForm({ appId, currency, onDone, onClose }: { appId: string; currency?: string; onDone: () => void; onClose: () => void }) {
    const t = useTranslations('LendingOrigination');
    const [name, setName] = useState('');
    const [type, setType] = useState('PERSONAL');
    const [amount, setAmount] = useState('');
    const [problems, setProblems] = useState<string[]>([]);
    const { busy, error, run, clearError } = useAction();

    const save = async () => {
        const errs: string[] = [];
        if (name.trim().length < 2) errs.push(t('forms.errGuarantorName'));
        if (!MONEY_RE.test(amount.trim())) errs.push(t('forms.errAmount'));
        setProblems(errs);
        if (errs.length) return;
        const res = await run('guarantee', () => api.post(`/lending/applications/${appId}/guarantees`, { guarantorName: name.trim(), type, amount: amount.trim() }));
        if (res) onDone();
    };

    return (
        <ActionPanel title={t('forms.addGuarantee')} onClose={onClose}>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <Field label={t('forms.guarantorName')}><TextInput value={name} onChange={setName} maxLength={120} /></Field>
                <Field label={t('forms.type')}><SelectInput value={type} onChange={setType} options={GUARANTEE_TYPES.map((v) => ({ value: v, label: t(`forms.guaranteeTypes.${v}`) }))} /></Field>
                <Field label={currency ? t('forms.amountIn', { currency }) : t('forms.amount')}><TextInput value={amount} onChange={setAmount} inputMode="decimal" /></Field>
            </div>
            <Problems items={problems} />
            <ErrorBox error={error} onDismiss={clearError} />
            <Btn variant="primary" onClick={save} busy={busy === 'guarantee'}>{t('forms.addGuarantee')}</Btn>
        </ActionPanel>
    );
}

/* ── Credit decisions ────────────────────────────────────────────────────── */

export type DecisionMode = 'recommend' | 'approve' | 'reject';

export function DecisionForm({ appId, mode, onDone, onClose }: { appId: string; mode: DecisionMode; onDone: () => void; onClose: () => void }) {
    const t = useTranslations('LendingOrigination');
    const [recommendation, setRecommendation] = useState<'APPROVE' | 'REJECT'>('APPROVE');
    const [rationale, setRationale] = useState('');
    const [problem, setProblem] = useState('');
    const { busy, error, run, clearError } = useAction();
    const title = t(`forms.decisionTitle.${mode}`);

    const save = async () => {
        if (rationale.trim().length < 3) { setProblem(t('forms.errRationale')); return; }
        setProblem('');
        const body = mode === 'recommend' ? { recommendation, rationale: rationale.trim() } : { rationale: rationale.trim() };
        const res = await run(mode, () => api.post(`/lending/applications/${appId}/${mode}`, body));
        if (res) onDone();
    };

    return (
        <ActionPanel title={title} onClose={onClose}>
            {mode === 'recommend' && (
                <Field label={t('forms.recommendation')}>
                    <SelectInput value={recommendation} onChange={(v) => setRecommendation(v as 'APPROVE' | 'REJECT')} options={(['APPROVE', 'REJECT'] as const).map((v) => ({ value: v, label: t(`forms.recommendations.${v}`) }))} />
                </Field>
            )}
            <Field label={t('forms.rationale')} error={problem || undefined}>
                <TextArea value={rationale} onChange={setRationale} rows={3} maxLength={2000} />
            </Field>
            <ErrorBox error={error} onDismiss={clearError} />
            <Btn variant={mode === 'reject' ? 'danger' : 'primary'} onClick={save} busy={busy === mode}>{title}</Btn>
        </ActionPanel>
    );
}

/* ── Booking ─────────────────────────────────────────────────────────────── */

export function BookForm({ appId, onBooked, onClose }: { appId: string; onBooked: (accountId: string | null) => void; onClose: () => void }) {
    const tc = useTranslations('Customers');
    const t = useTranslations('LendingOrigination');
    const [date, setDate] = useState('');
    const { busy, error, run, clearError } = useAction();
    const book = async () => {
        const res = await run('book', () => api.post<{ account?: { id: string } }>(`/lending/applications/${appId}/book`, clean({ plannedDisbursementDate: date })));
        if (res) onBooked(res.data?.account?.id ?? null);
    };
    return (
        <ActionPanel title={t('forms.bookAgreement')} onClose={onClose}>
            <Field label={t('forms.plannedDisbursementDate')} hint={tc('bookDateHint')}>
                <TextInput type="date" value={date} onChange={setDate} className="max-w-xs" />
            </Field>
            <ErrorBox error={error} onDismiss={clearError} />
            <Btn variant="primary" onClick={book} busy={busy === 'book'}>{t('forms.bookLoanAccount')}</Btn>
        </ActionPanel>
    );
}

/* ── Conditions precedent ────────────────────────────────────────────────── */

export function ConditionForm({ appId, code, label, resolution, onDone, onClose }: {
    appId: string; code: string; label: string; resolution: 'SATISFIED' | 'WAIVED'; onDone: () => void; onClose: () => void;
}) {
    const t = useTranslations('LendingOrigination');
    const [evidence, setEvidence] = useState('');
    const [problem, setProblem] = useState('');
    const { busy, error, run, clearError } = useAction();
    const save = async () => {
        if (resolution === 'SATISFIED' && !evidence.trim()) { setProblem(t('forms.errEvidence')); return; }
        setProblem('');
        const res = await run('condition', () => api.post(`/lending/applications/${appId}/conditions/${encodeURIComponent(code)}`, clean({ resolution, evidence: evidence.trim() })));
        if (res) onDone();
    };
    return (
        <ActionPanel title={resolution === 'SATISFIED' ? t('forms.satisfyTitle', { label }) : t('forms.waiveTitle', { label })} onClose={onClose}>
            <Field label={resolution === 'SATISFIED' ? t('forms.evidence') : t('forms.waiverNote')} error={problem || undefined}>
                <TextArea value={evidence} onChange={setEvidence} rows={2} maxLength={500} />
            </Field>
            <ErrorBox error={error} onDismiss={clearError} />
            <Btn variant="primary" onClick={save} busy={busy === 'condition'}>{resolution === 'SATISFIED' ? t('forms.markSatisfied') : t('forms.waiveCondition')}</Btn>
        </ActionPanel>
    );
}
