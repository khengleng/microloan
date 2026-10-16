import type { SimulationResult } from './types';
import { Card, Disclosure, IssueList, JsonBlock, KV, Notice, Table, th, thR, td, tdR } from './ui';
import { Money, MoneyCell, Rate } from './MoneyCell';
import { ScheduleTable, rowsFromSimulation } from './ScheduleTable';
import { StatusBadge } from './StatusBadge';

/** Full rendering of a product/application pricing simulation. */
export function SimulationResultView({ result, currency }: { result: SimulationResult; currency?: string }) {
    const s = result.schedule;
    const cur = currency ?? s.currency;
    return (
        <div className="space-y-4">
            <Notice tone="info" title="Simulation only">Nothing has been booked or posted. Amounts are computed by the lending engine from the selected product version.</Notice>
            {!result.termsCheck.ok && (
                <Notice tone="warn" title="These terms would be rejected by the product rules">
                    <IssueList issues={result.termsCheck.issues} />
                </Notice>
            )}
            {s.hasProjectedAmounts && (
                <Notice tone="warn" title="Contains projected amounts">Some instalments depend on a future rate observation; projected rows are highlighted.</Notice>
            )}

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <Card title="Summary">
                    <KV cols={2} items={[
                        ['Instalment', s.instalmentAmount ? <Money key="i" value={s.instalmentAmount} currency={cur} /> : 'varies'],
                        ['Effective annual rate (EIR)', result.effectiveAnnualRate ? <b key="e"><Rate value={result.effectiveAnnualRate} /></b> : '—'],
                        ['Total principal', <Money key="p" value={s.totals.principal} currency={cur} />],
                        ['Total interest', <Money key="t" value={s.totals.interest} currency={cur} />],
                        ['Capitalized interest', <Money key="c" value={s.totals.capitalizedInterest} currency={cur} />],
                        ['Total payments', <b key="tp"><Money value={s.totals.payments} currency={cur} /></b>],
                        ['Maturity date', s.maturityDate],
                        ['Final residual (rounding)', s.finalResidual ?? '—'],
                    ]} />
                </Card>
                <Card title="How this was calculated">
                    <ul className="list-disc pl-5 space-y-1 text-[13px] text-[#3C4257]">
                        {s.explanation.map((e, i) => <li key={i}>{e}</li>)}
                    </ul>
                </Card>
            </div>

            <Card title="Up-front fees" bodyClass="p-0">
                {result.fees.lines.length === 0 ? <p className="p-4 text-[13px] text-[#697386]">No up-front fees.</p> : (
                    <Table>
                        <thead>
                            <tr className="border-b border-[#E3E8EE] bg-[#F7FAFC]">
                                <th className={th}>Fee</th><th className={th}>Treatment</th><th className={thR}>Amount</th><th className={thR}>Tax</th><th className={th}></th>
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
                        ['Financed (added to principal)', <Money key="f" value={result.fees.financed} />],
                        ['Deducted from payout', <Money key="d" value={result.fees.deducted} />],
                        ['Paid separately', <Money key="s" value={result.fees.separate} />],
                        ['Booked principal', <b key="b"><Money value={result.fees.bookedPrincipal} /></b>],
                        ['Net disbursement', <b key="n"><Money value={result.fees.netDisbursement} /></b>],
                    ]} />
                </div>
            </Card>

            <Card title={`Schedule (${s.lines.length} instalments)`} bodyClass="p-0">
                <ScheduleTable rows={rowsFromSimulation(s.lines)} currency={cur} chargesLabel="Capitalized" />
            </Card>

            {result.calculationRecord !== undefined && (
                <Disclosure summary="Calculation record (inputs, engine version, config hash)">
                    <JsonBlock value={result.calculationRecord} />
                </Disclosure>
            )}
        </div>
    );
}
