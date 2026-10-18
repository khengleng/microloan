"use client";

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import api from '@/lib/api';
import { ActionPanel, Btn, Card, Disclosure, Empty, ErrorBox, Field, KV, Notice, SelectInput, Spinner, Table, TextInput, td, tdR, th, thR } from '../ui';
import { clean, toApiError, useAction, useApi, type ApiErrorInfo } from '../useAsync';
import { fmtDateTime, fmtRate } from '../format';
import { MoneyCell } from '../MoneyCell';
import { StatusBadge } from '../StatusBadge';
import type { LoanDetail } from '../types';

const MONEY_RE = /^\d+(\.\d{1,4})?$/;

export interface IncomeAssessment {
    id: string; sequence: number; reason: string; declaredAnnualIncome: string; incomePeriod: string; evidenceType: string; evidenceReference: string;
    annualRepayment: string; periodicPayment: string; status: string; effectiveDate: string | null; nextReviewDate: string | null;
    proposedBy: string; decidedBy: string | null; decidedAt: string | null; comment: string; createdAt: string;
}
interface Plan {
    terms: { repaymentRate: string; incomeThreshold: string; reassessmentMonths: number; unpaidInterest: string; capitalisationCap: string | null; evidenceRequired: boolean; annualRate: string | null; termInstalments: number | null };
    status: string; businessDate: string; termEnd: string | null; currentPayment: string;
    current: IncomeAssessment | null; pending: IncomeAssessment[]; assessments: IncomeAssessment[];
    nextReviewDate: string | null; reviewDue: boolean; capitalisedToDate: string; projectedForgiveness: string;
    forgiven: { amount: string; on: string } | null;
}
interface Preview {
    payment: { declaredAnnualIncome: string; incomeAboveThreshold: string; annualRepayment: string; periodicPayment: string; explanation: string };
    effectiveDate?: string;
    schedule: { maturityDate: string; explanation: string[]; forgivenAtTermEnd: string } | null;
}

const EVIDENCE = ['PAYSLIP', 'TAX_RETURN', 'EMPLOYER_LETTER', 'BENEFITS_STATEMENT', 'NO_INCOME_DECLARATION', 'OTHER'];
type T = ReturnType<typeof useTranslations>;
const evidenceLabel = (t: T, v: string) => (EVIDENCE.includes(v) || v === 'APPLICATION' ? t(`evidence.${v}`) : v);

type Props = { loanId: string; detail: LoanDetail; onDone: (msg: string) => void };

/** Income-contingent repayment: the instalment set by assessed income, reassessments under maker-checker, forgiveness at term end (D-066). */
export function IncomeContingentCard({ loanId, detail, onDone }: Props) {
    const t = useTranslations('LendingServicing.incomeContingent');
    const cur = detail.account.currency;
    const res = useApi<Plan>(`/lending/loans/${loanId}/income-contingent`);
    const [proposing, setProposing] = useState(false);
    const p = res.data;
    const done = (msg: string) => { setProposing(false); res.reload(); onDone(msg); };
    return (
        <Card title={t('title')} subtitle={t('subtitle')}>
            {res.error && <ErrorBox error={res.error} />}
            {!p ? <Spinner /> : (
                <div className="space-y-4">
                    {p.reviewDue && (
                        <Notice tone="warn" title={t('reviewDueTitle')}>
                            {t('reviewDueBody', { date: p.nextReviewDate ?? '—' })}
                        </Notice>
                    )}
                    {p.forgiven && <Notice tone="success" title={t('forgivenTitle')}>{t('forgivenBody', { currency: cur, amount: p.forgiven.amount, date: p.forgiven.on })}</Notice>}
                    <KV
                        cols={4}
                        items={[
                            [t('kv.currentInstalment'), <span key="c" className="font-bold">{t.rich('perMonth', { money: () => <MoneyCell value={p.currentPayment} currency={cur} /> })}</span>],
                            [t('kv.assessedIncome'), p.current ? <MoneyCell key="i" value={p.current.declaredAnnualIncome} currency={cur} /> : '—'],
                            [t('kv.repaymentRule'), t('repaymentRuleValue', { rate: fmtRate(p.terms.repaymentRate), currency: cur, threshold: p.terms.incomeThreshold })],
                            [t('kv.interest'), p.terms.unpaidInterest === 'CAPITALISE'
                                ? (p.terms.capitalisationCap
                                    ? t('interestCapitalisedCap', { rate: p.terms.annualRate ? fmtRate(p.terms.annualRate) : '—', cap: fmtRate(p.terms.capitalisationCap) })
                                    : t('interestCapitalised', { rate: p.terms.annualRate ? fmtRate(p.terms.annualRate) : '—' }))
                                : t('interestSubsidised', { rate: p.terms.annualRate ? fmtRate(p.terms.annualRate) : '—' })],
                            [t('kv.nextReview'), p.nextReviewDate ?? '—'],
                            [t('kv.interestCapitalised'), <MoneyCell key="k" value={p.capitalisedToDate} currency={cur} />],
                            [t('kv.termEnds'), p.termEnd ?? '—'],
                            [t('kv.forgivenAtTermEnd'), <MoneyCell key="f" value={p.projectedForgiveness} currency={cur} />],
                        ]}
                    />
                    {p.pending.map((a) => <PendingAssessment key={a.id} loanId={loanId} currency={cur} a={a} onDone={done} />)}
                    {p.status === 'ACTIVE' && p.pending.length === 0 && (
                        proposing
                            ? <ProposePanel loanId={loanId} currency={cur} evidenceRequired={p.terms.evidenceRequired} onDone={done} onClose={() => setProposing(false)} />
                            : <Btn variant="primary" onClick={() => setProposing(true)}>{t('recordAssessment')}</Btn>
                    )}
                    <Disclosure summary={t('history', { count: p.assessments.length })}>
                        {p.assessments.length === 0 ? <Empty>{t('noAssessments')}</Empty> : (
                            <Table>
                                <thead>
                                    <tr className="border-b border-[#E3E8EE] bg-[#F7FAFC]">
                                        <th className={th}>#</th><th className={th}>{t('columns.reason')}</th><th className={thR}>{t('columns.income')}</th><th className={thR}>{t('columns.instalment')}</th>
                                        <th className={th}>{t('columns.evidence')}</th><th className={th}>{t('columns.from')}</th><th className={th}>{t('columns.status')}</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-[#F0F2F5]">
                                    {p.assessments.map((a) => (
                                        <tr key={a.id}>
                                            <td className={td}>{a.sequence}</td>
                                            <td className={td}>{a.reason.replace(/_/g, ' ').toLowerCase()}{a.incomePeriod ? ` · ${a.incomePeriod}` : ''}</td>
                                            <td className={tdR}><MoneyCell value={a.declaredAnnualIncome} /></td>
                                            <td className={tdR}><MoneyCell value={a.periodicPayment} strong /></td>
                                            <td className={td}>{evidenceLabel(t, a.evidenceType)}<div className="text-[11px] text-[#697386]">{a.evidenceReference}</div></td>
                                            <td className={td}>{a.effectiveDate ?? '—'}</td>
                                            <td className={td}><StatusBadge status={a.status} />{a.decidedAt && <div className="text-[11px] text-[#697386]">{fmtDateTime(a.decidedAt)}</div>}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </Table>
                        )}
                    </Disclosure>
                </div>
            )}
        </Card>
    );
}

/** Live preview of the instalment an income would set, from the pure engine on the server. */
function usePreview(loanId: string, income: string) {
    const [state, setState] = useState<{ income: string; data?: Preview; error?: ApiErrorInfo }>({ income: '' });
    useEffect(() => {
        if (!MONEY_RE.test(income.trim())) return;
        let cancelled = false;
        const t = setTimeout(() => {
            api.get<Preview>(`/lending/loans/${loanId}/income-contingent/preview?income=${encodeURIComponent(income.trim())}`).then(
                (r) => { if (!cancelled) setState({ income, data: r.data }); },
                (e) => { if (!cancelled) setState({ income, error: toApiError(e) }); },
            );
        }, 300);
        return () => { cancelled = true; clearTimeout(t); };
    }, [loanId, income]);
    return state.income === income ? state : { income };
}

function ProposePanel({ loanId, currency, evidenceRequired, onDone, onClose }: { loanId: string; currency: string; evidenceRequired: boolean; onDone: (m: string) => void; onClose: () => void }) {
    const t = useTranslations('LendingServicing.incomeContingent');
    const [income, setIncome] = useState('');
    const [reason, setReason] = useState<'ANNUAL' | 'CHANGE_OF_CIRCUMSTANCES'>('ANNUAL');
    const [incomePeriod, setIncomePeriod] = useState('');
    const [evidenceType, setEvidenceType] = useState('PAYSLIP');
    const [evidenceReference, setEvidenceReference] = useState('');
    const { busy, error, run, clearError } = useAction();
    const preview = usePreview(loanId, income);
    const valid = MONEY_RE.test(income.trim()) && evidenceReference.trim().length >= 2;
    const submit = async () => {
        const body = clean({ declaredAnnualIncome: income.trim(), reason, incomePeriod: incomePeriod.trim(), evidenceType, evidenceReference: evidenceReference.trim() });
        const r = await run('propose', () => api.post(`/lending/loans/${loanId}/income-assessments`, body));
        if (r) onDone(t('propose.recorded'));
    };
    return (
        <ActionPanel title={t('propose.title')} onClose={onClose}>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                <Field label={t('propose.income', { currency })}><TextInput value={income} onChange={setIncome} inputMode="decimal" placeholder="0.00" /></Field>
                <Field label={t('propose.reason')}>
                    <SelectInput value={reason} onChange={(v) => setReason(v as typeof reason)} options={[{ value: 'ANNUAL', label: t('propose.reasons.ANNUAL') }, { value: 'CHANGE_OF_CIRCUMSTANCES', label: t('propose.reasons.CHANGE_OF_CIRCUMSTANCES') }]} />
                </Field>
                <Field label={t('propose.incomePeriod')} hint={t('propose.incomePeriodHint')}><TextInput value={incomePeriod} onChange={setIncomePeriod} maxLength={40} /></Field>
                <Field label={t('propose.evidence')} hint={evidenceRequired ? t('propose.evidenceRequired') : undefined}>
                    <SelectInput value={evidenceType} onChange={setEvidenceType} options={EVIDENCE.map((v) => ({ value: v, label: evidenceLabel(t, v) }))} />
                </Field>
                <Field label={t('propose.evidenceReference')} hint={t('propose.evidenceReferenceHint')}><TextInput value={evidenceReference} onChange={setEvidenceReference} maxLength={200} /></Field>
            </div>
            {preview.data && (
                <div className="rounded-md border border-[#E3E8EE] bg-white p-3 space-y-1">
                    <p className="text-[13px] text-[#1A1F36]">
                        {preview.data.effectiveDate
                            ? t.rich('propose.resultingFrom', { b: (c) => <b>{c}</b>, currency, amount: preview.data.payment.periodicPayment, date: preview.data.effectiveDate })
                            : t.rich('propose.resulting', { b: (c) => <b>{c}</b>, currency, amount: preview.data.payment.periodicPayment })}
                    </p>
                    <p className="text-[12px] text-[#697386]">{preview.data.payment.explanation}</p>
                    {preview.data.schedule && (
                        <p className="text-[12px] text-[#697386]">
                            {Number(preview.data.schedule.forgivenAtTermEnd) > 0
                                ? t('propose.forgivenAtEnd', { currency, amount: preview.data.schedule.forgivenAtTermEnd })
                                : t('propose.repaidBy', { date: preview.data.schedule.maturityDate })}
                        </p>
                    )}
                </div>
            )}
            {preview.error && <ErrorBox error={preview.error} />}
            <ErrorBox error={error} onDismiss={clearError} />
            <Btn variant="primary" onClick={submit} busy={busy === 'propose'} disabled={!valid}>{t('propose.submit')}</Btn>
        </ActionPanel>
    );
}

function PendingAssessment({ loanId, currency, a, onDone }: { loanId: string; currency: string; a: IncomeAssessment; onDone: (m: string) => void }) {
    const t = useTranslations('LendingServicing.incomeContingent');
    const [comment, setComment] = useState('');
    const { busy, error, run, clearError } = useAction();
    const decide = async (approve: boolean) => {
        const r = await run(approve ? 'approve' : 'reject', () =>
            api.post(`/lending/loans/${loanId}/income-assessments/${a.id}/decision`, clean({ approve, comment: comment.trim() })),
        );
        if (r) onDone(approve ? t('pending.approved') : t('pending.rejected'));
    };
    return (
        <Notice tone="warn" title={t('pending.title', { currency, payment: a.periodicPayment, income: a.declaredAnnualIncome })}>
            <p className="text-[12px]">{t('pending.body', { reason: a.reason.replace(/_/g, ' ').toLowerCase(), evidence: evidenceLabel(t, a.evidenceType), reference: a.evidenceReference })}</p>
            <div className="mt-2 flex flex-wrap items-end gap-2">
                <Field label={t('pending.comment')} className="min-w-[220px]"><TextInput value={comment} onChange={setComment} maxLength={500} /></Field>
                <Btn variant="primary" onClick={() => decide(true)} busy={busy === 'approve'}>{t('pending.approve')}</Btn>
                <Btn variant="danger" onClick={() => decide(false)} busy={busy === 'reject'}>{t('pending.reject')}</Btn>
            </div>
            <ErrorBox error={error} onDismiss={clearError} />
        </Notice>
    );
}
