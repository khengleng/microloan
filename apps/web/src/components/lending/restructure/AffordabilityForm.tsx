"use client";

import { useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import api from '@/lib/api';
import { useToast } from '@/components/ui/toast';
import { todayIso } from '../format';
import { Btn, Checkbox, ErrorBox, Field, Notice, SelectInput, Tabs, TextArea, TextInput } from '../ui';
import { clean, useAction } from '../useAsync';
import { EVIDENCE_QUALITY, MONEY_RE } from './labels';

type Template = 'INDIVIDUAL' | 'HOUSEHOLD' | 'BUSINESS' | 'SEASONAL';
interface DebtRow { k: number; description: string; monthlyPayment: string; isThisLoan: boolean }
interface MemberRow { k: number; name: string; verifiedNetIncome: string }
interface ForecastRow { k: number; month: string; inflows: string; outflows: string }

let seq = 0;
const nk = () => ++seq;

const TEMPLATE_TABS: { value: Template; label: string }[] = [
    { value: 'INDIVIDUAL', label: 'Individual' },
    { value: 'HOUSEHOLD', label: 'Household' },
    { value: 'BUSINESS', label: 'Business' },
    { value: 'SEASONAL', label: 'Seasonal (agri)' },
];

const okMoney = (v: string) => MONEY_RE.test(v.trim());

function MoneyField({ label, value, onChange, hint }: { label: string; value: string; onChange: (v: string) => void; hint?: string }) {
    return (
        <Field label={label} hint={hint} error={value && !okMoney(value) ? 'Decimal amount, up to 4 places' : undefined}>
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
    const { showToast } = useToast();
    const { busy, error, run, clearError } = useAction();
    const [template, setTemplate] = useState<Template>('INDIVIDUAL');
    const [income, setIncome] = useState('');
    const [expenses, setExpenses] = useState('');
    const [members, setMembers] = useState<MemberRow[]>(() => [{ k: nk(), name: '', verifiedNetIncome: '' }]);
    const [biz, setBiz] = useState({ operatingCashInflows: '', operatingCashOutflows: '', taxes: '', essentialCapitalExpenditure: '', requiredWorkingCapitalIncrease: '' });
    const [forecast, setForecast] = useState<ForecastRow[]>(() => [{ k: nk(), month: '', inflows: '', outflows: '' }]);
    const [debts, setDebts] = useState<DebtRow[]>(() => [{ k: nk(), description: 'This loan', monthlyPayment: '', isThisLoan: true }]);
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
    if (debtList.some((d) => !okMoney(d.monthlyPayment) || !d.description)) problems.push('Each debt needs a description and a monthly payment.');
    let inputs: Record<string, unknown> = {};
    if (template === 'INDIVIDUAL') {
        if (!okMoney(income) || !okMoney(expenses)) problems.push('Enter verified net income and essential living expenses.');
        inputs = { template, verifiedNetIncome: income.trim(), essentialLivingExpenses: expenses.trim(), debts: debtList };
    } else if (template === 'HOUSEHOLD') {
        const ms = members.map((m) => ({ name: m.name.trim(), verifiedNetIncome: m.verifiedNetIncome.trim() }));
        if (ms.length === 0 || ms.some((m) => !m.name || !okMoney(m.verifiedNetIncome))) problems.push('Each household member needs a name and verified net income.');
        if (!okMoney(expenses)) problems.push('Enter essential living expenses.');
        inputs = { template, members: ms, essentialLivingExpenses: expenses.trim(), debts: debtList };
    } else if (template === 'BUSINESS') {
        if (Object.values(biz).some((v) => !okMoney(v))) problems.push('Enter all business cash-flow figures (use 0 when none).');
        inputs = { template, ...Object.fromEntries(Object.entries(biz).map(([k, v]) => [k, v.trim()])), debts: debtList };
    } else {
        const fs = forecast.map((f) => ({ month: f.month ? `${f.month}-01` : '', inflows: f.inflows.trim(), outflows: f.outflows.trim() }));
        if (fs.length === 0 || fs.some((f) => !f.month || !okMoney(f.inflows) || !okMoney(f.outflows))) problems.push('Each forecast month needs a month, inflows and outflows.');
        inputs = { template, forecast: fs, debts: debtList };
    }
    if (assumptions.trim().length < 3) problems.push('Describe the assumptions (at least 3 characters).');
    if (!verificationDate) problems.push('Enter the verification date.');

    const submit = async () => {
        const body = { ...clean({ evidenceQuality, assumptions: assumptions.trim(), verificationDate, comments: comments.trim() }), inputs };
        const res = await run('assess', () => api.post(`/lending/restructures/${caseId}/assessments`, body));
        if (res) {
            showToast('Affordability assessment recorded', 'success');
            onDone();
        }
    };

    return (
        <div className="space-y-4">
            <Tabs tabs={TEMPLATE_TABS} value={template} onChange={setTemplate} />

            {template === 'INDIVIDUAL' && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <MoneyField label="Verified net monthly income" value={income} onChange={setIncome} />
                    <MoneyField label="Essential monthly living expenses" value={expenses} onChange={setExpenses} />
                </div>
            )}

            {template === 'HOUSEHOLD' && (
                <div className="space-y-3">
                    <p className="text-[12px] font-bold text-[#3C4257]">Household members contributing income</p>
                    {members.map((m) => (
                        <div key={m.k} className="grid grid-cols-[1fr_1fr_auto] gap-2 items-end">
                            <Field label="Name"><TextInput value={m.name} onChange={(v) => updMember(m.k, { name: v })} maxLength={80} /></Field>
                            <MoneyField label="Verified net monthly income" value={m.verifiedNetIncome} onChange={(v) => updMember(m.k, { verifiedNetIncome: v })} />
                            <RowBtn label="Remove member" onClick={() => setMembers((ms) => ms.filter((x) => x.k !== m.k))} />
                        </div>
                    ))}
                    <Btn size="sm" disabled={members.length >= 12} onClick={() => setMembers((ms) => [...ms, { k: nk(), name: '', verifiedNetIncome: '' }])}><Plus size={13} /> Add member</Btn>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <MoneyField label="Essential monthly living expenses (whole household)" value={expenses} onChange={setExpenses} />
                    </div>
                </div>
            )}

            {template === 'BUSINESS' && (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                    <MoneyField label="Operating cash inflows (monthly)" value={biz.operatingCashInflows} onChange={setBizField('operatingCashInflows')} />
                    <MoneyField label="Operating cash outflows (monthly)" value={biz.operatingCashOutflows} onChange={setBizField('operatingCashOutflows')} />
                    <MoneyField label="Taxes (monthly)" value={biz.taxes} onChange={setBizField('taxes')} />
                    <MoneyField label="Essential capital expenditure" value={biz.essentialCapitalExpenditure} onChange={setBizField('essentialCapitalExpenditure')} />
                    <MoneyField label="Required working-capital increase" value={biz.requiredWorkingCapitalIncrease} onChange={setBizField('requiredWorkingCapitalIncrease')} />
                </div>
            )}

            {template === 'SEASONAL' && (
                <div className="space-y-3">
                    <p className="text-[12px] font-bold text-[#3C4257]">Monthly cash-flow forecast (1–24 months)</p>
                    {forecast.map((f) => (
                        <div key={f.k} className="grid grid-cols-[1fr_1fr_1fr_auto] gap-2 items-end">
                            <Field label="Month"><TextInput type="month" value={f.month} onChange={(v) => updForecast(f.k, { month: v })} /></Field>
                            <MoneyField label="Inflows" value={f.inflows} onChange={(v) => updForecast(f.k, { inflows: v })} />
                            <MoneyField label="Outflows" value={f.outflows} onChange={(v) => updForecast(f.k, { outflows: v })} />
                            <RowBtn label="Remove month" onClick={() => setForecast((fs) => fs.filter((x) => x.k !== f.k))} />
                        </div>
                    ))}
                    <Btn size="sm" disabled={forecast.length >= 24} onClick={() => setForecast((fs) => [...fs, { k: nk(), month: '', inflows: '', outflows: '' }])}><Plus size={13} /> Add month</Btn>
                </div>
            )}

            <div className="space-y-2 border-t border-[#E3E8EE] pt-3">
                <p className="text-[12px] font-bold text-[#3C4257]">Monthly debt payments</p>
                <Notice tone="info">
                    List every debt the customer pays, including this loan. Debts ticked <b>“this loan”</b> are <b>excluded</b> from the
                    calculation to avoid double counting — the result is the amount available for this loan.
                </Notice>
                {debts.map((d) => (
                    <div key={d.k} className="grid grid-cols-[1.4fr_1fr_auto_auto] gap-2 items-end">
                        <Field label="Description"><TextInput value={d.description} onChange={(v) => updDebt(d.k, { description: v })} maxLength={120} /></Field>
                        <MoneyField label="Monthly payment" value={d.monthlyPayment} onChange={(v) => updDebt(d.k, { monthlyPayment: v })} />
                        <div className="pb-2"><Checkbox checked={d.isThisLoan} onChange={(v) => updDebt(d.k, { isThisLoan: v })} label="This loan" /></div>
                        <RowBtn label="Remove debt" onClick={() => setDebts((ds) => ds.filter((x) => x.k !== d.k))} />
                    </div>
                ))}
                <Btn size="sm" disabled={debts.length >= 30} onClick={() => setDebts((ds) => [...ds, { k: nk(), description: '', monthlyPayment: '', isThisLoan: false }])}><Plus size={13} /> Add debt</Btn>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 border-t border-[#E3E8EE] pt-3">
                <Field label="Evidence quality"><SelectInput value={evidenceQuality} onChange={setQuality} options={EVIDENCE_QUALITY} /></Field>
                <Field label="Verification date"><TextInput type="date" value={verificationDate} onChange={setVerificationDate} /></Field>
            </div>
            <Field label="Assumptions" hint="What the figures rely on (at least 3 characters).">
                <TextArea value={assumptions} onChange={setAssumptions} rows={2} maxLength={1000} />
            </Field>
            <Field label="Comments (optional)"><TextArea value={comments} onChange={setComments} rows={2} maxLength={1000} /></Field>

            {problems.length > 0 && <ul className="text-[12px] text-amber-800 list-disc pl-5 space-y-0.5">{problems.map((p) => <li key={p}>{p}</li>)}</ul>}
            <ErrorBox error={error} onDismiss={clearError} />
            <Btn variant="primary" busy={busy === 'assess'} disabled={problems.length > 0} reason={problems[0]} onClick={submit}>Record assessment</Btn>
        </div>
    );
}
