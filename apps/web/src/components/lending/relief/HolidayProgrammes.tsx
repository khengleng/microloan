"use client";

import { useState } from 'react';
import api from '@/lib/api';
import { useToast } from '@/components/ui/toast';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { StatusBadge } from '../StatusBadge';
import { ActionPanel, Btn, Card, Checkbox, Empty, ErrorBox, Field, Notice, SelectInput, Spinner, Table, TextInput, td, th } from '../ui';
import { qs, useAction, useApi } from '../useAsync';
import { todayIso } from '../format';
import type { HolidayProgramme, InterestTreatment, TermTreatment } from './types';
import { INTEREST_TREATMENTS, TERM_TREATMENTS, costBadgeCls, termOf, treatmentOf } from './treatments';

const CODE_RE = /^[A-Z0-9][A-Z0-9_.-]{1,47}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function intIn(v: string, min: number, max: number): number | undefined {
    if (!/^\d+$/.test(v.trim())) return undefined;
    const n = Number.parseInt(v, 10);
    return n >= min && n <= max ? n : undefined;
}

/** Cost badge for an interest treatment — makes "not free" visible in every list. */
export function TreatmentBadge({ treatment }: { treatment: string }) {
    const t = treatmentOf(treatment);
    if (!t) return <span className="text-[12px]">{treatment}</span>;
    return (
        <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded border text-[11px] font-bold whitespace-nowrap ${costBadgeCls[t.tone]}`} title={t.summary}>
            {t.label} · {t.costsBorrower ? (t.value === 'CAPITALIZE' ? 'grows the debt' : 'costs borrower') : 'free to borrower'}
        </span>
    );
}

function CreateProgrammeForm({ onCreated, onClose }: { onCreated: () => void; onClose: () => void }) {
    const { showToast } = useToast();
    const { busy, error, run, clearError } = useAction();
    const [code, setCode] = useState('');
    const [name, setName] = useState('');
    const [maxInstalments, setMaxInstalments] = useState('3');
    const [interestTreatment, setInterest] = useState<InterestTreatment | ''>('');
    const [termTreatment, setTerm] = useState<TermTreatment>('EXTEND_TERM');
    const [opensOn, setOpensOn] = useState(todayIso());
    const [closesOn, setClosesOn] = useState('');
    const [minPaid, setMinPaid] = useState('0');
    const [maxDpd, setMaxDpd] = useState('30');
    const [minRemaining, setMinRemaining] = useState('1');
    const [maxPerLoan, setMaxPerLoan] = useState('1');
    const [allowRestructured, setAllowRestructured] = useState(false);
    const [acknowledged, setAcknowledged] = useState(false);

    const treatment = interestTreatment ? treatmentOf(interestTreatment) : undefined;
    const problems: Record<string, string> = {};
    if (code && !CODE_RE.test(code)) problems.code = 'Upper-case letters, digits, _ . - (2–48 chars).';
    if (name && name.trim().length < 2) problems.name = 'At least 2 characters.';
    if (intIn(maxInstalments, 1, 24) === undefined) problems.maxInstalments = 'Whole number 1–24.';
    if (closesOn && opensOn && closesOn < opensOn) problems.closesOn = 'Closes before it opens.';
    if (intIn(minPaid, 0, 600) === undefined) problems.minPaid = '0–600.';
    if (intIn(maxDpd, 0, 3650) === undefined) problems.maxDpd = '0–3650.';
    if (intIn(minRemaining, 1, 600) === undefined) problems.minRemaining = '1–600.';
    if (intIn(maxPerLoan, 1, 10) === undefined) problems.maxPerLoan = '1–10.';
    const complete = CODE_RE.test(code) && name.trim().length >= 2 && !!interestTreatment && DATE_RE.test(opensOn) && DATE_RE.test(closesOn);
    const needsAck = !!treatment?.costsBorrower;
    const blocked = !complete || Object.keys(problems).length > 0 || (needsAck && !acknowledged);

    const submit = async () => {
        if (blocked || !interestTreatment) return;
        const body = {
            code,
            name: name.trim(),
            maxInstalments: intIn(maxInstalments, 1, 24)!,
            interestTreatment,
            termTreatment,
            opensOn,
            closesOn,
            minInstalmentsPaid: intIn(minPaid, 0, 600)!,
            maxDaysPastDue: intIn(maxDpd, 0, 3650)!,
            minInstalmentsRemaining: intIn(minRemaining, 1, 600)!,
            maxHolidaysPerLoan: intIn(maxPerLoan, 1, 10)!,
            allowRestructured,
        };
        const res = await run('create', () => api.post<HolidayProgramme>('/lending/ops/payment-holiday-programmes', body));
        if (res) {
            showToast(`Programme ${res.data.code} saved as draft — another user must publish it`, 'success');
            onCreated();
        }
    };

    return (
        <ActionPanel title="New payment-holiday programme" onClose={onClose}>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                <Field label="Code" error={problems.code} hint="e.g. FLOOD_RELIEF_2026">
                    <TextInput value={code} onChange={(v) => setCode(v.toUpperCase())} maxLength={48} className="font-mono" />
                </Field>
                <Field label="Name" error={problems.name} className="lg:col-span-2">
                    <TextInput value={name} onChange={setName} maxLength={120} />
                </Field>
                <Field label="Longest holiday (instalments)" error={problems.maxInstalments}>
                    <TextInput value={maxInstalments} onChange={setMaxInstalments} inputMode="numeric" />
                </Field>
                <Field label="Opens on" hint="First date enrolments are accepted">
                    <TextInput type="date" value={opensOn} onChange={setOpensOn} />
                </Field>
                <Field label="Closes on" error={problems.closesOn} hint="Last date enrolments are accepted">
                    <TextInput type="date" value={closesOn} onChange={setClosesOn} />
                </Field>
            </div>

            <div>
                <p className="text-[12px] font-semibold text-[#3C4257] mb-1.5">Interest arising during the holiday — who pays it?</p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                    {INTEREST_TREATMENTS.map((t) => {
                        const selected = interestTreatment === t.value;
                        return (
                            <button
                                key={t.value}
                                type="button"
                                onClick={() => { setInterest(t.value); setAcknowledged(false); }}
                                className={`text-left rounded-md border px-3 py-2.5 transition-colors ${selected ? 'border-[#635BFF] ring-2 ring-[#635BFF]/20 bg-white' : 'border-[#E3E8EE] bg-white hover:border-[#C9D7FF]'}`}
                            >
                                <div className="flex items-center justify-between gap-2">
                                    <span className="text-[13px] font-bold text-[#1A1F36]">{t.label}</span>
                                    <span className={`px-1.5 py-0.5 rounded border text-[10px] font-bold uppercase tracking-wide ${costBadgeCls[t.tone]}`}>
                                        {!t.costsBorrower ? 'Free to borrower' : t.value === 'CAPITALIZE' ? 'Grows the debt' : 'Costs borrower'}
                                    </span>
                                </div>
                                <p className="text-[12px] text-[#4F566B] mt-1">{t.summary}</p>
                                <p className="font-mono text-[10px] text-[#8792A2] mt-1">{t.value}</p>
                            </button>
                        );
                    })}
                </div>
            </div>

            {treatment && (
                <Notice tone={treatment.tone} title={treatment.costsBorrower ? 'This holiday is not free for the borrower' : 'The lender absorbs the interest'}>
                    <p>{treatment.summary}</p>
                    {treatment.value === 'CAPITALIZE' && <p className="mt-1">A borrower who takes this holiday will owe more afterwards than before it, and pay interest on that interest.</p>}
                    {treatment.costsBorrower && (
                        <div className="mt-2">
                            <Checkbox
                                checked={acknowledged}
                                onChange={setAcknowledged}
                                label="I understand only WAIVE is free to the borrower, and this programme will be published as relief that costs them."
                            />
                        </div>
                    )}
                </Notice>
            )}

            <div>
                <p className="text-[12px] font-semibold text-[#3C4257] mb-1.5">What the deferred payments do to the term</p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                    {TERM_TREATMENTS.map((t) => (
                        <label key={t.value} className={`flex gap-2 rounded-md border px-3 py-2 cursor-pointer ${termTreatment === t.value ? 'border-[#635BFF] bg-white' : 'border-[#E3E8EE] bg-white'}`}>
                            <input type="radio" name="termTreatment" className="accent-[#635BFF] mt-1" checked={termTreatment === t.value} onChange={() => setTerm(t.value)} />
                            <span>
                                <span className="block text-[13px] font-bold text-[#1A1F36]">{t.label}</span>
                                <span className="block text-[12px] text-[#4F566B]">{t.summary}</span>
                            </span>
                        </label>
                    ))}
                </div>
            </div>

            <div>
                <p className="text-[12px] font-semibold text-[#3C4257] mb-1.5">Eligibility rules (evaluated from recorded loan state, the same way for everyone)</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                    <Field label="Min. instalments paid" error={problems.minPaid} hint="Seasoning before a loan qualifies">
                        <TextInput value={minPaid} onChange={setMinPaid} inputMode="numeric" />
                    </Field>
                    <Field label="Max. days past due" error={problems.maxDpd}>
                        <TextInput value={maxDpd} onChange={setMaxDpd} inputMode="numeric" />
                    </Field>
                    <Field label="Min. instalments left after" error={problems.minRemaining} hint="So there is a loan left to serve">
                        <TextInput value={minRemaining} onChange={setMinRemaining} inputMode="numeric" />
                    </Field>
                    <Field label="Max. holidays per loan" error={problems.maxPerLoan}>
                        <TextInput value={maxPerLoan} onChange={setMaxPerLoan} inputMode="numeric" />
                    </Field>
                </div>
                <div className="mt-2">
                    <Checkbox checked={allowRestructured} onChange={setAllowRestructured} label="Already-restructured loans qualify" />
                </div>
            </div>

            <p className="text-[11px] text-[#697386]">The programme is saved as a DRAFT. Publishing it requires a different user (maker-checker).</p>
            <ErrorBox error={error} onDismiss={clearError} />
            <div className="flex gap-2">
                <Btn variant="primary" onClick={submit} busy={busy === 'create'} disabled={blocked}
                    reason={!complete ? 'Fill code, name, interest treatment and the window' : needsAck && !acknowledged ? 'Acknowledge the borrower cost first' : undefined}>
                    Save draft
                </Btn>
                <Btn variant="ghost" onClick={onClose}>Cancel</Btn>
            </div>
        </ActionPanel>
    );
}

function ProgrammeRules({ p }: { p: HolidayProgramme }) {
    return (
        <ul className="text-[12px] text-[#4F566B] space-y-0.5">
            <li>≥ {p.minInstalmentsPaid} instalment(s) paid · ≤ {p.maxDaysPastDue} DPD</li>
            <li>leaves ≥ {p.minInstalmentsRemaining} instalment(s) · ≤ {p.maxHolidaysPerLoan} holiday(s)/loan</li>
            <li>{p.allowRestructured ? 'restructured loans qualify' : 'restructured loans excluded'}</li>
        </ul>
    );
}

/** Payment-holiday programmes: list, create (maker) and publish / withdraw (checker). */
export function HolidayProgrammes() {
    const { showToast } = useToast();
    const confirm = useConfirm();
    const [status, setStatus] = useState('');
    const [creating, setCreating] = useState(false);
    const { data, error, loading, reload } = useApi<HolidayProgramme[]>(`/lending/ops/payment-holiday-programmes${qs({ status })}`);
    const action = useAction();
    const [actingOn, setActingOn] = useState<{ id: string; next: 'OPEN' | 'CLOSED' } | null>(null);

    const setProgrammeStatus = async (p: HolidayProgramme, next: 'OPEN' | 'CLOSED') => {
        const t = treatmentOf(p.interestTreatment);
        const ok = await confirm({
            title: next === 'OPEN' ? `Publish ${p.code}` : p.status === 'DRAFT' ? `Discard ${p.code}` : `Withdraw ${p.code}`,
            message: next === 'OPEN'
                ? `Publish this programme to the whole book from ${p.opensOn} to ${p.closesOn}? Every qualifying loan may enrol. Interest: ${t?.summary ?? p.interestTreatment} You must not be the user who created it.`
                : 'Close this programme? It stops accepting enrolments and cannot be reopened — publish a new one instead. Holidays already granted are unaffected.',
            confirmLabel: next === 'OPEN' ? 'Publish' : 'Close programme',
            variant: next === 'OPEN' ? 'warning' : 'danger',
        });
        if (!ok) return;
        setActingOn({ id: p.id, next });
        const res = await action.run(`${p.id}-${next}`, () => api.post(`/lending/ops/payment-holiday-programmes/${p.id}/status`, { status: next }));
        if (res) {
            showToast(next === 'OPEN' ? `${p.code} published` : `${p.code} closed`, 'success');
            setActingOn(null);
            reload();
        }
    };

    return (
        <div className="space-y-5">
            <Notice tone="info" title="Payment holidays are relief, not forgiveness">
                Interest keeps arising during a holiday. The programme&apos;s interest treatment decides who pays it: only <b>WAIVE</b> is free to the borrower;
                <b> CAPITALIZE</b> adds it to the principal, so the borrower ends up owing more. A programme is created as a draft and published by a different user.
            </Notice>

            {creating && <CreateProgrammeForm onCreated={() => { setCreating(false); reload(); }} onClose={() => setCreating(false)} />}

            <Card
                title="Programmes"
                subtitle="Published offers applied the same way to every loan that qualifies."
                actions={
                    <>
                        <div className="w-44">
                            <SelectInput value={status} onChange={setStatus} placeholder="All statuses" options={['DRAFT', 'OPEN', 'CLOSED']} />
                        </div>
                        {!creating && <Btn variant="primary" onClick={() => setCreating(true)}>New programme</Btn>}
                    </>
                }
                bodyClass="p-0"
            >
                {loading && !data ? <Spinner /> : error ? <div className="p-4"><ErrorBox error={error} /></div> : !data?.length ? <Empty>No payment-holiday programmes{status ? ` with status ${status}` : ''}.</Empty> : (
                    <Table>
                        <thead>
                            <tr className="border-b border-[#E3E8EE] bg-[#F7FAFC]">
                                <th className={th}>Programme</th><th className={th}>Status</th><th className={th}>Window</th>
                                <th className={th}>Max</th><th className={th}>Interest</th><th className={th}>Term</th>
                                <th className={th}>Eligibility</th><th className={th}></th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-[#F0F2F5]">
                            {data.map((p) => (
                                <tr key={p.id} className="hover:bg-[#F7FAFC]">
                                    <td className={td}>
                                        <p className="font-mono font-semibold text-[#1A1F36]">{p.code}</p>
                                        <p className="text-[12px] text-[#697386]">{p.name}</p>
                                    </td>
                                    <td className={td}><StatusBadge status={p.status} /></td>
                                    <td className={`${td} whitespace-nowrap text-[12px] tabular-nums`}>{p.opensOn} → {p.closesOn}</td>
                                    <td className={`${td} tabular-nums`}>{p.maxInstalments}</td>
                                    <td className={td}><TreatmentBadge treatment={p.interestTreatment} /></td>
                                    <td className={`${td} text-[12px]`} title={termOf(p.termTreatment)?.summary}>{termOf(p.termTreatment)?.label ?? p.termTreatment}</td>
                                    <td className={td}><ProgrammeRules p={p} /></td>
                                    <td className={`${td} whitespace-nowrap`}>
                                        <div className="flex gap-1.5 justify-end">
                                            {p.status === 'DRAFT' && (
                                                <>
                                                    <Btn size="sm" variant="primary" busy={action.busy === `${p.id}-OPEN`} disabled={!!action.busy} onClick={() => setProgrammeStatus(p, 'OPEN')}>Publish</Btn>
                                                    <Btn size="sm" variant="danger" busy={action.busy === `${p.id}-CLOSED`} disabled={!!action.busy} onClick={() => setProgrammeStatus(p, 'CLOSED')}>Discard</Btn>
                                                </>
                                            )}
                                            {p.status === 'OPEN' && (
                                                <Btn size="sm" variant="danger" busy={action.busy === `${p.id}-CLOSED`} disabled={!!action.busy} onClick={() => setProgrammeStatus(p, 'CLOSED')}>Withdraw</Btn>
                                            )}
                                        </div>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </Table>
                )}
                {action.error && actingOn && (
                    <div className="p-4 border-t border-[#E3E8EE] space-y-2">
                        <p className="text-[12px] text-[#697386]">
                            {actingOn.next === 'OPEN' ? 'Publishing' : 'Closing'} <span className="font-mono">{data?.find((p) => p.id === actingOn.id)?.code ?? actingOn.id.slice(0, 8)}</span> was refused.
                            {actingOn.next === 'OPEN' && ' A programme must be published by someone other than the user who created it.'}
                        </p>
                        <ErrorBox error={action.error} onDismiss={() => { action.clearError(); setActingOn(null); }} />
                    </div>
                )}
            </Card>
        </div>
    );
}
