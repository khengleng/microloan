"use client";

import { Suspense, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Plus, Trash2 } from 'lucide-react';
import api from '@/lib/api';
import { LendingShell } from '@/components/lending/LendingShell';
import { Btn, Card, Disclosure, ErrorBox, Field, SelectInput, Spinner, TextInput } from '@/components/lending/ui';
import { SimulationResultView } from '@/components/lending/SimulationResultView';
import { clean, useAction, useApi } from '@/components/lending/useAsync';
import { isDecimalString, percentToFraction, todayIso } from '@/components/lending/format';
import type { Product, SimulationResult, Terms } from '@/components/lending/types';

interface FormState {
    principal: string;
    numberOfInstalments: string;
    annualRatePct: string;
    disbursementDate: string;
    firstDueDate: string;
    principalGraceInstalments: string;
    interestGraceInstalments: string;
    balloonAmount: string;
    waivedFeeCodes: string;
    explicit: { dueDate: string; principal: string }[];
}

const INITIAL: FormState = {
    principal: '1000', numberOfInstalments: '12', annualRatePct: '', disbursementDate: todayIso(), firstDueDate: '',
    principalGraceInstalments: '', interestGraceInstalments: '', balloonAmount: '', waivedFeeCodes: '', explicit: [],
};

const int = (s: string) => (s.trim() === '' ? undefined : Number.parseInt(s, 10));

function buildTerms(f: FormState): Terms {
    return clean({
        principal: f.principal.trim(),
        numberOfInstalments: int(f.numberOfInstalments),
        annualRate: f.annualRatePct.trim() ? percentToFraction(f.annualRatePct) : undefined,
        disbursementDate: f.disbursementDate,
        firstDueDate: f.firstDueDate || undefined,
        principalGraceInstalments: int(f.principalGraceInstalments),
        interestGraceInstalments: int(f.interestGraceInstalments),
        balloonAmount: f.balloonAmount.trim() || undefined,
        explicitSchedule: f.explicit.length ? f.explicit : undefined,
        waivedFeeCodes: f.waivedFeeCodes.trim() ? f.waivedFeeCodes.split(',').map((s) => s.trim()).filter(Boolean) : undefined,
    }) as Terms;
}

function Simulator() {
    const params = useSearchParams();
    const products = useApi<Product[]>('/lending/products');
    const [versionId, setVersionId] = useState(params.get('version') ?? '');
    const [f, setF] = useState<FormState>(INITIAL);
    const [result, setResult] = useState<SimulationResult | null>(null);
    const { busy, error, run } = useAction();

    const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setF((s) => ({ ...s, [k]: v }));

    const options = (products.data ?? []).flatMap((p) => p.versions.map((v) => ({
        value: v.id, label: `${p.name} (${p.code}) — v${v.version} ${v.status}`,
    })));

    const principalErr = f.principal && !isDecimalString(f.principal) ? 'Decimal amount, e.g. 1500.00' : undefined;
    const rateErr = f.annualRatePct && !isDecimalString(f.annualRatePct) ? 'Percent, e.g. 12.5' : undefined;

    const simulate = async () => {
        const r = await run('sim', () => api.post<SimulationResult>(`/lending/product-versions/${versionId}/simulate`, buildTerms(f)));
        if (r) setResult(r.data);
    };

    return (
        <LendingShell title="Pricing & repayment simulator" subtitle="Price a loan against any product version. Side-effect free: nothing is booked.">
            <Card title="Terms">
                {products.loading && !products.data ? <Spinner /> : (
                    <div className="space-y-4">
                        <ErrorBox error={products.error} />
                        <Field label="Product version">
                            <SelectInput value={versionId} onChange={setVersionId} options={options} placeholder="Select a product version…" />
                        </Field>
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                            <Field label="Principal" error={principalErr}><TextInput inputMode="decimal" value={f.principal} onChange={(v) => set('principal', v)} /></Field>
                            <Field label="Number of instalments"><TextInput type="number" min={1} value={f.numberOfInstalments} onChange={(v) => set('numberOfInstalments', v)} /></Field>
                            <Field label="Annual rate (%)" hint="Blank = product default" error={rateErr}><TextInput inputMode="decimal" value={f.annualRatePct} onChange={(v) => set('annualRatePct', v)} placeholder="e.g. 12" /></Field>
                            <Field label="Disbursement date"><TextInput type="date" value={f.disbursementDate} onChange={(v) => set('disbursementDate', v)} /></Field>
                            <Field label="First due date" hint="Optional"><TextInput type="date" value={f.firstDueDate} onChange={(v) => set('firstDueDate', v)} /></Field>
                            <Field label="Principal grace instalments"><TextInput type="number" min={0} value={f.principalGraceInstalments} onChange={(v) => set('principalGraceInstalments', v)} /></Field>
                            <Field label="Interest grace instalments"><TextInput type="number" min={0} value={f.interestGraceInstalments} onChange={(v) => set('interestGraceInstalments', v)} /></Field>
                            <Field label="Balloon amount" hint="Balloon products only"><TextInput inputMode="decimal" value={f.balloonAmount} onChange={(v) => set('balloonAmount', v)} /></Field>
                            <Field label="Waived fee codes" hint="Comma-separated" className="sm:col-span-2"><TextInput value={f.waivedFeeCodes} onChange={(v) => set('waivedFeeCodes', v)} /></Field>
                        </div>
                        <Disclosure summary={`Explicit schedule (EXPLICIT repayment method)${f.explicit.length ? ` — ${f.explicit.length} rows` : ''}`}>
                            <div className="space-y-2">
                                {f.explicit.map((row, i) => (
                                    <div key={i} className="flex gap-2 items-end">
                                        <Field label={`Due date #${i + 1}`}><TextInput type="date" value={row.dueDate} onChange={(v) => set('explicit', f.explicit.map((r, j) => (j === i ? { ...r, dueDate: v } : r)))} /></Field>
                                        <Field label="Principal"><TextInput inputMode="decimal" value={row.principal} onChange={(v) => set('explicit', f.explicit.map((r, j) => (j === i ? { ...r, principal: v } : r)))} /></Field>
                                        <Btn variant="ghost" onClick={() => set('explicit', f.explicit.filter((_, j) => j !== i))}><Trash2 size={14} /></Btn>
                                    </div>
                                ))}
                                <Btn size="sm" onClick={() => set('explicit', [...f.explicit, { dueDate: '', principal: '' }])}><Plus size={13} /> Add row</Btn>
                            </div>
                        </Disclosure>
                        <ErrorBox error={error} />
                        <div className="flex justify-end">
                            <Btn variant="primary" busy={busy === 'sim'} disabled={!versionId || !!principalErr || !!rateErr || !f.principal || !f.disbursementDate} onClick={simulate}>Simulate</Btn>
                        </div>
                    </div>
                )}
            </Card>
            {result && <SimulationResultView result={result} />}
        </LendingShell>
    );
}

export default function SimulatorPage() {
    return <Suspense fallback={<Spinner />}><Simulator /></Suspense>;
}
