"use client";

import { useState } from 'react';
import { LendingShell } from '../LendingShell';
import { Btn, Card, Empty, ErrorBox, Field, KV, Notice, SelectInput, Spinner, Table, TextInput, td, tdR, th, thR } from '../ui';
import { qs, useApi } from '../useAsync';
import { fmtRate } from '../format';
import { OutcomeBadge } from './ScoreResultView';
import { useScoringText } from './i18n';
import { psiLabel } from './types';
import type { MonitoredVersion, MonitoringReport, ScorecardList } from './types';

interface Filters {
    scorecardCode: string; badDaysPastDue: string; performanceMonths: string;
    baselineFrom: string; baselineTo: string; recentFrom: string; recentTo: string;
}

const EMPTY: Filters = { scorecardCode: '', badDaysPastDue: '', performanceMonths: '', baselineFrom: '', baselineTo: '', recentFrom: '', recentTo: '' };

function dec(v: string | null | undefined, digits = 3): string {
    if (v === null || v === undefined || v === '') return '—';
    const n = Number(v);
    return Number.isFinite(n) ? n.toFixed(digits) : String(v);
}

/** Champion and challenger performance: distribution, approvals, bad rates, discrimination and stability. */
export function ScoreMonitoringView() {
    const { t } = useScoringText();
    const [form, setForm] = useState<Filters>(EMPTY);
    const [applied, setApplied] = useState<Filters>(EMPTY);
    const list = useApi<ScorecardList>('/lending/scorecards');
    const report = useApi<MonitoringReport>(`/lending/scorecard-monitoring${qs({ ...applied })}`);
    const set = (k: keyof Filters) => (v: string) => setForm((f) => ({ ...f, [k]: v }));

    const codes = Array.from(new Set([...(list.data?.scorecards.map((s) => s.code) ?? []), ...(list.data?.templateInForce ?? [])]));
    const p = report.data?.parameters;

    return (
        <LendingShell
            title={t('monitoring.title')}
            subtitle={t('monitoring.subtitle')}
            actions={<Btn variant="ghost" onClick={report.reload}>{t('common.refresh')}</Btn>}
        >
            <Card title={t('monitoring.filters')}>
                <form className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3 items-end" onSubmit={(e) => { e.preventDefault(); setApplied(form); }}>
                    <Field label={t('monitoring.scorecard')}><SelectInput value={form.scorecardCode} onChange={set('scorecardCode')} options={codes} placeholder={t('monitoring.all')} /></Field>
                    <Field label={t('monitoring.badAtDpd')}><TextInput inputMode="numeric" value={form.badDaysPastDue} onChange={set('badDaysPastDue')} placeholder={p ? String(p.badDaysPastDue) : ''} /></Field>
                    <Field label={t('monitoring.performanceMonths')}><TextInput inputMode="numeric" value={form.performanceMonths} onChange={set('performanceMonths')} placeholder={p ? String(p.performanceMonths) : ''} /></Field>
                    <Field label={t('monitoring.baselineFrom')}><TextInput type="date" value={form.baselineFrom} onChange={set('baselineFrom')} /></Field>
                    <Field label={t('monitoring.baselineTo')}><TextInput type="date" value={form.baselineTo} onChange={set('baselineTo')} /></Field>
                    <Field label={t('monitoring.recentFrom')}><TextInput type="date" value={form.recentFrom} onChange={set('recentFrom')} /></Field>
                    <Field label={t('monitoring.recentTo')}><TextInput type="date" value={form.recentTo} onChange={set('recentTo')} /></Field>
                    <div className="col-span-2 md:col-span-4 lg:col-span-7 flex gap-2">
                        <Btn variant="primary" type="submit">{t('monitoring.apply')}</Btn>
                        <Btn variant="ghost" onClick={() => { setForm(EMPTY); setApplied(EMPTY); }}>{t('monitoring.reset')}</Btn>
                    </div>
                </form>
            </Card>

            {report.error && <ErrorBox error={report.error} />}
            {report.loading && !report.data ? <Spinner /> : report.data && (
                <>
                    <Notice>
                        {t.rich('monitoring.explain', {
                            asOf: report.data.asOf,
                            dpd: report.data.parameters.badDaysPastDue,
                            months: report.data.parameters.performanceMonths,
                            baselineFrom: report.data.parameters.baseline.from,
                            baselineTo: report.data.parameters.baseline.to,
                            recentFrom: report.data.parameters.recent.from,
                            recentTo: report.data.parameters.recent.to,
                            b: (chunks) => <b>{chunks}</b>,
                        })}
                    </Notice>
                    {report.data.versions.length === 0 ? <Card><Empty>{t('monitoring.noneScored')}</Empty></Card> : report.data.versions.map((v) => (
                        <VersionCard key={`${v.scorecardCode}-${v.version}-${v.role}`} v={v} />
                    ))}
                </>
            )}
        </LendingShell>
    );
}

function VersionCard({ v }: { v: MonitoredVersion }) {
    const { t, version: versionLabel } = useScoringText();
    const psi = psiLabel(v.stability.psi);
    const maxCount = Math.max(1, ...v.byGrade.map((g) => g.count));
    const d = v.discrimination;
    return (
        <Card
            title={<span className="flex items-center gap-2">{v.scorecardCode} {versionLabel(v.version)}
                <span className={`inline-flex px-1.5 py-0.5 rounded border text-[11px] font-bold ${v.role === 'CHAMPION' ? 'bg-[#F0F5FF] text-[#4B45C6] border-[#C9D7FF]' : 'bg-slate-100 text-slate-600 border-slate-200'}`}>{v.role === 'CHAMPION' ? t('monitoring.champion') : t('monitoring.challengerShadow')}</span>
            </span>}
            subtitle={t('monitoring.source', { source: v.source.toLowerCase() })}
        >
            <div className="space-y-5">
                <KV cols={4} items={[
                    [t('monitoring.applications'), v.applications],
                    [t('monitoring.averageScore'), v.averageScore === null ? '—' : dec(String(v.averageScore), 1)],
                    [t('monitoring.approvalRate'), fmtRate(v.approvalRate, 2)],
                    [t('monitoring.matureLoans'), t('monitoring.matureSplit', { mature: d.matureLoans, goods: d.goods, bads: d.bads })],
                    ['Gini', dec(d.gini)],
                    ['AUC', dec(d.auc)],
                    ['KS', d.ks ? t('monitoring.ksAt', { ks: dec(d.ks.ks), score: d.ks.atScore }) : '—'],
                    ['PSI', <span key="psi">{dec(v.stability.psi)} <span className={`font-semibold ${psi.cls}`}>{t(`monitoring.psi.${psi.key}`)}</span></span>],
                ]} />

                <div>
                    <p className="text-[11px] font-bold uppercase tracking-wide text-[#8792A2] mb-2">{t('monitoring.distribution')}</p>
                    {v.byGrade.length === 0 ? <Empty>{t('monitoring.noApplications')}</Empty> : (
                        <div className="space-y-1.5">
                            {v.byGrade.map((g) => (
                                <div key={g.grade} className="flex items-center gap-3">
                                    <span className="w-8 text-[13px] font-bold text-[#1A1F36]">{g.grade}</span>
                                    <div className="flex-1 h-4 rounded bg-[#F0F2F5] overflow-hidden">
                                        <div className="h-full bg-[#635BFF]/70 rounded" style={{ width: `${(g.count / maxCount) * 100}%` }} />
                                    </div>
                                    <span className="w-28 text-right text-[12px] tabular-nums text-[#3C4257]">{g.count} · {fmtRate(g.share, 1)}</span>
                                </div>
                            ))}
                        </div>
                    )}
                </div>

                {v.byGrade.length > 0 && (
                    <Table className="border border-[#E3E8EE] rounded">
                        <thead>
                            <tr className="border-b border-[#E3E8EE] bg-[#F7FAFC]">
                                <th className={th}>{t('monitoring.grade')}</th><th className={thR}>{t('monitoring.count')}</th><th className={thR}>{t('monitoring.share')}</th><th className={th}>{t('monitoring.scores')}</th><th className={th}>{t('monitoring.outcomes')}</th>
                                <th className={thR}>{t('monitoring.approved')}</th><th className={thR}>{t('monitoring.rejected')}</th><th className={thR}>{t('monitoring.approvalRate')}</th><th className={thR}>{t('monitoring.mature')}</th><th className={thR}>{t('monitoring.bad')}</th><th className={thR}>{t('monitoring.badRate')}</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-[#F0F2F5]">
                            {v.byGrade.map((g) => (
                                <tr key={g.grade}>
                                    <td className={td}><span className="font-bold">{g.grade}</span></td>
                                    <td className={tdR}>{g.count}</td>
                                    <td className={tdR}>{fmtRate(g.share, 1)}</td>
                                    <td className={`${td} whitespace-nowrap tabular-nums`}>{g.minScore ?? '—'} – {g.maxScore ?? '—'}</td>
                                    <td className={td}>
                                        <div className="flex flex-wrap gap-1">
                                            {(['AUTO_APPROVE', 'REFER', 'DECLINE'] as const).filter((o) => g.outcomes[o]).map((o) => (
                                                <span key={o} className="inline-flex items-center gap-1"><OutcomeBadge outcome={o} /><span className="text-[12px] tabular-nums">{g.outcomes[o]}</span></span>
                                            ))}
                                        </div>
                                    </td>
                                    <td className={tdR}>{g.approved}</td>
                                    <td className={tdR}>{g.rejected}</td>
                                    <td className={tdR}>{fmtRate(g.approvalRate, 1)}</td>
                                    <td className={tdR}>{g.matureLoans}</td>
                                    <td className={tdR}>{g.bad}</td>
                                    <td className={tdR}>{fmtRate(g.badRate, 1)}</td>
                                </tr>
                            ))}
                        </tbody>
                    </Table>
                )}

                {v.stability.bins.length > 0 && (
                    <div>
                        <p className="text-[11px] font-bold uppercase tracking-wide text-[#8792A2] mb-2">{t('monitoring.stability')}</p>
                        <Table className="border border-[#E3E8EE] rounded">
                            <thead><tr className="border-b border-[#E3E8EE] bg-[#F7FAFC]"><th className={th}>{t('monitoring.grade')}</th><th className={thR}>{t('monitoring.baseline')}</th><th className={thR}>{t('monitoring.recent')}</th><th className={thR}>{t('monitoring.psiContribution')}</th></tr></thead>
                            <tbody className="divide-y divide-[#F0F2F5]">
                                {v.stability.bins.map((b) => (
                                    <tr key={b.bin}>
                                        <td className={td}>{b.bin}<span className="ml-1.5 text-[11px] text-[#697386]">({v.stability.baseline[b.bin] ?? 0} → {v.stability.recent[b.bin] ?? 0})</span></td>
                                        <td className={tdR}>{fmtRate(b.baseline, 1)}</td>
                                        <td className={tdR}>{fmtRate(b.recent, 1)}</td>
                                        <td className={tdR}>{dec(b.contribution, 4)}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </Table>
                    </div>
                )}
            </div>
        </Card>
    );
}
