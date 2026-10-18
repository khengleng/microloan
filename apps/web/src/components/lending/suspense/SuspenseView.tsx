"use client";

import { Fragment, useMemo, useState } from 'react';
import Link from 'next/link';
import { Plus } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useToast } from '@/components/ui/toast';
import { LendingShell, useLendingHref } from '../LendingShell';
import { Btn, Card, Empty, ErrorBox, Spinner, Table, Tabs, td, tdR, th, thR } from '../ui';
import { qs, useApi } from '../useAsync';
import { MoneyCell } from '../MoneyCell';
import { StatusBadge } from '../StatusBadge';
import { addDecimal, fmtDateTime } from '../format';
import { AGE_BUCKETS, CHANNELS, ageBucket } from './types';
import type { AgeBucket, PendingRefund, SuspenseList, SuspensePayment, SuspenseStatus } from './types';
import { ReceiptForm } from './ReceiptForm';
import { MatchPanel } from './MatchPanel';
import { RefundDecisionPanel, RefundProposalPanel } from './RefundPanel';
import { Person } from '../People';

type Filter = SuspenseStatus | '';
type Panel = { id: string; kind: 'match' | 'refund' | 'decision' | 'details' } | null;

const CHANNEL_VALUES = new Set<string>(CHANNELS.map((c) => c.value));

/** Sum of decimal strings per currency, e.g. "USD 1,200 · KHR 400,000". */
function byCurrency(rows: SuspensePayment[], field: 'remaining' | 'amount'): { currency: string; total: string }[] {
    const m = new Map<string, string>();
    for (const r of rows) m.set(r.currency, addDecimal(m.get(r.currency) ?? '0', r[field]));
    return Array.from(m.entries()).map(([currency, total]) => ({ currency, total })).sort((a, b) => a.currency.localeCompare(b.currency));
}

function CurrencyTotals({ rows }: { rows: { currency: string; total: string }[] }) {
    if (rows.length === 0) return <span className="text-[#AAB7C4]">0</span>;
    return (
        <span className="flex flex-col">
            {rows.map((r) => <MoneyCell key={r.currency} value={r.total} currency={r.currency} strong />)}
        </span>
    );
}

function AgeChip({ days }: { days: number }) {
    const t = useTranslations('LendingSuspense.view');
    const b = AGE_BUCKETS.find((x) => x.key === ageBucket(days))!;
    return <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded border text-[11px] font-bold tabular-nums whitespace-nowrap ${b.cls}`}>{t('days', { days })}</span>;
}

export function SuspenseView() {
    const t = useTranslations('LendingSuspense.view');
    const tc = useTranslations('LendingSuspense.channel');
    const href = useLendingHref();
    const { showToast } = useToast();
    const [status, setStatus] = useState<Filter>('OPEN');
    const [bucket, setBucket] = useState<AgeBucket | ''>('');
    const [recording, setRecording] = useState(false);
    const [panel, setPanel] = useState<Panel>(null);
    /** Refund proposals made in this session, by payment id, until the list reloads with them. */
    const [pending, setPending] = useState<Record<string, PendingRefund>>({});

    const open = useApi<SuspenseList>('/lending/suspense?status=OPEN');
    const other = useApi<SuspenseList>(status === 'OPEN' ? null : `/lending/suspense${qs({ status })}`);
    const list = status === 'OPEN' ? open : other;
    const reloadAll = () => { open.reload(); if (status !== 'OPEN') other.reload(); };

    const openRows = useMemo(() => open.data?.payments ?? [], [open.data]);
    const summary = useMemo(() => {
        const oldest = openRows.reduce<SuspensePayment | null>((o, r) => (!o || r.ageDays > o.ageDays ? r : o), null);
        const buckets = AGE_BUCKETS.map((b) => {
            const rows = openRows.filter((r) => ageBucket(r.ageDays) === b.key);
            return { ...b, count: rows.length, totals: byCurrency(rows, 'remaining') };
        });
        return { oldest, buckets, held: byCurrency(openRows, 'remaining') };
    }, [openRows]);

    const rows = (list.data?.payments ?? []).filter((r) => !bucket || ageBucket(r.ageDays) === bucket);
    const defaultCurrency = openRows[0]?.currency ?? 'USD';

    const toggle = (id: string, kind: NonNullable<Panel>['kind']) => setPanel((p) => (p && p.id === id && p.kind === kind ? null : { id, kind }));
    const done = (msg: string) => { showToast(msg, 'success'); setPanel(null); reloadAll(); };

    return (
        <LendingShell
            title="Unidentified payments"
            subtitle="Money received without an identifiable loan is held in suspense until it is matched to a loan or refunded to the payer."
            actions={!recording && <Btn variant="primary" onClick={() => setRecording(true)}><Plus size={15} /> {t('recordReceipt')}</Btn>}
        >
            {recording && (
                <ReceiptForm
                    defaultCurrency={defaultCurrency}
                    onClose={() => setRecording(false)}
                    onDone={(p) => { showToast(t('recorded', { reference: p.reference }), 'success'); setRecording(false); reloadAll(); }}
                />
            )}

            {/* Aging summary (always of OPEN receipts) */}
            <div className="grid grid-cols-2 lg:grid-cols-6 gap-3">
                <SummaryTile label={t('openReceipts')} value={open.data ? String(open.data.totals.open) : '—'} />
                <SummaryTile label={t('totalHeld')} value={<CurrencyTotals rows={summary.held} />} />
                <SummaryTile
                    label={t('oldest')}
                    value={summary.oldest ? <span className="flex items-center gap-2">{t('daysLong', { days: summary.oldest.ageDays })} <AgeChip days={summary.oldest.ageDays} /></span> : '—'}
                    note={summary.oldest ? t('oldestNote', { reference: summary.oldest.reference, date: summary.oldest.valueDate }) : undefined}
                />
                {summary.buckets.map((b) => (
                    <button key={b.key} type="button" onClick={() => { setBucket((x) => (x === b.key ? '' : b.key)); setStatus('OPEN'); }}
                        className={`text-left bg-white border rounded-lg shadow-sm px-4 py-3 transition-colors ${bucket === b.key ? 'border-[#635BFF] ring-1 ring-[#635BFF]/30' : 'border-[#E3E8EE] hover:border-[#C9D7FF]'}`}>
                        <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-[#8792A2]"><span className={`w-2 h-2 rounded-full ${b.dot}`} /> {t(`age.${b.key}`)}</p>
                        <p className="text-[18px] font-bold text-[#1A1F36] mt-0.5">{b.count}</p>
                        <div className="text-[12px]"><CurrencyTotals rows={b.totals} /></div>
                    </button>
                ))}
            </div>
            {open.data && <p className="text-[11px] text-[#697386] -mt-2">{t('ageNote', { date: open.data.businessDate })}</p>}

            <Card
                title={t('receipts')}
                subtitle={list.data ? (bucket ? t('shownAged', { count: rows.length, age: t(`age.${bucket}`) }) : t('shown', { count: rows.length })) : undefined}
                bodyClass="p-0"
                actions={<>
                    {bucket && <Btn size="sm" variant="ghost" onClick={() => setBucket('')}>{t('clearAge')}</Btn>}
                    <Btn size="sm" variant="ghost" onClick={reloadAll}>{t('refresh')}</Btn>
                </>}
            >
                <div className="px-4 pt-2">
                    <Tabs<Filter>
                        value={status}
                        onChange={(v) => { setStatus(v); setPanel(null); }}
                        tabs={[{ value: 'OPEN', label: t('tabOpen') }, { value: 'MATCHED', label: t('tabMatched') }, { value: 'REFUNDED', label: t('tabRefunded') }, { value: '', label: t('tabAll') }]}
                    />
                </div>
                {list.error && <div className="p-4"><ErrorBox error={list.error} /></div>}
                {list.loading && !list.data ? <Spinner /> : rows.length === 0 ? (
                    !list.error && <Empty>{status === 'OPEN' ? t('nothingHeld') : t('noMatch')}</Empty>
                ) : (
                    <Table>
                        <thead>
                            <tr className="border-b border-[#E3E8EE] bg-[#F7FAFC]">
                                <th className={th}>{t('colReference')}</th>
                                <th className={th}>{t('colValueDate')}</th>
                                <th className={th}>{t('colAge')}</th>
                                <th className={th}>{t('colChannel')}</th>
                                <th className={th}>{t('colPayer')}</th>
                                <th className={thR}>{t('colReceived')}</th>
                                <th className={thR}>{t('colStillHeld')}</th>
                                <th className={th}>{t('colStatus')}</th>
                                <th className={th}></th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-[#F0F2F5]">
                            {rows.map((r) => {
                                const b = ageBucket(r.ageDays);
                                const isOpen = r.status === 'OPEN';
                                const pend = pending[r.id] ?? r.pendingRefund ?? undefined;
                                const active = panel?.id === r.id ? panel.kind : null;
                                const rowTone = isOpen ? (b === '31+' ? 'bg-red-50/40' : b === '8-30' ? 'bg-amber-50/40' : '') : '';
                                return (
                                    <Fragment key={r.id}>
                                        <tr className={`${rowTone} ${active ? 'bg-[#F7FAFC]' : 'hover:bg-[#F7FAFC]'}`}>
                                            <td className={td}>
                                                <button type="button" onClick={() => toggle(r.id, 'details')} className="font-mono text-[12px] font-semibold text-[#635BFF] hover:underline">{r.reference}</button>
                                            </td>
                                            <td className={`${td} whitespace-nowrap`}>{r.valueDate}</td>
                                            <td className={td}>{isOpen ? <AgeChip days={r.ageDays} /> : <span className="text-[12px] text-[#8792A2] tabular-nums">{t('days', { days: r.ageDays })}</span>}</td>
                                            <td className={td}>
                                                <div className="text-[12px]">{CHANNEL_VALUES.has(r.channel) ? tc(r.channel) : r.channel}</div>
                                                <div className="font-mono text-[11px] text-[#697386] break-all">{r.externalReference}</div>
                                            </td>
                                            <td className={td}>
                                                {r.payerName || <span className="text-[#AAB7C4]">{t('unknown')}</span>}
                                                {r.narrative && <div className="text-[11px] text-[#697386] line-clamp-2 max-w-[220px]">{r.narrative}</div>}
                                            </td>
                                            <td className={tdR}><MoneyCell value={r.amount} currency={r.currency} /></td>
                                            <td className={tdR}><MoneyCell value={r.remaining} strong={isOpen} /></td>
                                            <td className={td}>
                                                <div className="flex flex-col items-start gap-1">
                                                    <StatusBadge status={r.status} />
                                                    {pend && <StatusBadge status="PENDING_APPROVAL" />}
                                                </div>
                                            </td>
                                            <td className={`${td} text-right whitespace-nowrap`}>
                                                {isOpen && (
                                                    <div className="inline-flex gap-1.5">
                                                        <Btn size="sm" variant={active === 'match' ? 'primary' : 'secondary'} onClick={() => toggle(r.id, 'match')}>{t('match')}</Btn>
                                                        {pend
                                                            ? <Btn size="sm" variant={active === 'decision' ? 'primary' : 'secondary'} onClick={() => toggle(r.id, 'decision')}>{t('refundDecision')}</Btn>
                                                            : <Btn size="sm" variant={active === 'refund' ? 'primary' : 'secondary'} onClick={() => toggle(r.id, 'refund')}>{t('refund')}</Btn>}
                                                    </div>
                                                )}
                                            </td>
                                        </tr>
                                        {active && (
                                            <tr>
                                                <td colSpan={9} className="px-3 py-3 bg-[#FBFCFE]">
                                                    {active === 'details' && <ReceiptDetails payment={r} loanHref={(id) => href(`/lending/loans/${id}`)} />}
                                                    {active === 'match' && <MatchPanel payment={r} onClose={() => setPanel(null)} onDone={done} />}
                                                    {active === 'refund' && (
                                                        <RefundProposalPanel
                                                            payment={r}
                                                            onClose={() => setPanel(null)}
                                                            onProposed={(p) => {
                                                                setPending((s) => ({ ...s, [r.id]: p }));
                                                                showToast(t('refundProposed'), 'success');
                                                                setPanel({ id: r.id, kind: 'decision' });
                                                            }}
                                                        />
                                                    )}
                                                    {active === 'decision' && pend && (
                                                        <RefundDecisionPanel
                                                            payment={r}
                                                            pending={pend}
                                                            onClose={() => setPanel(null)}
                                                            onDecided={(approved) => {
                                                                setPending((s) => { const n = { ...s }; delete n[r.id]; return n; });
                                                                done(approved ? t('refundApproved', { amount: pend.amount, currency: pend.currency }) : t('refundRejected'));
                                                            }}
                                                        />
                                                    )}
                                                </td>
                                            </tr>
                                        )}
                                    </Fragment>
                                );
                            })}
                        </tbody>
                    </Table>
                )}
            </Card>
        </LendingShell>
    );
}

function SummaryTile({ label, value, note }: { label: string; value: React.ReactNode; note?: string }) {
    return (
        <div className="bg-white border border-[#E3E8EE] rounded-lg shadow-sm px-4 py-3">
            <p className="text-[11px] font-bold uppercase tracking-wide text-[#8792A2]">{label}</p>
            <div className="text-[18px] font-bold text-[#1A1F36] mt-0.5">{value}</div>
            {note && <p className="text-[11px] text-[#697386] mt-0.5 truncate">{note}</p>}
        </div>
    );
}

function ReceiptDetails({ payment, loanHref }: { payment: SuspensePayment; loanHref: (id: string) => string }) {
    const t = useTranslations('LendingSuspense.view');
    return (
        <div className="space-y-2">
            <div className="text-[12px] text-[#697386]">
                {t.rich('receivedBy', { when: fmtDateTime(payment.createdAt), who: () => <Person id={payment.receivedBy} /> })}
                {payment.narrative && <> · {payment.narrative}</>}
            </div>
            {payment.matches.length === 0 ? (
                <p className="text-[13px] text-[#697386]">{t('notYetMatched')}</p>
            ) : (
                <Table className="border border-[#E3E8EE] rounded bg-white">
                    <thead>
                        <tr className="border-b border-[#E3E8EE] bg-[#F7FAFC]">
                            <th className={th}>{t('colWhen')}</th>
                            <th className={th}>{t('colKind')}</th>
                            <th className={th}>{t('colLoanReason')}</th>
                            <th className={thR}>{t('colAmount')}</th>
                            <th className={th}>{t('colBy')}</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-[#F0F2F5]">
                        {payment.matches.map((m) => (
                            <tr key={m.id}>
                                <td className={`${td} text-[12px] whitespace-nowrap`}>{fmtDateTime(m.createdAt)}</td>
                                <td className={td}><StatusBadge status={m.kind === 'MATCH' ? 'MATCHED' : 'REFUNDED'} /></td>
                                <td className={td}>
                                    {m.loanAccountId
                                        ? <Link href={loanHref(m.loanAccountId)} className="font-mono text-[12px] text-[#635BFF] hover:underline">{m.loanAccountId.slice(0, 8)}…</Link>
                                        : m.reason || '—'}
                                </td>
                                <td className={tdR}><MoneyCell value={m.amount} currency={payment.currency} /></td>
                                <td className={`${td} text-[12px] text-[#697386]`}><Person id={m.actorId} /></td>
                            </tr>
                        ))}
                    </tbody>
                </Table>
            )}
        </div>
    );
}
