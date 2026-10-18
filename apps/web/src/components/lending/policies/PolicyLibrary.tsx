"use client";

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Plus } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useToast } from '@/components/ui/toast';
import { useWorkspace } from '@/lib/workspace';
import { LendingShell, useLendingHref } from '../LendingShell';
import { Btn, Card, Empty, ErrorBox, Spinner, Table, Tabs, td, th } from '../ui';
import { qs, useApi } from '../useAsync';
import { StatusBadge } from '../StatusBadge';
import { KIND_INFO, POLICY_KINDS } from './types';
import type { LendingPolicy, LendingPolicyVersion, PolicyKind } from './types';
import { NewPolicyForm } from './NewPolicyForm';

type KindFilter = '' | PolicyKind;

/** Latest approved version (what new contracts use), if any. */
export function liveVersion(p: LendingPolicy): LendingPolicyVersion | undefined {
    return p.versions.find((v) => v.status === 'APPROVED');
}

export function PolicyLibrary() {
    const t = useTranslations('LendingPolicies');
    const href = useLendingHref();
    const router = useRouter();
    const { showToast } = useToast();
    const { can } = useWorkspace();
    const [kind, setKind] = useState<KindFilter>('');
    const [creating, setCreating] = useState(false);
    const { data, error, loading, reload } = useApi<LendingPolicy[]>(`/lending/policies${qs({ kind })}`);
    const policies = data ?? [];
    const kinds = kind ? [kind] : POLICY_KINDS;

    return (
        <LendingShell
            title="Policy library"
            subtitle="Reusable, versioned pieces of loan terms that products offer as menus and contracts are composed from. Versions go draft → submitted → approved → retired under maker-checker."
            actions={!creating && can('loan_product.create') && <Btn variant="primary" onClick={() => setCreating(true)}><Plus size={15} /> {t('newPolicy.title')}</Btn>}
        >
            {creating && (
                <NewPolicyForm
                    defaultKind={kind || undefined}
                    onClose={() => setCreating(false)}
                    onCreated={(p) => {
                        showToast(t('library.created', { code: p.code }), 'success');
                        setCreating(false);
                        router.push(href(`/lending/policies/${p.id}`));
                    }}
                />
            )}

            <Tabs<KindFilter>
                value={kind}
                onChange={setKind}
                tabs={[{ value: '', label: t('library.allKinds') }, ...POLICY_KINDS.map((k) => ({ value: k as KindFilter, label: t(`kind.${k}`) }))]}
            />

            {error && <ErrorBox error={error} />}
            {loading && !data ? <Spinner /> : (
                <div className="space-y-4">
                    {kinds.map((k) => {
                        const rows = policies.filter((p) => p.kind === k);
                        return (
                            <Card
                                key={k}
                                title={<span className="flex items-center gap-2">{t(`kind.${k}`)} <span className="font-mono text-[11px] font-semibold text-[#8792A2]">{k}</span></span>}
                                subtitle={t.rich('library.cardSubtitle', { path: () => <span className="font-mono">{KIND_INFO[k].path}</span>, count: rows.length })}
                                actions={<Btn size="sm" variant="ghost" onClick={reload}>{t('library.refresh')}</Btn>}
                                bodyClass="p-0"
                            >
                                {rows.length === 0 ? <Empty>{t('library.none', { kind: t(`kindLower.${k}`) })}</Empty> : (
                                    <Table>
                                        <thead>
                                            <tr className="border-b border-[#E3E8EE] bg-[#F7FAFC]">
                                                <th className={th}>{t('library.colCode')}</th>
                                                <th className={th}>{t('col.name')}</th>
                                                <th className={th}>{t('library.colLive')}</th>
                                                <th className={th}>{t('detail.versions')}</th>
                                                <th className={th}></th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-[#F0F2F5]">
                                            {rows.map((p) => {
                                                const live = liveVersion(p);
                                                return (
                                                    <tr key={p.id} className="hover:bg-[#F7FAFC]">
                                                        <td className={td}>
                                                            <Link href={href(`/lending/policies/${p.id}`)} className="font-mono text-[12px] font-semibold text-[#635BFF] hover:underline">{p.code}</Link>
                                                        </td>
                                                        <td className={td}>
                                                            <div className="font-semibold text-[#1A1F36]">{p.name}</div>
                                                            {p.description && <div className="text-[12px] text-[#697386] line-clamp-2">{p.description}</div>}
                                                        </td>
                                                        <td className={`${td} whitespace-nowrap`}>
                                                            {live ? <span className="font-semibold">v{live.version}</span> : <span className="text-[12px] text-amber-700">{t('noneApproved')}</span>}
                                                        </td>
                                                        <td className={td}>
                                                            <div className="flex flex-wrap gap-1.5">
                                                                {p.versions.map((v) => (
                                                                    <Link key={v.id} href={href(`/lending/policies/${p.id}?v=${v.id}`)} className="inline-flex items-center gap-1 text-[12px] hover:opacity-80" title={v.changeSummary || undefined}>
                                                                        <span className="font-semibold text-[#3C4257]">v{v.version}</span>
                                                                        <StatusBadge status={v.status} />
                                                                    </Link>
                                                                ))}
                                                            </div>
                                                        </td>
                                                        <td className={`${td} text-right`}>
                                                            <Link href={href(`/lending/policies/${p.id}`)} className="text-[12px] font-semibold text-[#635BFF] hover:underline">{t('library.open')}</Link>
                                                        </td>
                                                    </tr>
                                                );
                                            })}
                                        </tbody>
                                    </Table>
                                )}
                            </Card>
                        );
                    })}
                </div>
            )}
        </LendingShell>
    );
}
