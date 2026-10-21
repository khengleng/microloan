"use client";

import { useState } from 'react';
import Link from 'next/link';
import { FileDown, RefreshCw } from 'lucide-react';
import api from '@/lib/api';
import { useToast } from '@/components/ui/toast';
import { useWorkspace } from '@/lib/workspace';
import { LendingShell, useLendingHref } from '../LendingShell';
import { Btn, Card, Disclosure, Empty, ErrorBox, KV, Notice, SelectInput, Spinner, Table, td, tdR, th } from '../ui';
import { useAction, useApi } from '../useAsync';
import { fmtDateTime } from '../format';
import { Money } from '../MoneyCell';
import { GradePill } from './ScoreResultView';
import { usePeople, useScoringText } from './i18n';
import type { CreditReportFacility, CreditReportList, CreditReportView as Report } from './types';

/** A month cell of the payment-status grid: green current, red past due or written off, grey otherwise. */
function codeCls(code: string): string {
    if (code === '') return 'bg-white text-[#C1C9D2]';
    if (code === '0') return 'bg-emerald-50 text-emerald-800';
    if (code === 'C') return 'bg-slate-100 text-slate-600';
    if (code === 'R') return 'bg-amber-50 text-amber-800';
    return 'bg-red-50 text-red-700 font-bold';
}

function Grid({ months, history }: { months: string[]; history: CreditReportFacility['history'] }) {
    const codes = new Map(history.map((h) => [h.month, h]));
    return (
        <div data-testid="credit-report-grid" className="overflow-x-auto">
            <table className="border-collapse">
                <thead>
                    <tr>{months.map((m) => <th key={m} className="px-0.5 text-[9px] font-semibold text-[#8792A2] whitespace-nowrap">{`${m.slice(5)}/${m.slice(2, 4)}`}</th>)}</tr>
                </thead>
                <tbody>
                    <tr>
                        {months.map((m) => {
                            const h = codes.get(m);
                            const code = h?.code ?? '';
                            return (
                                <td key={m} title={h?.dpd !== null && h?.dpd !== undefined ? `${m}: ${h.dpd}` : m}
                                    className={`w-7 h-6 text-center text-[11px] tabular-nums border border-[#E3E8EE] ${codeCls(code)}`}>
                                    {code || '·'}
                                </td>
                            );
                        })}
                    </tr>
                </tbody>
            </table>
        </div>
    );
}

/** The report itself: score, reasons, summary, facilities with their grids, guarantees and enquiries. */
export function CreditReportBody({ report }: { report: Report }) {
    const { t } = useScoringText();
    const c = report.content;
    const sc = c.score;
    const label = (group: string, code: string) => (t.has(`creditReport.${group}.${code}`) ? t(`creditReport.${group}.${code}`) : code.replace(/_/g, ' ').toLowerCase());
    const amounts = (xs: { currency: string; amount: string }[]) =>
        xs.length ? xs.map((x) => <div key={x.currency}><Money value={x.amount} currency={x.currency} /></div>) : '0';

    return (
        <div data-testid="credit-report" className="space-y-5">
            <div className="flex flex-wrap items-end gap-6">
                <div>
                    <p className="text-[11px] font-bold uppercase tracking-wide text-[#8792A2]">{t('creditReport.bureauScore')}</p>
                    {sc.score === null ? (
                        <p data-testid="credit-report-score" className="text-[18px] font-bold text-[#1A1F36] leading-tight">{t('creditReport.noScore')}</p>
                    ) : (
                        <p data-testid="credit-report-score" className="text-[28px] font-bold text-[#1A1F36] tabular-nums leading-tight">{sc.score}</p>
                    )}
                </div>
                {sc.grade && (
                    <div>
                        <p className="text-[11px] font-bold uppercase tracking-wide text-[#8792A2]">{t('result.grade')}</p>
                        <div className="mt-1"><GradePill grade={sc.grade} label={sc.gradeLabel ?? undefined} /></div>
                    </div>
                )}
                <div>
                    <p className="text-[11px] font-bold uppercase tracking-wide text-[#8792A2]">{t('creditReport.reportLabel')}</p>
                    <p className="text-[13px] mt-1"><span className="font-mono font-semibold">{report.reference}</span> · {t('creditReport.asOf', { date: report.asOf })}</p>
                </div>
                <div>
                    <p className="text-[11px] font-bold uppercase tracking-wide text-[#8792A2]">{t('appScore.scorecard')}</p>
                    <p className="text-[13px] mt-1"><span className="font-mono font-semibold">{report.scorecardCode}</span> {report.scorecardVersion === 0 ? t('common.template') : `v${report.scorecardVersion}`}</p>
                </div>
                <div>
                    <p className="text-[11px] font-bold uppercase tracking-wide text-[#8792A2]">{t('creditReport.purposeLabel')}</p>
                    <p className="text-[13px] mt-1">{label('purposes', report.purpose)}</p>
                </div>
            </div>
            {sc.score === null && sc.noScoreReason && (
                <Notice tone="info" title={label('noScoreReasons', sc.noScoreReason)}>{t('creditReport.noScoreExplained')}</Notice>
            )}
            {sc.adverseReasons.length > 0 && (
                <div>
                    <p className="text-[11px] font-bold uppercase tracking-wide text-[#8792A2] mb-1">{t('creditReport.reasons')}</p>
                    <ul className="space-y-0.5">{sc.adverseReasons.map((a) => <li key={a.code} className="text-[13px] text-[#3C4257]">{a.text} <span className="font-mono text-[10px] text-[#8792A2]">{a.code}</span></li>)}</ul>
                </div>
            )}

            <div>
                <p className="text-[11px] font-bold uppercase tracking-wide text-[#8792A2] mb-2">{t('creditReport.summary')}</p>
                <KV cols={3} items={[
                    [t('creditReport.activeFacilities'), c.totals.activeFacilities],
                    [t('creditReport.closedFacilities'), c.totals.closedFacilities],
                    [t('creditReport.writtenOffFacilities'), c.totals.writtenOffFacilities],
                    [t('creditReport.exposure'), amounts(c.totals.exposure)],
                    [t('creditReport.monthlyObligation'), amounts(c.totals.monthlyObligation)],
                    [t('creditReport.lenders'), c.totals.lenders],
                ]} />
            </div>

            <div>
                <p className="text-[11px] font-bold uppercase tracking-wide text-[#8792A2] mb-2">{t('creditReport.facilities')}</p>
                {c.facilities.length === 0 ? <Empty>{t('creditReport.noFacilities')}</Empty> : (
                    <div className="space-y-3">
                        {c.facilities.map((fac) => (
                            <div key={fac.id} data-testid="credit-report-facility" className="border border-[#E3E8EE] rounded-md p-3 space-y-2">
                                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-[13px]">
                                    <span className="font-mono font-semibold">{fac.reference}</span>
                                    <span>{fac.product}</span>
                                    <span className="text-[#697386]">{label('kinds', fac.kind)}</span>
                                    <span className="inline-flex px-1.5 py-0.5 rounded border text-[11px] font-semibold bg-slate-50 border-slate-200">{label('statuses', fac.status)}</span>
                                    {fac.source === 'LEGACY' && <span className="text-[11px] text-[#697386]">{t('creditReport.legacy')}</span>}
                                    {fac.writtenOff && <span className="text-[11px] font-bold text-red-700">{t('creditReport.flagWrittenOff')}</span>}
                                    {fac.restructured && <span className="text-[11px] font-bold text-amber-800">{t('creditReport.flagRestructured')}</span>}
                                    {fac.settled && <span className="text-[11px] font-bold text-amber-800">{t('creditReport.flagSettled')}</span>}
                                    {fac.transferredTo && <span className="text-[11px] text-[#697386]">{t('creditReport.transferredTo', { reference: fac.transferredTo })}</span>}
                                </div>
                                <Table>
                                    <thead><tr>
                                        <th className={th}>{t('creditReport.colOpened')}</th><th className={th}>{t('creditReport.colClosed')}</th>
                                        <th className={th}>{fac.limit ? t('creditReport.colLimit') : t('creditReport.colPrincipal')}</th><th className={th}>{t('creditReport.colBalance')}</th>
                                        <th className={th}>{t('creditReport.colInstalment')}</th><th className={th}>{t('creditReport.colDpdNow')}</th><th className={th}>{t('creditReport.colWorstDpd')}</th>
                                    </tr></thead>
                                    <tbody><tr>
                                        <td className={td}>{fac.openedOn ?? '—'}</td><td className={td}>{fac.closedOn ?? '—'}</td>
                                        <td className={tdR}><Money value={fac.limit ?? fac.principal} currency={fac.currency} /></td>
                                        <td className={tdR}><Money value={fac.balance} currency={fac.currency} /></td>
                                        <td className={tdR}>{fac.instalment ? <Money value={fac.instalment} currency={fac.currency} /> : '—'}</td>
                                        <td className={tdR}>{fac.currentDpd}</td>
                                        <td className={tdR}>{t('creditReport.worstDpdValues', { ever: fac.worstDpd, m12: fac.worstDpd12m, m24: fac.worstDpd24m })}</td>
                                    </tr></tbody>
                                </Table>
                                <Grid months={c.months} history={fac.history} />
                            </div>
                        ))}
                    </div>
                )}
                <p className="mt-2 text-[11px] text-[#697386]">{t('creditReport.legend')}</p>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
                <div>
                    <p className="text-[11px] font-bold uppercase tracking-wide text-[#8792A2] mb-1">{t('creditReport.guarantees')}</p>
                    {c.guarantees.length === 0 ? <Empty>{t('creditReport.noGuarantees')}</Empty> : (
                        <ul className="space-y-1">
                            {c.guarantees.map((g) => (
                                <li key={g.id} className="text-[13px] text-[#3C4257]">
                                    {t('creditReport.guaranteeLine', { date: g.givenOn, borrower: g.principalBorrower, reference: g.applicationReference })} <Money value={g.amount} currency={g.currency} />
                                    {g.loan && <span className="text-[#697386]"> · {g.loan.reference} · {t('creditReport.dpdShort', { days: g.loan.daysPastDue })}</span>}
                                </li>
                            ))}
                        </ul>
                    )}
                </div>
                <div>
                    <p className="text-[11px] font-bold uppercase tracking-wide text-[#8792A2] mb-1">{t('creditReport.enquiries')}</p>
                    {c.enquiries.length === 0 ? <Empty>{t('creditReport.noEnquiries')}</Empty> : (
                        <ul className="space-y-1">
                            {c.enquiries.map((e) => (
                                <li key={`${e.type}-${e.id}`} className="text-[13px] text-[#3C4257]">
                                    <span className="tabular-nums">{e.date}</span> · {e.type === 'APPLICATION' ? t('creditReport.enquiryApplication') : t('creditReport.enquiryReport')} · <span className="font-mono text-[12px]">{e.reference}</span> · {e.type === 'REPORT' ? label('purposes', e.purpose) : e.purpose}
                                    {e.current && <span className="ml-1 text-[11px] font-semibold text-[#635BFF]">{t('creditReport.thisApplication')}</span>}
                                </li>
                            ))}
                        </ul>
                    )}
                </div>
            </div>
            <p className="text-[11px] text-[#697386]">{t('creditReport.internalNote')}</p>
        </div>
    );
}

/**
 * A customer's credit report: the latest one, the provider and consent in
 * force, pulling a fresh report and printing it. On the application page it
 * shows the report pulled for that application.
 */
export function CreditReportPanel({ borrowerId, applicationId }: { borrowerId: string; applicationId?: string }) {
    const ws = useWorkspace();
    const href = useLendingHref();
    const { t } = useScoringText();
    const { showToast } = useToast();
    const url = applicationId ? `/lending/applications/${applicationId}/credit-report` : `/lending/customers/${borrowerId}/credit-reports`;
    const list = useApi<CreditReportList>(url);
    const person = usePeople((list.data?.reports ?? []).map((r) => r.requestedBy));
    const [purpose, setPurpose] = useState(applicationId ? 'NEW_APPLICATION' : 'ACCOUNT_REVIEW');
    const { busy, error, run, clearError } = useAction();
    const canPull = !ws.access || ws.can('credit_report.pull');
    const d = list.data;
    const label = (group: string, code: string) => (t.has(`creditReport.${group}.${code}`) ? t(`creditReport.${group}.${code}`) : code);

    const pull = async () => {
        const res = await run('pull', () => api.post(`/lending/customers/${borrowerId}/credit-reports`, { purpose, ...(purpose === 'NEW_APPLICATION' && applicationId ? { applicationId } : {}) }));
        if (res) { showToast(t('creditReport.pulled'), 'success'); list.reload(); }
    };
    const openPdf = (id: string) => run(`pdf-${id}`, async () => {
        const r = await api.get(`/lending/credit-reports/${id}/pdf`, { responseType: 'blob' });
        const link = URL.createObjectURL(r.data as Blob);
        window.open(link, '_blank', 'noopener');
        setTimeout(() => URL.revokeObjectURL(link), 60_000);
    });

    if (list.loading && !d) return <Spinner />;
    if (list.error && !d) return <ErrorBox error={list.error} />;
    if (!d) return null;
    const purposes = applicationId ? d.purposes : d.purposes.filter((p) => p !== 'NEW_APPLICATION');

    return (
        <div className="space-y-4">
            <ErrorBox error={error} onDismiss={clearError} />
            <div className="flex flex-wrap items-end gap-3">
                <div className="text-[13px] text-[#3C4257]">
                    {t('creditReport.provider')}: <span className="font-semibold">{label('providers', d.provider)}</span>
                    {' · '}
                    {d.consent ? t('creditReport.consentUntil', { date: (d.consent.expiresAt ?? '').slice(0, 10) }) : <span className="font-semibold text-amber-800">{t('creditReport.noConsent')}</span>}
                </div>
                <div className="ml-auto flex flex-wrap items-end gap-2">
                    {canPull && d.availability.usable && d.consent && (
                        <>
                            <div className="w-56"><SelectInput value={purpose} onChange={setPurpose} options={purposes.map((p) => ({ value: p, label: label('purposes', p) }))} /></div>
                            <Btn data-testid="credit-report-pull" size="sm" variant="primary" busy={busy === 'pull'} onClick={pull}><RefreshCw size={13} /> {t('creditReport.pull')}</Btn>
                        </>
                    )}
                    {d.latest && <Btn size="sm" busy={busy === `pdf-${d.latest.id}`} onClick={() => openPdf(d.latest!.id)}><FileDown size={13} /> {t('creditReport.pdf')}</Btn>}
                </div>
            </div>
            {!d.availability.usable && <Notice tone="warn" title={t('creditReport.providerUnavailable')}>{d.availability.message}</Notice>}
            {!d.consent && (
                <Notice tone="info">
                    {t('creditReport.noConsentExplained')}{' '}
                    <Link href={href(`/lending/customers/${borrowerId}/alternative-data`)} className="font-semibold text-[#635BFF] hover:underline">{t('creditReport.recordConsent')}</Link>
                </Notice>
            )}
            {applicationId && d.latest && d.forThisApplication === false && <Notice tone="info">{t('creditReport.notForThisApplication')}</Notice>}
            {d.latest ? <CreditReportBody report={d.latest} /> : <Empty>{t('creditReport.noReports')}</Empty>}
            {d.reports.length > 1 && (
                <Disclosure summary={t('creditReport.earlier', { count: d.reports.length })}>
                    <Table className="border border-[#E3E8EE] rounded">
                        <thead><tr className="border-b border-[#E3E8EE] bg-[#F7FAFC]">
                            <th className={th}>{t('appScore.colWhen')}</th><th className={th}>{t('creditReport.reportLabel')}</th><th className={th}>{t('creditReport.purposeLabel')}</th>
                            <th className={th}>{t('creditReport.bureauScore')}</th><th className={th}>{t('appScore.colBy')}</th><th className={th}></th>
                        </tr></thead>
                        <tbody className="divide-y divide-[#F0F2F5]">
                            {d.reports.map((r) => (
                                <tr key={r.id}>
                                    <td className={`${td} whitespace-nowrap`}>{fmtDateTime(r.createdAt)}</td>
                                    <td className={td}><span className="font-mono text-[12px]">{r.reference}</span></td>
                                    <td className={td}>{label('purposes', r.purpose)}</td>
                                    <td className={`${td} tabular-nums`}>{r.score ?? label('noScoreReasons', r.noScoreReason ?? '')}{r.grade ? ` (${r.grade})` : ''}</td>
                                    <td className={td}>{person(r.requestedBy)}</td>
                                    <td className={td}><Btn size="sm" variant="ghost" busy={busy === `pdf-${r.id}`} onClick={() => openPdf(r.id)}><FileDown size={13} /></Btn></td>
                                </tr>
                            ))}
                        </tbody>
                    </Table>
                </Disclosure>
            )}
        </div>
    );
}

/** The credit report card on the application page. */
export function ApplicationCreditReportCard({ applicationId, borrowerId }: { applicationId: string; borrowerId: string }) {
    const ws = useWorkspace();
    const { t } = useScoringText();
    if (ws.access && !ws.can('credit_report.read')) return null;
    return (
        <Card title={t('creditReport.cardTitle')} subtitle={t('creditReport.cardSubtitle')}>
            <div data-tour="app-credit-report"><CreditReportPanel borrowerId={borrowerId} applicationId={applicationId} /></div>
        </Card>
    );
}

/** The customer's credit report page. */
export function CreditReportView({ borrowerId }: { borrowerId: string }) {
    const { t } = useScoringText();
    return (
        <LendingShell title={t('creditReport.title')} subtitle={t('creditReport.subtitle')} back={{ href: `/borrowers/${borrowerId}`, label: t('altData.customerProfile') }}>
            <Card><CreditReportPanel borrowerId={borrowerId} /></Card>
        </LendingShell>
    );
}
