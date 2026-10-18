"use client";

import { useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import api from '@/lib/api';
import { useToast } from '@/components/ui/toast';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { useLendingHref } from '../LendingShell';
import { Btn, Card, Disclosure, Empty, ErrorBox, KV, Notice, Spinner, Table, td, th, tdR, thR } from '../ui';
import { useAction, useApi } from '../useAsync';
import { fmtRate } from '../format';
import { MoneyCell } from '../MoneyCell';
import type { RateResetApplyResult, RateResetHistory } from './types';

const BOUND_CLS: Record<string, string> = {
    BENCHMARK: 'bg-slate-100 text-slate-600 border-slate-200',
    FLOOR: 'bg-amber-50 text-amber-800 border-amber-200',
    CAP: 'bg-[#F0F5FF] text-[#4B45C6] border-[#C9D7FF]',
};

/** Floating-rate resets on one loan: terms, reset calendar, history, and applying what is due. */
export function RateResetsPanel({ loanId, onDone, onClose }: { loanId: string; onDone?: (msg: string) => void; onClose?: () => void }) {
    const tr = useTranslations('LendingRelief');
    const href = useLendingHref();
    const { showToast } = useToast();
    const confirm = useConfirm();
    const { data, error, loading, reload } = useApi<RateResetHistory>(`/lending/loans/${loanId}/rate-resets`);
    const { busy, error: applyError, run, clearError } = useAction();
    const [result, setResult] = useState<RateResetApplyResult | null>(null);

    const apply = async () => {
        if (!data) return;
        const ok = await confirm({
            title: tr('rates.applyTitle'),
            message: tr('rates.applyMessage', { count: data.due.length, dates: data.due.join(', '), benchmark: data.terms?.benchmarkCode ?? tr('rates.benchmarkFallback') }),
            confirmLabel: tr('rates.applyConfirm'),
            variant: 'warning',
        });
        if (!ok) return;
        const res = await run('apply', () => api.post<RateResetApplyResult>(`/lending/loans/${loanId}/rate-resets`, {}));
        if (res) {
            setResult(res.data);
            reload();
            const n = res.data.applied?.length ?? 0;
            const last = n ? res.data.applied[n - 1] : null;
            const msg = n ? (last ? tr('rates.appliedToastRate', { count: n, rate: fmtRate(last.newAnnualRate) }) : tr('rates.appliedToast', { count: n })) : (res.data.message ?? tr('rates.noneDueToast'));
            if (onDone && n) onDone(msg);
            else showToast(msg, n ? 'success' : 'info');
        }
    };

    const applied = data?.resets ?? [];
    const appliedDates = new Set(applied.map((r) => r.resetDate));
    const dueDates = new Set(data?.due ?? []);
    const benchmarkMissing = applyError?.code === 'BENCHMARK_MISSING';

    return (
        <Card
            title={tr('rates.title')}
            subtitle={tr('rates.subtitle')}
            actions={
                <>
                    {data?.floating && (
                        <Btn variant="primary" size="sm" onClick={apply} busy={busy === 'apply'} disabled={!data.due.length} reason={!data.due.length ? tr('rates.noneDueReason') : undefined}>
                            {tr('rates.applyButton', { count: data.due.length })}
                        </Btn>
                    )}
                    {onClose && <Btn size="sm" variant="ghost" onClick={onClose}>{tr('common.close')}</Btn>}
                </>
            }
        >
            {loading && !data ? <Spinner /> : error ? <ErrorBox error={error} /> : !data ? null : !data.floating ? (
                <Empty>{tr('rates.fixedRate')}</Empty>
            ) : (
                <div className="space-y-4">
                    {data.terms && (
                        <KV cols={4} items={[
                            [tr('rates.benchmark'), <span key="b" className="font-mono">{data.terms.benchmarkCode}</span>],
                            [tr('rates.margin'), fmtRate(data.terms.margin)],
                            [tr('rates.resetFrequency'), tr.has(`frequency.${data.terms.resetFrequency}`) ? tr(`frequency.${data.terms.resetFrequency}`) : data.terms.resetFrequency.replace(/_/g, ' ')],
                            [tr('rates.floorCap'), `${data.terms.floor ? fmtRate(data.terms.floor) : tr('rates.none')} / ${data.terms.cap ? fmtRate(data.terms.cap) : tr('rates.none')}`],
                        ]} />
                    )}

                    {data.due.length > 0 && (
                        <Notice tone="warn" title={tr('rates.dueTitle', { count: data.due.length })}>
                            {tr('rates.dueBody', { dates: data.due.join(', ') })}
                        </Notice>
                    )}

                    {applyError && (
                        <div className="space-y-2">
                            <ErrorBox error={applyError} onDismiss={clearError} />
                            {benchmarkMissing && (
                                <p className="text-[12px] text-[#697386]">
                                    {tr.rich('rates.missingObservation', { link: (c) => <Link href={href('/lending/operations')} className="text-[#635BFF] hover:underline">{c}</Link> })}
                                </p>
                            )}
                        </div>
                    )}

                    {result && result.applied.length === 0 && result.message && <Notice tone="info">{result.message}</Notice>}
                    {result && result.applied.some((r) => r.explanation?.length) && (
                        <Disclosure summary={tr('rates.howCalculated')} defaultOpen>
                            <div className="space-y-2">
                                {result.applied.map((r) => (
                                    <div key={r.id} className="text-[12px]">
                                        <p className="font-semibold text-[#1A1F36]">{r.resetDate}</p>
                                        <ul className="list-disc pl-5 text-[#4F566B]">{(r.explanation ?? []).map((x, i) => <li key={i}>{x}</li>)}</ul>
                                    </div>
                                ))}
                            </div>
                        </Disclosure>
                    )}

                    <div>
                        <p className="text-[11px] font-bold uppercase tracking-wide text-[#8792A2] mb-1.5">{tr('rates.appliedHeading')}</p>
                        {!applied.length ? <p className="text-[13px] text-[#697386]">{tr('rates.noneApplied')}</p> : (
                            <Table className="border border-[#E3E8EE] rounded">
                                <thead>
                                    <tr className="border-b border-[#E3E8EE] bg-[#F7FAFC]">
                                        <th className={th}>{tr('rates.col.resetDate')}</th><th className={th}>{tr('rates.col.effectiveFrom')}</th><th className={th}>{tr('rates.col.observation')}</th>
                                        <th className={thR}>{tr('rates.col.benchmark')}</th><th className={thR}>{tr('rates.col.margin')}</th><th className={thR}>{tr('rates.col.indicated')}</th><th className={th}>{tr('rates.col.bound')}</th>
                                        <th className={thR}>{tr('rates.col.previous')}</th><th className={thR}>{tr('rates.col.newRate')}</th><th className={thR}>{tr('rates.col.instalment')}</th><th className={th}>{tr('rates.col.agreement')}</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-[#F0F2F5]">
                                    {applied.map((r) => (
                                        <tr key={r.id}>
                                            <td className={`${td} tabular-nums whitespace-nowrap`}>{r.resetDate}</td>
                                            <td className={`${td} tabular-nums whitespace-nowrap`}>{r.effectiveFrom}</td>
                                            <td className={`${td} tabular-nums whitespace-nowrap text-[12px]`}><span className="font-mono">{r.benchmarkCode}</span> {r.observationDate}</td>
                                            <td className={tdR}>{fmtRate(r.observedRate)}</td>
                                            <td className={tdR}>{fmtRate(r.margin)}</td>
                                            <td className={tdR}>{fmtRate(r.indicatedRate)}</td>
                                            <td className={td}>
                                                <span className={`inline-flex px-1.5 py-0.5 rounded border text-[11px] font-bold ${BOUND_CLS[r.bound] ?? BOUND_CLS.BENCHMARK}`}>{tr.has(`bound.${r.bound}`) ? tr(`bound.${r.bound}`) : r.bound}</span>
                                            </td>
                                            <td className={`${tdR} text-[#697386]`}>{fmtRate(r.previousAnnualRate)}</td>
                                            <td className={`${tdR} font-bold text-[#1A1F36]`}>{fmtRate(r.newAnnualRate)}</td>
                                            <td className={tdR}>{r.instalmentAmount === null ? <span className="text-[#AAB7C4]">—</span> : <MoneyCell value={r.instalmentAmount} />}</td>
                                            <td className={`${td} tabular-nums`}>v{r.agreementVersion}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </Table>
                        )}
                    </div>

                    {data.schedule.length > 0 && (
                        <Disclosure summary={tr('rates.calendar', { count: data.schedule.length })}>
                            <div className="flex flex-wrap gap-1.5">
                                {data.schedule.map((d) => {
                                    const cls = appliedDates.has(d)
                                        ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                                        : dueDates.has(d) ? 'bg-amber-50 text-amber-800 border-amber-300 font-bold' : 'bg-white text-[#697386] border-[#E3E8EE]';
                                    return (
                                        <span key={d} className={`px-1.5 py-0.5 rounded border text-[11px] tabular-nums ${cls}`} title={appliedDates.has(d) ? tr('rates.dayApplied') : dueDates.has(d) ? tr('rates.dayDue') : tr('rates.dayUpcoming')}>{d}</span>
                                    );
                                })}
                            </div>
                            <p className="text-[11px] text-[#8792A2] mt-1.5">{tr('rates.legend')}</p>
                        </Disclosure>
                    )}
                </div>
            )}
        </Card>
    );
}
