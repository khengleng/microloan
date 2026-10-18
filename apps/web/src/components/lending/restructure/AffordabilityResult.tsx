import { AlertOctagon, CheckCircle2, XCircle } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { AffordabilityResultView } from '../types';
import { MoneyCell } from '../MoneyCell';
import { StatusBadge } from '../StatusBadge';
import { Table, KV, td, tdR, th, thR } from '../ui';
import { Person } from '../People';
import { useRestructureLabels } from './labels';

export interface AssessmentRow {
    id: string; template: string; result: AffordabilityResultView; evidenceQuality: string; assumptions: string;
    verificationDate: string; comments?: string | null; createdAt?: string; assessorId?: string; policyVersion?: string;
}

/** Specialist-review banner: deliberately loud. */
export function SpecialistBanner() {
    const t = useTranslations('LendingRestructure');
    return (
        <div className="flex items-start gap-3 rounded-lg border-2 border-red-400 bg-gradient-to-r from-red-50 to-amber-50 px-5 py-4 text-red-900" role="alert">
            <AlertOctagon size={28} className="shrink-0 text-red-600" />
            <div>
                <p className="text-[16px] font-extrabold uppercase tracking-wide">{t('specialist.title')}</p>
                <p className="text-[13px] mt-0.5">{t('specialist.body')}</p>
            </div>
        </div>
    );
}

/** Result of one affordability assessment. */
export function AffordabilityResult({ assessment }: { assessment: AssessmentRow }) {
    const t = useTranslations('LendingRestructure');
    const L = useRestructureLabels();
    const r = assessment.result ?? ({} as AffordabilityResultView);
    return (
        <div className="space-y-3">
            {r.specialistReview && <SpecialistBanner />}
            {r.sustainable ? (
                <div className="flex items-center gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-[13px] font-semibold text-emerald-800">
                    <CheckCircle2 size={16} /> {t('result.sustainable')}
                </div>
            ) : (
                <div className="flex items-center gap-2 rounded-md border-2 border-red-300 bg-red-50 px-4 py-3 text-[14px] font-bold text-red-800">
                    <XCircle size={18} /> {t('result.notSustainable')}
                </div>
            )}
            <KV cols={4} items={[
                [t('result.template'), L.label('template', assessment.template)],
                [t('result.available'), r.availableForThisLoanMonthly === null || r.availableForThisLoanMonthly === undefined ? '—' : <MoneyCell value={r.availableForThisLoanMonthly} strong />],
                [t('result.dscr'), r.dscr ?? '—'],
                [t('common.evidenceQuality'), <StatusBadge key="q" status={assessment.evidenceQuality} />],
                [t('common.verificationDate'), String(assessment.verificationDate ?? '').slice(0, 10)],
                [t('result.assessor'), assessment.assessorId ? <Person key="as" id={assessment.assessorId} /> : '—'],
                [t('result.policyVersion'), assessment.policyVersion ?? '—'],
                [t('common.recorded'), assessment.createdAt ? new Date(assessment.createdAt).toLocaleString() : '—'],
            ]} />
            {(r.lines?.length ?? 0) > 0 && (
                <Table>
                    <thead><tr className="border-b border-[#E3E8EE] bg-[#F7FAFC]"><th className={th}>{t('result.line')}</th><th className={thR}>{t('result.amount')}</th></tr></thead>
                    <tbody className="divide-y divide-[#F0F2F5]">
                        {r.lines.map((l, i) => (
                            <tr key={i}><td className={td}>{l.label}</td><td className={tdR}><MoneyCell value={l.amount} /></td></tr>
                        ))}
                    </tbody>
                </Table>
            )}
            {r.excludedDebts && r.excludedDebts.length > 0 && (
                <p className="text-[12px] text-[#697386]">{t('result.excluded', { list: r.excludedDebts.join(', ') })}</p>
            )}
            {r.seasonalCapacity && r.seasonalCapacity.length > 0 && (
                <div>
                    <p className="text-[11px] font-bold uppercase tracking-wide text-[#8792A2] mb-1">{t('result.seasonalCapacity')}</p>
                    <Table>
                        <thead><tr className="border-b border-[#E3E8EE] bg-[#F7FAFC]"><th className={th}>{t('common.month')}</th><th className={thR}>{t('result.surplus')}</th><th className={thR}>{t('result.availableForLoan')}</th></tr></thead>
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
                <span className="font-semibold">{t('result.assumptions')}</span> {assessment.assumptions}
                {assessment.comments ? <><br /><span className="font-semibold">{t('result.comments')}</span> {assessment.comments}</> : null}
            </div>
        </div>
    );
}
