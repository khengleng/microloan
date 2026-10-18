import { AlertTriangle, CheckCircle2, HelpCircle, TrendingUp, XCircle } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { BalanceSnapshot, RestructureCalculation, RestructureComparison } from '../types';
import { MoneyCell } from '../MoneyCell';
import { ScheduleTable, rowsFromProposal } from '../ScheduleTable';
import { isPositive } from '../format';
import { Disclosure, JsonBlock, KV, Table, td, tdR, th, thR } from '../ui';

/** The parts of a simulation / proposal needed to render it. */
export interface SimulationLike {
    snapshot: BalanceSnapshot;
    calculation: RestructureCalculation;
    comparison: RestructureComparison;
    affordability?: { fits: boolean | null; message: string } | null;
    policyExceptions?: string[] | null;
    requiredFlags?: string[] | null;
    concessions?: unknown;
}

export function SnapshotView({ snapshot }: { snapshot: BalanceSnapshot }) {
    const t = useTranslations('LendingRestructure.simulation');
    const c = snapshot.currency;
    const m = (v: string) => <MoneyCell value={v} currency={c} />;
    return (
        <div>
            <p className="text-[11px] font-bold uppercase tracking-wide text-[#8792A2] mb-2">{t('snapshotTitle', { date: snapshot.asOf })}</p>
            <KV cols={4} items={[
                [t('snapshot.principal'), m(snapshot.principal)],
                [t('snapshot.overduePrincipal'), <MoneyCell key="op" value={snapshot.overduePrincipal} currency={c} highlightNonZero />],
                [t('snapshot.overdueInterest'), <MoneyCell key="oi" value={snapshot.overdueInterest} currency={c} highlightNonZero />],
                [t('snapshot.accruedNotDue'), m(snapshot.accruedInterestNotDue)],
                [t('snapshot.fees'), m(snapshot.fees)],
                [t('snapshot.penalties'), m(snapshot.penalties)],
                [t('snapshot.taxes'), m(snapshot.taxes)],
                [t('snapshot.unallocated'), m(snapshot.unallocatedPayments)],
            ]} />
        </div>
    );
}

export function ComparisonTable({ comparison, currency }: { comparison: RestructureComparison; currency?: string }) {
    const t = useTranslations('LendingRestructure.simulation');
    const { original: o, proposed: p } = comparison;
    const row = (label: string, a: React.ReactNode, b: React.ReactNode, emphasize?: boolean) => (
        <tr className={emphasize ? 'bg-amber-50/60' : ''}>
            <td className={`${td} font-semibold`}>{label}</td>
            <td className={tdR}>{a}</td>
            <td className={tdR}>{b}</td>
        </tr>
    );
    const costUp = comparison.lowerInstalmentHigherCost;
    return (
        <Table>
            <thead>
                <tr className="border-b border-[#E3E8EE] bg-[#F7FAFC]">
                    <th className={th}>{currency ? t('amountsIn', { currency }) : ''}</th><th className={thR}>{t('original')}</th><th className={thR}>{t('proposed')}</th>
                </tr>
            </thead>
            <tbody className="divide-y divide-[#F0F2F5]">
                {row(t('rows.instalment'), o.instalment ? <MoneyCell value={o.instalment} /> : t('varies'), p.instalment ? <MoneyCell value={p.instalment} strong /> : t('varies'))}
                {row(t('rows.maturityDate'), o.maturityDate ?? '—', <b key="m">{p.maturityDate}</b>)}
                {row(t('rows.totalPayments'), <MoneyCell value={o.totalFuturePayments} />, <MoneyCell value={p.totalFuturePayments} strong />, costUp)}
                {row(t('rows.totalInterest'), <MoneyCell value={o.totalFutureInterestAndCharges} />, <MoneyCell value={p.totalFutureInterestAndCharges} strong />, costUp)}
                {row(t('rows.balloon'), <MoneyCell value={o.balloon} />, <MoneyCell value={p.balloon} />)}
                {row(t('rows.payableAtEffective'), '—', <MoneyCell value={p.payableAtEffectiveDate} highlightNonZero />)}
                {row(t('rows.capitalized'), '—', <MoneyCell value={comparison.capitalized} />)}
                {row(t('rows.waived'), '—', <MoneyCell value={comparison.waived} />)}
                {row(t('rows.forgiven'), '—', <MoneyCell value={comparison.forgiven} />)}
            </tbody>
        </Table>
    );
}

/** The "lower instalment, higher total cost" warning — must not be missed. */
export function HigherCostBanner() {
    const t = useTranslations('LendingRestructure.simulation');
    return (
        <div className="flex items-start gap-3 rounded-lg border-2 border-amber-400 bg-amber-50 px-4 py-3 text-amber-900" role="alert">
            <TrendingUp size={22} className="shrink-0 mt-0.5 text-amber-600" />
            <div>
                <p className="text-[14px] font-extrabold">{t('higherCostTitle')}</p>
                <p className="text-[12px]">{t('higherCostBody')}</p>
            </div>
        </div>
    );
}

export function AffordabilityFit({ affordability }: { affordability: { fits: boolean | null; message: string } | null | undefined }) {
    const t = useTranslations('LendingRestructure.simulation');
    if (!affordability) return null;
    const { fits, message } = affordability;
    const cls = fits === true ? 'bg-emerald-50 border-emerald-200 text-emerald-900' : fits === false ? 'bg-red-50 border-red-300 text-red-900' : 'bg-slate-50 border-slate-200 text-slate-700';
    const Icon = fits === true ? CheckCircle2 : fits === false ? XCircle : HelpCircle;
    const title = fits === true ? t('fits') : fits === false ? t('doesNotFit') : t('noAssessment');
    return (
        <div className={`flex items-start gap-2 rounded-md border px-4 py-2.5 text-[13px] ${cls}`}>
            <Icon size={16} className="shrink-0 mt-0.5" />
            <div><p className="font-bold">{title}</p><p>{message}</p></div>
        </div>
    );
}

export function WarningsView({ sim }: { sim: SimulationLike }) {
    const t = useTranslations('LendingRestructure.simulation');
    const warnings = sim.comparison.warnings ?? [];
    const exceptions = sim.policyExceptions ?? sim.calculation.policyExceptions ?? [];
    const flags = sim.requiredFlags ?? [];
    return (
        <div className="space-y-2">
            {sim.comparison.lowerInstalmentHigherCost && <HigherCostBanner />}
            <AffordabilityFit affordability={sim.affordability} />
            {warnings.length > 0 && (
                <div className="border border-amber-200 bg-amber-50 rounded-md px-4 py-2.5 text-[13px] text-amber-900">
                    <p className="font-bold flex items-center gap-1.5"><AlertTriangle size={14} /> {t('warnings')}</p>
                    <ul className="list-disc pl-5 mt-1 space-y-0.5">{warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>
                </div>
            )}
            {exceptions.length > 0 && (
                <div className="border border-red-200 bg-red-50 rounded-md px-4 py-2.5 text-[13px] text-red-900">
                    <p className="font-bold">{t('policyExceptions')}</p>
                    <ul className="list-disc pl-5 mt-1 space-y-0.5">{exceptions.map((w, i) => <li key={i}>{w}</li>)}</ul>
                </div>
            )}
            {flags.length > 0 && (
                <p className="text-[12px] text-[#3C4257]">
                    <span className="font-semibold">{t('requiredFlags')}</span>{' '}
                    {flags.map((f) => <span key={f} className="inline-block font-mono text-[11px] bg-[#F0F5FF] border border-[#C9D7FF] text-[#4B45C6] rounded px-1.5 mr-1">{f}</span>)}
                </p>
            )}
        </div>
    );
}

/** Full simulation / proposal view: snapshot, comparison, warnings, explanation and schedule. */
export function SimulationView({ sim, showSnapshot = true }: { sim: SimulationLike; showSnapshot?: boolean }) {
    const t = useTranslations('LendingRestructure.simulation');
    const calc = sim.calculation;
    const currency = sim.snapshot?.currency;
    const cv = calc.concessionValue;
    return (
        <div className="space-y-4">
            <WarningsView sim={sim} />
            {showSnapshot && sim.snapshot && <SnapshotView snapshot={sim.snapshot} />}
            <div>
                <p className="text-[11px] font-bold uppercase tracking-wide text-[#8792A2] mb-2">{t('originalVsProposed')}</p>
                <ComparisonTable comparison={sim.comparison} currency={currency} />
            </div>
            <KV cols={3} items={[
                [t('newPrincipal'), <MoneyCell key="np" value={calc.newPrincipal} currency={currency} strong />],
                [t('termSolution'), calc.termSolution ? t('termSolutionValue', { method: calc.termSolution.method.replace(/_/g, ' '), count: calc.termSolution.instalments, detail: calc.termSolution.detail }) : '—'],
                [t('concessionValue'), cv ? (
                    <span key="cv">
                        <MoneyCell value={cv.total} currency={currency} strong />
                        {(isPositive(cv.rateReduction) || isPositive(cv.futureInterestWaived)) && (
                            <span className="block text-[11px] text-[#697386]">{t('concessionDetail', { rate: cv.rateReduction, waived: cv.futureInterestWaived })}</span>
                        )}
                    </span>
                ) : '—'],
            ]} />
            {(calc.explanation?.length ?? 0) > 0 && (
                <div>
                    <p className="text-[11px] font-bold uppercase tracking-wide text-[#8792A2] mb-1">{t('howCalculated')}</p>
                    <ul className="list-disc pl-5 text-[12px] text-[#3C4257] space-y-0.5">{calc.explanation.map((e, i) => <li key={i}>{e}</li>)}</ul>
                </div>
            )}
            <div>
                <p className="text-[11px] font-bold uppercase tracking-wide text-[#8792A2] mb-1">{t('proposedSchedule')}</p>
                <ScheduleTable rows={rowsFromProposal(calc.lines ?? [])} currency={currency} chargesLabel={t('deferredArrears')} showStatus={false} />
            </div>
            {sim.concessions !== undefined && sim.concessions !== null && (
                <Disclosure summary={t('concessionsRaw')}><JsonBlock value={sim.concessions} /></Disclosure>
            )}
        </div>
    );
}
