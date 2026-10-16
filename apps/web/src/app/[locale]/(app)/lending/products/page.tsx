"use client";

import Link from 'next/link';
import { useState } from 'react';
import { Plus } from 'lucide-react';
import { LendingShell, useLendingHref } from '@/components/lending/LendingShell';
import { Btn, Card, Empty, ErrorBox, Spinner, Table, th, td } from '@/components/lending/ui';
import { StatusBadge } from '@/components/lending/StatusBadge';
import { useApi } from '@/components/lending/useAsync';
import { NewProductWizard } from '@/components/lending/products/NewProductWizard';
import type { Product, ProductVersionSummary } from '@/components/lending/types';

function activeOf(p: Product): ProductVersionSummary | null {
    return p.activeVersion && typeof p.activeVersion === 'object' ? p.activeVersion : null;
}

export default function LendingProductsPage() {
    const href = useLendingHref();
    const [creating, setCreating] = useState(false);
    const { data, error, loading } = useApi<Product[]>('/lending/products');

    return (
        <LendingShell
            title="Lending products"
            subtitle="Versioned product configurations. Changes go through draft → submit → approve → activate (maker-checker)."
            actions={!creating && <Btn variant="primary" onClick={() => setCreating(true)}><Plus size={15} /> New product</Btn>}
        >
            {creating && <NewProductWizard onClose={() => setCreating(false)} />}

            {loading && !data ? <Spinner /> : error ? <ErrorBox error={error} /> : (data ?? []).length === 0 ? (
                <Card><Empty>No lending products yet. Create one from an available template.</Empty></Card>
            ) : (
                <div className="space-y-4">
                    {(data ?? []).map((p) => {
                        const active = activeOf(p);
                        return (
                            <Card key={p.id}
                                title={<span className="flex items-center gap-2">{p.name} {active ? <StatusBadge status="ACTIVE" /> : <StatusBadge status="INACTIVE" />}</span>}
                                subtitle={<span className="font-mono">{p.code} · {p.familyCode} / {p.templateCode}{active ? ` · active v${active.version}` : ''}</span>}
                                bodyClass="p-0">
                                <Table>
                                    <thead>
                                        <tr className="border-b border-[#E3E8EE] bg-[#F7FAFC]">
                                            <th className={th}>Version</th>
                                            <th className={th}>Status</th>
                                            <th className={th}>Effective</th>
                                            <th className={th}>Change summary</th>
                                            <th className={th}>Maker / checker</th>
                                            <th className={th}></th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-[#F0F2F5]">
                                        {p.versions.map((v) => (
                                            <tr key={v.id}>
                                                <td className={`${td} font-semibold`}>v{v.version}</td>
                                                <td className={td}><StatusBadge status={v.status} /></td>
                                                <td className={`${td} whitespace-nowrap`}>{v.effectiveFrom ?? '—'}{v.effectiveTo ? ` → ${v.effectiveTo}` : ''}</td>
                                                <td className={td}>{v.changeSummary || <span className="text-[#AAB7C4]">—</span>}</td>
                                                <td className={`${td} font-mono text-[11px] text-[#697386]`}>{v.makerId?.slice(0, 8) ?? '—'} / {v.checkerId?.slice(0, 8) ?? '—'}</td>
                                                <td className={`${td} text-right`}>
                                                    <Link href={href(`/lending/products/versions/${v.id}`)} className="text-[12px] font-semibold text-[#635BFF] hover:underline">Open</Link>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </Table>
                            </Card>
                        );
                    })}
                </div>
            )}
        </LendingShell>
    );
}
