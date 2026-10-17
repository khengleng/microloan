"use client";

import { useState } from 'react';
import api from '@/lib/api';
import { Btn, Card, Empty, ErrorBox, Field, SelectInput, Table, TextInput, td, th } from '../ui';
import { useAction, useApi } from '../useAsync';
import { StatusBadge } from '../StatusBadge';

interface CovenantTest { id: string; testedOn: string; periodEnd: string; value: string | null; passed: boolean; kind: string; evidence: string }
interface Covenant {
    id: string; type: 'MIN_DSCR' | 'MAX_LTV' | 'FINANCIAL_STATEMENTS' | 'MAX_LEVERAGE' | 'MIN_INTEREST_COVER'; threshold: string | null; frequencyMonths: number;
    nextTestOn: string; status: string; description: string; testOverdue: boolean; tests: CovenantTest[];
}

const LABEL: Record<Covenant['type'], string> = {
    MIN_DSCR: 'Minimum DSCR', MAX_LTV: 'Maximum LTV', MAX_LEVERAGE: 'Maximum net leverage (net debt / EBITDA)',
    MIN_INTEREST_COVER: 'Minimum interest cover (EBITDA / interest)', FINANCIAL_STATEMENTS: 'Financial statements',
};
const isMax = (t: Covenant['type']) => t === 'MAX_LTV' || t === 'MAX_LEVERAGE';
const HINT: Record<Covenant['type'], string> = { MIN_DSCR: 'e.g. 1.25', MAX_LTV: 'e.g. 0.70', MAX_LEVERAGE: 'e.g. 3.50', MIN_INTEREST_COVER: 'e.g. 3.00', FINANCIAL_STATEMENTS: '' };

/** Covenants on a commercial loan, their tests, breaches and waivers (LT-16). */
export function CovenantsCard({ loanId, can }: { loanId: string; can: (code: string) => { allowed: boolean; reason?: string } }) {
    const list = useApi<Covenant[]>(`/lending/loans/${loanId}/covenants`);
    const [form, setForm] = useState({ type: 'MIN_DSCR', threshold: '1.25', frequencyMonths: '12', description: '' });
    const [testing, setTesting] = useState<{ id: string; periodEnd: string; noi: string; ds: string; received: string; evidence: string; ebitda: string; debt: string; cash: string; interest: string } | null>(null);
    const [waiving, setWaiving] = useState<{ id: string; reason: string } | null>(null);
    const { busy, error, run, clearError } = useAction();
    const manage = can('loan.repayment.post');
    const waive = can('loan.repayment.reverse');

    const add = async () => {
        const body = {
            type: form.type,
            ...(form.type !== 'FINANCIAL_STATEMENTS' ? { threshold: form.threshold.trim() } : {}),
            frequencyMonths: Number(form.frequencyMonths) || 12,
            ...(form.description.trim() ? { description: form.description.trim() } : {}),
        };
        if (await run('add', () => api.post(`/lending/loans/${loanId}/covenants`, body))) list.reload();
    };
    const test = async (c: Covenant) => {
        if (!testing) return;
        const body = {
            periodEnd: testing.periodEnd,
            ...(c.type === 'MIN_DSCR' ? { annualNetOperatingIncome: testing.noi.trim(), ...(testing.ds.trim() ? { annualDebtService: testing.ds.trim() } : {}) } : {}),
            ...(c.type === 'FINANCIAL_STATEMENTS' ? { statementsReceived: testing.received === 'yes' } : {}),
            ...(c.type === 'MAX_LEVERAGE' || c.type === 'MIN_INTEREST_COVER' ? { ebitda: testing.ebitda.trim() } : {}),
            ...(c.type === 'MAX_LEVERAGE' && testing.debt.trim() ? { totalDebt: testing.debt.trim() } : {}),
            ...(c.type === 'MAX_LEVERAGE' && testing.cash.trim() ? { cash: testing.cash.trim() } : {}),
            ...(c.type === 'MIN_INTEREST_COVER' && testing.interest.trim() ? { interestExpense: testing.interest.trim() } : {}),
            ...(testing.evidence.trim() ? { evidence: testing.evidence.trim() } : {}),
        };
        if (await run(`test-${c.id}`, () => api.post(`/lending/loans/${loanId}/covenants/${c.id}/tests`, body))) { setTesting(null); list.reload(); }
    };
    const doWaive = async () => {
        if (!waiving) return;
        if (await run('waive', () => api.post(`/lending/loans/${loanId}/covenants/${waiving.id}/waive`, { reason: waiving.reason.trim() }))) { setWaiving(null); list.reload(); }
    };

    return (
        <Card title="Covenants" subtitle="Tested on schedule; a failed test is a breach until a later test passes or another person waives it.">
            <div className="space-y-3">
                {list.data && list.data.length === 0 && <Empty>No covenants on this loan.</Empty>}
                {!!list.data?.length && (
                    <Table>
                        <thead><tr><th className={th}>Covenant</th><th className={th}>Next test</th><th className={th}>Last result</th><th className={th}>Status</th><th className={th} /></tr></thead>
                        <tbody className="divide-y divide-[#F0F2F5]">
                            {list.data.map((c) => {
                                const last = c.tests[0];
                                return (
                                    <tr key={c.id} className="align-top">
                                        <td className={td}>{LABEL[c.type]}{c.threshold ? ` ${isMax(c.type) ? '≤' : '≥'} ${c.threshold}` : ''}<div className="text-[11px] text-[#8792A2]">every {c.frequencyMonths} month(s){c.description ? ` · ${c.description}` : ''}</div></td>
                                        <td className={td}>{c.nextTestOn}{c.testOverdue && <span className="ml-1 text-[11px] font-semibold text-red-600">overdue</span>}</td>
                                        <td className={td}>{last ? `${last.kind === 'WAIVER' ? 'Waived' : last.passed ? 'Passed' : 'Failed'}${last.value ? ` (${Number(last.value).toFixed(2)})` : ''} · ${last.testedOn}` : '—'}</td>
                                        <td className={td}><StatusBadge status={c.status} /></td>
                                        <td className={`${td} whitespace-nowrap space-x-1`}>
                                            <Btn size="sm" onClick={() => setTesting({ id: c.id, periodEnd: '', noi: '', ds: '', received: 'yes', evidence: '', ebitda: '', debt: '', cash: '', interest: '' })} disabled={!manage.allowed} reason={manage.reason}>Record test</Btn>
                                            {c.status === 'BREACHED' && <Btn size="sm" variant="ghost" onClick={() => setWaiving({ id: c.id, reason: '' })} disabled={!waive.allowed} reason={waive.reason}>Waive</Btn>}
                                            {testing?.id === c.id && (
                                                <div className="mt-2 space-y-1">
                                                    <TextInput type="date" value={testing.periodEnd} onChange={(v) => setTesting({ ...testing, periodEnd: v })} />
                                                    {c.type === 'MIN_DSCR' && <TextInput value={testing.noi} onChange={(v) => setTesting({ ...testing, noi: v })} placeholder="Annual net operating income" inputMode="decimal" />}
                                                    {c.type === 'MIN_DSCR' && <TextInput value={testing.ds} onChange={(v) => setTesting({ ...testing, ds: v })} placeholder="Annual debt service (blank: from schedule)" inputMode="decimal" />}
                                                    {(c.type === 'MAX_LEVERAGE' || c.type === 'MIN_INTEREST_COVER') && <TextInput value={testing.ebitda} onChange={(v) => setTesting({ ...testing, ebitda: v })} placeholder="EBITDA, last twelve months" inputMode="decimal" />}
                                                    {c.type === 'MAX_LEVERAGE' && <TextInput value={testing.debt} onChange={(v) => setTesting({ ...testing, debt: v })} placeholder="Total debt (blank: this loan's balance)" inputMode="decimal" />}
                                                    {c.type === 'MAX_LEVERAGE' && <TextInput value={testing.cash} onChange={(v) => setTesting({ ...testing, cash: v })} placeholder="Cash netted off (blank: 0)" inputMode="decimal" />}
                                                    {c.type === 'MIN_INTEREST_COVER' && <TextInput value={testing.interest} onChange={(v) => setTesting({ ...testing, interest: v })} placeholder="Interest expense (blank: from schedule)" inputMode="decimal" />}
                                                    {c.type === 'FINANCIAL_STATEMENTS' && <SelectInput value={testing.received} onChange={(v) => setTesting({ ...testing, received: v })} options={[{ value: 'yes', label: 'Received' }, { value: 'no', label: 'Not received' }]} />}
                                                    <TextInput value={testing.evidence} onChange={(v) => setTesting({ ...testing, evidence: v })} placeholder="Evidence" maxLength={500} />
                                                    <Btn size="sm" variant="primary" onClick={() => test(c)} busy={busy === `test-${c.id}`}>Save test</Btn>
                                                    <Btn size="sm" variant="ghost" onClick={() => setTesting(null)}>Cancel</Btn>
                                                </div>
                                            )}
                                            {waiving?.id === c.id && (
                                                <div className="mt-2 space-y-1">
                                                    <TextInput value={waiving.reason} onChange={(v) => setWaiving({ ...waiving, reason: v })} placeholder="Reason for the waiver" maxLength={500} />
                                                    <Btn size="sm" variant="primary" onClick={doWaive} busy={busy === 'waive'}>Waive breach</Btn>
                                                </div>
                                            )}
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </Table>
                )}
                <div className="flex flex-wrap items-end gap-2 border-t border-[#E3E8EE] pt-3">
                    <Field label="Covenant">
                        <SelectInput value={form.type} onChange={(v) => setForm({ ...form, type: v })} options={Object.entries(LABEL).map(([value, label]) => ({ value, label }))} />
                    </Field>
                    {form.type !== 'FINANCIAL_STATEMENTS' && <Field label="Threshold" hint={HINT[form.type as Covenant['type']]}><TextInput value={form.threshold} onChange={(v) => setForm({ ...form, threshold: v })} inputMode="decimal" className="w-24" /></Field>}
                    <Field label="Every (months)"><TextInput value={form.frequencyMonths} onChange={(v) => setForm({ ...form, frequencyMonths: v })} inputMode="numeric" className="w-20" /></Field>
                    <Field label="Description"><TextInput value={form.description} onChange={(v) => setForm({ ...form, description: v })} maxLength={500} className="w-56" /></Field>
                    <Btn onClick={add} busy={busy === 'add'} disabled={!manage.allowed} reason={manage.reason}>Add covenant</Btn>
                </div>
            </div>
            <ErrorBox error={error ?? list.error} onDismiss={clearError} />
        </Card>
    );
}
