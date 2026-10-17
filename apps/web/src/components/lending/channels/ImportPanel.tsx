"use client";

import { useState } from 'react';
import api from '@/lib/api';
import { Btn, Card, Disclosure, ErrorBox, Field, Notice, SelectInput, TextArea, TextInput } from '../ui';
import { useAction } from '../useAsync';
import { todayIso } from '../format';
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
    const [kind, setKind] = useState<Kind>('SETTLEMENT');
    const [channel, setChannel] = useState<SettlementChannel>('WALLET');
    const [employer, setEmployer] = useState('');
    const [period, setPeriod] = useState(todayIso().slice(0, 7));
    const [currency, setCurrency] = useState('USD');
    const [valueDate, setValueDate] = useState(todayIso());
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
        const name = fileName.trim() || `${kind.toLowerCase()}-${todayIso()}.csv`;
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
            <Card title="Import a file" subtitle="Lines that name a live loan post repayments; every other line is held in unidentified payments with its reason. A file or line sent twice is only applied once.">
                <div className="space-y-3">
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                        <Field label="File type">
                            <SelectInput value={kind} onChange={(v) => { setKind(v as Kind); setResult(null); clearError(); }}
                                options={[{ value: 'SETTLEMENT', label: 'Channel settlement' }, { value: 'PAYROLL', label: 'Payroll remittance' }]} />
                        </Field>
                        {kind === 'SETTLEMENT' ? (
                            <Field label="Channel">
                                <SelectInput value={channel} onChange={(v) => setChannel(v as SettlementChannel)} options={SETTLEMENT_CHANNELS} />
                            </Field>
                        ) : (
                            <>
                                <Field label="Employer"><TextInput value={employer} onChange={setEmployer} maxLength={80} /></Field>
                                <Field label="Payroll period"><TextInput type="month" value={period} onChange={setPeriod} /></Field>
                                <Field label="Currency / value date">
                                    <div className="flex gap-1">
                                        <SelectInput value={currency} onChange={setCurrency} options={['USD', 'KHR', 'THB']} className="!w-24" />
                                        <TextInput type="date" value={valueDate} onChange={setValueDate} />
                                    </div>
                                </Field>
                            </>
                        )}
                    </div>
                    <Field label="CSV file" hint="Or paste the content below.">
                        <input type="file" accept=".csv,text/csv,text/plain" onChange={(e) => pick(e.target.files?.[0])}
                            className="block text-[13px] text-[#3C4257] file:mr-3 file:rounded file:border file:border-[#E3E8EE] file:bg-white file:px-3 file:py-1 file:text-[12px] file:font-semibold" />
                    </Field>
                    <Field label="Content">
                        <TextArea value={content} onChange={(v) => { setContent(v); setResult(null); }} rows={6} className="font-mono text-[12px]" placeholder={kind === 'SETTLEMENT' ? SETTLEMENT_SAMPLE : PAYROLL_SAMPLE} />
                    </Field>
                    <Disclosure summary="File format">
                        {kind === 'SETTLEMENT' ? (
                            <div className="text-[12px] text-[#3C4257] space-y-1">
                                <p>Header row with these columns, in any order: <code>reference, loan_ref, amount, currency, value_date, channel_txn_id</code>, and optionally <code>payer_name</code>. Lines starting with <code>#</code> are ignored.</p>
                                <p><code>loan_ref</code> is the loan account reference (blank if unknown — the line goes to suspense). <code>channel_txn_id</code> identifies the payment at the channel: the same id is never applied twice. Value dates must be within the last 30 days.</p>
                                <pre className="bg-[#F7FAFC] border border-[#E3E8EE] rounded p-2 overflow-auto">{SETTLEMENT_SAMPLE}</pre>
                            </div>
                        ) : (
                            <div className="text-[12px] text-[#3C4257] space-y-1">
                                <p>Header row: <code>employee_ref, amount</code> and at least one of <code>national_id</code> / <code>loan_ref</code> per line. The employer, period, currency and value date apply to every line.</p>
                                <p>A line by national id is applied when the borrower has exactly one live loan in the file currency. The national id is not stored, only a blind index and its last digits.</p>
                                <pre className="bg-[#F7FAFC] border border-[#E3E8EE] rounded p-2 overflow-auto">{PAYROLL_SAMPLE}</pre>
                            </div>
                        )}
                    </Disclosure>
                    <ErrorBox error={error} onDismiss={clearError} />
                    <Btn variant="primary" onClick={submit} busy={busy === 'import'} disabled={!ready}>Import file</Btn>
                </div>
            </Card>
            {result && (
                <Card
                    title={result.replayed ? 'Already imported' : 'Imported'}
                    subtitle={`${result.file.fileName} · ${result.file.lineCount} lines: ${result.file.postedCount} posted, ${result.file.suspenseCount} to suspense, ${result.file.duplicateCount} duplicates`}
                    bodyClass="p-0"
                >
                    {result.replayed && <div className="p-4"><Notice tone="warn" title="This file was imported before">Nothing was applied again; this is the original import.</Notice></div>}
                    <FileLinesTable lines={result.lines} />
                </Card>
            )}
        </div>
    );
}
