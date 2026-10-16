"use client";

import { useMemo, useState } from 'react';
import { CheckCircle2, CircleSlash } from 'lucide-react';
import { LendingShell } from '@/components/lending/LendingShell';
import { Card, Empty, ErrorBox, Spinner, Tabs, Table, th, td, Disclosure, JsonBlock } from '@/components/lending/ui';
import { StatusBadge } from '@/components/lending/StatusBadge';
import { useApi } from '@/components/lending/useAsync';
import type { CapabilityMatrix, CapabilityStatus, Family, TemplateSummary } from '@/components/lending/types';

const STATUS_ORDER: CapabilityStatus[] = ['IMPLEMENTED', 'SIMULATION_ONLY', 'REQUIRES_INTEGRATION', 'NOT_IMPLEMENTED'];

function TemplateCard({ t }: { t: TemplateSummary }) {
    return (
        <div className={`rounded-md border p-3.5 ${t.available ? 'border-emerald-200 bg-emerald-50/40' : 'border-slate-200 bg-slate-50 opacity-90'}`}>
            <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                    <p className={`text-[13px] font-bold ${t.available ? 'text-[#1A1F36]' : 'text-slate-500'}`}>{t.name}</p>
                    <p className="font-mono text-[10px] text-[#8792A2]">{t.code}</p>
                </div>
                {t.available
                    ? <span className="inline-flex items-center gap-1 text-[11px] font-bold text-emerald-700"><CheckCircle2 size={13} /> Available</span>
                    : <span className="inline-flex items-center gap-1 text-[11px] font-bold text-slate-500"><CircleSlash size={13} /> Unavailable</span>}
            </div>
            {t.description && <p className="text-[12px] text-[#697386] mt-1.5">{t.description}</p>}
            {t.phase1Slice && <p className="mt-1.5 text-[10px] font-bold uppercase text-[#635BFF]">Phase 1 slice</p>}
            {!t.available && t.missing.length > 0 && (
                <div className="mt-2 border-t border-slate-200 pt-2">
                    <p className="text-[10px] font-bold uppercase text-slate-500 mb-1">Missing capabilities</p>
                    <ul className="space-y-1">
                        {t.missing.map((m) => (
                            <li key={m.id} className="text-[11px] text-slate-600 flex flex-wrap items-center gap-1.5">
                                <span className="font-mono">{m.id}</span>
                                <StatusBadge status={m.status} />
                                <span className="text-slate-500">{m.description}</span>
                            </li>
                        ))}
                    </ul>
                </div>
            )}
            {t.requiredCapabilities.length > 0 && (
                <div className="mt-2">
                    <Disclosure summary={`Requires ${t.requiredCapabilities.length} capabilities`}>
                        <p className="text-[11px] font-mono text-[#697386] break-words">{t.requiredCapabilities.join(', ')}</p>
                        {t.structure !== undefined && t.structure !== null && <div className="mt-2"><JsonBlock value={t.structure} /></div>}
                    </Disclosure>
                </div>
            )}
        </div>
    );
}

function Families({ families }: { families: Family[] }) {
    if (families.length === 0) return <Empty>No loan families are configured.</Empty>;
    return (
        <div className="space-y-5">
            {families.map((f) => {
                const avail = f.templates.filter((t) => t.available).length;
                return (
                    <Card key={f.code} title={f.name} subtitle={<>{f.description} <span className="ml-1 font-mono">{f.code}</span></>}
                        actions={<span className="text-[12px] text-[#697386]">{avail} of {f.templates.length} templates available</span>}>
                        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                            {f.templates.map((t) => <TemplateCard key={t.code} t={t} />)}
                        </div>
                    </Card>
                );
            })}
        </div>
    );
}

function Matrix({ matrix }: { matrix: CapabilityMatrix }) {
    const [filter, setFilter] = useState<CapabilityStatus | ''>('');
    const groups = useMemo(() => {
        const m = new Map<string, CapabilityMatrix['capabilities']>();
        for (const c of matrix.capabilities) {
            if (filter && c.status !== filter) continue;
            const list = m.get(c.area) ?? [];
            list.push(c);
            m.set(c.area, list);
        }
        return [...m.entries()];
    }, [matrix, filter]);
    const counts = useMemo(() => {
        const c: Record<string, number> = {};
        for (const cap of matrix.capabilities) c[cap.status] = (c[cap.status] ?? 0) + 1;
        return c;
    }, [matrix]);

    return (
        <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
                <span className="text-[12px] text-[#697386]">Engine <span className="font-mono">{matrix.engineVersion}</span> · Filter:</span>
                <button onClick={() => setFilter('')} className={`text-[12px] px-2 py-0.5 rounded border ${filter === '' ? 'border-[#635BFF] text-[#635BFF]' : 'border-[#E3E8EE] text-[#697386]'}`}>All ({matrix.capabilities.length})</button>
                {STATUS_ORDER.map((s) => (
                    <button key={s} onClick={() => setFilter(s)} className={`rounded ${filter === s ? 'ring-2 ring-[#635BFF]/40' : ''}`}>
                        <StatusBadge status={s} /> <span className="text-[11px] text-[#697386]">{counts[s] ?? 0}</span>
                    </button>
                ))}
            </div>
            {groups.length === 0 && <Empty>No capabilities match.</Empty>}
            {groups.map(([area, caps]) => (
                <Card key={area} title={area} bodyClass="p-0">
                    <Table>
                        <thead>
                            <tr className="border-b border-[#E3E8EE] bg-[#F7FAFC]">
                                <th className={th}>Capability</th>
                                <th className={th}>Status</th>
                                <th className={th}>Phase</th>
                                <th className={th}>Description</th>
                                <th className={th}>Limitation / evidence</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-[#F0F2F5]">
                            {caps.map((c) => (
                                <tr key={c.id}>
                                    <td className={`${td} font-mono text-[12px] whitespace-nowrap`}>{c.id}</td>
                                    <td className={td}><StatusBadge status={c.status} /></td>
                                    <td className={td}>{c.phase ?? '—'}</td>
                                    <td className={td}>{c.description}</td>
                                    <td className={`${td} text-[12px]`}>
                                        {c.limitation && <p className="text-amber-800">{c.limitation}</p>}
                                        {c.evidence && <p className="text-[#8792A2] font-mono text-[11px] break-words">{Array.isArray(c.evidence) ? c.evidence.join(', ') : c.evidence}</p>}
                                        {!c.limitation && !c.evidence && '—'}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </Table>
                </Card>
            ))}
        </div>
    );
}

export default function CataloguePage() {
    const [tab, setTab] = useState<'families' | 'matrix'>('families');
    const catalogue = useApi<Family[]>('/lending/catalogue');
    const matrix = useApi<CapabilityMatrix>(tab === 'matrix' ? '/lending/capability-matrix' : null);

    return (
        <LendingShell title="Product catalogue" subtitle="Loan families and templates, and what the engine can actually do today.">
            <Tabs value={tab} onChange={setTab} tabs={[{ value: 'families', label: 'Families & templates' }, { value: 'matrix', label: 'Capability matrix' }]} />
            {tab === 'families' && (
                catalogue.loading && !catalogue.data ? <Spinner /> : catalogue.error ? <ErrorBox error={catalogue.error} /> : <Families families={catalogue.data ?? []} />
            )}
            {tab === 'matrix' && (
                matrix.loading && !matrix.data ? <Spinner /> : matrix.error ? <ErrorBox error={matrix.error} /> : matrix.data ? <Matrix matrix={matrix.data} /> : null
            )}
        </LendingShell>
    );
}
