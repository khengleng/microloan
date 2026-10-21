"use client";

import { useState } from 'react';
import Link from 'next/link';
import api from '@/lib/api';
import { useTranslations } from 'next-intl';
import { useWorkspace } from '@/lib/workspace';
import { useLendingHref } from '../LendingShell';
import { Btn, Card, Disclosure, Empty, ErrorBox, Field, Notice, SelectInput, Spinner, Table, td, tdR, th, thR } from '../ui';
import { clean, qs, useAction, useApi } from '../useAsync';
import { MoneyCell } from '../MoneyCell';
import { StatusBadge } from '../StatusBadge';
import { fmtDateTime } from '../format';
import { FileLinesTable } from '../channels/FileLinesTable';
import type { ChannelFile, FileView } from '../channels/types';
import { readStatementFile, STATEMENT_SAMPLE, type MappingsView, type PreviewView } from './types';

/**
 * Import the bank / Bakong merchant statement (CSV or XLSX) through a column
 * mapping. "Check first" shows what each line would do; importing posts the
 * exact matches (or holds them for a second person when auto-posting is off)
 * and puts the rest in suspense (D-161…D-164).
 */
export function StatementImportPanel() {
    const t = useTranslations('LendingQr.statement');
    const href = useLendingHref();
    const { can } = useWorkspace();
    const canImport = can('loan.repayment.post');
    const maps = useApi<MappingsView>('/lending/khqr/statement-mappings');
    const files = useApi<ChannelFile[]>(`/lending/payment-channels/files${qs({ channel: 'KHQR' })}`);
    const [mapping, setMapping] = useState('GENERIC');
    const [currency, setCurrency] = useState('');
    const [file, setFile] = useState<File | null>(null);
    const [preview, setPreview] = useState<PreviewView | null>(null);
    const [result, setResult] = useState<(FileView & { skipped?: { lineNo: number; reason: string }[] }) | null>(null);
    const [openFile, setOpenFile] = useState<string | null>(null);
    const detail = useApi<FileView>(openFile ? `/lending/payment-channels/files/${openFile}` : null);
    const { busy, error, run, clearError } = useAction();

    const send = async (dryRun: boolean) => {
        if (!file) return;
        const content = await readStatementFile(file);
        const body = clean({ fileName: file.name, mapping, currency, dryRun: dryRun || undefined, ...content });
        const res = await run(dryRun ? 'check' : 'import', () => api.post('/lending/khqr/statements', body));
        if (!res) return;
        if (dryRun) { setPreview(res.data as PreviewView); setResult(null); }
        else { setResult(res.data as FileView); setPreview(null); files.reload(); }
    };

    const selected = maps.data?.mappings.find((m) => m.code === mapping);
    return (
        <div className="space-y-4">
            <Card title={t('title')} subtitle={t('subtitle')}>
                {maps.error && <ErrorBox error={maps.error} />}
                {maps.data && (
                    <div className="space-y-3" data-testid="statement-import">
                        <Notice tone="info" title={maps.data.autoPost ? t('autoPostOn') : t('autoPostOff')}>{maps.data.autoPost ? t('autoPostOnBody') : t('autoPostOffBody')}</Notice>
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                            <Field label={t('mapping')} hint={selected && !selected.verified ? t('unverified') : undefined}>
                                <SelectInput value={mapping} onChange={setMapping} options={maps.data.mappings.map((m) => ({ value: m.code, label: m.label }))} />
                            </Field>
                            <Field label={t('currency')} hint={t('currencyHint')}>
                                <SelectInput value={currency} onChange={setCurrency} placeholder={t('fromFile')} options={['USD', 'KHR']} />
                            </Field>
                            <Field label={t('file')} hint={t('fileHint')}>
                                <input type="file" accept=".csv,.xlsx,text/csv" aria-label={t('file')} onChange={(e) => { setFile(e.target.files?.[0] ?? null); setPreview(null); setResult(null); clearError(); }}
                                    className="block text-[13px] text-[#3C4257] file:mr-3 file:rounded file:border file:border-[#E3E8EE] file:bg-white file:px-3 file:py-1 file:text-[12px] file:font-semibold" />
                            </Field>
                        </div>
                        <Disclosure summary={t('format')}>
                            <div className="text-[12px] text-[#3C4257] space-y-1">
                                <p>{t('format1')}</p>
                                <p>{t('format2')}</p>
                                <pre className="bg-[#F7FAFC] border border-[#E3E8EE] rounded p-2 overflow-auto">{STATEMENT_SAMPLE}</pre>
                            </div>
                        </Disclosure>
                        <ErrorBox error={error} onDismiss={clearError} />
                        <div className="flex gap-2">
                            <Btn onClick={() => send(true)} busy={busy === 'check'} disabled={!file}>{t('check')}</Btn>
                            {canImport && <Btn variant="primary" onClick={() => send(false)} busy={busy === 'import'} disabled={!file}>{t('import')}</Btn>}
                        </div>
                    </div>
                )}
                {!maps.data && !maps.error && <Spinner />}
            </Card>

            {preview && (
                <Card title={t('previewTitle')} subtitle={t('previewSubtitle', { lines: preview.lines.length, skipped: preview.skipped.length })} bodyClass="p-0">
                    <Table>
                        <thead>
                            <tr className="border-b border-[#E3E8EE] bg-[#F7FAFC]">
                                <th className={th}>{t('colLine')}</th><th className={th}>{t('colDate')}</th><th className={th}>{t('colBankRef')}</th><th className={th}>{t('colPayer')}</th>
                                <th className={thR}>{t('colAmount')}</th><th className={th}>{t('colProposed')}</th><th className={th}>{t('colReason')}</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-[#F0F2F5]">
                            {preview.lines.map((l) => (
                                <tr key={l.lineNo}>
                                    <td className={td}>{l.lineNo}</td>
                                    <td className={td}>{l.valueDate}</td>
                                    <td className={`${td} font-mono text-[12px]`}>{l.bankRef}</td>
                                    <td className={td}>{l.payerName ?? '—'}{l.remark && <p className="text-[11px] text-[#697386]">“{l.remark}”</p>}</td>
                                    <td className={tdR}><MoneyCell value={l.amount} currency={l.currency} /></td>
                                    <td className={td}>{t(`proposed_${l.proposed}`)}{l.loanReference && <p className="text-[11px] font-mono">{l.loanReference}</p>}</td>
                                    <td className={`${td} text-[12px]`}>{l.reason}</td>
                                </tr>
                            ))}
                        </tbody>
                    </Table>
                </Card>
            )}

            {result && (
                <Card
                    title={result.replayed ? t('alreadyImported') : t('imported')}
                    subtitle={t('resultSummary', { lines: result.file.lineCount, posted: result.file.postedCount, suspense: result.file.suspenseCount, duplicates: result.file.duplicateCount })}
                    bodyClass="p-0"
                >
                    <FileLinesTable lines={result.lines} />
                </Card>
            )}

            <Card title={t('filesTitle')} bodyClass="p-0" actions={<Link href={href('/lending/payment-channels')} className="text-[12px] font-semibold text-[#635BFF] hover:underline">{t('reconciliation')}</Link>}>
                {files.error && <div className="p-4"><ErrorBox error={files.error} /></div>}
                {files.loading && !files.data ? <Spinner /> : !files.data?.length ? <Empty>{t('noFiles')}</Empty> : (
                    <Table>
                        <thead>
                            <tr className="border-b border-[#E3E8EE] bg-[#F7FAFC]">
                                <th className={th}>{t('colFile')}</th><th className={th}>{t('colImported')}</th><th className={thR}>{t('colLines')}</th>
                                <th className={thR}>{t('colPosted')}</th><th className={thR}>{t('colSuspense')}</th><th className={thR}>{t('colDuplicates')}</th><th className={th}></th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-[#F0F2F5]">
                            {files.data.map((f) => (
                                <tr key={f.id}>
                                    <td className={td}>{f.fileName}</td>
                                    <td className={td}>{f.businessDate}<p className="text-[11px] text-[#697386]">{fmtDateTime(f.createdAt)}</p></td>
                                    <td className={tdR}>{f.lineCount}</td>
                                    <td className={tdR}>{f.postedCount}</td>
                                    <td className={tdR}>{f.suspenseCount > 0 ? <StatusBadge status="OPEN" /> : null} {f.suspenseCount}</td>
                                    <td className={tdR}>{f.duplicateCount}</td>
                                    <td className={td}><Btn size="sm" variant="ghost" onClick={() => setOpenFile((o) => (o === f.id ? null : f.id))}>{openFile === f.id ? t('hide') : t('lines')}</Btn></td>
                                </tr>
                            ))}
                        </tbody>
                    </Table>
                )}
            </Card>
            {openFile && detail.data && (
                <Card title={detail.data.file.fileName} bodyClass="p-0"><FileLinesTable lines={detail.data.lines} /></Card>
            )}
        </div>
    );
}
