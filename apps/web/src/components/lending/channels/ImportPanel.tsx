"use client";

import { useState } from 'react';
import api from '@/lib/api';
import { useTranslations } from 'next-intl';
import { Btn, Card, Disclosure, ErrorBox, Field, Notice, SelectInput, TextArea, TextInput } from '../ui';
import { useAction } from '../useAsync';
import { useBusinessDate } from '../useBusinessDate';
import { FileLinesTable } from './FileLinesTable';
import { PAYROLL_SAMPLE, SETTLEMENT_CHANNELS, SETTLEMENT_SAMPLE } from './types';
import type { FileView, SettlementChannel } from './types';

type Kind = 'SETTLEMENT' | 'PAYROLL';

/**
 * Import a settlement file (mobile, QR, wallet, agent — UC-18) or an employer
 * payroll remittance (UC-19). The whole file is checked first; if any line is
 * malformed nothing is imported and every error is listed.
 */
export function ImportPanel({ onImported }: { onImported: () => void }) {
    const t = useTranslations('LendingChannels.import');
    const tch = useTranslations('LendingChannels.channel');
    const businessDate = useBusinessDate();
    const [kind, setKind] = useState<Kind>('SETTLEMENT');
    const [channel, setChannel] = useState<SettlementChannel>('WALLET');
    const [employer, setEmployer] = useState('');
    const [period, setPeriod] = useState(businessDate.slice(0, 7));
    const [currency, setCurrency] = useState('USD');
    const [valueDate, setValueDate] = useState(businessDate);
    const [fileName, setFileName] = useState('');
    const [content, setContent] = useState('');
    const [result, setResult] = useState<FileView | null>(null);
    const { busy, error, run, clearError } = useAction();

    const pick = async (file: File | undefined) => {
        if (!file) return;
        setFileName(file.name);
        setContent(await file.text());
        setResult(null);
    };

    const submit = async () => {
        const name = fileName.trim() || `${kind.toLowerCase()}-${businessDate}.csv`;
        const res = await run('import', () =>
            kind === 'SETTLEMENT'
                ? api.post<FileView>('/lending/payment-channels/settlement-files', { channel, fileName: name, content })
                : api.post<FileView>('/lending/payment-channels/payroll-files', { employer: employer.trim(), period, currency, valueDate, fileName: name, content }),
        );
        if (res) { setResult(res.data); onImported(); }
    };

    const ready = content.trim().length > 0 && (kind === 'SETTLEMENT' || employer.trim().length >= 2);

    return (
        <div className="space-y-4">
            <Card title={t('title')} subtitle={t('subtitle')}>
                <div className="space-y-3">
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                        <Field label={t('fileType')}>
                            <SelectInput value={kind} onChange={(v) => { setKind(v as Kind); setResult(null); clearError(); }}
                                options={[{ value: 'SETTLEMENT', label: t('kindSettlement') }, { value: 'PAYROLL', label: t('kindPayroll') }]} />
                        </Field>
                        {kind === 'SETTLEMENT' ? (
                            <Field label={t('channel')}>
                                <SelectInput value={channel} onChange={(v) => setChannel(v as SettlementChannel)} options={SETTLEMENT_CHANNELS.map((c) => ({ value: c.value, label: tch(c.value) }))} />
                            </Field>
                        ) : (
                            <>
                                <Field label={t('employer')}><TextInput value={employer} onChange={setEmployer} maxLength={80} /></Field>
                                <Field label={t('payrollPeriod')}><TextInput type="month" value={period} onChange={setPeriod} /></Field>
                                <Field label={t('currencyValueDate')}>
                                    <div className="flex gap-1">
                                        <SelectInput value={currency} onChange={setCurrency} options={['USD', 'KHR', 'THB']} className="!w-24" />
                                        <TextInput type="date" value={valueDate} onChange={setValueDate} />
                                    </div>
                                </Field>
                            </>
                        )}
                    </div>
                    <Field label={t('csvFile')} hint={t('csvHint')}>
                        <input type="file" accept=".csv,text/csv,text/plain" onChange={(e) => pick(e.target.files?.[0])}
                            className="block text-[13px] text-[#3C4257] file:mr-3 file:rounded file:border file:border-[#E3E8EE] file:bg-white file:px-3 file:py-1 file:text-[12px] file:font-semibold" />
                    </Field>
                    <Field label={t('content')}>
                        <TextArea value={content} onChange={(v) => { setContent(v); setResult(null); }} rows={6} className="font-mono text-[12px]" placeholder={kind === 'SETTLEMENT' ? SETTLEMENT_SAMPLE : PAYROLL_SAMPLE} />
                    </Field>
                    <Disclosure summary={t('fileFormat')}>
                        {kind === 'SETTLEMENT' ? (
                            <div className="text-[12px] text-[#3C4257] space-y-1">
                                <p>{t.rich('settlementFormat1', { code: (chunks) => <code>{chunks}</code> })}</p>
                                <p>{t.rich('settlementFormat2', { code: (chunks) => <code>{chunks}</code> })}</p>
                                <pre className="bg-[#F7FAFC] border border-[#E3E8EE] rounded p-2 overflow-auto">{SETTLEMENT_SAMPLE}</pre>
                            </div>
                        ) : (
                            <div className="text-[12px] text-[#3C4257] space-y-1">
                                <p>{t.rich('payrollFormat1', { code: (chunks) => <code>{chunks}</code> })}</p>
                                <p>{t('payrollFormat2')}</p>
                                <pre className="bg-[#F7FAFC] border border-[#E3E8EE] rounded p-2 overflow-auto">{PAYROLL_SAMPLE}</pre>
                            </div>
                        )}
                    </Disclosure>
                    <ErrorBox error={error} onDismiss={clearError} />
                    <Btn variant="primary" onClick={submit} busy={busy === 'import'} disabled={!ready}>{t('importFile')}</Btn>
                </div>
            </Card>
            {result && (
                <Card
                    title={result.replayed ? t('alreadyImported') : t('imported')}
                    subtitle={t('resultSummary', { file: result.file.fileName, lines: result.file.lineCount, posted: result.file.postedCount, suspense: result.file.suspenseCount, duplicates: result.file.duplicateCount })}
                    bodyClass="p-0"
                >
                    {result.replayed && <div className="p-4"><Notice tone="warn" title={t('importedBefore')}>{t('importedBeforeBody')}</Notice></div>}
                    <FileLinesTable lines={result.lines} />
                </Card>
            )}
        </div>
    );
}
