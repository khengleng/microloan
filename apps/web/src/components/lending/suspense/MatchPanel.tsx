"use client";

import { useState } from 'react';
import api from '@/lib/api';
import { useTranslations } from 'next-intl';
import { ActionPanel, Btn, Empty, ErrorBox, Field, SelectInput, Spinner, Table, TextInput, td, tdR, th, thR } from '../ui';
import { clean, idem, qs, useAction, useApi, useIdempotencyKey } from '../useAsync';
import { MoneyCell } from '../MoneyCell';
import { StatusBadge } from '../StatusBadge';
import { compareDecimal } from '../format';
import type { LoanSummary, Paged } from '../types';
import type { SuspensePayment } from './types';

const MONEY_RE = /^\d+(\.\d{1,4})?$/;

/** Apply some or all of a held receipt to a loan — posted as an ordinary repayment funded from suspense. */
export function MatchPanel({ payment, onDone, onClose }: { payment: SuspensePayment; onDone: (msg: string) => void; onClose: () => void }) {
    const t = useTranslations('LendingSuspense.match');
    const [search, setSearch] = useState(payment.externalReference && /^LN-/i.test(payment.externalReference) ? payment.externalReference : '');
    const [query, setQuery] = useState<string | null>(null);
    const [loan, setLoan] = useState<LoanSummary | null>(null);
    const [amount, setAmount] = useState(payment.remaining);
    const [applyExcessAs, setApplyExcessAs] = useState('');
    const [strategy, setStrategy] = useState('');
    const [problem, setProblem] = useState('');
    const { busy, error, run, clearError } = useAction();
    const key = useIdempotencyKey();
    const loans = useApi<Paged<LoanSummary>>(query === null ? null : `/lending/loans${qs({ search: query })}`);
    const rows = loans.data?.data ?? [];

    const doSearch = () => { setQuery(search.trim()); setLoan(null); };

    const post = async () => {
        if (!loan) { setProblem(t('chooseLoan')); return; }
        const a = amount.trim();
        if (!MONEY_RE.test(a) || !/[1-9]/.test(a)) { setProblem(t('positiveAmount')); return; }
        if (compareDecimal(a, payment.remaining) > 0) { setProblem(t('atMost', { amount: payment.remaining, currency: payment.currency })); return; }
        setProblem('');
        const body = clean({ loanId: loan.id, amount: a, applyExcessAs, prepaymentStrategy: strategy });
        const k = key.keyFor({ id: payment.id, ...body });
        const res = await run('match', () => api.post(`/lending/suspense/${payment.id}/matches`, body, idem(k)));
        if (res) {
            key.reset();
            onDone(t('applied', { amount: a, currency: payment.currency, receipt: payment.reference, loan: loan.reference }));
        }
    };

    return (
        <ActionPanel title={t('title', { reference: payment.reference })} onClose={onClose}>
            <div className="flex flex-wrap items-end gap-2">
                <Field label={t('findLoan')} className="flex-1 min-w-[220px]">
                    <TextInput value={search} onChange={setSearch} placeholder={t('findPlaceholder')} onKeyDown={(e) => { if (e.key === 'Enter') doSearch(); }} />
                </Field>
                <Btn onClick={doSearch}>{t('search')}</Btn>
            </div>

            {query !== null && (
                <div className="border border-[#E3E8EE] rounded bg-white max-h-64 overflow-auto">
                    {loans.error && <div className="p-3"><ErrorBox error={loans.error} /></div>}
                    {loans.loading && !loans.data ? <Spinner label={t('searching')} /> : rows.length === 0 ? (
                        !loans.error && <Empty>{t('noMatch', { query })}</Empty>
                    ) : (
                        <Table>
                            <thead>
                                <tr className="border-b border-[#E3E8EE] bg-[#F7FAFC]">
                                    <th className={th}>{t('colReference')}</th>
                                    <th className={th}>{t('colStatus')}</th>
                                    <th className={thR}>{t('colPrincipal')}</th>
                                    <th className={thR}>{t('colDpd')}</th>
                                    <th className={th}></th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-[#F0F2F5]">
                                {rows.map((l) => {
                                    const wrongCcy = l.currency !== payment.currency;
                                    const chosen = loan?.id === l.id;
                                    return (
                                        <tr key={l.id} className={chosen ? 'bg-[#F0F5FF]' : ''}>
                                            <td className={`${td} font-mono text-[12px] font-semibold`}>{l.reference}</td>
                                            <td className={td}><StatusBadge status={l.status} /></td>
                                            <td className={tdR}><MoneyCell value={l.principalOutstanding} currency={l.currency} /></td>
                                            <td className={`${tdR} ${l.daysPastDue > 0 ? 'text-red-600 font-semibold' : ''}`}>{l.daysPastDue}</td>
                                            <td className={`${td} text-right`}>
                                                <Btn size="sm" variant={chosen ? 'primary' : 'secondary'} disabled={wrongCcy}
                                                    reason={wrongCcy ? t('wrongCurrency', { receipt: payment.currency, loan: l.currency }) : undefined}
                                                    onClick={() => { setLoan(l); setProblem(''); }}>
                                                    {chosen ? t('selected') : t('select')}
                                                </Btn>
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </Table>
                    )}
                </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                <Field label={t('loan')}>
                    <div className={`${loan ? 'font-mono font-semibold text-[#1A1F36]' : 'text-[#AAB7C4]'} text-[13px] py-1.5`}>{loan?.reference ?? t('noneSelected')}</div>
                </Field>
                <Field label={t('amount', { currency: payment.currency })} hint={t('upTo', { amount: payment.remaining })} error={problem || undefined}>
                    <TextInput value={amount} onChange={setAmount} inputMode="decimal" />
                </Field>
                <Field label={t('applyExcessAs')} hint={t('applyExcessHint')}>
                    <SelectInput value={applyExcessAs} onChange={setApplyExcessAs} placeholder={t('productDefault')}
                        options={[{ value: 'ADVANCE', label: t('excessAdvance') }, { value: 'PREPAY', label: t('excessPrepay') }]} />
                </Field>
                <Field label={t('strategy')} hint={t('strategyHint')}>
                    <SelectInput value={strategy} onChange={setStrategy} placeholder={t('productDefault')}
                        options={[{ value: 'RECAST', label: t('strategyRecast') }, { value: 'SHORTEN', label: t('strategyShorten') }]} />
                </Field>
            </div>
            <p className="text-[11px] text-[#697386]">{t('postedNote', { date: payment.valueDate })}</p>
            <ErrorBox error={error} onDismiss={clearError} />
            <Btn variant="primary" onClick={post} busy={busy === 'match'} disabled={!loan}>{t('applyToLoan')}</Btn>
        </ActionPanel>
    );
}
