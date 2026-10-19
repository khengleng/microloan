"use client";

import { useState } from 'react';
import { useTranslations } from 'next-intl';
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
    const tr = useTranslations('LendingRelief');
    const t = treatmentOf(treatment);
    if (!t) return <span className="text-[12px]">{treatment}</span>;
    return (
        <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded border text-[11px] font-bold whitespace-nowrap ${costBadgeCls[t.tone]}`} title={tr(`treatment.${t.value}.summary`)}>
            {tr(`treatment.${t.value}.label`)} · {t.costsBorrower ? (t.value === 'CAPITALIZE' ? tr('costInline.grows') : tr('costInline.costs')) : tr('costInline.free')}
        </span>
    );
}

function CreateProgrammeForm({ onCreated, onClose }: { onCreated: () => void; onClose: () => void }) {
    const tr = useTranslations('LendingRelief');
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
    if (code && !CODE_RE.test(code)) problems.code = tr('create.errCode');
    if (name && name.trim().length < 2) problems.name = tr('create.errName');
    if (intIn(maxInstalments, 1, 24) === undefined) problems.maxInstalments = tr('common.wholeNumber', { max: 24 });
    if (closesOn && opensOn && closesOn < opensOn) problems.closesOn = tr('create.errClosesOn');
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
            showToast(tr('create.savedToast', { code: res.data.code }), 'success');
            onCreated();
        }
    };

    return (
        <ActionPanel title={tr('create.title')} onClose={onClose}>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                <Field label={tr('create.code')} error={problems.code} hint={tr('create.codeHint')}>
                    <TextInput value={code} onChange={(v) => setCode(v.toUpperCase())} maxLength={48} className="font-mono" />
                </Field>
                <Field label={tr('create.name')} error={problems.name} className="lg:col-span-2">
                    <TextInput value={name} onChange={setName} maxLength={120} />
                </Field>
                <Field label={tr('create.maxInstalments')} error={problems.maxInstalments}>
                    <TextInput value={maxInstalments} onChange={setMaxInstalments} inputMode="numeric" />
                </Field>
                <Field label={tr('create.opensOn')} hint={tr('create.opensOnHint')}>
                    <TextInput type="date" value={opensOn} onChange={setOpensOn} />
                </Field>
                <Field label={tr('create.closesOn')} error={problems.closesOn} hint={tr('create.closesOnHint')}>
                    <TextInput type="date" value={closesOn} onChange={setClosesOn} />
                </Field>
            </div>

            <div>
                <p className="text-[12px] font-semibold text-[#3C4257] mb-1.5">{tr('create.interestQuestion')}</p>
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
                                    <span className="text-[13px] font-bold text-[#1A1F36]">{tr(`treatment.${t.value}.label`)}</span>
                                    <span className={`px-1.5 py-0.5 rounded border text-[10px] font-bold uppercase tracking-wide ${costBadgeCls[t.tone]}`}>
                                        {!t.costsBorrower ? tr('cost.free') : t.value === 'CAPITALIZE' ? tr('cost.grows') : tr('cost.costs')}
                                    </span>
                                </div>
                                <p className="text-[12px] text-[#4F566B] mt-1">{tr(`treatment.${t.value}.summary`)}</p>
                                <p className="font-mono text-[10px] text-[#8792A2] mt-1">{t.value}</p>
                            </button>
                        );
                    })}
                </div>
            </div>

            {treatment && (
                <Notice tone={treatment.tone} title={treatment.costsBorrower ? tr('create.noticeNotFree') : tr('create.noticeLenderAbsorbs')}>
                    <p>{tr(`treatment.${treatment.value}.summary`)}</p>
                    {treatment.value === 'CAPITALIZE' && <p className="mt-1">{tr('create.capitalizeWarning')}</p>}
                    {treatment.costsBorrower && (
                        <div className="mt-2">
                            <Checkbox
                                checked={acknowledged}
                                onChange={setAcknowledged}
                                label={tr('create.acknowledge')}
                            />
                        </div>
                    )}
                </Notice>
            )}

            <div>
                <p className="text-[12px] font-semibold text-[#3C4257] mb-1.5">{tr('create.termQuestion')}</p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                    {TERM_TREATMENTS.map((t) => (
                        <label key={t.value} className={`flex gap-2 rounded-md border px-3 py-2 cursor-pointer ${termTreatment === t.value ? 'border-[#635BFF] bg-white' : 'border-[#E3E8EE] bg-white'}`}>
                            <input type="radio" name="termTreatment" className="accent-[#635BFF] mt-1" checked={termTreatment === t.value} onChange={() => setTerm(t.value)} />
                            <span>
                                <span className="block text-[13px] font-bold text-[#1A1F36]">{tr(`term.${t.value}.label`)}</span>
                                <span className="block text-[12px] text-[#4F566B]">{tr(`term.${t.value}.summary`)}</span>
                            </span>
                        </label>
                    ))}
                </div>
            </div>

            <div>
                <p className="text-[12px] font-semibold text-[#3C4257] mb-1.5">{tr('create.eligibilityTitle')}</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                    <Field label={tr('create.minPaid')} error={problems.minPaid} hint={tr('create.minPaidHint')}>
                        <TextInput value={minPaid} onChange={setMinPaid} inputMode="numeric" />
                    </Field>
                    <Field label={tr('create.maxDpd')} error={problems.maxDpd}>
                        <TextInput value={maxDpd} onChange={setMaxDpd} inputMode="numeric" />
                    </Field>
                    <Field label={tr('create.minRemaining')} error={problems.minRemaining} hint={tr('create.minRemainingHint')}>
                        <TextInput value={minRemaining} onChange={setMinRemaining} inputMode="numeric" />
                    </Field>
                    <Field label={tr('create.maxPerLoan')} error={problems.maxPerLoan}>
                        <TextInput value={maxPerLoan} onChange={setMaxPerLoan} inputMode="numeric" />
                    </Field>
                </div>
                <div className="mt-2">
                    <Checkbox checked={allowRestructured} onChange={setAllowRestructured} label={tr('create.allowRestructured')} />
                </div>
            </div>

            <p className="text-[11px] text-[#697386]">{tr('create.draftNote')}</p>
            <ErrorBox error={error} onDismiss={clearError} />
            <div className="flex gap-2">
                <Btn variant="primary" onClick={submit} busy={busy === 'create'} disabled={blocked}
                    reason={!complete ? tr('create.reasonIncomplete') : needsAck && !acknowledged ? tr('create.reasonAcknowledge') : undefined}>
                    {tr('create.saveDraft')}
                </Btn>
                <Btn variant="ghost" onClick={onClose}>{tr('common.cancel')}</Btn>
            </div>
        </ActionPanel>
    );
}

function ProgrammeRules({ p }: { p: HolidayProgramme }) {
    const tr = useTranslations('LendingRelief');
    return (
        <ul className="text-[12px] text-[#4F566B] space-y-0.5">
            <li>{tr('rules.paid', { paid: p.minInstalmentsPaid, dpd: p.maxDaysPastDue })}</li>
            <li>{tr('rules.leaves', { remaining: p.minInstalmentsRemaining, holidays: p.maxHolidaysPerLoan })}</li>
            <li>{p.allowRestructured ? tr('rules.restructuredQualify') : tr('rules.restructuredExcluded')}</li>
        </ul>
    );
}

/** Payment-holiday programmes: list, create (maker) and publish / withdraw (checker). */
export function HolidayProgrammes() {
    const tr = useTranslations('LendingRelief');
    const ts = useTranslations('Status');
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
            title: next === 'OPEN' ? tr('list.publishTitle', { code: p.code }) : p.status === 'DRAFT' ? tr('list.discardTitle', { code: p.code }) : tr('list.withdrawTitle', { code: p.code }),
            message: next === 'OPEN'
                ? tr('list.publishMessage', { opensOn: p.opensOn, closesOn: p.closesOn, interest: t ? tr(`treatment.${t.value}.summary`) : p.interestTreatment })
                : tr('list.closeMessage'),
            confirmLabel: next === 'OPEN' ? tr('list.publish') : tr('list.closeProgramme'),
            variant: next === 'OPEN' ? 'warning' : 'danger',
        });
        if (!ok) return;
        setActingOn({ id: p.id, next });
        const res = await action.run(`${p.id}-${next}`, () => api.post(`/lending/ops/payment-holiday-programmes/${p.id}/status`, { status: next }));
        if (res) {
            showToast(next === 'OPEN' ? tr('list.published', { code: p.code }) : tr('list.closed', { code: p.code }), 'success');
            setActingOn(null);
            reload();
        }
    };

    return (
        <div className="space-y-5">
            <Notice tone="info" title={tr('list.noticeTitle')}>
                {tr.rich('list.noticeBody', { b: (c) => <b>{c}</b> })}
            </Notice>

            {creating && <CreateProgrammeForm onCreated={() => { setCreating(false); reload(); }} onClose={() => setCreating(false)} />}

            <Card
                title={tr('list.title')}
                subtitle={tr('list.subtitle')}
                actions={
                    <>
                        <div className="w-44">
                            <SelectInput value={status} onChange={setStatus} placeholder={tr('common.allStatuses')} options={['DRAFT', 'OPEN', 'CLOSED'].map((v) => ({ value: v, label: ts.has(v) ? ts(v) : v }))} />
                        </div>
                        {!creating && <Btn variant="primary" onClick={() => setCreating(true)}>{tr('list.newProgramme')}</Btn>}
                    </>
                }
                bodyClass="p-0"
            >
                {loading && !data ? <Spinner /> : error ? <div className="p-4"><ErrorBox error={error} /></div> : !data?.length ? <Empty>{status ? tr('list.emptyWithStatus', { status: ts.has(status) ? ts(status) : status }) : tr('list.empty')}</Empty> : (
                    <Table>
                        <thead>
                            <tr className="border-b border-[#E3E8EE] bg-[#F7FAFC]">
                                <th className={th}>{tr('col.programme')}</th><th className={th}>{tr('col.status')}</th><th className={th}>{tr('col.window')}</th>
                                <th className={th}>{tr('col.max')}</th><th className={th}>{tr('col.interest')}</th><th className={th}>{tr('col.term')}</th>
                                <th className={th}>{tr('col.eligibility')}</th><th className={th}></th>
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
                                    <td className={`${td} text-[12px]`} title={termOf(p.termTreatment) ? tr(`term.${p.termTreatment}.summary`) : undefined}>{termOf(p.termTreatment) ? tr(`term.${p.termTreatment}.label`) : p.termTreatment}</td>
                                    <td className={td}><ProgrammeRules p={p} /></td>
                                    <td className={`${td} whitespace-nowrap`}>
                                        <div className="flex gap-1.5 justify-end">
                                            {p.status === 'DRAFT' && (
                                                <>
                                                    <Btn size="sm" variant="primary" busy={action.busy === `${p.id}-OPEN`} disabled={!!action.busy} onClick={() => setProgrammeStatus(p, 'OPEN')}>{tr('list.publish')}</Btn>
                                                    <Btn size="sm" variant="danger" busy={action.busy === `${p.id}-CLOSED`} disabled={!!action.busy} onClick={() => setProgrammeStatus(p, 'CLOSED')}>{tr('list.discard')}</Btn>
                                                </>
                                            )}
                                            {p.status === 'OPEN' && (
                                                <Btn size="sm" variant="danger" busy={action.busy === `${p.id}-CLOSED`} disabled={!!action.busy} onClick={() => setProgrammeStatus(p, 'CLOSED')}>{tr('list.withdraw')}</Btn>
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
                            {tr.rich(actingOn.next === 'OPEN' ? 'list.publishRefused' : 'list.closeRefused', { code: data?.find((p) => p.id === actingOn.id)?.code ?? actingOn.id.slice(0, 8), mono: (c) => <span className="font-mono">{c}</span> })}
                            {actingOn.next === 'OPEN' && ` ${tr('list.makerChecker')}`}
                        </p>
                        <ErrorBox error={action.error} onDismiss={() => { action.clearError(); setActingOn(null); }} />
                    </div>
                )}
            </Card>
        </div>
    );
}
