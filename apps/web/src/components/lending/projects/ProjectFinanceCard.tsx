"use client";

import { useState } from 'react';
import Link from 'next/link';
import api from '@/lib/api';
import { useTranslations } from 'next-intl';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { useLendingHref } from '../LendingShell';
import { ActionPanel, Btn, Card, Disclosure, Empty, ErrorBox, Field, KV, Notice, Table, TextInput, td, tdR, th, thR } from '../ui';
import { clean, idem, useAction, useApi, useIdempotencyKey } from '../useAsync';
import { addDecimal, compareDecimal, fmtMoney, fmtRate, isPositive } from '../format';
import { Money, MoneyCell } from '../MoneyCell';
import { StatusBadge } from '../StatusBadge';

type Can = (code: string) => { allowed: boolean; reason?: string };

interface WaterfallStep { order: number; code: string; label: string; amount: string; informational: boolean; note?: string }
interface WaterfallRun {
    id: string; sequence: number; receivedOn: string; revenue: string; operatingCosts: string; taxes: string; cfads: string;
    periodDebtService: string; dscr: string | null; lockedUp: boolean; seniorDebtService: string; dsraDraw: string; dsraTopUp: string;
    cashSweep: string; lockUpRetained: string; lockUpReleased: string; distribution: string; dsraTarget: string;
    dsraBalanceAfter: string; lockUpBalanceAfter: string; steps: { steps: WaterfallStep[]; lockUpReasons: string[] }; externalReference: string | null;
}
interface SculptedLine { number: number; dueDate: string; cfads: string; openingBalance: string; interest: string; principal: string; debtService: string; dscr: string | null; closingBalance: string }
interface ProjectView {
    project: {
        id: string; status: string; targetDscr: string; lockUpDscr: string | null; dsraMonths: number; cashSweepRate: string | null;
        dsraBalance: string; lockUpBalance: string; lockedUp: boolean; termedOutOn: string | null;
        sculpting: { sculptedDscr: string; minDscr: string | null; averageDscr: string | null; maxDebt: string; lines: SculptedLine[] } | null;
    };
    currency: string; loanStatus: string; principalOutstanding: string; facilityId: string | null; businessDate: string;
    dsraTarget: string | null;
    upcoming: { number: number; dueDate: string; principal: string; interest: string }[];
    runs: WaterfallRun[];
}
interface Preview {
    valueDate: string; cfads: string; dscr: string | null; lockedUp: boolean; lockUpReasons: string[]; shortfall: string;
    dsraTarget: string; dsraBalanceAfter: string; lockUpBalanceAfter: string; steps: WaterfallStep[];
}

const MONEY_RE = /^\d+(\.\d{1,4})?$/;
const ratio = (v: string | null | undefined) => (v ? `${Number(v).toFixed(2)}×` : '—');

/** Horizontal bar share of a step in the period's CFADS (display only). */
function StepBar({ amount, of, tone }: { amount: string; of: string; tone: string }) {
    const pct = isPositive(of) ? Math.max(0, Math.min(100, (Number(amount) / Number(of)) * 100)) : 0;
    return (
        <div className="h-1.5 w-28 rounded bg-slate-100 overflow-hidden">
            <div className={`h-full ${tone}`} style={{ width: `${pct}%` }} />
        </div>
    );
}

const TONE: Record<string, string> = {
    SENIOR_DEBT_SERVICE: 'bg-[#635BFF]', DSRA_DRAW: 'bg-amber-500', DSRA_TOP_UP: 'bg-sky-500', DSRA_RELEASE: 'bg-sky-300',
    CASH_SWEEP: 'bg-indigo-400', LOCK_UP: 'bg-amber-500', LOCK_UP_RELEASE: 'bg-emerald-300', DISTRIBUTION: 'bg-emerald-500',
};

function Steps({ steps, cfads, currency }: { steps: WaterfallStep[]; cfads: string; currency: string }) {
    const t = useTranslations('LendingProjects');
    return (
        <Table>
            <thead><tr className="border-b border-[#E3E8EE] bg-[#F7FAFC]"><th className={th}>#</th><th className={th}>{t('steps.colStep')}</th><th className={thR}>{t('steps.colAmount')}</th><th className={th} /></tr></thead>
            <tbody className="divide-y divide-[#F0F2F5]">
                {steps.map((s) => (
                    <tr key={`${s.order}-${s.code}`} className={s.informational ? 'text-[#8792A2]' : ''}>
                        <td className={td}>{s.order}</td>
                        <td className={td}>{s.label}{s.informational && <span className="ml-1 text-[11px]">{t('steps.informational')}</span>}{s.note && <div className="text-[11px] text-[#697386]">{s.note}</div>}</td>
                        <td className={tdR}><MoneyCell value={s.amount} currency={currency} muted={s.informational} /></td>
                        <td className={td}>{!s.informational && <StepBar amount={s.amount} of={cfads} tone={TONE[s.code] ?? 'bg-slate-400'} />}</td>
                    </tr>
                ))}
            </tbody>
        </Table>
    );
}

/** The DSRA filled against its target, as a bar. */
function ReserveBar({ balance, target }: { balance: string; target: string | null }) {
    const t = useTranslations('LendingProjects');
    if (!target || !isPositive(target)) return null;
    const pct = Math.max(0, Math.min(100, (Number(balance) / Number(target)) * 100));
    const short = compareDecimal(balance, target) < 0;
    return (
        <div className="mt-1.5">
            <div className="h-1.5 rounded bg-slate-100 overflow-hidden"><div className={`h-full ${short ? 'bg-amber-500' : 'bg-emerald-500'}`} style={{ width: `${pct}%` }} /></div>
            <p className="text-[11px] text-[#697386] mt-0.5">{short ? t('reserve.short', { target: fmtMoney(target) }) : t('reserve.atTarget')}</p>
        </div>
    );
}

function ApplyReceiptsPanel({ loanId, currency, can, onDone, onClose }: { loanId: string; currency: string; can: Can; onDone: (m: string) => void; onClose: () => void }) {
    const t = useTranslations('LendingProjects');
    const confirm = useConfirm();
    const [form, setForm] = useState({ revenue: '', operatingCosts: '', taxes: '0', externalReference: '' });
    const [preview, setPreview] = useState<Preview | null>(null);
    const [problem, setProblem] = useState('');
    const { busy, error, run, clearError } = useAction();
    const key = useIdempotencyKey();
    const allowed = can('loan.repayment.post');
    const body = () => clean({ ...form, externalReference: form.externalReference.trim() });
    const valid = () => {
        for (const k of ['revenue', 'operatingCosts', 'taxes'] as const) if (!MONEY_RE.test(form[k].trim())) { setProblem(t('apply.problem')); return false; }
        setProblem('');
        return true;
    };
    const doPreview = async () => {
        if (!valid()) return;
        const r = await run('preview', () => api.post<Preview>(`/lending/loans/${loanId}/project/waterfall-preview`, body()));
        if (r) setPreview(r.data);
    };
    const apply = async () => {
        if (!valid() || !preview) return;
        const ok = await confirm({
            title: t('apply.title'),
            message: t(preview.lockedUp ? 'apply.confirmLocked' : 'apply.confirm', { date: preview.valueDate, currency, cfads: fmtMoney(preview.cfads) }),
            confirmLabel: t('apply.confirmLabel'),
        });
        if (!ok) return;
        const b = body();
        const r = await run('apply', () => api.post<{ run: WaterfallRun; loanClosed: boolean }>(`/lending/loans/${loanId}/project/waterfall`, b, idem(key.keyFor(b))));
        if (r) { key.reset(); onDone(r.data.loanClosed ? t('apply.closed') : t('apply.applied', { sequence: r.data.run.sequence })); }
    };
    const set = (k: keyof typeof form) => (v: string) => { setForm({ ...form, [k]: v }); setPreview(null); };
    return (
        <ActionPanel title={t('apply.title')} onClose={onClose}>
            <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
                <Field label={t('apply.revenue', { currency })} error={problem || undefined}><TextInput value={form.revenue} onChange={set('revenue')} inputMode="decimal" /></Field>
                <Field label={t('apply.operatingCosts')} hint={t('apply.paidByProject')}><TextInput value={form.operatingCosts} onChange={set('operatingCosts')} inputMode="decimal" /></Field>
                <Field label={t('apply.taxes')} hint={t('apply.paidByProject')}><TextInput value={form.taxes} onChange={set('taxes')} inputMode="decimal" /></Field>
                <Field label={t('apply.reference')} hint={t('apply.referenceHint')}><TextInput value={form.externalReference} onChange={set('externalReference')} maxLength={120} /></Field>
            </div>
            <p className="text-[11px] text-[#697386]">{t('apply.note')}</p>
            {preview && (
                <div className="space-y-2">
                    {preview.lockedUp && <Notice tone="warn" title={t('apply.lockUp')}>{preview.lockUpReasons.join('; ')}.</Notice>}
                    <KV cols={4} items={[['CFADS', <Money key="c" value={preview.cfads} currency={currency} />], [t('apply.periodDscr'), ratio(preview.dscr)], [t('apply.reserveAfter'), <Money key="r" value={preview.dsraBalanceAfter} currency={currency} />], [t('apply.reserveTarget'), <Money key="t" value={preview.dsraTarget} currency={currency} />]]} />
                    <Steps steps={preview.steps} cfads={preview.cfads} currency={currency} />
                </div>
            )}
            <ErrorBox error={error} onDismiss={clearError} />
            <div className="flex gap-2">
                <Btn onClick={doPreview} busy={busy === 'preview'}>{t('apply.preview')}</Btn>
                <Btn variant="primary" onClick={apply} busy={busy === 'apply'} disabled={!preview || !allowed.allowed} reason={!preview ? t('apply.previewFirst') : allowed.reason}>{t('applyReceipts')}</Btn>
            </div>
        </ActionPanel>
    );
}

/** Project finance on a loan (LT-17): reserve, lock-up, sculpted profile and the cash waterfall. */
export function ProjectFinanceCard({ loanId, can, onDone }: { loanId: string; can: Can; onDone: (msg: string) => void }) {
    const t = useTranslations('LendingProjects');
    const href = useLendingHref();
    const res = useApi<ProjectView>(`/lending/loans/${loanId}/project`);
    const [applying, setApplying] = useState(false);
    const d = res.data;
    if (!d) return res.error ? <ErrorBox error={res.error} /> : null;
    const p = d.project;
    const cur = d.currency;
    const done = (m: string) => { setApplying(false); res.reload(); onDone(m); };
    return (
        <Card
            title={<span className="flex items-center gap-2">{t('title')} <StatusBadge status={p.status} />{p.lockedUp && <StatusBadge status="LOCKED_UP" />}</span>}
            subtitle={t(p.cashSweepRate ? 'subtitleSweep' : 'subtitle', { target: ratio(p.targetDscr), lockUp: ratio(p.lockUpDscr), months: p.dsraMonths, sweep: p.cashSweepRate ? fmtRate(p.cashSweepRate) : '' })}
            actions={p.status === 'OPERATIONS' && !applying ? <Btn variant="primary" onClick={() => setApplying(true)}>{t('applyReceipts')}</Btn> : undefined}
        >
            <div className="space-y-4">
                {p.status === 'CONSTRUCTION' && (
                    <Notice title={t('construction')}>
                        {t('constructionBody')}{' '}
                        {d.facilityId && <Link href={href(`/lending/facilities/${d.facilityId}`)} className="font-semibold text-[#635BFF] hover:underline">{t('openFacility')}</Link>}
                    </Notice>
                )}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    <div className="border border-[#E3E8EE] rounded-md px-3 py-2"><p className="text-[11px] font-bold uppercase text-[#8792A2]">{t('tile.dsra')}</p><p className="text-[16px] font-bold"><Money value={p.dsraBalance} currency={cur} /></p><ReserveBar balance={p.dsraBalance} target={d.dsraTarget} /></div>
                    <div className="border border-[#E3E8EE] rounded-md px-3 py-2"><p className="text-[11px] font-bold uppercase text-[#8792A2]">{t('tile.lockUp')}</p><p className="text-[16px] font-bold"><Money value={p.lockUpBalance} currency={cur} /></p><p className="text-[11px] text-[#697386]">{p.lockedUp ? t('tile.blocked') : t('tile.released')}</p></div>
                    <div className="border border-[#E3E8EE] rounded-md px-3 py-2"><p className="text-[11px] font-bold uppercase text-[#8792A2]">{t('tile.principal')}</p><p className="text-[16px] font-bold"><Money value={d.principalOutstanding} currency={cur} /></p></div>
                    <div className="border border-[#E3E8EE] rounded-md px-3 py-2"><p className="text-[11px] font-bold uppercase text-[#8792A2]">{t('tile.sculpted')}</p><p className="text-[16px] font-bold">{ratio(p.sculpting?.sculptedDscr)}</p><p className="text-[11px] text-[#697386]">{p.termedOutOn ? t('tile.termedOut', { date: p.termedOutOn }) : t('tile.notTermedOut')}</p></div>
                </div>

                {applying && <ApplyReceiptsPanel loanId={loanId} currency={cur} can={can} onDone={done} onClose={() => setApplying(false)} />}

                {d.upcoming.length > 0 && (
                    <p className="text-[12px] text-[#697386]">{t('nextDebtService')} {d.upcoming.map((u) => `${u.dueDate} ${cur} ${fmtMoney(addDecimal(u.principal, u.interest))}`).slice(0, 2).join(' · ')}</p>
                )}

                {p.sculpting && (
                    <Disclosure summary={t('sculptedProfile', { count: p.sculpting.lines.length, min: ratio(p.sculpting.minDscr) })}>
                        <SculptedTable lines={p.sculpting.lines} currency={cur} />
                    </Disclosure>
                )}

                <div>
                    <p className="text-[13px] font-bold text-[#1A1F36] mb-2">{t('runs.title')}</p>
                    {d.runs.length === 0 ? <Empty>{t('runs.none')}</Empty> : (
                        <Table>
                            <thead><tr className="border-b border-[#E3E8EE] bg-[#F7FAFC]"><th className={th}>#</th><th className={th}>{t('runs.colDate')}</th><th className={thR}>CFADS</th><th className={th}>DSCR</th><th className={thR}>{t('runs.colDebtService')}</th><th className={thR}>{t('runs.colReserve')}</th><th className={thR}>{t('runs.colSweep')}</th><th className={thR}>{t('runs.colLockUp')}</th><th className={thR}>{t('runs.colDistributed')}</th></tr></thead>
                            <tbody className="divide-y divide-[#F0F2F5]">
                                {d.runs.map((r) => (
                                    <tr key={r.id} className="align-top">
                                        <td className={td}>{r.sequence}</td>
                                        <td className={`${td} whitespace-nowrap`}>{r.receivedOn}{r.lockedUp && <div><StatusBadge status="LOCKED_UP" /></div>}</td>
                                        <td className={tdR}><MoneyCell value={r.cfads} /></td>
                                        <td className={td}>{ratio(r.dscr)}</td>
                                        <td className={tdR}><MoneyCell value={r.seniorDebtService} />{isPositive(r.dsraDraw) && <div className="text-[11px] text-amber-700">{t('runs.fromReserve', { amount: fmtMoney(r.dsraDraw) })}</div>}</td>
                                        <td className={tdR}><MoneyCell value={r.dsraTopUp} /><div className="text-[11px] text-[#697386]">→ {fmtMoney(r.dsraBalanceAfter)}</div></td>
                                        <td className={tdR}><MoneyCell value={r.cashSweep} /></td>
                                        <td className={tdR}><MoneyCell value={r.lockUpRetained} highlightNonZero />{isPositive(r.lockUpReleased) && <div className="text-[11px] text-emerald-700">{t('runs.released', { amount: fmtMoney(r.lockUpReleased) })}</div>}</td>
                                        <td className={tdR}><MoneyCell value={r.distribution} strong /></td>
                                    </tr>
                                ))}
                            </tbody>
                        </Table>
                    )}
                    {d.runs[0] && (
                        <div className="mt-2">
                            <Disclosure summary={t('runs.latestSteps', { date: d.runs[0].receivedOn })}>
                                <Steps steps={d.runs[0].steps.steps} cfads={d.runs[0].cfads} currency={cur} />
                            </Disclosure>
                        </div>
                    )}
                </div>
            </div>
            <ErrorBox error={res.error} />
        </Card>
    );
}

export function SculptedTable({ lines, currency }: { lines: SculptedLine[]; currency: string }) {
    const t = useTranslations('LendingProjects.sculpted');
    return (
        <Table>
            <thead><tr className="border-b border-[#E3E8EE] bg-[#F7FAFC]"><th className={th}>#</th><th className={th}>{t('colDue')}</th><th className={thR}>CFADS</th><th className={thR}>{t('colOpening')}</th><th className={thR}>{t('colInterest')}</th><th className={thR}>{t('colPrincipal')}</th><th className={thR}>{t('colDebtService')}</th><th className={th}>DSCR</th><th className={thR}>{t('colClosing')}</th></tr></thead>
            <tbody className="divide-y divide-[#F0F2F5]">
                {lines.map((l) => (
                    <tr key={l.number}>
                        <td className={td}>{l.number}</td>
                        <td className={`${td} whitespace-nowrap`}>{l.dueDate}</td>
                        <td className={tdR}><MoneyCell value={l.cfads} currency={currency} /></td>
                        <td className={tdR}><MoneyCell value={l.openingBalance} /></td>
                        <td className={tdR}><MoneyCell value={l.interest} /></td>
                        <td className={tdR}><MoneyCell value={l.principal} /></td>
                        <td className={tdR}><MoneyCell value={l.debtService} strong /></td>
                        <td className={td}>{ratio(l.dscr)}</td>
                        <td className={tdR}><MoneyCell value={l.closingBalance} /></td>
                    </tr>
                ))}
            </tbody>
        </Table>
    );
}
