"use client";

import { RefreshCw } from 'lucide-react';
import api from '@/lib/api';
import { useToast } from '@/components/ui/toast';
import { useWorkspace } from '@/lib/workspace';
import { Btn, Card, Disclosure, Empty, ErrorBox, Notice, Spinner, Table, td, th } from '../ui';
import { useAction, useApi } from '../useAsync';
import { fmtDateTime } from '../format';
import { Money } from '../MoneyCell';
import { AdverseReasons, FactorBars, GradePill, OutcomeBadge } from './ScoreResultView';
import { usePeople, useScoringText } from './i18n';
import { displayValue, shortId } from './types';
import type { ApplicationScores, ScoreEvaluation } from './types';

const RESCORABLE = ['DRAFT', 'SUBMITTED', 'RECOMMENDED'];

function Header({ e }: { e: ScoreEvaluation }) {
    const { t, version: versionLabel } = useScoringText();
    return (
        <div className="flex flex-wrap items-end gap-6">
            <div>
                <p className="text-[11px] font-bold uppercase tracking-wide text-[#8792A2]">{t('result.score')}</p>
                <p className="text-[28px] font-bold text-[#1A1F36] tabular-nums leading-tight">{e.score}</p>
            </div>
            <div>
                <p className="text-[11px] font-bold uppercase tracking-wide text-[#8792A2]">{t('result.grade')}</p>
                <div className="mt-1"><GradePill grade={e.grade} label={e.result.gradeLabel} /></div>
            </div>
            <div>
                <p className="text-[11px] font-bold uppercase tracking-wide text-[#8792A2]">{t('appScore.outcome')}</p>
                <div className="mt-1"><OutcomeBadge outcome={e.outcome} /></div>
            </div>
            <div>
                <p className="text-[11px] font-bold uppercase tracking-wide text-[#8792A2]">{t('appScore.scorecard')}</p>
                <p className="text-[13px] mt-1"><span className="font-mono font-semibold">{e.scorecardCode}</span> {versionLabel(e.version)}</p>
            </div>
            <div>
                <p className="text-[11px] font-bold uppercase tracking-wide text-[#8792A2]">{t('appScore.stage')}</p>
                <p className="text-[13px] mt-1">{e.stage.toLowerCase()} · {fmtDateTime(e.createdAt)}</p>
            </div>
            {e.thinFile && (
                <span className="inline-flex px-1.5 py-0.5 rounded border text-[11px] font-bold bg-amber-50 text-amber-800 border-amber-200">{t('appScore.thinFileBadge')}</span>
            )}
        </div>
    );
}

/**
 * The application's credit score (champion), the shadow challenger, the
 * strategy outcome and the evidence the score used.
 */
export function ApplicationScoreCard({ applicationId, status, currency }: { applicationId: string; status: string; currency: string }) {
    const ws = useWorkspace();
    const { t, version: versionLabel, outcome: outcomeLabel } = useScoringText();
    const { showToast } = useToast();
    const scores = useApi<ApplicationScores>(`/lending/applications/${applicationId}/scores`);
    const person = usePeople((scores.data?.evaluations ?? []).map((h) => h.evaluatedBy));
    const { busy, error, run, clearError } = useAction();
    const canRun = !ws.access || ws.can('credit_score.run');

    const rerun = async () => {
        const res = await run('rerun', () => api.post(`/lending/applications/${applicationId}/scores`, {}));
        if (res) { showToast(t('appScore.rerunDone'), 'success'); scores.reload(); }
    };

    const actions = canRun && RESCORABLE.includes(status)
        ? <Btn size="sm" busy={busy === 'rerun'} onClick={rerun}><RefreshCw size={13} /> {t('appScore.rerun')}</Btn>
        : undefined;

    if (scores.loading && !scores.data) return <Card title={t('appScore.title')}><Spinner /></Card>;
    if (scores.error && !scores.data) return <Card title={t('appScore.title')} actions={actions}><ErrorBox error={scores.error} /></Card>;
    const d = scores.data;
    if (!d) return null;
    const e = d.latest;
    const st = e?.strategy ?? null;

    return (
        <Card title={t('appScore.title')} subtitle={t('appScore.subtitle')} actions={actions}>
            <div className="space-y-5">
                <ErrorBox error={error} onDismiss={clearError} />
                {!e ? <Empty>{t('appScore.notScored')}</Empty> : (
                    <>
                        <Header e={e} />
                        {e.outcome === 'AUTO_APPROVE' && (
                            <Notice tone="success">{t('appScore.autoApproveNotice')}</Notice>
                        )}

                        {st && (st.knockouts.length > 0 || st.reasons.length > 0 || st.maxAmount || st.rateAddOnBps) && (
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                {st.knockouts.length > 0 && (
                                    <div>
                                        <p className="text-[11px] font-bold uppercase tracking-wide text-red-700 mb-1">Knock-outs</p>
                                        <ul className="space-y-0.5">{st.knockouts.map((k) => <li key={k.code} className="text-[13px] text-red-900">{k.message} <span className="font-mono text-[10px] text-[#8792A2]">{k.code}</span></li>)}</ul>
                                    </div>
                                )}
                                {st.reasons.length > 0 && (
                                    <div>
                                        <p className="text-[11px] font-bold uppercase tracking-wide text-[#8792A2] mb-1">Strategy reasons</p>
                                        <ul className="space-y-0.5">{st.reasons.map((k) => <li key={k.code} className="text-[13px] text-[#3C4257]">{k.message} <span className="font-mono text-[10px] text-[#8792A2]">{k.code}</span></li>)}</ul>
                                    </div>
                                )}
                                <div className="text-[13px] text-[#3C4257] space-y-0.5 md:col-span-2">
                                    {st.declineBelowScore !== null && <p>Declines below score {st.declineBelowScore}.</p>}
                                    {st.maxAmount && <p>Grade limit <Money value={st.maxAmount} currency={e.inputs.currency || currency} />{st.amountAboveGradeLimit && <span className="ml-1 font-semibold text-amber-700">— requested amount is above it</span>}</p>}
                                    {!!st.rateAddOnBps && <p>Rate add-on {st.rateAddOnBps} bps for this grade.</p>}
                                </div>
                            </div>
                        )}

                        <div className="grid grid-cols-1 lg:grid-cols-5 gap-5">
                            <div className="lg:col-span-3">
                                <p className="text-[11px] font-bold uppercase tracking-wide text-[#8792A2] mb-2">{t('result.factors')}</p>
                                <FactorBars items={e.result.characteristics} />
                            </div>
                            <div className="lg:col-span-2 space-y-4">
                                <div>
                                    <p className="text-[11px] font-bold uppercase tracking-wide text-[#8792A2] mb-1">{t('result.adverseReasons')}</p>
                                    <AdverseReasons items={e.result.adverseReasons} />
                                </div>
                                {d.customerExplanation && (
                                    <div className="border border-[#E3E8EE] rounded-md p-3 bg-[#F7FAFC]">
                                        <p className="text-[11px] font-bold uppercase tracking-wide text-[#8792A2] mb-1">What the customer is told</p>
                                        <p className="text-[13px] font-semibold text-[#1A1F36]">{outcomeLabel(d.customerExplanation.outcome)}</p>
                                        {d.customerExplanation.reasons.length > 0 && (
                                            <ul className="mt-1 space-y-0.5 list-disc list-inside">{d.customerExplanation.reasons.map((r) => <li key={r.code} className="text-[13px] text-[#3C4257]">{r.message}</li>)}</ul>
                                        )}
                                    </div>
                                )}
                            </div>
                        </div>

                        <Disclosure summary={t('appScore.inputSnapshot', { count: Object.keys(e.inputs.features).length, asOf: e.inputs.asOf })}>
                            <Table className="border border-[#E3E8EE] rounded">
                                <thead><tr className="border-b border-[#E3E8EE] bg-[#F7FAFC]"><th className={th}>{t('appScore.colVariable')}</th><th className={th}>{t('appScore.colValue')}</th><th className={th}>{t('appScore.colSource')}</th><th className={th}>{t('appScore.colConsent')}</th><th className={th}>{t('appScore.colNote')}</th></tr></thead>
                                <tbody className="divide-y divide-[#F0F2F5]">
                                    {Object.entries(e.inputs.features).map(([k, f]) => (
                                        <tr key={k}>
                                            <td className={td}><span className="font-mono text-[12px]">{k}</span></td>
                                            <td className={td}>{displayValue(f.value)}</td>
                                            <td className={td}>{f.source.toLowerCase().replace(/_/g, ' ')}{f.evidence && <div className="text-[11px] text-[#697386]">{f.evidence}</div>}</td>
                                            <td className={td}><span className="font-mono text-[11px]">{f.consentId ? shortId(f.consentId) : '—'}</span></td>
                                            <td className={td}>{f.note || '—'}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </Table>
                        </Disclosure>
                    </>
                )}

                {d.challenger && (
                    <div className="border border-dashed border-[#C9D7FF] rounded-md p-4 bg-[#FBFCFE] space-y-3">
                        <p className="text-[12px] font-bold text-[#4B45C6]">{t('appScore.challengerTitle')}</p>
                        <Header e={d.challenger} />
                        <Disclosure summary={t('appScore.challengerFactors')}><FactorBars items={d.challenger.result.characteristics} /></Disclosure>
                    </div>
                )}

                {d.evaluations.length > 0 && (
                    <Disclosure summary={t('appScore.history', { count: d.evaluations.length })}>
                        <Table className="border border-[#E3E8EE] rounded">
                            <thead><tr className="border-b border-[#E3E8EE] bg-[#F7FAFC]"><th className={th}>{t('appScore.colWhen')}</th><th className={th}>{t('appScore.colRole')}</th><th className={th}>{t('appScore.stage')}</th><th className={th}>{t('appScore.scorecard')}</th><th className={th}>{t('result.score')}</th><th className={th}>{t('result.grade')}</th><th className={th}>{t('appScore.outcome')}</th><th className={th}>{t('appScore.colBy')}</th></tr></thead>
                            <tbody className="divide-y divide-[#F0F2F5]">
                                {d.evaluations.map((h) => (
                                    <tr key={h.id} className={h.drivesDecision ? '' : 'text-[#697386]'}>
                                        <td className={`${td} whitespace-nowrap`}>{fmtDateTime(h.createdAt)}</td>
                                        <td className={td}>{h.role === 'CHALLENGER' ? t('appScore.roleChallenger') : t('appScore.roleChampion')}</td>
                                        <td className={td}>{h.stage.toLowerCase()}</td>
                                        <td className={td}><span className="font-mono text-[12px]">{h.scorecardCode}</span> {versionLabel(h.version)}{h.thinFile ? ` · ${t('appScore.thinFile')}` : ''}</td>
                                        <td className={`${td} tabular-nums`}>{h.score}</td>
                                        <td className={td}>{h.grade}</td>
                                        <td className={td}><OutcomeBadge outcome={h.outcome} /></td>
                                        <td className={td}><span className="text-[12px]" title={h.evaluatedBy ?? undefined}>{h.evaluatedBy ? person(h.evaluatedBy) : t('common.system')}</span></td>
                                    </tr>
                                ))}
                            </tbody>
                        </Table>
                    </Disclosure>
                )}
            </div>
        </Card>
    );
}
