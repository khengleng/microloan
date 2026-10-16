"use client";

import { useState } from 'react';
import api from '@/lib/api';
import { useToast } from '@/components/ui/toast';
import { StatusBadge } from '../StatusBadge';
import { fmtDateTime } from '../format';
import { ActionPanel, Btn, Card, Empty, ErrorBox, Field, SelectInput, Table, TextArea, TextInput, td, th } from '../ui';
import { clean, useAction } from '../useAsync';
import { EVIDENCE_QUALITY, EVIDENCE_TYPES } from './labels';

export interface EvidenceRow {
    id: string; type: string; description: string; quality: string; documentRef?: string | null;
    providedBy?: string; verifiedBy?: string | null; createdAt: string;
}

/** Evidence list, add-evidence form and "request more info". */
export function EvidencePanel({ caseId, evidence, editable, onChanged }: {
    caseId: string; evidence: EvidenceRow[]; editable: boolean; onChanged: () => void;
}) {
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
            showToast('Evidence recorded', 'success');
            setDescription(''); setDocumentRef(''); setMode('none');
            onChanged();
        }
    };
    const moreInfo = async () => {
        const res = await run('info', () => api.post(`/lending/restructures/${caseId}/more-info`, { note: infoNote.trim() }));
        if (res) {
            showToast('Case marked as needing more information', 'success');
            setInfoNote(''); setMode('none');
            onChanged();
        }
    };

    return (
        <Card
            title="Evidence"
            subtitle="Documents and declarations supporting the hardship and the affordability figures."
            actions={editable && (
                <>
                    <Btn size="sm" onClick={() => setMode(mode === 'add' ? 'none' : 'add')}>Add evidence</Btn>
                    <Btn size="sm" onClick={() => setMode(mode === 'info' ? 'none' : 'info')}>Request more info</Btn>
                </>
            )}
            bodyClass="p-0"
        >
            {mode !== 'none' && (
                <div className="p-4 border-b border-[#E3E8EE]">
                    {mode === 'add' ? (
                        <ActionPanel title="Record evidence" onClose={() => setMode('none')}>
                            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                                <Field label="Type"><SelectInput value={type} onChange={setType} options={EVIDENCE_TYPES} /></Field>
                                <Field label="Quality"><SelectInput value={quality} onChange={setQuality} options={EVIDENCE_QUALITY} /></Field>
                                <Field label="Document reference (optional)"><TextInput value={documentRef} onChange={setDocumentRef} maxLength={200} /></Field>
                            </div>
                            <Field label="Description" hint="At least 3 characters.">
                                <TextArea value={description} onChange={setDescription} rows={2} maxLength={500} />
                            </Field>
                            <ErrorBox error={error} onDismiss={clearError} />
                            <Btn variant="primary" busy={busy === 'add'} disabled={description.trim().length < 3} onClick={add}>Save evidence</Btn>
                        </ActionPanel>
                    ) : (
                        <ActionPanel title="Request more information from the customer" onClose={() => setMode('none')}>
                            <Field label="What is needed?" hint="At least 3 characters. The case moves to MORE INFO REQUIRED.">
                                <TextArea value={infoNote} onChange={setInfoNote} rows={2} maxLength={500} />
                            </Field>
                            <ErrorBox error={error} onDismiss={clearError} />
                            <Btn variant="primary" busy={busy === 'info'} disabled={infoNote.trim().length < 3} onClick={moreInfo}>Request information</Btn>
                        </ActionPanel>
                    )}
                </div>
            )}
            {evidence.length === 0 ? (
                <Empty>No evidence recorded yet.</Empty>
            ) : (
                <Table>
                    <thead>
                        <tr className="border-b border-[#E3E8EE] bg-[#F7FAFC]">
                            <th className={th}>Type</th><th className={th}>Description</th><th className={th}>Quality</th>
                            <th className={th}>Document</th><th className={th}>Recorded</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-[#F0F2F5]">
                        {evidence.map((e) => (
                            <tr key={e.id}>
                                <td className={`${td} font-semibold whitespace-nowrap`}>{e.type.replace(/_/g, ' ')}</td>
                                <td className={td}>{e.description}</td>
                                <td className={td}><StatusBadge status={e.quality} /></td>
                                <td className={`${td} font-mono text-[11px]`}>{e.documentRef || '—'}</td>
                                <td className={`${td} whitespace-nowrap text-[12px] text-[#697386]`}>{fmtDateTime(e.createdAt)}{e.providedBy ? <><br /><span className="font-mono">{e.providedBy}</span></> : null}</td>
                            </tr>
                        ))}
                    </tbody>
                </Table>
            )}
        </Card>
    );
}
