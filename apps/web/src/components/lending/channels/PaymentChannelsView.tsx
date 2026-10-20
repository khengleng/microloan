"use client";

import { useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import api from '@/lib/api';
import { useTranslations } from 'next-intl';
import { useToast } from '@/components/ui/toast';
import { LendingShell, useLendingHref } from '../LendingShell';
import { Btn, Card, Empty, ErrorBox, Field, KV, Notice, SelectInput, Spinner, Table, Tabs, TextInput, td, tdR, th, thR } from '../ui';
import { qs, useAction, useApi } from '../useAsync';
import { MoneyCell } from '../MoneyCell';
import { StatusBadge } from '../StatusBadge';
import { fmtDateTime } from '../format';
import { useBusinessDate } from '../useBusinessDate';
import { useWorkspace } from '@/lib/workspace';
import { ImportPanel } from './ImportPanel';
import { FileLinesTable } from './FileLinesTable';
import { PayrollSummaryPanel, ReconciliationPanel } from './ReconciliationPanel';
import { CHANNEL_LABEL } from './types';
import type { ChannelFile, ChannelSettings, DebitAttempt, FileView, SettingsView } from './types';

const OUTCOMES = ['SUCCEEDED', 'FAILED', 'SUSPENSE', 'PENDING'];

type Tab = 'import' | 'files' | 'reconciliation' | 'payroll' | 'auto-debit' | 'settings';

/**
 * Payment channels (UC-16, UC-18, UC-19, UC-21): file imports, the daily
 * reconciliation, payroll by employer, auto-debit attempts and settings.
 */
export function PaymentChannelsView() {
    const params = useSearchParams();
    const fileParam = params?.get('file') ?? null;
    const { can } = useWorkspace();
    // Importing a file posts repayments (payment.channel_file.import → loan.repayment.post).
    const canImport = can('loan.repayment.post');
    const [tab, setTab] = useState<Tab>(fileParam || !canImport ? 'files' : 'import');
    const [version, setVersion] = useState(0);
    const businessDate = useBusinessDate();
    const t = useTranslations('LendingChannels.view');
    const tn = useTranslations('Workspace.nav');
    const tp = useTranslations('LendingPages');
    return (
        <LendingShell
            title={tn('paymentChannels')}
            subtitle={tp('paymentChannels')}
        >
            <Tabs<Tab>
                value={tab}
                onChange={setTab}
                tabs={[
                    ...(canImport ? [{ value: 'import' as Tab, label: t('tabImport') }] : []),
                    { value: 'files', label: t('tabFiles') },
                    { value: 'reconciliation', label: t('tabReconciliation') },
                    { value: 'payroll', label: t('tabPayroll') },
                    { value: 'auto-debit', label: t('tabAutoDebit') },
                    { value: 'settings', label: t('tabSettings') },
                ]}
            />
            {tab === 'import' && canImport && <ImportPanel onImported={() => setVersion((v) => v + 1)} />}
            {tab === 'files' && <FilesPanel key={version} initialFile={fileParam} />}
            {tab === 'reconciliation' && <ReconciliationPanel defaultDate={businessDate} />}
            {tab === 'payroll' && <PayrollSummaryPanel />}
            {tab === 'auto-debit' && <AutoDebitPanel />}
            {tab === 'settings' && <SettingsPanel />}
        </LendingShell>
    );
}

function FilesPanel({ initialFile }: { initialFile: string | null }) {
    const t = useTranslations('LendingChannels.files');
    const tch = useTranslations('LendingChannels.channel');
    const [channel, setChannel] = useState('');
    const [open, setOpen] = useState<string | null>(initialFile);
    const files = useApi<ChannelFile[]>(`/lending/payment-channels/files${qs({ channel })}`);
    const detail = useApi<FileView>(open ? `/lending/payment-channels/files/${open}` : null);
    return (
        <div className="space-y-4">
            <Card
                title={t('title')}
                bodyClass="p-0"
                actions={<>
                    <SelectInput value={channel} onChange={setChannel} placeholder={t('allChannels')} options={Object.keys(CHANNEL_LABEL).map((value) => ({ value, label: tch(value) }))} className="!w-44" />
                    <Btn size="sm" variant="ghost" onClick={files.reload}>{t('refresh')}</Btn>
                </>}
            >
                {files.error && <div className="p-4"><ErrorBox error={files.error} /></div>}
                {files.loading && !files.data ? <Spinner /> : !files.data?.length ? <Empty>{t('none')}</Empty> : (
                    <Table>
                        <thead>
                            <tr className="border-b border-[#E3E8EE] bg-[#F7FAFC]">
                                <th className={th}>{t('colFile')}</th><th className={th}>{t('colChannel')}</th><th className={th}>{t('colImported')}</th>
                                <th className={thR}>{t('colLines')}</th><th className={thR}>{t('colPosted')}</th><th className={thR}>{t('colSuspense')}</th><th className={thR}>{t('colDup')}</th><th className={thR}>{t('colTotal')}</th><th className={th}></th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-[#F0F2F5]">
                            {files.data.map((x) => (
                                <tr key={x.id} className={open === x.id ? 'bg-[#F8F9FF]' : ''}>
                                    <td className={td}>{x.fileName}{x.employer && <p className="text-[11px] text-[#697386]">{x.employer} · {x.period}</p>}</td>
                                    <td className={td}>{CHANNEL_LABEL[x.channel] ? tch(x.channel) : x.channel}</td>
                                    <td className={td}>{x.businessDate}<p className="text-[11px] text-[#697386]">{fmtDateTime(x.createdAt)}</p></td>
                                    <td className={tdR}>{x.lineCount}</td>
                                    <td className={tdR}>{x.postedCount}</td>
                                    <td className={tdR}>{x.suspenseCount}</td>
                                    <td className={tdR}>{x.duplicateCount}</td>
                                    <td className={tdR}>{Object.entries(x.totals).map(([c, v]) => <div key={c}><MoneyCell value={v} currency={c} /></div>)}</td>
                                    <td className={td}><Btn size="sm" variant="ghost" onClick={() => setOpen((o) => (o === x.id ? null : x.id))}>{open === x.id ? t('hide') : t('lines')}</Btn></td>
                                </tr>
                            ))}
                        </tbody>
                    </Table>
                )}
            </Card>
            {open && (
                <Card title={detail.data ? t('fileLines', { file: detail.data.file.fileName }) : t('lines')} bodyClass="p-0">
                    {detail.error && <div className="p-4"><ErrorBox error={detail.error} /></div>}
                    {detail.data ? <FileLinesTable lines={detail.data.lines} /> : <Spinner />}
                </Card>
            )}
        </div>
    );
}

/** Shown wherever auto-debit appears while the bank adapter is a mock, not only on Settings. */
export function MockBankNotice({ className }: { className?: string }) {
    const t = useTranslations('LendingChannels.mock');
    const view = useApi<SettingsView>('/lending/payment-channels/settings');
    if (!view.data || view.data.adapters.bankDebit.real) return null;
    return <div className={className}><Notice tone="warn" title={t('title')}>{t('bodyLong')}</Notice></div>;
}

function AutoDebitPanel() {
    const t = useTranslations('LendingChannels.autoDebit');
    const href = useLendingHref();
    const [status, setStatus] = useState('');
    const rows = useApi<DebitAttempt[]>(`/lending/payment-channels/auto-debit/attempts${qs({ status })}`);
    return (
        <>
        <MockBankNotice />
        <Card
            title={t('title')}
            subtitle={t('subtitle')}
            bodyClass="p-0"
            actions={<>
                <SelectInput value={status} onChange={setStatus} placeholder={t('allOutcomes')} options={OUTCOMES.map((o) => ({ value: o, label: t(`outcome.${o}`) }))} className="!w-40" />
                <Btn size="sm" variant="ghost" onClick={rows.reload}>{t('refresh')}</Btn>
            </>}
        >
            {rows.error && <div className="p-4"><ErrorBox error={rows.error} /></div>}
            {rows.loading && !rows.data ? <Spinner /> : !rows.data?.length ? <Empty>{t('none')}</Empty> : (
                <Table>
                    <thead>
                        <tr className="border-b border-[#E3E8EE] bg-[#F7FAFC]">
                            <th className={th}>{t('colLoan')}</th><th className={th}>{t('colMandate')}</th><th className={th}>{t('colDueDate')}</th><th className={th}>{t('colAttempt')}</th>
                            <th className={thR}>{t('colAmount')}</th><th className={th}>{t('colOutcome')}</th><th className={th}>{t('colNextRetry')}</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-[#F0F2F5]">
                        {rows.data.map((a) => (
                            <tr key={a.id}>
                                <td className={td}><Link href={href(`/lending/loans/${a.loanAccountId}`)} className="text-[#635BFF] font-semibold hover:underline">{a.loanReference ?? t('loanFallback')}</Link></td>
                                <td className={`${td} font-mono text-[12px]`}>{a.mandateReference}</td>
                                <td className={td}>{a.dueDate}</td>
                                <td className={td}>{t('attemptOn', { no: a.attemptNo, date: a.businessDate })}</td>
                                <td className={tdR}><MoneyCell value={a.amount} currency={a.currency} /></td>
                                <td className={td}><StatusBadge status={a.status} />{a.failureCode && <span className="ml-1 font-mono text-[11px] text-red-700">{a.failureCode}</span>}{a.detail && <p className="text-[11px] text-[#697386]">{a.detail}</p>}</td>
                                <td className={td}>{a.nextRetryDate ?? '—'}</td>
                            </tr>
                        ))}
                    </tbody>
                </Table>
            )}
        </Card>
        </>
    );
}

function SettingsPanel() {
    const view = useApi<SettingsView>('/lending/payment-channels/settings');
    if (view.error) return <ErrorBox error={view.error} />;
    if (!view.data) return <Spinner />;
    return <SettingsForm view={view.data} onSaved={view.reload} />;
}

function SettingsForm({ view, onSaved }: { view: SettingsView; onSaved: () => void }) {
    const t = useTranslations('LendingChannels.settings');
    const tm = useTranslations('LendingChannels.mock');
    const { showToast } = useToast();
    const { can } = useWorkspace();
    // Reading the settings needs loan.read; changing them is payment.channel.configure (rate_observation.manage).
    const canConfigure = can('rate_observation.manage');
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
        if (res) { showToast(t('saved'), 'success'); onSaved(); }
    };
    const a = view.adapters;
    return (
        <div className="space-y-4">
            <Card title={t('integrations')}>
                <KV cols={2} items={[
                    [t('bankAutoDebit'), <span key="b">{a.bankDebit.name} <StatusBadge status={a.bankDebit.real ? 'ENABLED' : a.bankDebit.usable ? 'SIMULATION_ONLY' : 'DISABLED'} /></span>],
                    [t('exchangeRates'), <span key="f">{a.fxRates.name} <StatusBadge status={a.fxRates.real ? 'ENABLED' : a.fxRates.usable ? 'SIMULATION_ONLY' : 'DISABLED'} /></span>],
                ]} />
                {!a.bankDebit.real && <div className="mt-3"><Notice tone="warn" title={tm('title')}>{tm('body')}</Notice></div>}
                {a.fxRates.name === 'TENANT_RATE_TABLE' && <p className="mt-3 text-[12px] text-[#697386]">{t('tenantRates')}</p>}
            </Card>
            <Card title={t('title')} subtitle={t('subtitle')}>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                    <Field label={t('fxSpread')} hint={t('fxSpreadHint')}><TextInput value={form.fxSpreadBps} onChange={set('fxSpreadBps')} inputMode="numeric" disabled={!canConfigure} /></Field>
                    <Field label={t('rateAge')} hint={t('rateAgeHint')}><TextInput value={form.fxMaxRateAgeDays} onChange={set('fxMaxRateAgeDays')} inputMode="numeric" disabled={!canConfigure} /></Field>
                    <Field label={t('attempts')} hint={t('attemptsHint')}><TextInput value={form.autoDebitMaxAttempts} onChange={set('autoDebitMaxAttempts')} inputMode="numeric" disabled={!canConfigure} /></Field>
                    <Field label={t('retryDays')} hint={t('retryDaysHint')}><TextInput value={form.autoDebitRetryDays} onChange={set('autoDebitRetryDays')} inputMode="numeric" disabled={!canConfigure} /></Field>
                </div>
                <div className="mt-3 space-y-2">
                    <ErrorBox error={error} onDismiss={clearError} />
                    {canConfigure
                        ? <Btn variant="primary" onClick={save} busy={busy === 'save'}>{t('save')}</Btn>
                        : <p className="text-[12px] text-[#697386]">{t('readOnly')}</p>}
                </div>
            </Card>
        </div>
    );
}
