"use client";

import { useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import api from '@/lib/api';
import { useToast } from '@/components/ui/toast';
import { todayIso } from '../format';
import { Btn, Checkbox, ErrorBox, Field, Notice, SelectInput, Tabs, TextArea, TextInput } from '../ui';
import { clean, useAction } from '../useAsync';
import { EVIDENCE_QUALITY, MONEY_RE, useRestructureLabels } from './labels';

type Template = 'INDIVIDUAL' | 'HOUSEHOLD' | 'BUSINESS' | 'SEASONAL';
interface DebtRow { k: number; description: string; monthlyPayment: string; isThisLoan: boolean }
interface MemberRow { k: number; name: string; verifiedNetIncome: string }
interface ForecastRow { k: number; month: string; inflows: string; outflows: string }

let seq = 0;
const nk = () => ++seq;

const TEMPLATES: Template[] = ['INDIVIDUAL', 'HOUSEHOLD', 'BUSINESS', 'SEASONAL'];

const okMoney = (v: string) => MONEY_RE.test(v.trim());

function MoneyField({ label, value, onChange, hint }: { label: string; value: string; onChange: (v: string) => void; hint?: string }) {
    const t = useTranslations('LendingRestructure');
    return (
        <Field label={label} hint={hint} error={value && !okMoney(value) ? t('affordabilityForm.moneyError') : undefined}>
            <TextInput value={value} onChange={onChange} inputMode="decimal" placeholder="0.00" />
        </Field>
    );
}

function RowBtn({ onClick, label }: { onClick: () => void; label: string }) {
    return (
        <button type="button" onClick={onClick} aria-label={label} title={label} className="p-1.5 text-[#697386] hover:text-red-600">
            <Trash2 size={14} />
        </button>
    );
}

/** Capture an affordability assessment using one of four templates. */
export function AffordabilityForm({ caseId, onDone }: { caseId: string; onDone: () => void }) {
    const t = useTranslations('LendingRestructure');
    const L = useRestructureLabels();
    const { showToast } = useToast();
    const { busy, error, run, clearError } = useAction();
    const [template, setTemplate] = useState<Template>('INDIVIDUAL');
    const [income, setIncome] = useState('');
    const [expenses, setExpenses] = useState('');
    const [members, setMembers] = useState<MemberRow[]>(() => [{ k: nk(), name: '', verifiedNetIncome: '' }]);
    const [biz, setBiz] = useState({ operatingCashInflows: '', operatingCashOutflows: '', taxes: '', essentialCapitalExpenditure: '', requiredWorkingCapitalIncrease: '' });
    const [forecast, setForecast] = useState<ForecastRow[]>(() => [{ k: nk(), month: '', inflows: '', outflows: '' }]);
    const [debts, setDebts] = useState<DebtRow[]>(() => [{ k: nk(), description: t('affordabilityForm.thisLoan'), monthlyPayment: '', isThisLoan: true }]);
    const [evidenceQuality, setQuality] = useState('SELF_DECLARED');
    const [assumptions, setAssumptions] = useState('');
    const [verificationDate, setVerificationDate] = useState(todayIso);
    const [comments, setComments] = useState('');

    const setBizField = (k: keyof typeof biz) => (v: string) => setBiz((b) => ({ ...b, [k]: v }));
    const updDebt = (k: number, patch: Partial<DebtRow>) => setDebts((ds) => ds.map((d) => (d.k === k ? { ...d, ...patch } : d)));
    const updMember = (k: number, patch: Partial<MemberRow>) => setMembers((ms) => ms.map((m) => (m.k === k ? { ...m, ...patch } : m)));
    const updForecast = (k: number, patch: Partial<ForecastRow>) => setForecast((fs) => fs.map((f) => (f.k === k ? { ...f, ...patch } : f)));

    const debtList = debts
        .filter((d) => d.description.trim() || d.monthlyPayment.trim())
        .map((d) => ({ description: d.description.trim(), monthlyPayment: d.monthlyPayment.trim(), ...(d.isThisLoan ? { isThisLoan: true } : {}) }));

    const problems: string[] = [];
    if (debtList.some((d) => !okMoney(d.monthlyPayment) || !d.description)) problems.push(t('affordabilityForm.problems.debts'));
    let inputs: Record<string, unknown> = {};
    if (template === 'INDIVIDUAL') {
        if (!okMoney(income) || !okMoney(expenses)) problems.push(t('affordabilityForm.problems.individual'));
        inputs = { template, verifiedNetIncome: income.trim(), essentialLivingExpenses: expenses.trim(), debts: debtList };
    } else if (template === 'HOUSEHOLD') {
        const ms = members.map((m) => ({ name: m.name.trim(), verifiedNetIncome: m.verifiedNetIncome.trim() }));
        if (ms.length === 0 || ms.some((m) => !m.name || !okMoney(m.verifiedNetIncome))) problems.push(t('affordabilityForm.problems.members'));
        if (!okMoney(expenses)) problems.push(t('affordabilityForm.problems.expenses'));
        inputs = { template, members: ms, essentialLivingExpenses: expenses.trim(), debts: debtList };
    } else if (template === 'BUSINESS') {
        if (Object.values(biz).some((v) => !okMoney(v))) problems.push(t('affordabilityForm.problems.business'));
        inputs = { template, ...Object.fromEntries(Object.entries(biz).map(([k, v]) => [k, v.trim()])), debts: debtList };
    } else {
        const fs = forecast.map((f) => ({ month: f.month ? `${f.month}-01` : '', inflows: f.inflows.trim(), outflows: f.outflows.trim() }));
        if (fs.length === 0 || fs.some((f) => !f.month || !okMoney(f.inflows) || !okMoney(f.outflows))) problems.push(t('affordabilityForm.problems.forecast'));
        inputs = { template, forecast: fs, debts: debtList };
    }
    if (assumptions.trim().length < 3) problems.push(t('affordabilityForm.problems.assumptions'));
    if (!verificationDate) problems.push(t('affordabilityForm.problems.verificationDate'));

    const submit = async () => {
        const body = { ...clean({ evidenceQuality, assumptions: assumptions.trim(), verificationDate, comments: comments.trim() }), inputs };
        const res = await run('assess', () => api.post(`/lending/restructures/${caseId}/assessments`, body));
        if (res) {
            showToast(t('affordabilityForm.toastRecorded'), 'success');
            onDone();
        }
    };

    return (
        <div className="space-y-4">
            <Tabs tabs={TEMPLATES.map((v) => ({ value: v, label: L.label('template', v) }))} value={template} onChange={setTemplate} />

            {template === 'INDIVIDUAL' && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <MoneyField label={t('affordabilityForm.netIncome')} value={income} onChange={setIncome} />
                    <MoneyField label={t('affordabilityForm.expenses')} value={expenses} onChange={setExpenses} />
                </div>
            )}

            {template === 'HOUSEHOLD' && (
                <div className="space-y-3">
                    <p className="text-[12px] font-bold text-[#3C4257]">{t('affordabilityForm.membersTitle')}</p>
                    {members.map((m) => (
                        <div key={m.k} className="grid grid-cols-[1fr_1fr_auto] gap-2 items-end">
                            <Field label={t('affordabilityForm.name')}><TextInput value={m.name} onChange={(v) => updMember(m.k, { name: v })} maxLength={80} /></Field>
                            <MoneyField label={t('affordabilityForm.netIncome')} value={m.verifiedNetIncome} onChange={(v) => updMember(m.k, { verifiedNetIncome: v })} />
                            <RowBtn label={t('affordabilityForm.removeMember')} onClick={() => setMembers((ms) => ms.filter((x) => x.k !== m.k))} />
                        </div>
                    ))}
                    <Btn size="sm" disabled={members.length >= 12} onClick={() => setMembers((ms) => [...ms, { k: nk(), name: '', verifiedNetIncome: '' }])}><Plus size={13} /> {t('affordabilityForm.addMember')}</Btn>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <MoneyField label={t('affordabilityForm.householdExpenses')} value={expenses} onChange={setExpenses} />
                    </div>
                </div>
            )}

            {template === 'BUSINESS' && (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                    <MoneyField label={t('affordabilityForm.bizInflows')} value={biz.operatingCashInflows} onChange={setBizField('operatingCashInflows')} />
                    <MoneyField label={t('affordabilityForm.bizOutflows')} value={biz.operatingCashOutflows} onChange={setBizField('operatingCashOutflows')} />
                    <MoneyField label={t('affordabilityForm.taxes')} value={biz.taxes} onChange={setBizField('taxes')} />
                    <MoneyField label={t('affordabilityForm.capex')} value={biz.essentialCapitalExpenditure} onChange={setBizField('essentialCapitalExpenditure')} />
                    <MoneyField label={t('affordabilityForm.workingCapital')} value={biz.requiredWorkingCapitalIncrease} onChange={setBizField('requiredWorkingCapitalIncrease')} />
                </div>
            )}

            {template === 'SEASONAL' && (
                <div className="space-y-3">
                    <p className="text-[12px] font-bold text-[#3C4257]">{t('affordabilityForm.forecastTitle')}</p>
                    {forecast.map((f) => (
                        <div key={f.k} className="grid grid-cols-[1fr_1fr_1fr_auto] gap-2 items-end">
                            <Field label={t('common.month')}><TextInput type="month" value={f.month} onChange={(v) => updForecast(f.k, { month: v })} /></Field>
                            <MoneyField label={t('affordabilityForm.inflows')} value={f.inflows} onChange={(v) => updForecast(f.k, { inflows: v })} />
                            <MoneyField label={t('affordabilityForm.outflows')} value={f.outflows} onChange={(v) => updForecast(f.k, { outflows: v })} />
                            <RowBtn label={t('affordabilityForm.removeMonth')} onClick={() => setForecast((fs) => fs.filter((x) => x.k !== f.k))} />
                        </div>
                    ))}
                    <Btn size="sm" disabled={forecast.length >= 24} onClick={() => setForecast((fs) => [...fs, { k: nk(), month: '', inflows: '', outflows: '' }])}><Plus size={13} /> {t('affordabilityForm.addMonth')}</Btn>
                </div>
            )}

            <div className="space-y-2 border-t border-[#E3E8EE] pt-3">
                <p className="text-[12px] font-bold text-[#3C4257]">{t('affordabilityForm.debtsTitle')}</p>
                <Notice tone="info">
                    {t.rich('affordabilityForm.debtsNotice', { b: (c) => <b>{c}</b> })}
                </Notice>
                {debts.map((d) => (
                    <div key={d.k} className="grid grid-cols-[1.4fr_1fr_auto_auto] gap-2 items-end">
                        <Field label={t('common.description')}><TextInput value={d.description} onChange={(v) => updDebt(d.k, { description: v })} maxLength={120} /></Field>
                        <MoneyField label={t('affordabilityForm.monthlyPayment')} value={d.monthlyPayment} onChange={(v) => updDebt(d.k, { monthlyPayment: v })} />
                        <div className="pb-2"><Checkbox checked={d.isThisLoan} onChange={(v) => updDebt(d.k, { isThisLoan: v })} label={t('affordabilityForm.thisLoan')} /></div>
                        <RowBtn label={t('affordabilityForm.removeDebt')} onClick={() => setDebts((ds) => ds.filter((x) => x.k !== d.k))} />
                    </div>
                ))}
                <Btn size="sm" disabled={debts.length >= 30} onClick={() => setDebts((ds) => [...ds, { k: nk(), description: '', monthlyPayment: '', isThisLoan: false }])}><Plus size={13} /> {t('affordabilityForm.addDebt')}</Btn>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 border-t border-[#E3E8EE] pt-3">
                <Field label={t('common.evidenceQuality')}><SelectInput value={evidenceQuality} onChange={setQuality} options={L.options('evidenceQuality', EVIDENCE_QUALITY)} /></Field>
                <Field label={t('common.verificationDate')}><TextInput type="date" value={verificationDate} onChange={setVerificationDate} /></Field>
            </div>
            <Field label={t('affordabilityForm.assumptions')} hint={t('affordabilityForm.assumptionsHint')}>
                <TextArea value={assumptions} onChange={setAssumptions} rows={2} maxLength={1000} />
            </Field>
            <Field label={t('affordabilityForm.comments')}><TextArea value={comments} onChange={setComments} rows={2} maxLength={1000} /></Field>

            {problems.length > 0 && <ul className="text-[12px] text-amber-800 list-disc pl-5 space-y-0.5">{problems.map((p) => <li key={p}>{p}</li>)}</ul>}
            <ErrorBox error={error} onDismiss={clearError} />
            <Btn variant="primary" busy={busy === 'assess'} disabled={problems.length > 0} reason={problems[0]} onClick={submit}>{t('affordabilityForm.submit')}</Btn>
        </div>
    );
}
