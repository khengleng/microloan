"use client";

import { useEffect, useState } from 'react';
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

const EVIDENCE = [
    { value: 'PAYSLIP', label: 'Payslip' },
    { value: 'TAX_RETURN', label: 'Tax return' },
    { value: 'EMPLOYER_LETTER', label: 'Employer letter' },
    { value: 'BENEFITS_STATEMENT', label: 'Benefits statement' },
    { value: 'NO_INCOME_DECLARATION', label: 'Signed no-income declaration' },
    { value: 'OTHER', label: 'Other (attach the document)' },
];
const evidenceLabel = (v: string) => EVIDENCE.find((e) => e.value === v)?.label ?? (v === 'APPLICATION' ? 'Declared on the application' : v);

type Props = { loanId: string; detail: LoanDetail; onDone: (msg: string) => void };

/** Income-contingent repayment: the instalment set by assessed income, reassessments under maker-checker, forgiveness at term end (D-066). */
export function IncomeContingentCard({ loanId, detail, onDone }: Props) {
    const cur = detail.account.currency;
    const res = useApi<Plan>(`/lending/loans/${loanId}/income-contingent`);
    const [proposing, setProposing] = useState(false);
    const p = res.data;
    const done = (msg: string) => { setProposing(false); res.reload(); onDone(msg); };
    return (
        <Card title="Income-contingent repayment" subtitle="The instalment is a share of the borrower's income above a threshold. Below it nothing is due and nothing falls into arrears; what is left at the end of the term is forgiven.">
            {res.error && <ErrorBox error={res.error} />}
            {!p ? <Spinner /> : (
                <div className="space-y-4">
                    {p.reviewDue && (
                        <Notice tone="warn" title="Annual reassessment due">
                            The income was last assessed for a review on {p.nextReviewDate}. Until a new assessment is approved, the last assessed instalment continues.
                        </Notice>
                    )}
                    {p.forgiven && <Notice tone="success" title="Forgiven at the end of the term">{cur} {p.forgiven.amount} was forgiven on {p.forgiven.on}.</Notice>}
                    <KV
                        cols={4}
                        items={[
                            ['Current instalment', <span key="c" className="font-bold"><MoneyCell value={p.currentPayment} currency={cur} /> a month</span>],
                            ['Assessed income', p.current ? <MoneyCell key="i" value={p.current.declaredAnnualIncome} currency={cur} /> : '—'],
                            ['Repayment rule', `${fmtRate(p.terms.repaymentRate)} of income above ${cur} ${p.terms.incomeThreshold} a year`],
                            ['Interest', `${p.terms.annualRate ? fmtRate(p.terms.annualRate) : '—'} a year; uncovered interest ${p.terms.unpaidInterest === 'CAPITALISE' ? `capitalised${p.terms.capitalisationCap ? ` (cap ${fmtRate(p.terms.capitalisationCap)} of amount financed)` : ''}` : 'not charged (subsidised)'}`],
                            ['Next review', p.nextReviewDate ?? '—'],
                            ['Interest capitalised', <MoneyCell key="k" value={p.capitalisedToDate} currency={cur} />],
                            ['Term ends', p.termEnd ?? '—'],
                            ['Forgiven at term end (at this income)', <MoneyCell key="f" value={p.projectedForgiveness} currency={cur} />],
                        ]}
                    />
                    {p.pending.map((a) => <PendingAssessment key={a.id} loanId={loanId} currency={cur} a={a} onDone={done} />)}
                    {p.status === 'ACTIVE' && p.pending.length === 0 && (
                        proposing
                            ? <ProposePanel loanId={loanId} currency={cur} evidenceRequired={p.terms.evidenceRequired} onDone={done} onClose={() => setProposing(false)} />
                            : <Btn variant="primary" onClick={() => setProposing(true)}>Record a new income assessment</Btn>
                    )}
                    <Disclosure summary={`Assessment history (${p.assessments.length})`}>
                        {p.assessments.length === 0 ? <Empty>No assessments.</Empty> : (
                            <Table>
                                <thead>
                                    <tr className="border-b border-[#E3E8EE] bg-[#F7FAFC]">
                                        <th className={th}>#</th><th className={th}>Reason</th><th className={thR}>Income</th><th className={thR}>Instalment</th>
                                        <th className={th}>Evidence</th><th className={th}>From</th><th className={th}>Status</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-[#F0F2F5]">
                                    {p.assessments.map((a) => (
                                        <tr key={a.id}>
                                            <td className={td}>{a.sequence}</td>
                                            <td className={td}>{a.reason.replace(/_/g, ' ').toLowerCase()}{a.incomePeriod ? ` · ${a.incomePeriod}` : ''}</td>
                                            <td className={tdR}><MoneyCell value={a.declaredAnnualIncome} /></td>
                                            <td className={tdR}><MoneyCell value={a.periodicPayment} strong /></td>
                                            <td className={td}>{evidenceLabel(a.evidenceType)}<div className="text-[11px] text-[#697386]">{a.evidenceReference}</div></td>
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
        if (r) onDone('Income assessment recorded — a second person must approve it');
    };
    return (
        <ActionPanel title="New income assessment" onClose={onClose}>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                <Field label={`Declared annual income (${currency})`}><TextInput value={income} onChange={setIncome} inputMode="decimal" placeholder="0.00" /></Field>
                <Field label="Reason">
                    <SelectInput value={reason} onChange={(v) => setReason(v as typeof reason)} options={[{ value: 'ANNUAL', label: 'Annual reassessment' }, { value: 'CHANGE_OF_CIRCUMSTANCES', label: 'Change of circumstances' }]} />
                </Field>
                <Field label="Income period" hint="Optional — e.g. 2026"><TextInput value={incomePeriod} onChange={setIncomePeriod} maxLength={40} /></Field>
                <Field label="Evidence" hint={evidenceRequired ? 'This product requires documentary evidence' : undefined}>
                    <SelectInput value={evidenceType} onChange={setEvidenceType} options={EVIDENCE} />
                </Field>
                <Field label="Evidence reference" hint="Document number, employer, period covered"><TextInput value={evidenceReference} onChange={setEvidenceReference} maxLength={200} /></Field>
            </div>
            {preview.data && (
                <div className="rounded-md border border-[#E3E8EE] bg-white p-3 space-y-1">
                    <p className="text-[13px] text-[#1A1F36]">
                        Resulting instalment: <b>{currency} {preview.data.payment.periodicPayment}</b> a month
                        {preview.data.effectiveDate && <> from the period starting <b>{preview.data.effectiveDate}</b></>}.
                    </p>
                    <p className="text-[12px] text-[#697386]">{preview.data.payment.explanation}</p>
                    {preview.data.schedule && (
                        <p className="text-[12px] text-[#697386]">
                            {Number(preview.data.schedule.forgivenAtTermEnd) > 0
                                ? `At this income ${currency} ${preview.data.schedule.forgivenAtTermEnd} would be forgiven at the end of the term.`
                                : `At this income the loan is repaid by ${preview.data.schedule.maturityDate}.`}
                        </p>
                    )}
                </div>
            )}
            {preview.error && <ErrorBox error={preview.error} />}
            <ErrorBox error={error} onDismiss={clearError} />
            <Btn variant="primary" onClick={submit} busy={busy === 'propose'} disabled={!valid}>Submit for approval</Btn>
        </ActionPanel>
    );
}

function PendingAssessment({ loanId, currency, a, onDone }: { loanId: string; currency: string; a: IncomeAssessment; onDone: (m: string) => void }) {
    const [comment, setComment] = useState('');
    const { busy, error, run, clearError } = useAction();
    const decide = async (approve: boolean) => {
        const r = await run(approve ? 'approve' : 'reject', () =>
            api.post(`/lending/loans/${loanId}/income-assessments/${a.id}/decision`, clean({ approve, comment: comment.trim() })),
        );
        if (r) onDone(approve ? 'Assessment approved — the schedule is rebuilt from the next period' : 'Assessment rejected');
    };
    return (
        <Notice tone="warn" title={`Awaiting approval: ${currency} ${a.periodicPayment} a month on an income of ${currency} ${a.declaredAnnualIncome}`}>
            <p className="text-[12px]">{a.reason.replace(/_/g, ' ').toLowerCase()} · {evidenceLabel(a.evidenceType)}: {a.evidenceReference}. Check the evidence; you cannot approve an assessment you recorded.</p>
            <div className="mt-2 flex flex-wrap items-end gap-2">
                <Field label="Comment" className="min-w-[220px]"><TextInput value={comment} onChange={setComment} maxLength={500} /></Field>
                <Btn variant="primary" onClick={() => decide(true)} busy={busy === 'approve'}>Approve</Btn>
                <Btn variant="danger" onClick={() => decide(false)} busy={busy === 'reject'}>Reject</Btn>
            </div>
            <ErrorBox error={error} onDismiss={clearError} />
        </Notice>
    );
}
