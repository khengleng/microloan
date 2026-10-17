"use client";

import { useState } from 'react';
import api from '@/lib/api';
import { Btn, Card, ErrorBox, Field, TextInput } from '../ui';
import { qs, useAction } from '../useAsync';

/** Statements for any period (OPS-4) and, once closed, the closure letter (UC-75). */
export function LoanDocumentsCard({ loanId, closed }: { loanId: string; closed: boolean }) {
    const [from, setFrom] = useState('');
    const [to, setTo] = useState('');
    const [doc, setDoc] = useState<{ title: string; text: string } | null>(null);
    const { busy, error, run, clearError } = useAction();

    const statement = async () => {
        const res = await run('statement', () => api.get<{ reference: string; from: string; to: string; text: string }>(`/lending/loans/${loanId}/statement${qs({ from, to })}`));
        if (res) setDoc({ title: `Statement ${res.data.from} to ${res.data.to}`, text: res.data.text });
    };
    const closure = async () => {
        const res = await run('closure', () => api.get<{ text: string }>(`/lending/loans/${loanId}/closure-letter`));
        if (res) setDoc({ title: 'Closure letter', text: res.data.text });
    };
    const print = () => {
        if (!doc) return;
        const w = window.open('', '_blank', 'width=760,height=900');
        if (!w) return;
        w.opener = null;
        const pre = w.document.createElement('pre');
        pre.style.font = '12px/1.5 ui-monospace, monospace';
        pre.style.whiteSpace = 'pre-wrap';
        pre.textContent = doc.text;
        w.document.title = doc.title;
        w.document.body.appendChild(pre);
        w.print();
    };

    return (
        <Card title="Statements and letters" subtitle="Generated from the books on request; nothing is posted.">
            <div className="flex flex-wrap items-end gap-2">
                <Field label="From" hint="Blank: from disbursement"><TextInput type="date" value={from} onChange={setFrom} className="w-44" /></Field>
                <Field label="To" hint="Blank: business date"><TextInput type="date" value={to} onChange={setTo} className="w-44" /></Field>
                <Btn onClick={statement} busy={busy === 'statement'}>Statement</Btn>
                {closed && <Btn onClick={closure} busy={busy === 'closure'}>Closure letter</Btn>}
            </div>
            {doc && (
                <div className="mt-3 rounded-md border border-[#E3E8EE] bg-[#F7FAFC] p-3">
                    <div className="mb-2 flex items-center justify-between">
                        <span className="text-[13px] font-medium text-[#1A1F36]">{doc.title}</span>
                        <span className="space-x-2"><Btn size="sm" onClick={print}>Print</Btn><Btn size="sm" variant="ghost" onClick={() => setDoc(null)}>Hide</Btn></span>
                    </div>
                    <pre className="overflow-x-auto whitespace-pre font-mono text-[12px] text-[#3C4257]">{doc.text}</pre>
                </div>
            )}
            <ErrorBox error={error} onDismiss={clearError} />
        </Card>
    );
}
