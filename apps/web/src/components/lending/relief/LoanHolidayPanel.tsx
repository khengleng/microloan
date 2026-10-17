"use client";

import { useState } from 'react';
import { CheckCircle2, XCircle } from 'lucide-react';
import api from '@/lib/api';
import { useToast } from '@/components/ui/toast';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { Btn, Card, Empty, ErrorBox, Field, Notice, Spinner, Table, TextInput, td, th, tdR, thR } from '../ui';
import { idem, useAction, useApi, useIdempotencyKey } from '../useAsync';
import { MoneyCell } from '../MoneyCell';
import type { HolidayEligibility, HolidayEnrolment, HolidayEnrolResult, HolidayProgramme } from './types';
import { termOf, treatmentOf } from './treatments';
import { TreatmentBadge } from './HolidayProgrammes';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function EnrolForm({ loanId, programme, eligibility, onEnrolled }: {
    loanId: string; programme: HolidayProgramme; eligibility: HolidayEligibility; onEnrolled: (r: HolidayEnrolResult) => void;
}) {
    const confirm = useConfirm();
    const [instalments, setInstalments] = useState('1');
    const [effectiveDate, setEffectiveDate] = useState('');
    const { busy, error, run, clearError } = useAction();
    const key = useIdempotencyKey();
    const n = /^\d+$/.test(instalments.trim()) ? Number.parseInt(instalments, 10) : NaN;
    const nErr = Number.isNaN(n) || n < 1 || n > eligibility.maxInstalments ? `Whole number 1–${eligibility.maxInstalments}.` : undefined;
    const dateErr = effectiveDate && !DATE_RE.test(effectiveDate) ? 'YYYY-MM-DD' : undefined;
    const t = treatmentOf(programme.interestTreatment);
    const term = termOf(programme.termTreatment);

    const enrol = async () => {
        if (nErr || dateErr) return;
        const ok = await confirm({
            title: `Grant payment holiday (${programme.code})`,
            message: `Defer ${n} instalment(s)? ${t?.summary ?? ''} ${term?.summary ?? ''} The schedule is re-issued as a new agreement version.`,
            confirmLabel: 'Grant holiday',
            variant: t?.costsBorrower ? 'warning' : 'default',
        });
        if (!ok) return;
        const body: { instalments: number; effectiveDate?: string } = { instalments: n };
        if (effectiveDate) body.effectiveDate = effectiveDate;
        const k = key.keyFor({ programmeId: programme.id, ...body });
        const res = await run('enrol', () => api.post<HolidayEnrolResult>(`/lending/loans/${loanId}/payment-holidays/${programme.id}`, body, idem(k)));
        if (res) {
            key.reset();
            onEnrolled(res.data);
        }
    };

    return (
        <div className="space-y-3 border-t border-[#E3E8EE] pt-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Field label={`Instalments to defer (max ${eligibility.maxInstalments})`} error={instalments ? nErr : undefined}>
                    <TextInput value={instalments} onChange={setInstalments} inputMode="numeric" />
                </Field>
                <Field label="Effective date" hint="Optional — defaults to the start of the next unpaid period" error={dateErr}>
                    <TextInput type="date" value={effectiveDate} onChange={setEffectiveDate} />
                </Field>
            </div>
            {t && (
                <Notice tone={t.tone} title={t.costsBorrower ? (t.value === 'CAPITALIZE' ? 'This holiday increases what the borrower owes' : 'This holiday is not free for the borrower') : 'Free to the borrower'}>
                    {t.summary} The exact interest amount is calculated when the holiday is granted.
                </Notice>
            )}
            <p className="text-[11px] text-[#697386]">Eligibility is re-checked when you grant. Retrying the same request reuses its idempotency key.</p>
            <ErrorBox error={error} onDismiss={clearError} />
            <Btn variant="primary" onClick={enrol} busy={busy === 'enrol'} disabled={!!nErr || !!dateErr}>Grant payment holiday</Btn>
        </div>
    );
}

function ProgrammeOffer({ loanId, programme, onEnrolled }: { loanId: string; programme: HolidayProgramme; onEnrolled: (r: HolidayEnrolResult) => void }) {
    const [checking, setChecking] = useState(false);
    const elig = useApi<HolidayEligibility>(checking ? `/lending/loans/${loanId}/payment-holidays/${programme.id}/eligibility` : null);
    const e = elig.data;

    return (
        <div className="px-5 py-3.5 space-y-3">
            <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                    <p className="text-[13px] font-semibold text-[#1A1F36]"><span className="font-mono">{programme.code}</span> — {programme.name}</p>
                    <p className="text-[12px] text-[#697386] mt-0.5">
                        up to {programme.maxInstalments} instalment(s) · {termOf(programme.termTreatment)?.label ?? programme.termTreatment} · enrol {programme.opensOn} → {programme.closesOn}
                    </p>
                    <div className="mt-1"><TreatmentBadge treatment={programme.interestTreatment} /></div>
                </div>
                <Btn size="sm" onClick={() => (checking ? elig.reload() : setChecking(true))} busy={elig.loading}>{checking ? 'Re-check' : 'Check eligibility'}</Btn>
            </div>
            <ErrorBox error={elig.error} />
            {e && (
                e.eligible ? (
                    <>
                        <p className="flex items-center gap-1.5 text-[13px] font-semibold text-emerald-700">
                            <CheckCircle2 size={15} /> Eligible for up to {e.maxInstalments} instalment(s)
                        </p>
                        <EnrolForm loanId={loanId} programme={programme} eligibility={e} onEnrolled={onEnrolled} />
                    </>
                ) : (
                    <div className="border border-red-200 bg-red-50 rounded-md px-4 py-3 text-[13px] text-red-900">
                        <p className="font-semibold flex items-center gap-1.5"><XCircle size={14} /> Not eligible</p>
                        <ul className="mt-1.5 space-y-1">
                            {e.reasons.map((r) => (
                                <li key={r.code} className="flex gap-2">
                                    <span className="font-mono text-[11px] font-bold px-1.5 rounded bg-red-100 h-fit">{r.code}</span>
                                    <span>{r.message}</span>
                                </li>
                            ))}
                        </ul>
                        <p className="mt-2 text-[11px] text-red-800/80">
                            Loan as assessed: {e.candidate.status.toLowerCase()}, {e.candidate.instalmentsPaid} paid, {e.candidate.instalmentsRemaining} remaining,
                            {' '}{e.candidate.daysPastDue} DPD, {e.candidate.priorHolidays} prior holiday(s){e.candidate.isRestructured ? ', restructured' : ''}{e.candidate.holidayInProgress ? ', holiday in progress' : ''}.
                        </p>
                    </div>
                )
            )}
        </div>
    );
}

/** Payment holidays on one loan: holidays granted, open programmes, eligibility and enrolment. */
export function LoanHolidayPanel({ loanId, onDone, onClose }: { loanId: string; onDone?: (msg: string) => void; onClose?: () => void }) {
    const { showToast } = useToast();
    const history = useApi<HolidayEnrolment[]>(`/lending/loans/${loanId}/payment-holidays`);
    const programmes = useApi<HolidayProgramme[]>('/lending/ops/payment-holiday-programmes?status=OPEN');
    const [granted, setGranted] = useState<HolidayEnrolResult | null>(null);
    const codeOf = (id: string) => programmes.data?.find((p) => p.id === id)?.code ?? `${id.slice(0, 8)}…`;

    const onEnrolled = (r: HolidayEnrolResult) => {
        setGranted(r);
        history.reload();
        const msg = `Payment holiday granted: ${r.enrolment.instalments} instalment(s), resumes ${r.enrolment.resumesOn}. ${r.cost.summary}`;
        if (onDone) onDone(msg);
        else showToast(msg, 'success');
    };

    return (
        <Card
            title="Payment holidays"
            subtitle="Relief under a published programme. Eligibility is judged from recorded loan state, and every refusal says why."
            actions={onClose && <Btn size="sm" variant="ghost" onClick={onClose}>Close</Btn>}
            bodyClass="p-0"
        >
            {granted && (
                <div className="p-4 border-b border-[#E3E8EE]">
                    <Notice tone={granted.cost.costsBorrower ? 'warn' : 'success'} title={`Holiday granted — payments resume ${granted.enrolment.resumesOn}`}>
                        {granted.cost.summary}
                    </Notice>
                </div>
            )}

            <div className="px-5 pt-3.5 pb-1">
                <p className="text-[11px] font-bold uppercase tracking-wide text-[#8792A2]">Holidays granted on this loan</p>
            </div>
            {history.loading && !history.data ? <Spinner /> : history.error ? <div className="p-4"><ErrorBox error={history.error} /></div> : !history.data?.length ? <Empty>No payment holidays taken.</Empty> : (
                <Table>
                    <thead>
                        <tr className="border-b border-[#E3E8EE] bg-[#F7FAFC]">
                            <th className={th}>Programme</th><th className={th}>Instalments</th><th className={th}>Effective</th><th className={th}>Resumes</th>
                            <th className={th}>Interest</th><th className={thR}>Deferred interest</th><th className={th}>Agreement</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-[#F0F2F5]">
                        {history.data.map((h) => (
                            <tr key={h.id}>
                                <td className={`${td} font-mono text-[12px]`}>{codeOf(h.programmeId)}</td>
                                <td className={`${td} tabular-nums`}>{h.instalments}</td>
                                <td className={`${td} tabular-nums whitespace-nowrap`}>{h.effectiveDate}</td>
                                <td className={`${td} tabular-nums whitespace-nowrap`}>{h.resumesOn}</td>
                                <td className={td}><TreatmentBadge treatment={h.interestTreatment} /></td>
                                <td className={tdR}><MoneyCell value={h.deferredInterest} /></td>
                                <td className={`${td} tabular-nums`}>v{h.agreementVersion}</td>
                            </tr>
                        ))}
                    </tbody>
                </Table>
            )}

            <div className="px-5 pt-4 pb-1 border-t border-[#E3E8EE] mt-2">
                <p className="text-[11px] font-bold uppercase tracking-wide text-[#8792A2]">Open programmes</p>
            </div>
            {programmes.loading && !programmes.data ? <Spinner /> : programmes.error ? <div className="p-4"><ErrorBox error={programmes.error} /></div> : !programmes.data?.length ? <Empty>No payment-holiday programme is open.</Empty> : (
                <div className="divide-y divide-[#F0F2F5]">
                    {programmes.data.map((p) => <ProgrammeOffer key={p.id} loanId={loanId} programme={p} onEnrolled={onEnrolled} />)}
                </div>
            )}
        </Card>
    );
}
