import { AlertOctagon, CheckCircle2, XCircle } from 'lucide-react';
import type { AffordabilityResultView } from '../types';
import { MoneyCell } from '../MoneyCell';
import { StatusBadge } from '../StatusBadge';
import { Table, KV, td, tdR, th, thR } from '../ui';

export interface AssessmentRow {
    id: string; template: string; result: AffordabilityResultView; evidenceQuality: string; assumptions: string;
    verificationDate: string; comments?: string | null; createdAt?: string; assessorId?: string; policyVersion?: string;
}

/** Specialist-review banner: deliberately loud. */
export function SpecialistBanner() {
    return (
        <div className="flex items-start gap-3 rounded-lg border-2 border-red-400 bg-gradient-to-r from-red-50 to-amber-50 px-5 py-4 text-red-900" role="alert">
            <AlertOctagon size={28} className="shrink-0 text-red-600" />
            <div>
                <p className="text-[16px] font-extrabold uppercase tracking-wide">Specialist review required</p>
                <p className="text-[13px] mt-0.5">
                    The affordability result is outside what front-line staff may decide. A specialist must review this case before any
                    option is proposed or approved.
                </p>
            </div>
        </div>
    );
}

/** Result of one affordability assessment. */
export function AffordabilityResult({ assessment }: { assessment: AssessmentRow }) {
    const r = assessment.result ?? ({} as AffordabilityResultView);
    return (
        <div className="space-y-3">
            {r.specialistReview && <SpecialistBanner />}
            {r.sustainable ? (
                <div className="flex items-center gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-[13px] font-semibold text-emerald-800">
                    <CheckCircle2 size={16} /> Sustainable — the customer can afford a revised schedule within the amount available.
                </div>
            ) : (
                <div className="flex items-center gap-2 rounded-md border-2 border-red-300 bg-red-50 px-4 py-3 text-[14px] font-bold text-red-800">
                    <XCircle size={18} /> Not sustainable — the customer cannot afford a repayment on this loan on these figures.
                </div>
            )}
            <KV cols={4} items={[
                ['Template', assessment.template],
                ['Available for this loan / month', r.availableForThisLoanMonthly === null || r.availableForThisLoanMonthly === undefined ? '—' : <MoneyCell value={r.availableForThisLoanMonthly} strong />],
                ['DSCR', r.dscr ?? '—'],
                ['Evidence quality', <StatusBadge key="q" status={assessment.evidenceQuality} />],
                ['Verification date', String(assessment.verificationDate ?? '').slice(0, 10)],
                ['Assessor', assessment.assessorId ? <span className="font-mono text-[11px]">{assessment.assessorId}</span> : '—'],
                ['Policy version', assessment.policyVersion ?? '—'],
                ['Recorded', assessment.createdAt ? new Date(assessment.createdAt).toLocaleString() : '—'],
            ]} />
            {(r.lines?.length ?? 0) > 0 && (
                <Table>
                    <thead><tr className="border-b border-[#E3E8EE] bg-[#F7FAFC]"><th className={th}>Line</th><th className={thR}>Amount</th></tr></thead>
                    <tbody className="divide-y divide-[#F0F2F5]">
                        {r.lines.map((l, i) => (
                            <tr key={i}><td className={td}>{l.label}</td><td className={tdR}><MoneyCell value={l.amount} /></td></tr>
                        ))}
                    </tbody>
                </Table>
            )}
            {r.excludedDebts && r.excludedDebts.length > 0 && (
                <p className="text-[12px] text-[#697386]">Excluded as “this loan” (not double counted): {r.excludedDebts.join(', ')}</p>
            )}
            {r.seasonalCapacity && r.seasonalCapacity.length > 0 && (
                <div>
                    <p className="text-[11px] font-bold uppercase tracking-wide text-[#8792A2] mb-1">Seasonal capacity</p>
                    <Table>
                        <thead><tr className="border-b border-[#E3E8EE] bg-[#F7FAFC]"><th className={th}>Month</th><th className={thR}>Surplus</th><th className={thR}>Available for this loan</th></tr></thead>
                        <tbody className="divide-y divide-[#F0F2F5]">
                            {r.seasonalCapacity.map((s) => (
                                <tr key={s.month}><td className={td}>{String(s.month).slice(0, 7)}</td><td className={tdR}><MoneyCell value={s.surplus} /></td><td className={tdR}><MoneyCell value={s.available} strong /></td></tr>
                            ))}
                        </tbody>
                    </Table>
                </div>
            )}
            {(r.explanation?.length ?? 0) > 0 && (
                <ul className="list-disc pl-5 text-[12px] text-[#3C4257] space-y-0.5">{r.explanation.map((e, i) => <li key={i}>{e}</li>)}</ul>
            )}
            <div className="text-[12px] text-[#3C4257]">
                <span className="font-semibold">Assumptions:</span> {assessment.assumptions}
                {assessment.comments ? <><br /><span className="font-semibold">Comments:</span> {assessment.comments}</> : null}
            </div>
        </div>
    );
}
