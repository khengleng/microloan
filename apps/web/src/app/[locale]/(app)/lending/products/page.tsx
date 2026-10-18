"use client";

import Link from 'next/link';
import { useState } from 'react';
import { Plus } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { LendingShell, useLendingHref } from '@/components/lending/LendingShell';
import { Btn, Card, Empty, ErrorBox, Spinner, Table, th, td } from '@/components/lending/ui';
import { StatusBadge } from '@/components/lending/StatusBadge';
import { useApi } from '@/components/lending/useAsync';
import { NewProductWizard } from '@/components/lending/products/NewProductWizard';
import { Person } from '@/components/lending/People';
import type { Product, ProductVersionSummary } from '@/components/lending/types';

function activeOf(p: Product): ProductVersionSummary | null {
    return p.activeVersion && typeof p.activeVersion === 'object' ? p.activeVersion : null;
}

export default function LendingProductsPage() {
    const href = useLendingHref();
    const [creating, setCreating] = useState(false);
    const { data, error, loading } = useApi<Product[]>('/lending/products');
    const t = useTranslations('LendingProducts.list');

    return (
        <LendingShell
            title="Lending products"
            subtitle="Versioned product configurations. Changes go through draft → submit → approve → activate (maker-checker)."
            actions={!creating && <Btn data-tour="product-new" variant="primary" onClick={() => setCreating(true)}><Plus size={15} /> {t('newProduct')}</Btn>}
        >
            {creating && <NewProductWizard onClose={() => setCreating(false)} />}

            {loading && !data ? <Spinner /> : error ? <ErrorBox error={error} /> : (data ?? []).length === 0 ? (
                <Card><Empty>{t('none')}</Empty></Card>
            ) : (
                <div data-tour="product-list" className="space-y-4">
                    {(data ?? []).map((p) => {
                        const active = activeOf(p);
                        return (
                            <Card key={p.id}
                                title={<span className="flex items-center gap-2">{p.name} {active ? <StatusBadge status="ACTIVE" /> : <StatusBadge status="INACTIVE" />}</span>}
                                subtitle={<span className="font-mono">{p.code} · {p.familyCode} / {p.templateCode}{active ? ` · ${t('activeVersion', { version: active.version })}` : ''}</span>}
                                bodyClass="p-0">
                                <Table>
                                    <thead>
                                        <tr className="border-b border-[#E3E8EE] bg-[#F7FAFC]">
                                            <th className={th}>{t('colVersion')}</th>
                                            <th className={th}>{t('colStatus')}</th>
                                            <th className={th}>{t('colEffective')}</th>
                                            <th className={th}>{t('colSummary')}</th>
                                            <th className={th}>{t('colMakerChecker')}</th>
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
                                                <td className={`${td} text-[12px] text-[#697386]`}>{v.makerId ? <Person id={v.makerId} /> : '—'} / {v.checkerId ? <Person id={v.checkerId} /> : '—'}</td>
                                                <td className={`${td} text-right`}>
                                                    <Link data-tour="product-version-open" href={href(`/lending/products/versions/${v.id}`)} className="text-[12px] font-semibold text-[#635BFF] hover:underline">{t('open')}</Link>
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
