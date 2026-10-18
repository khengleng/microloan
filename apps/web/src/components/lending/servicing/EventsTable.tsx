"use client";

import { Fragment, useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Btn, JsonBlock, Table, td, tdR, th, thR } from '../ui';
import { MoneyCell } from '../MoneyCell';
import { StatusBadge } from '../StatusBadge';
import { addDecimal } from '../format';
import type { FinancialEvent } from '../types';
import { isReversible } from './ReverseEvent';
import { Person } from '../People';

interface Allocation { id?: string; instalmentNumber: number; component: string; amount: string }

export function EventsTable({ events, currency, onReverse, reverseAllowed }: {
    events: FinancialEvent[]; currency: string; onReverse: (e: FinancialEvent) => void; reverseAllowed: { allowed: boolean; reason?: string };
}) {
    const t = useTranslations('LendingServicing.events');
    const [open, setOpen] = useState<Record<string, boolean>>({});
    const toggle = (id: string) => setOpen((o) => ({ ...o, [id]: !o[id] }));

    return (
        <Table>
            <thead>
                <tr className="border-b border-[#E3E8EE] bg-[#F7FAFC]">
                    <th className={th} />
                    <th className={th}>{t('columns.type')}</th>
                    <th className={th}>{t('columns.status')}</th>
                    <th className={th}>{t('columns.businessDate')}</th>
                    <th className={th}>{t('columns.valueDate')}</th>
                    <th className={thR}>{t('columns.amount', { currency })}</th>
                    <th className={th}>{t('columns.externalRef')}</th>
                    <th className={th}>{t('columns.actor')}</th>
                    <th className={th} />
                </tr>
            </thead>
            <tbody className="divide-y divide-[#F0F2F5]">
                {events.map((e) => {
                    const lines = e.journal?.lines ?? [];
                    const allocations = (e.allocations ?? []) as Allocation[];
                    return (
                        <Fragment key={e.id}>
                            <tr className={e.status === 'REVERSED' ? 'bg-red-50/40' : ''}>
                                <td className={td}>
                                    <button type="button" onClick={() => toggle(e.id)} className="text-[#697386] hover:text-[#1A1F36]" aria-label={t('toggleDetails')}>
                                        {open[e.id] ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                                    </button>
                                </td>
                                <td className={td}>
                                    <span className="font-mono text-[12px] font-semibold">{e.type}</span>
                                    {e.reversalOfId && <div className="text-[10px] text-[#8792A2]">{t('reverses', { id: e.reversalOfId.slice(0, 8) })}</div>}
                                </td>
                                <td className={td}><StatusBadge status={e.status} /></td>
                                <td className={`${td} whitespace-nowrap`}>{e.businessDate?.slice(0, 10)}</td>
                                <td className={`${td} whitespace-nowrap`}>{e.valueDate?.slice(0, 10)}</td>
                                <td className={tdR}><MoneyCell value={e.amount} strong /></td>
                                <td className={td}>{e.externalReference || '—'}</td>
                                <td className={td}><Person id={e.actorId} className="text-[11px]" /></td>
                                <td className={td}>
                                    {isReversible(e) && (
                                        <Btn size="sm" variant="danger" onClick={() => onReverse(e)} disabled={!reverseAllowed.allowed} reason={reverseAllowed.reason}>{t('reverse')}</Btn>
                                    )}
                                </td>
                            </tr>
                            {open[e.id] && (
                                <tr className="bg-[#FAFBFC]">
                                    <td />
                                    <td colSpan={8} className="px-3 py-3">
                                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                                            <div>
                                                <p className="text-[11px] font-bold uppercase tracking-wide text-[#8792A2] mb-1">{t('journal')}</p>
                                                {lines.length === 0 ? <p className="text-[12px] text-[#697386]">{t('noJournalLines')}</p> : (
                                                    <table className="min-w-full border-collapse">
                                                        <thead><tr className="border-b border-[#E3E8EE]"><th className={th}>{t('account')}</th><th className={thR}>{t('debit')}</th><th className={thR}>{t('credit')}</th></tr></thead>
                                                        <tbody className="divide-y divide-[#F0F2F5]">
                                                            {lines.map((l, i) => (
                                                                <tr key={l.id ?? i}>
                                                                    <td className={td}><span className="font-mono text-[12px]">{l.accountCode}</span></td>
                                                                    <td className={tdR}><MoneyCell value={l.debit} /></td>
                                                                    <td className={tdR}><MoneyCell value={l.credit} /></td>
                                                                </tr>
                                                            ))}
                                                            <tr className="border-t border-[#E3E8EE]">
                                                                <td className={`${td} font-bold`}>{t('total')}</td>
                                                                <td className={tdR}><MoneyCell value={addDecimal(...lines.map((l) => l.debit))} strong /></td>
                                                                <td className={tdR}><MoneyCell value={addDecimal(...lines.map((l) => l.credit))} strong /></td>
                                                            </tr>
                                                        </tbody>
                                                    </table>
                                                )}
                                            </div>
                                            <div className="space-y-3">
                                                {allocations.length > 0 && (
                                                    <div>
                                                        <p className="text-[11px] font-bold uppercase tracking-wide text-[#8792A2] mb-1">{t('allocation')}</p>
                                                        <table className="min-w-full border-collapse">
                                                            <thead><tr className="border-b border-[#E3E8EE]"><th className={th}>{t('instalment')}</th><th className={th}>{t('component')}</th><th className={thR}>{t('amount')}</th></tr></thead>
                                                            <tbody className="divide-y divide-[#F0F2F5]">
                                                                {allocations.map((a, i) => (
                                                                    <tr key={a.id ?? i}>
                                                                        <td className={td}>#{a.instalmentNumber}</td>
                                                                        <td className={td}>{a.component}</td>
                                                                        <td className={tdR}><MoneyCell value={a.amount} /></td>
                                                                    </tr>
                                                                ))}
                                                            </tbody>
                                                        </table>
                                                    </div>
                                                )}
                                                <div>
                                                    <p className="text-[11px] font-bold uppercase tracking-wide text-[#8792A2] mb-1">{t('components')}</p>
                                                    <JsonBlock value={e.components} />
                                                </div>
                                                {e.narrative && <p className="text-[12px] text-[#4F566B]">{e.narrative}</p>}
                                            </div>
                                        </div>
                                    </td>
                                </tr>
                            )}
                        </Fragment>
                    );
                })}
            </tbody>
        </Table>
    );
}
