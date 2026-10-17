"use client";

import { useState } from 'react';
import Link from 'next/link';
import api from '@/lib/api';
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
    return (
        <Table>
            <thead><tr className="border-b border-[#E3E8EE] bg-[#F7FAFC]"><th className={th}>#</th><th className={th}>Step</th><th className={thR}>Amount</th><th className={th} /></tr></thead>
            <tbody className="divide-y divide-[#F0F2F5]">
                {steps.map((s) => (
                    <tr key={`${s.order}-${s.code}`} className={s.informational ? 'text-[#8792A2]' : ''}>
                        <td className={td}>{s.order}</td>
                        <td className={td}>{s.label}{s.informational && <span className="ml-1 text-[11px]">(paid by the project; information)</span>}{s.note && <div className="text-[11px] text-[#697386]">{s.note}</div>}</td>
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
    if (!target || !isPositive(target)) return null;
    const pct = Math.max(0, Math.min(100, (Number(balance) / Number(target)) * 100));
    const short = compareDecimal(balance, target) < 0;
    return (
        <div className="mt-1.5">
            <div className="h-1.5 rounded bg-slate-100 overflow-hidden"><div className={`h-full ${short ? 'bg-amber-500' : 'bg-emerald-500'}`} style={{ width: `${pct}%` }} /></div>
            <p className="text-[11px] text-[#697386] mt-0.5">{short ? `${fmtMoney(target)} target — short` : 'At target'}</p>
        </div>
    );
}

function ApplyReceiptsPanel({ loanId, currency, can, onDone, onClose }: { loanId: string; currency: string; can: Can; onDone: (m: string) => void; onClose: () => void }) {
    const confirm = useConfirm();
    const [form, setForm] = useState({ revenue: '', operatingCosts: '', taxes: '0', externalReference: '' });
    const [preview, setPreview] = useState<Preview | null>(null);
    const [problem, setProblem] = useState('');
    const { busy, error, run, clearError } = useAction();
    const key = useIdempotencyKey();
    const allowed = can('loan.repayment.post');
    const body = () => clean({ ...form, externalReference: form.externalReference.trim() });
    const valid = () => {
        for (const k of ['revenue', 'operatingCosts', 'taxes'] as const) if (!MONEY_RE.test(form[k].trim())) { setProblem('Enter revenue, operating costs and taxes as decimal amounts.'); return false; }
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
            title: 'Apply project receipts',
            message: `Post the waterfall for ${preview.valueDate}: CFADS ${currency} ${fmtMoney(preview.cfads)}${preview.lockedUp ? ' — the project is in lock-up, so nothing is distributed' : ''}?`,
            confirmLabel: 'Apply',
        });
        if (!ok) return;
        const b = body();
        const r = await run('apply', () => api.post<{ run: WaterfallRun; loanClosed: boolean }>(`/lending/loans/${loanId}/project/waterfall`, b, idem(key.keyFor(b))));
        if (r) { key.reset(); onDone(r.data.loanClosed ? 'Receipts applied — the loan is repaid and the project closed' : `Receipts applied (run #${r.data.run.sequence})`); }
    };
    const set = (k: keyof typeof form) => (v: string) => { setForm({ ...form, [k]: v }); setPreview(null); };
    return (
        <ActionPanel title="Apply project receipts" onClose={onClose}>
            <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
                <Field label={`Revenue (${currency})`} error={problem || undefined}><TextInput value={form.revenue} onChange={set('revenue')} inputMode="decimal" /></Field>
                <Field label="Operating costs" hint="Paid by the project"><TextInput value={form.operatingCosts} onChange={set('operatingCosts')} inputMode="decimal" /></Field>
                <Field label="Taxes" hint="Paid by the project"><TextInput value={form.taxes} onChange={set('taxes')} inputMode="decimal" /></Field>
                <Field label="Reference" hint="Proceeds account statement"><TextInput value={form.externalReference} onChange={set('externalReference')} maxLength={120} /></Field>
            </div>
            <p className="text-[11px] text-[#697386]">Applied on the business date, in order: senior debt service, reserve top-up, cash sweep, then distribution — held in lock-up when cover is below the threshold or the reserve is short.</p>
            {preview && (
                <div className="space-y-2">
                    {preview.lockedUp && <Notice tone="warn" title="Lock-up">{preview.lockUpReasons.join('; ')}.</Notice>}
                    <KV cols={4} items={[['CFADS', <Money key="c" value={preview.cfads} currency={currency} />], ['Period DSCR', ratio(preview.dscr)], ['Reserve after', <Money key="r" value={preview.dsraBalanceAfter} currency={currency} />], ['Reserve target', <Money key="t" value={preview.dsraTarget} currency={currency} />]]} />
                    <Steps steps={preview.steps} cfads={preview.cfads} currency={currency} />
                </div>
            )}
            <ErrorBox error={error} onDismiss={clearError} />
            <div className="flex gap-2">
                <Btn onClick={doPreview} busy={busy === 'preview'}>Preview waterfall</Btn>
                <Btn variant="primary" onClick={apply} busy={busy === 'apply'} disabled={!preview || !allowed.allowed} reason={!preview ? 'Preview first' : allowed.reason}>Apply receipts</Btn>
            </div>
        </ActionPanel>
    );
}

/** Project finance on a loan (LT-17): reserve, lock-up, sculpted profile and the cash waterfall. */
export function ProjectFinanceCard({ loanId, can, onDone }: { loanId: string; can: Can; onDone: (msg: string) => void }) {
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
            title={<span className="flex items-center gap-2">Project finance <StatusBadge status={p.status} />{p.lockedUp && <StatusBadge status="LOCKED_UP" />}</span>}
            subtitle={`Sculpted to a ${ratio(p.targetDscr)} DSCR · lock-up below ${ratio(p.lockUpDscr)} · reserve of ${p.dsraMonths} months' debt service${p.cashSweepRate ? ` · ${fmtRate(p.cashSweepRate)} cash sweep` : ''}`}
            actions={p.status === 'OPERATIONS' && !applying ? <Btn variant="primary" onClick={() => setApplying(true)}>Apply receipts</Btn> : undefined}
        >
            <div className="space-y-4">
                {p.status === 'CONSTRUCTION' && (
                    <Notice title="In construction">
                        Tranches are drawn and construction interest capitalized on the facility. When availability ends, generate the last statement and term it out on a profile sculpted to the projected CFADS.{' '}
                        {d.facilityId && <Link href={href(`/lending/facilities/${d.facilityId}`)} className="font-semibold text-[#635BFF] hover:underline">Open the facility →</Link>}
                    </Notice>
                )}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    <div className="border border-[#E3E8EE] rounded-md px-3 py-2"><p className="text-[11px] font-bold uppercase text-[#8792A2]">Debt service reserve</p><p className="text-[16px] font-bold"><Money value={p.dsraBalance} currency={cur} /></p><ReserveBar balance={p.dsraBalance} target={d.dsraTarget} /></div>
                    <div className="border border-[#E3E8EE] rounded-md px-3 py-2"><p className="text-[11px] font-bold uppercase text-[#8792A2]">Held in lock-up</p><p className="text-[16px] font-bold"><Money value={p.lockUpBalance} currency={cur} /></p><p className="text-[11px] text-[#697386]">{p.lockedUp ? 'Distributions blocked' : 'Released with the next distribution'}</p></div>
                    <div className="border border-[#E3E8EE] rounded-md px-3 py-2"><p className="text-[11px] font-bold uppercase text-[#8792A2]">Principal outstanding</p><p className="text-[16px] font-bold"><Money value={d.principalOutstanding} currency={cur} /></p></div>
                    <div className="border border-[#E3E8EE] rounded-md px-3 py-2"><p className="text-[11px] font-bold uppercase text-[#8792A2]">Sculpted DSCR</p><p className="text-[16px] font-bold">{ratio(p.sculpting?.sculptedDscr)}</p><p className="text-[11px] text-[#697386]">{p.termedOutOn ? `Termed out ${p.termedOutOn}` : 'Not termed out'}</p></div>
                </div>

                {applying && <ApplyReceiptsPanel loanId={loanId} currency={cur} can={can} onDone={done} onClose={() => setApplying(false)} />}

                {d.upcoming.length > 0 && (
                    <p className="text-[12px] text-[#697386]">Next debt service: {d.upcoming.map((u) => `${u.dueDate} ${cur} ${fmtMoney(addDecimal(u.principal, u.interest))}`).slice(0, 2).join(' · ')}</p>
                )}

                {p.sculpting && (
                    <Disclosure summary={`Sculpted repayment profile (${p.sculpting.lines.length} periods, minimum DSCR ${ratio(p.sculpting.minDscr)})`}>
                        <SculptedTable lines={p.sculpting.lines} currency={cur} />
                    </Disclosure>
                )}

                <div>
                    <p className="text-[13px] font-bold text-[#1A1F36] mb-2">Waterfall runs</p>
                    {d.runs.length === 0 ? <Empty>No receipts applied yet.</Empty> : (
                        <Table>
                            <thead><tr className="border-b border-[#E3E8EE] bg-[#F7FAFC]"><th className={th}>#</th><th className={th}>Date</th><th className={thR}>CFADS</th><th className={th}>DSCR</th><th className={thR}>Debt service</th><th className={thR}>Reserve ±</th><th className={thR}>Sweep</th><th className={thR}>Lock-up ±</th><th className={thR}>Distributed</th></tr></thead>
                            <tbody className="divide-y divide-[#F0F2F5]">
                                {d.runs.map((r) => (
                                    <tr key={r.id} className="align-top">
                                        <td className={td}>{r.sequence}</td>
                                        <td className={`${td} whitespace-nowrap`}>{r.receivedOn}{r.lockedUp && <div><StatusBadge status="LOCKED_UP" /></div>}</td>
                                        <td className={tdR}><MoneyCell value={r.cfads} /></td>
                                        <td className={td}>{ratio(r.dscr)}</td>
                                        <td className={tdR}><MoneyCell value={r.seniorDebtService} />{isPositive(r.dsraDraw) && <div className="text-[11px] text-amber-700">{fmtMoney(r.dsraDraw)} from reserve</div>}</td>
                                        <td className={tdR}><MoneyCell value={r.dsraTopUp} /><div className="text-[11px] text-[#697386]">→ {fmtMoney(r.dsraBalanceAfter)}</div></td>
                                        <td className={tdR}><MoneyCell value={r.cashSweep} /></td>
                                        <td className={tdR}><MoneyCell value={r.lockUpRetained} highlightNonZero />{isPositive(r.lockUpReleased) && <div className="text-[11px] text-emerald-700">−{fmtMoney(r.lockUpReleased)} released</div>}</td>
                                        <td className={tdR}><MoneyCell value={r.distribution} strong /></td>
                                    </tr>
                                ))}
                            </tbody>
                        </Table>
                    )}
                    {d.runs[0] && (
                        <div className="mt-2">
                            <Disclosure summary={`Steps of the latest run (${d.runs[0].receivedOn})`}>
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
    return (
        <Table>
            <thead><tr className="border-b border-[#E3E8EE] bg-[#F7FAFC]"><th className={th}>#</th><th className={th}>Due</th><th className={thR}>CFADS</th><th className={thR}>Opening</th><th className={thR}>Interest</th><th className={thR}>Principal</th><th className={thR}>Debt service</th><th className={th}>DSCR</th><th className={thR}>Closing</th></tr></thead>
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
