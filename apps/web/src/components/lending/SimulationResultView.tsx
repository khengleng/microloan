import { useTranslations } from 'next-intl';
import type { SimulationResult } from './types';
import { Card, Disclosure, IssueList, JsonBlock, KV, Notice, Table, th, thR, td, tdR } from './ui';
import { Money, MoneyCell, Rate } from './MoneyCell';
import { ScheduleTable, rowsFromSimulation } from './ScheduleTable';
import { StatusBadge } from './StatusBadge';

/** Full rendering of a product/application pricing simulation. */
export function SimulationResultView({ result, currency }: { result: SimulationResult; currency?: string }) {
    const s = result.schedule;
    const cur = currency ?? s.currency;
    const t = useTranslations('LendingShared.simulation');
    return (
        <div className="space-y-4">
            <Notice tone="info" title={t('onlyTitle')}>{t('onlyBody')}</Notice>
            {!result.termsCheck.ok && (
                <Notice tone="warn" title={t('rejectedTerms')}>
                    <IssueList issues={result.termsCheck.issues} />
                </Notice>
            )}
            {s.hasProjectedAmounts && (
                <Notice tone="warn" title={t('projectedTitle')}>{t('projectedBody')}</Notice>
            )}

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <Card title={t('summary')}>
                    <KV cols={2} items={[
                        [t('instalment'), s.instalmentAmount ? <Money key="i" value={s.instalmentAmount} currency={cur} /> : t('varies')],
                        [t('eir'), result.effectiveAnnualRate ? <b key="e"><Rate value={result.effectiveAnnualRate} /></b> : '—'],
                        [t('totalPrincipal'), <Money key="p" value={s.totals.principal} currency={cur} />],
                        [t('totalInterest'), <Money key="t" value={s.totals.interest} currency={cur} />],
                        [t('capitalizedInterest'), <Money key="c" value={s.totals.capitalizedInterest} currency={cur} />],
                        [t('totalPayments'), <b key="tp"><Money value={s.totals.payments} currency={cur} /></b>],
                        [t('maturityDate'), s.maturityDate],
                        [t('finalResidual'), s.finalResidual ?? '—'],
                    ]} />
                </Card>
                <Card title={t('howCalculated')}>
                    <ul className="list-disc pl-5 space-y-1 text-[13px] text-[#3C4257]">
                        {s.explanation.map((e, i) => <li key={i}>{e}</li>)}
                    </ul>
                </Card>
            </div>

            <Card title={t('upfrontFees')} bodyClass="p-0">
                {result.fees.lines.length === 0 ? <p className="p-4 text-[13px] text-[#697386]">{t('noFees')}</p> : (
                    <Table>
                        <thead>
                            <tr className="border-b border-[#E3E8EE] bg-[#F7FAFC]">
                                <th className={th}>{t('fee')}</th><th className={th}>{t('treatment')}</th><th className={thR}>{t('amount')}</th><th className={thR}>{t('tax')}</th><th className={th}></th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-[#F0F2F5]">
                            {result.fees.lines.map((f) => (
                                <tr key={f.code}>
                                    <td className={td}>{f.name ?? f.code} <span className="font-mono text-[10px] text-[#8792A2]">{f.code}</span></td>
                                    <td className={td}><StatusBadge status={f.treatment} /></td>
                                    <td className={tdR}><MoneyCell value={f.amount} /></td>
                                    <td className={tdR}><MoneyCell value={f.tax ?? '0'} /></td>
                                    <td className={td}>{f.waived && <StatusBadge status="WAIVED" />}</td>
                                </tr>
                            ))}
                        </tbody>
                    </Table>
                )}
                <div className="p-4 border-t border-[#E3E8EE]">
                    <KV cols={4} items={[
                        [t('financed'), <Money key="f" value={result.fees.financed} />],
                        [t('deducted'), <Money key="d" value={result.fees.deducted} />],
                        [t('separate'), <Money key="s" value={result.fees.separate} />],
                        [t('bookedPrincipal'), <b key="b"><Money value={result.fees.bookedPrincipal} /></b>],
                        [t('netDisbursement'), <b key="n"><Money value={result.fees.netDisbursement} /></b>],
                    ]} />
                </div>
            </Card>

            <Card title={t('schedule', { count: s.lines.length })} bodyClass="p-0">
                <ScheduleTable rows={rowsFromSimulation(s.lines)} currency={cur} chargesLabel={t('capitalized')} />
            </Card>

            {result.calculationRecord !== undefined && (
                <Disclosure summary={t('calcRecord')}>
                    <JsonBlock value={result.calculationRecord} />
                </Disclosure>
            )}
        </div>
    );
}
