"use client";

import { useState } from 'react';
import { LendingShell } from '../LendingShell';
import { Btn, Card, Empty, ErrorBox, Field, KV, Notice, SelectInput, Spinner, Table, TextInput, td, tdR, th, thR } from '../ui';
import { qs, useApi } from '../useAsync';
import { fmtRate } from '../format';
import { OutcomeBadge } from './ScoreResultView';
import { psiLabel, versionLabel } from './types';
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
    const [form, setForm] = useState<Filters>(EMPTY);
    const [applied, setApplied] = useState<Filters>(EMPTY);
    const list = useApi<ScorecardList>('/lending/scorecards');
    const report = useApi<MonitoringReport>(`/lending/scorecard-monitoring${qs({ ...applied })}`);
    const set = (k: keyof Filters) => (v: string) => setForm((f) => ({ ...f, [k]: v }));

    const codes = Array.from(new Set([...(list.data?.scorecards.map((s) => s.code) ?? []), ...(list.data?.templateInForce ?? [])]));
    const p = report.data?.parameters;

    return (
        <LendingShell
            title="Scorecard monitoring"
            subtitle="How each scorecard version is scoring and performing. Figures are recomputed on every load."
            actions={<Btn variant="ghost" onClick={report.reload}>Refresh</Btn>}
        >
            <Card title="Filters">
                <form className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3 items-end" onSubmit={(e) => { e.preventDefault(); setApplied(form); }}>
                    <Field label="Scorecard"><SelectInput value={form.scorecardCode} onChange={set('scorecardCode')} options={codes} placeholder="All" /></Field>
                    <Field label="Bad at DPD ≥"><TextInput inputMode="numeric" value={form.badDaysPastDue} onChange={set('badDaysPastDue')} placeholder={p ? String(p.badDaysPastDue) : ''} /></Field>
                    <Field label="Performance months"><TextInput inputMode="numeric" value={form.performanceMonths} onChange={set('performanceMonths')} placeholder={p ? String(p.performanceMonths) : ''} /></Field>
                    <Field label="Baseline from"><TextInput type="date" value={form.baselineFrom} onChange={set('baselineFrom')} /></Field>
                    <Field label="Baseline to"><TextInput type="date" value={form.baselineTo} onChange={set('baselineTo')} /></Field>
                    <Field label="Recent from"><TextInput type="date" value={form.recentFrom} onChange={set('recentFrom')} /></Field>
                    <Field label="Recent to"><TextInput type="date" value={form.recentTo} onChange={set('recentTo')} /></Field>
                    <div className="col-span-2 md:col-span-4 lg:col-span-7 flex gap-2">
                        <Btn variant="primary" type="submit">Apply</Btn>
                        <Btn variant="ghost" onClick={() => { setForm(EMPTY); setApplied(EMPTY); }}>Reset</Btn>
                    </div>
                </form>
            </Card>

            {report.error && <ErrorBox error={report.error} />}
            {report.loading && !report.data ? <Spinner /> : report.data && (
                <>
                    <Notice>
                        As of {report.data.asOf}. A loan counts as <b>bad</b> when it reached {report.data.parameters.badDaysPastDue}+ days past due within
                        {' '}{report.data.parameters.performanceMonths} months of booking; only loans that have been on book that long (<b>mature</b>) count towards bad rates,
                        Gini, AUC and KS. Stability compares the grade mix of applications scored {report.data.parameters.baseline.from} – {report.data.parameters.baseline.to} (baseline)
                        with {report.data.parameters.recent.from} – {report.data.parameters.recent.to} (recent). <b>Challenger</b> rows are shadow evaluations: they are scored
                        alongside the champion but never affect a decision, so their approval figures reflect the champion&apos;s decisions.
                    </Notice>
                    {report.data.versions.length === 0 ? <Card><Empty>No scored applications in this window.</Empty></Card> : report.data.versions.map((v) => (
                        <VersionCard key={`${v.scorecardCode}-${v.version}-${v.role}`} v={v} />
                    ))}
                </>
            )}
        </LendingShell>
    );
}

function VersionCard({ v }: { v: MonitoredVersion }) {
    const psi = psiLabel(v.stability.psi);
    const maxCount = Math.max(1, ...v.byGrade.map((g) => g.count));
    const d = v.discrimination;
    return (
        <Card
            title={<span className="flex items-center gap-2">{v.scorecardCode} {versionLabel(v.version)}
                <span className={`inline-flex px-1.5 py-0.5 rounded border text-[11px] font-bold ${v.role === 'CHAMPION' ? 'bg-[#F0F5FF] text-[#4B45C6] border-[#C9D7FF]' : 'bg-slate-100 text-slate-600 border-slate-200'}`}>{v.role === 'CHAMPION' ? 'CHAMPION' : 'CHALLENGER · shadow'}</span>
            </span>}
            subtitle={`Source ${v.source.toLowerCase()}`}
        >
            <div className="space-y-5">
                <KV cols={4} items={[
                    ['Applications', v.applications],
                    ['Average score', v.averageScore === null ? '—' : dec(String(v.averageScore), 1)],
                    ['Approval rate', fmtRate(v.approvalRate, 2)],
                    ['Mature loans', `${d.matureLoans} (${d.goods} good · ${d.bads} bad)`],
                    ['Gini', dec(d.gini)],
                    ['AUC', dec(d.auc)],
                    ['KS', d.ks ? `${dec(d.ks.ks)} at score ${d.ks.atScore}` : '—'],
                    ['PSI', <span key="psi">{dec(v.stability.psi)} <span className={`font-semibold ${psi.cls}`}>{psi.label}</span></span>],
                ]} />

                <div>
                    <p className="text-[11px] font-bold uppercase tracking-wide text-[#8792A2] mb-2">Distribution by grade</p>
                    {v.byGrade.length === 0 ? <Empty>No applications.</Empty> : (
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
                                <th className={th}>Grade</th><th className={thR}>Count</th><th className={thR}>Share</th><th className={th}>Scores</th><th className={th}>Outcomes</th>
                                <th className={thR}>Approved</th><th className={thR}>Rejected</th><th className={thR}>Approval rate</th><th className={thR}>Mature</th><th className={thR}>Bad</th><th className={thR}>Bad rate</th>
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
                        <p className="text-[11px] font-bold uppercase tracking-wide text-[#8792A2] mb-2">Stability (baseline → recent share)</p>
                        <Table className="border border-[#E3E8EE] rounded">
                            <thead><tr className="border-b border-[#E3E8EE] bg-[#F7FAFC]"><th className={th}>Grade</th><th className={thR}>Baseline</th><th className={thR}>Recent</th><th className={thR}>PSI contribution</th></tr></thead>
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
