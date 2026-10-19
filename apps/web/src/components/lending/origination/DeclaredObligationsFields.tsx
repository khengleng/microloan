"use client";

import { useTranslations } from 'next-intl';
import { Field, TextInput } from '../ui';

/** What the applicant declares about their debts to other lenders (D-126). */
export interface DeclaredObligationsDraft { payments: string; lenders: string }

const MONEY_RE = /^\d+(\.\d{1,4})?$/;
const COUNT_RE = /^\d{1,2}$/;

export function draftFromDeclared(app?: { declaredExternalMonthlyPayments?: string | null; declaredOtherLenders?: number | null } | null): DeclaredObligationsDraft {
    return {
        payments: app?.declaredExternalMonthlyPayments != null ? String(Number(app.declaredExternalMonthlyPayments)) : '',
        lenders: app?.declaredOtherLenders != null ? String(app.declaredOtherLenders) : '',
    };
}

/** Problems with the draft, as messages. */
export function declaredProblems(v: DeclaredObligationsDraft, t: (key: string) => string): string[] {
    const out: string[] = [];
    if (v.payments.trim() && !MONEY_RE.test(v.payments.trim())) out.push(t('obligations.errPayments'));
    if (v.lenders.trim() && (!COUNT_RE.test(v.lenders.trim()) || Number(v.lenders) > 50)) out.push(t('obligations.errLenders'));
    return out;
}

/** The request fields. On an edit, an emptied field is cleared (null); on a create it is left out. */
export function declaredBody(v: DeclaredObligationsDraft, clearEmpty = false) {
    const payments = v.payments.trim();
    const lenders = v.lenders.trim();
    return {
        declaredExternalMonthlyPayments: payments || (clearEmpty ? null : undefined),
        declaredOtherLenders: lenders ? Number(lenders) : clearEmpty ? null : undefined,
    };
}

export function DeclaredObligationsFields({ value, onChange }: { value: DeclaredObligationsDraft; onChange: (v: DeclaredObligationsDraft) => void }) {
    const t = useTranslations('LendingOrigination');
    return (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label={t('obligations.payments')} hint={t('obligations.paymentsHint')}>
                <TextInput value={value.payments} onChange={(payments) => onChange({ ...value, payments })} inputMode="decimal" placeholder="0.00" />
            </Field>
            <Field label={t('obligations.lenders')} hint={t('obligations.lendersHint')}>
                <TextInput value={value.lenders} onChange={(lenders) => onChange({ ...value, lenders })} inputMode="numeric" placeholder="0" />
            </Field>
        </div>
    );
}
