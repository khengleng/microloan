"use client";

import { useTranslations } from 'next-intl';
import { LendingShell } from '../LendingShell';
import { Card, Empty, ErrorBox, Notice, Spinner, Table, td, tdR, th, thR } from '../ui';
import { useApi } from '../useAsync';
import { fmtMoney } from '../format';
import { AGEING_BANDS, Stat } from './LendingReportsView';

interface Figures {
    activeLoans: number;
    principalOutstanding: string;
    allowance: string;
    ageing: { band: string; amount: string }[];
    par30Pct: string | null;
    par90Pct: string | null;
    allowanceCoveragePct: string | null;
    disbursed: string;
    collected: string;
    writtenOff: string;
    writeOffRatePct: string | null;
    collectionRatePct: string | null;
}
interface Performance {
    businessDate: string;
    reportingCurrency: string;
    borrowers?: number;
    byCurrency: ({ currency: string } & Figures)[];
    totals: Figures | null;
    unconverted: string[];
    income: {
        from: string;
        to: string;
        byCurrency: {
            currency: string;
            accounts: { code: string; name: string; type: string; amount: string }[];
            totalIncome: string;
            totalExpense: string;
            net: string;
        }[];
    } | null;
}

const BAR = ['bg-emerald-500', 'bg-lime-500', 'bg-amber-500', 'bg-orange-500', 'bg-red-500'];
const pct = (v: string | null | undefined) => (v === null || v === undefined ? '—' : `${v}%`);

/** The lending book's performance (D-153): ageing, PAR, ratios and the year's income, from the lending journal. */
export function LendingPerformanceView() {
    const t = useTranslations('LendingReports');
    const { data, error, loading } = useApi<Performance>('/lending/reports/performance');
    const k = data?.totals;
    const cur = data?.reportingCurrency ?? '';
    const gross = Number(k?.principalOutstanding ?? 0);
    return (
        <LendingShell title={t('performanceTitle')} subtitle={t('performanceSubtitle')}>
            <ErrorBox error={error} />
            {loading && !data ? <Spinner /> : data && (
                <>
                    <p className="text-[13px] text-[#697386]">{t('asOf', { date: data.businessDate, currency: cur })}</p>
                    {data.unconverted.length > 0 && <Notice tone="warn">{t('unconverted', { currencies: data.unconverted.join(', '), currency: cur })}</Notice>}
                    {!k ? <Card><Empty>{t('noAccess')}</Empty></Card> : (
                        <>
                            <div className="grid gap-3 grid-cols-2 lg:grid-cols-5">
                                <Stat label={t('principalOutstanding')} value={`${fmtMoney(k.principalOutstanding)} ${cur}`} note={t('activeLoans', { count: k.activeLoans })} />
                                <Stat label={t('borrowers')} value={String(data.borrowers ?? 0)} />
                                <Stat label={t('disbursed')} value={`${fmtMoney(k.disbursed)} ${cur}`} />
                                <Stat label={t('collected')} value={`${fmtMoney(k.collected)} ${cur}`} />
                                <Stat label={t('writtenOff')} value={`${fmtMoney(k.writtenOff)} ${cur}`} />
                            </div>
                            <div className="grid gap-4 lg:grid-cols-2">
                                <Card title={t('ageingTitle')} subtitle={t('ageingSubtitle')} actions={<span className="text-[12px] text-[#697386]">{t('par30')} <b className="text-[#1A1F36]">{pct(k.par30Pct)}</b> · {t('par90')} <b className="text-[#1A1F36]">{pct(k.par90Pct)}</b></span>}>
                                    <div className="space-y-2.5">
                                        {AGEING_BANDS.map((b, i) => {
                                            const amount = Number(k.ageing.find((a) => a.band === b)?.amount ?? 0);
                                            const w = gross > 0 ? Math.max(1, Math.round((amount / gross) * 100)) : 0;
                                            return (
                                                <div key={b} className="flex items-center gap-3">
                                                    <span className="text-[12px] text-[#697386] w-24">{t(`bands.${b}`)}</span>
                                                    <div className="flex-1 h-2.5 bg-slate-100 rounded"><div className={`h-2.5 rounded ${BAR[i]}`} style={{ width: `${amount > 0 ? w : 0}%` }} /></div>
                                                    <span className="text-[12px] font-semibold tabular-nums w-32 text-right">{fmtMoney(String(amount))}</span>
                                                </div>
                                            );
                                        })}
                                    </div>
                                </Card>
                                <Card title={t('ratiosTitle')}>
                                    <dl className="grid grid-cols-2 gap-3 text-[13px]">
                                        <dt className="text-[#697386]">{t('collectionRate')}</dt><dd className="text-right font-semibold">{pct(k.collectionRatePct)}</dd>
                                        <dt className="text-[#697386]">{t('allowanceCoverage')}</dt><dd className="text-right font-semibold">{pct(k.allowanceCoveragePct)}</dd>
                                        <dt className="text-[#697386]">{t('writeOffRate')}</dt><dd className="text-right font-semibold">{pct(k.writeOffRatePct)}</dd>
                                        <dt className="text-[#697386]">{t('allowance')}</dt><dd className="text-right font-semibold">{fmtMoney(k.allowance)} {cur}</dd>
                                    </dl>
                                    <p className="text-[12px] text-[#697386] mt-3">{t('ratiosNote')}</p>
                                </Card>
                            </div>
                            {data.byCurrency.length > 1 && (
                                <Card title={t('byCurrency')} bodyClass="p-0">
                                    <Table>
                                        <thead className="bg-[#F7FAFC] border-b border-[#E3E8EE]">
                                            <tr><th className={th}>{t('currency')}</th><th className={thR}>{t('loans')}</th><th className={thR}>{t('principalOutstanding')}</th><th className={thR}>{t('par30')}</th><th className={thR}>{t('collected')}</th><th className={thR}>{t('collectionRate')}</th></tr>
                                        </thead>
                                        <tbody>
                                            {data.byCurrency.map((c) => (
                                                <tr key={c.currency} className="border-b border-[#F0F2F5]">
                                                    <td className={td}>{c.currency}</td><td className={tdR}>{c.activeLoans}</td><td className={tdR}>{fmtMoney(c.principalOutstanding)}</td>
                                                    <td className={tdR}>{pct(c.par30Pct)}</td><td className={tdR}>{fmtMoney(c.collected)}</td><td className={tdR}>{pct(c.collectionRatePct)}</td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </Table>
                                </Card>
                            )}
                            {data.income ? (
                                <Card title={t('incomeTitle')} subtitle={t('incomeSubtitle', { from: data.income.from, to: data.income.to })} bodyClass="p-0">
                                    {data.income.byCurrency.length === 0 ? <Empty>{t('noIncome')}</Empty> : data.income.byCurrency.map((c) => (
                                        <Table key={c.currency}>
                                            <thead className="bg-[#F7FAFC] border-b border-[#E3E8EE]">
                                                <tr><th className={th}>{t('account', { currency: c.currency })}</th><th className={th}>{t('accountType')}</th><th className={thR}>{t('amount')}</th></tr>
                                            </thead>
                                            <tbody>
                                                {c.accounts.map((a) => (
                                                    <tr key={a.code} className="border-b border-[#F0F2F5]">
                                                        <td className={td}><span className="font-mono">{a.code}</span> {a.name}</td>
                                                        <td className={td}>{a.type === 'INCOME' ? t('income') : t('expense')}</td>
                                                        <td className={tdR}>{a.type === 'EXPENSE' ? '−' : ''}{fmtMoney(a.amount)}</td>
                                                    </tr>
                                                ))}
                                                <tr className="border-b border-[#E3E8EE] font-semibold"><td className={td} colSpan={2}>{t('net')}</td><td className={tdR}>{fmtMoney(c.net)} {c.currency}</td></tr>
                                            </tbody>
                                        </Table>
                                    ))}
                                </Card>
                            ) : (
                                <Notice tone="info">{t('incomeHidden')}</Notice>
                            )}
                        </>
                    )}
                </>
            )}
        </LendingShell>
    );
}
