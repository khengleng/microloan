"use client";

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import api from '@/lib/api';
import { useToast } from '@/components/ui/toast';
import { StatusBadge } from '../StatusBadge';
import { fmtDateTime } from '../format';
import { Person } from '../People';
import { ActionPanel, Btn, Card, Empty, ErrorBox, Field, SelectInput, Table, TextArea, TextInput, td, th } from '../ui';
import { clean, useAction } from '../useAsync';
import { EVIDENCE_QUALITY, EVIDENCE_TYPES, useRestructureLabels } from './labels';

export interface EvidenceRow {
    id: string; type: string; description: string; quality: string; documentRef?: string | null;
    providedBy?: string; verifiedBy?: string | null; createdAt: string;
}

/** Evidence list, add-evidence form and "request more info". */
export function EvidencePanel({ caseId, evidence, editable, onChanged }: {
    caseId: string; evidence: EvidenceRow[]; editable: boolean; onChanged: () => void;
}) {
    const t = useTranslations('LendingRestructure');
    const L = useRestructureLabels();
    const { showToast } = useToast();
    const { busy, error, run, clearError } = useAction();
    const [mode, setMode] = useState<'none' | 'add' | 'info'>('none');
    const [type, setType] = useState('INCOME');
    const [description, setDescription] = useState('');
    const [quality, setQuality] = useState('SELF_DECLARED');
    const [documentRef, setDocumentRef] = useState('');
    const [infoNote, setInfoNote] = useState('');

    const add = async () => {
        const res = await run('add', () => api.post(`/lending/restructures/${caseId}/evidence`, clean({ type, description: description.trim(), quality, documentRef: documentRef.trim() })));
        if (res) {
            showToast(t('evidence.toastRecorded'), 'success');
            setDescription(''); setDocumentRef(''); setMode('none');
            onChanged();
        }
    };
    const moreInfo = async () => {
        const res = await run('info', () => api.post(`/lending/restructures/${caseId}/more-info`, { note: infoNote.trim() }));
        if (res) {
            showToast(t('evidence.toastMoreInfo'), 'success');
            setInfoNote(''); setMode('none');
            onChanged();
        }
    };

    return (
        <Card
            title={t('common.evidence')}
            subtitle={t('evidence.subtitle')}
            actions={editable && (
                <>
                    <Btn size="sm" onClick={() => setMode(mode === 'add' ? 'none' : 'add')}>{t('evidence.add')}</Btn>
                    <Btn size="sm" onClick={() => setMode(mode === 'info' ? 'none' : 'info')}>{t('evidence.requestInfo')}</Btn>
                </>
            )}
            bodyClass="p-0"
        >
            {mode !== 'none' && (
                <div className="p-4 border-b border-[#E3E8EE]">
                    {mode === 'add' ? (
                        <ActionPanel title={t('evidence.recordTitle')} onClose={() => setMode('none')}>
                            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                                <Field label={t('common.type')}><SelectInput value={type} onChange={setType} options={L.options('evidenceType', EVIDENCE_TYPES)} /></Field>
                                <Field label={t('evidence.quality')}><SelectInput value={quality} onChange={setQuality} options={L.options('evidenceQuality', EVIDENCE_QUALITY)} /></Field>
                                <Field label={t('evidence.documentRef')}><TextInput value={documentRef} onChange={setDocumentRef} maxLength={200} /></Field>
                            </div>
                            <Field label={t('common.description')} hint={t('common.atLeast3')}>
                                <TextArea value={description} onChange={setDescription} rows={2} maxLength={500} />
                            </Field>
                            <ErrorBox error={error} onDismiss={clearError} />
                            <Btn variant="primary" busy={busy === 'add'} disabled={description.trim().length < 3} onClick={add}>{t('evidence.save')}</Btn>
                        </ActionPanel>
                    ) : (
                        <ActionPanel title={t('evidence.infoTitle')} onClose={() => setMode('none')}>
                            <Field label={t('evidence.infoLabel')} hint={t('evidence.infoHint')}>
                                <TextArea value={infoNote} onChange={setInfoNote} rows={2} maxLength={500} />
                            </Field>
                            <ErrorBox error={error} onDismiss={clearError} />
                            <Btn variant="primary" busy={busy === 'info'} disabled={infoNote.trim().length < 3} onClick={moreInfo}>{t('evidence.infoSubmit')}</Btn>
                        </ActionPanel>
                    )}
                </div>
            )}
            {evidence.length === 0 ? (
                <Empty>{t('evidence.empty')}</Empty>
            ) : (
                <Table>
                    <thead>
                        <tr className="border-b border-[#E3E8EE] bg-[#F7FAFC]">
                            <th className={th}>{t('common.type')}</th><th className={th}>{t('common.description')}</th><th className={th}>{t('evidence.quality')}</th>
                            <th className={th}>{t('evidence.document')}</th><th className={th}>{t('common.recorded')}</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-[#F0F2F5]">
                        {evidence.map((e) => (
                            <tr key={e.id}>
                                <td className={`${td} font-semibold whitespace-nowrap`}>{L.label('evidenceType', e.type)}</td>
                                <td className={td}>{e.description}</td>
                                <td className={td}><StatusBadge status={e.quality} /></td>
                                <td className={`${td} font-mono text-[11px]`}>{e.documentRef || '—'}</td>
                                <td className={`${td} whitespace-nowrap text-[12px] text-[#697386]`}>{fmtDateTime(e.createdAt)}{e.providedBy ? <><br /><Person id={e.providedBy} /></> : null}</td>
                            </tr>
                        ))}
                    </tbody>
                </Table>
            )}
        </Card>
    );
}
