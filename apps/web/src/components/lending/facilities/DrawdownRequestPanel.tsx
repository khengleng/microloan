"use client";

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import api from '@/lib/api';
import { ActionPanel, Btn, ErrorBox, Field, IssueList, KV, Notice, SelectInput, TextInput } from '../ui';
import { clean, qs, useAction, useApi } from '../useAsync';
import { fmtRate } from '../format';
import { Money } from '../MoneyCell';
import { MONEY_RE, type DrawdownCheck, type FacilityTerms } from './types';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Request a drawdown. While the operator types, the server prices the request
 * (GET drawdown-simulation) against committed movements and reports every
 * reason it would be refused, so problems show before anything is written.
 */
export function DrawdownRequestPanel({ facilityId, terms, onDone, onClose }: {
    facilityId: string; terms: FacilityTerms; onDone: (msg: string) => void; onClose: () => void;
}) {
    const tr = useTranslations('LendingFacilities.drawdownRequest');
    const staged = terms.type === 'STAGED_DRAWDOWN';
    const cur = terms.currency;
    const [amount, setAmount] = useState('');
    const [valueDate, setValueDate] = useState('');
    const [trancheCode, setTrancheCode] = useState('');
    const [purpose, setPurpose] = useState('');
    const [problem, setProblem] = useState('');
    const { busy, error, run, clearError } = useAction();

    // Debounce the simulation so it runs once the operator pauses typing.
    const [probe, setProbe] = useState<{ amount: string; valueDate: string; trancheCode: string } | null>(null);
    useEffect(() => {
        const a = amount.trim();
        const t = setTimeout(() => {
            setProbe(MONEY_RE.test(a) && /[1-9]/.test(a) && (!valueDate || DATE_RE.test(valueDate))
                ? { amount: a, valueDate, trancheCode }
                : null);
        }, 400);
        return () => clearTimeout(t);
    }, [amount, valueDate, trancheCode]);
    const sim = useApi<DrawdownCheck>(probe ? `/lending/facilities/${facilityId}/drawdown-simulation${qs(probe)}` : null);

    const submit = async () => {
        const a = amount.trim();
        if (!MONEY_RE.test(a) || !/[1-9]/.test(a)) { setProblem(tr('problems.amount')); return; }
        if (staged && !trancheCode) { setProblem(tr('problems.tranche')); return; }
        setProblem('');
        const body = clean({ amount: a, valueDate, trancheCode, purpose: purpose.trim() });
        const res = await run('request', () => api.post(`/lending/facilities/${facilityId}/drawdowns`, body));
        if (res) onDone(tr('toast.requested'));
    };

    const limits = [
        terms.minimumDrawdown ? tr('limits.minimum', { currency: cur, amount: terms.minimumDrawdown }) : null,
        terms.maximumDrawdown ? tr('limits.maximum', { currency: cur, amount: terms.maximumDrawdown }) : null,
    ].filter(Boolean).join(' · ');

    return (
        <ActionPanel title={tr('title')} onClose={onClose}>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                <Field label={tr('fields.amount', { currency: cur })} hint={limits || undefined} error={problem || undefined}>
                    <TextInput value={amount} onChange={setAmount} inputMode="decimal" />
                </Field>
                <Field label={tr('fields.valueDate')} hint={tr('fields.valueDateHint')}>
                    <TextInput type="date" value={valueDate} onChange={setValueDate} />
                </Field>
                {staged && (
                    <Field label={tr('fields.tranche')} hint={tr('fields.trancheHint')}>
                        <SelectInput
                            value={trancheCode}
                            onChange={setTrancheCode}
                            placeholder={tr('fields.selectTranche')}
                            options={terms.tranches.map((t) => ({ value: t.code, label: tr('fields.trancheOption', { code: t.code, currency: cur, amount: t.amount, from: t.availableFrom }) }))}
                        />
                    </Field>
                )}
                <Field label={tr('fields.purpose')} hint={tr('fields.purposeHint')} className={staged ? '' : 'lg:col-span-2'}>
                    <TextInput value={purpose} onChange={setPurpose} maxLength={200} />
                </Field>
            </div>

            {probe && (
                <div>
                    {sim.loading && <p className="text-[12px] text-[#697386]">{tr('sim.checking')}</p>}
                    {sim.error && !sim.loading && <ErrorBox error={sim.error} />}
                    {sim.data && !sim.loading && (sim.data.ok ? (
                        <Notice tone="success" title={tr('sim.permitted')}>
                            {sim.data.resulting && (
                                <div className="mt-2">
                                    <KV
                                        cols={4}
                                        items={[
                                            [tr('sim.outstandingAfter'), <Money key="o" value={sim.data.resulting.outstanding} currency={cur} />],
                                            [tr('sim.availableAfter'), <Money key="a" value={sim.data.resulting.available} currency={cur} />],
                                            [tr('sim.utilizationAfter'), fmtRate(sim.data.resulting.utilization, 2)],
                                            [tr('sim.overLimit'), <Money key="ol" value={sim.data.resulting.overlimit} currency={cur} />],
                                        ]}
                                    />
                                </div>
                            )}
                            <p className="text-[11px] mt-2 opacity-80">{tr('sim.recheck')}</p>
                        </Notice>
                    ) : (
                        <Notice tone="warn" title={tr('sim.refused')}>
                            <IssueList issues={sim.data.issues} />
                        </Notice>
                    ))}
                </div>
            )}

            <ErrorBox error={error} onDismiss={clearError} />
            <Btn variant="primary" onClick={submit} busy={busy === 'request'}>{tr('actions.request')}</Btn>
        </ActionPanel>
    );
}
