"use client";

import { useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import api from '@/lib/api';
import { useToast } from '@/components/ui/toast';
import { LendingShell, useLendingHref } from '../LendingShell';
import { Btn, Card, Empty, ErrorBox, Field, KV, Notice, SelectInput, Spinner, Table, Tabs, TextInput, td, tdR, th, thR } from '../ui';
import { qs, useAction, useApi } from '../useAsync';
import { MoneyCell } from '../MoneyCell';
import { StatusBadge } from '../StatusBadge';
import { fmtDateTime, todayIso } from '../format';
import { ImportPanel } from './ImportPanel';
import { FileLinesTable } from './FileLinesTable';
import { PayrollSummaryPanel, ReconciliationPanel } from './ReconciliationPanel';
import { CHANNEL_LABEL } from './types';
import type { ChannelFile, ChannelSettings, DebitAttempt, FileView, SettingsView } from './types';

type Tab = 'import' | 'files' | 'reconciliation' | 'payroll' | 'auto-debit' | 'settings';

/**
 * Payment channels (UC-16, UC-18, UC-19, UC-21): file imports, the daily
 * reconciliation, payroll by employer, auto-debit attempts and settings.
 */
export function PaymentChannelsView() {
    const params = useSearchParams();
    const fileParam = params?.get('file') ?? null;
    const [tab, setTab] = useState<Tab>(fileParam ? 'files' : 'import');
    const [version, setVersion] = useState(0);
    return (
        <LendingShell
            title="Payment channels"
            subtitle="Wallet, QR, agent and mobile settlement files, payroll remittances, auto-debit and the daily reconciliation."
        >
            <Tabs<Tab>
                value={tab}
                onChange={setTab}
                tabs={[
                    { value: 'import', label: 'Import file' },
                    { value: 'files', label: 'Files' },
                    { value: 'reconciliation', label: 'Daily reconciliation' },
                    { value: 'payroll', label: 'Payroll by employer' },
                    { value: 'auto-debit', label: 'Auto-debit' },
                    { value: 'settings', label: 'Settings' },
                ]}
            />
            {tab === 'import' && <ImportPanel onImported={() => setVersion((v) => v + 1)} />}
            {tab === 'files' && <FilesPanel key={version} initialFile={fileParam} />}
            {tab === 'reconciliation' && <ReconciliationPanel defaultDate={todayIso()} />}
            {tab === 'payroll' && <PayrollSummaryPanel />}
            {tab === 'auto-debit' && <AutoDebitPanel />}
            {tab === 'settings' && <SettingsPanel />}
        </LendingShell>
    );
}

function FilesPanel({ initialFile }: { initialFile: string | null }) {
    const [channel, setChannel] = useState('');
    const [open, setOpen] = useState<string | null>(initialFile);
    const files = useApi<ChannelFile[]>(`/lending/payment-channels/files${qs({ channel })}`);
    const detail = useApi<FileView>(open ? `/lending/payment-channels/files/${open}` : null);
    return (
        <div className="space-y-4">
            <Card
                title="Imported files"
                bodyClass="p-0"
                actions={<>
                    <SelectInput value={channel} onChange={setChannel} placeholder="All channels" options={Object.entries(CHANNEL_LABEL).map(([value, label]) => ({ value, label }))} className="!w-44" />
                    <Btn size="sm" variant="ghost" onClick={files.reload}>Refresh</Btn>
                </>}
            >
                {files.error && <div className="p-4"><ErrorBox error={files.error} /></div>}
                {files.loading && !files.data ? <Spinner /> : !files.data?.length ? <Empty>No files imported yet.</Empty> : (
                    <Table>
                        <thead>
                            <tr className="border-b border-[#E3E8EE] bg-[#F7FAFC]">
                                <th className={th}>File</th><th className={th}>Channel</th><th className={th}>Imported</th>
                                <th className={thR}>Lines</th><th className={thR}>Posted</th><th className={thR}>Suspense</th><th className={thR}>Dup.</th><th className={thR}>Total</th><th className={th}></th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-[#F0F2F5]">
                            {files.data.map((x) => (
                                <tr key={x.id} className={open === x.id ? 'bg-[#F8F9FF]' : ''}>
                                    <td className={td}>{x.fileName}{x.employer && <p className="text-[11px] text-[#697386]">{x.employer} · {x.period}</p>}</td>
                                    <td className={td}>{CHANNEL_LABEL[x.channel] ?? x.channel}</td>
                                    <td className={td}>{x.businessDate}<p className="text-[11px] text-[#697386]">{fmtDateTime(x.createdAt)}</p></td>
                                    <td className={tdR}>{x.lineCount}</td>
                                    <td className={tdR}>{x.postedCount}</td>
                                    <td className={tdR}>{x.suspenseCount}</td>
                                    <td className={tdR}>{x.duplicateCount}</td>
                                    <td className={tdR}>{Object.entries(x.totals).map(([c, v]) => <div key={c}><MoneyCell value={v} currency={c} /></div>)}</td>
                                    <td className={td}><Btn size="sm" variant="ghost" onClick={() => setOpen((o) => (o === x.id ? null : x.id))}>{open === x.id ? 'Hide' : 'Lines'}</Btn></td>
                                </tr>
                            ))}
                        </tbody>
                    </Table>
                )}
            </Card>
            {open && (
                <Card title={detail.data ? `${detail.data.file.fileName} — lines` : 'Lines'} bodyClass="p-0">
                    {detail.error && <div className="p-4"><ErrorBox error={detail.error} /></div>}
                    {detail.data ? <FileLinesTable lines={detail.data.lines} /> : <Spinner />}
                </Card>
            )}
        </div>
    );
}

function AutoDebitPanel() {
    const href = useLendingHref();
    const [status, setStatus] = useState('');
    const rows = useApi<DebitAttempt[]>(`/lending/payment-channels/auto-debit/attempts${qs({ status })}`);
    return (
        <Card
            title="Collection attempts"
            subtitle="End of day collects instalments due under active mandates; failed attempts are retried per the settings and the borrower is notified. Mandates are set up on the loan screen."
            bodyClass="p-0"
            actions={<>
                <SelectInput value={status} onChange={setStatus} placeholder="All outcomes" options={['SUCCEEDED', 'FAILED', 'SUSPENSE', 'PENDING']} className="!w-40" />
                <Btn size="sm" variant="ghost" onClick={rows.reload}>Refresh</Btn>
            </>}
        >
            {rows.error && <div className="p-4"><ErrorBox error={rows.error} /></div>}
            {rows.loading && !rows.data ? <Spinner /> : !rows.data?.length ? <Empty>No collection attempts yet.</Empty> : (
                <Table>
                    <thead>
                        <tr className="border-b border-[#E3E8EE] bg-[#F7FAFC]">
                            <th className={th}>Loan</th><th className={th}>Mandate</th><th className={th}>Due date</th><th className={th}>Attempt</th>
                            <th className={thR}>Amount</th><th className={th}>Outcome</th><th className={th}>Next retry</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-[#F0F2F5]">
                        {rows.data.map((a) => (
                            <tr key={a.id}>
                                <td className={td}><Link href={href(`/lending/loans/${a.loanAccountId}`)} className="text-[#635BFF] font-semibold hover:underline">{a.loanReference ?? 'Loan'}</Link></td>
                                <td className={`${td} font-mono text-[12px]`}>{a.mandateReference}</td>
                                <td className={td}>{a.dueDate}</td>
                                <td className={td}>#{a.attemptNo} on {a.businessDate}</td>
                                <td className={tdR}><MoneyCell value={a.amount} currency={a.currency} /></td>
                                <td className={td}><StatusBadge status={a.status} />{a.failureCode && <span className="ml-1 font-mono text-[11px] text-red-700">{a.failureCode}</span>}{a.detail && <p className="text-[11px] text-[#697386]">{a.detail}</p>}</td>
                                <td className={td}>{a.nextRetryDate ?? '—'}</td>
                            </tr>
                        ))}
                    </tbody>
                </Table>
            )}
        </Card>
    );
}

function SettingsPanel() {
    const view = useApi<SettingsView>('/lending/payment-channels/settings');
    if (view.error) return <ErrorBox error={view.error} />;
    if (!view.data) return <Spinner />;
    return <SettingsForm view={view.data} onSaved={view.reload} />;
}

function SettingsForm({ view, onSaved }: { view: SettingsView; onSaved: () => void }) {
    const { showToast } = useToast();
    const s = view.settings;
    const [form, setForm] = useState<Record<keyof ChannelSettings, string>>({
        fxSpreadBps: String(s.fxSpreadBps),
        fxMaxRateAgeDays: String(s.fxMaxRateAgeDays),
        autoDebitMaxAttempts: String(s.autoDebitMaxAttempts),
        autoDebitRetryDays: String(s.autoDebitRetryDays),
    });
    const { busy, error, run, clearError } = useAction();
    const set = (k: keyof ChannelSettings) => (v: string) => setForm((f) => ({ ...f, [k]: v.replace(/\D/g, '') }));
    const save = async () => {
        const body = Object.fromEntries(Object.entries(form).map(([k, v]) => [k, Number(v || '0')]));
        const res = await run('save', () => api.put('/lending/payment-channels/settings', body));
        if (res) { showToast('Payment-channel settings saved', 'success'); onSaved(); }
    };
    const a = view.adapters;
    return (
        <div className="space-y-4">
            <Card title="Integrations">
                <KV cols={2} items={[
                    ['Bank auto-debit', <span key="b">{a.bankDebit.name} <StatusBadge status={a.bankDebit.real ? 'ENABLED' : a.bankDebit.usable ? 'SIMULATION_ONLY' : 'DISABLED'} /></span>],
                    ['Exchange rates', <span key="f">{a.fxRates.name} <StatusBadge status={a.fxRates.real ? 'ENABLED' : a.fxRates.usable ? 'SIMULATION_ONLY' : 'DISABLED'} /></span>],
                ]} />
                {!a.bankDebit.real && <div className="mt-3"><Notice tone="warn" title="Auto-debit uses a mock bank">No money moves: accounts ending in 000 are refused for insufficient funds, in 999 as closed, anything else succeeds. Production refuses the mock.</Notice></div>}
                {a.fxRates.name === 'TENANT_RATE_TABLE' && <p className="mt-3 text-[12px] text-[#697386]">Rates come from this organisation&apos;s published exchange rates (FX settings).</p>}
            </Card>
            <Card title="Settings" subtitle="Changes apply from the next payment or end-of-day run.">
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                    <Field label="FX spread (basis points)" hint="Taken off the mid rate when the bank buys the payment currency; 0–1000"><TextInput value={form.fxSpreadBps} onChange={set('fxSpreadBps')} inputMode="numeric" /></Field>
                    <Field label="Rate may be up to (days old)" hint="0 = only a rate published for the value date"><TextInput value={form.fxMaxRateAgeDays} onChange={set('fxMaxRateAgeDays')} inputMode="numeric" /></Field>
                    <Field label="Auto-debit attempts per due date" hint="Including the first; 1–10"><TextInput value={form.autoDebitMaxAttempts} onChange={set('autoDebitMaxAttempts')} inputMode="numeric" /></Field>
                    <Field label="Days between attempts" hint="1–31"><TextInput value={form.autoDebitRetryDays} onChange={set('autoDebitRetryDays')} inputMode="numeric" /></Field>
                </div>
                <div className="mt-3 space-y-2">
                    <ErrorBox error={error} onDismiss={clearError} />
                    <Btn variant="primary" onClick={save} busy={busy === 'save'}>Save settings</Btn>
                </div>
            </Card>
        </div>
    );
}
