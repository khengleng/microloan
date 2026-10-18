"use client";

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import api from '@/lib/api';
import { useToast } from '@/components/ui/toast';
import { useWorkspace } from '@/lib/workspace';
import { LendingShell } from '@/components/lending/LendingShell';
import { Btn, Card, Checkbox, Empty, ErrorBox, Field, Notice, SelectInput, Spinner, Table, TextInput, th, td } from '@/components/lending/ui';
import { StatusBadge } from '@/components/lending/StatusBadge';
import { useAction, useApi } from '@/components/lending/useAsync';
import { fmtDateTime } from '@/components/lending/format';
import type { Flag } from '@/components/lending/types';

interface PlatformRule {
    id: string; flagKey: string; enabled: boolean; emergency: boolean; status: string;
    effectiveFrom: string | null; effectiveTo: string | null; reason: string; makerId: string;
    checkerId: string | null; createdAt: string;
}
interface PlatformFlags { precedence: string[]; flags: Flag[]; platformRules: PlatformRule[] }

/**
 * Platform feature flags (GET /lending/access/flags as a platform
 * administrator): the platform default for every tenant and the emergency
 * switch above all tenant rules. A rule is proposed by one platform
 * administrator and approved by another before it takes effect.
 */
export default function PlatformFlagsPage() {
    const t = useTranslations('Governance.platformFlags');
    const { showToast } = useToast();
    const { can, access } = useWorkspace();
    const me = access?.principal.id;
    const { data, error, loading, reload } = useApi<PlatformFlags>('/lending/access/flags');
    const act = useAction();
    const [form, setForm] = useState({ flagKey: '', enabled: 'true', emergency: false, reason: '' });
    const canManage = can('feature_flag.manage');
    const canApprove = can('feature_flag.approve');

    const propose = async () => {
        const r = await act.run('propose', () => api.post('/lending/access/flags/rules', {
            flagKey: form.flagKey, scopeType: 'PLATFORM', enabled: form.emergency ? false : form.enabled === 'true', emergency: form.emergency, reason: form.reason.trim(),
        }));
        if (r) { showToast(t('proposed'), 'success'); setForm({ flagKey: '', enabled: 'true', emergency: false, reason: '' }); reload(); }
    };
    const decide = async (id: string, approve: boolean) => {
        const r = await act.run(`${id}:${approve}`, () => api.post(`/lending/access/flags/changes/${id}/decision`, { approve }));
        if (r) { showToast(approve ? t('approved') : t('rejected'), 'success'); reload(); }
    };

    const rules = data?.platformRules ?? [];
    return (
        <LendingShell title={t('title')} subtitle={t('subtitle')}>
            <ErrorBox error={error} />
            {loading && !data ? <Spinner /> : data && (
                <div className="space-y-4">
                    <Notice tone="info">{t('notice')}</Notice>
                    <Card title={t('rulesTitle')} bodyClass="p-0">
                        <div className="p-4 pb-0"><ErrorBox error={act.error} onDismiss={act.clearError} /></div>
                        {rules.length === 0 ? <Empty>{t('noRules')}</Empty> : (
                            <Table>
                                <thead><tr className="border-b border-[#E3E8EE]"><th className={th}>{t('flag')}</th><th className={th}>{t('value')}</th><th className={th}>{t('status')}</th><th className={th}>{t('reason')}</th><th className={th}>{t('when')}</th><th className={th}></th></tr></thead>
                                <tbody className="divide-y divide-[#F0F2F5]">
                                    {rules.map((r) => {
                                        const own = !!me && r.makerId === me;
                                        const why = !canApprove ? t('needApprove') : own ? t('ownRule') : undefined;
                                        return (
                                            <tr key={r.id} className={r.status === 'PENDING_APPROVAL' ? 'bg-amber-50/60' : ''}>
                                                <td className={td}><span className="font-mono text-[12px]">{r.flagKey}</span></td>
                                                <td className={td}>{r.emergency ? t('emergencyOff') : r.enabled ? t('on') : t('off')}</td>
                                                <td className={td}><StatusBadge status={r.status} /></td>
                                                <td className={td}>{r.reason}</td>
                                                <td className={`${td} text-[12px] whitespace-nowrap`}>{fmtDateTime(r.createdAt)}</td>
                                                <td className={`${td} text-right whitespace-nowrap space-x-1`}>
                                                    {r.status === 'PENDING_APPROVAL' && (
                                                        <>
                                                            <Btn size="sm" variant="primary" busy={act.busy === `${r.id}:true`} disabled={!!why || !!act.busy} reason={why} onClick={() => decide(r.id, true)}>{t('approve')}</Btn>
                                                            <Btn size="sm" variant="danger" disabled={!!why || !!act.busy} reason={why} onClick={() => decide(r.id, false)}>{t('reject')}</Btn>
                                                        </>
                                                    )}
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </Table>
                        )}
                    </Card>
                    <Card title={t('flagsTitle')} subtitle={t('flagsSubtitle')} bodyClass="p-0">
                        <Table>
                            <thead><tr className="border-b border-[#E3E8EE]"><th className={th}>{t('flag')}</th><th className={th}>{t('category')}</th><th className={th}>{t('default')}</th><th className={th}>{t('platformValue')}</th></tr></thead>
                            <tbody className="divide-y divide-[#F0F2F5]">
                                {data.flags.map((f) => (
                                    <tr key={f.key}>
                                        <td className={td}><span className="font-mono text-[12px]">{f.key}</span><div className="text-[11px] text-[#697386]">{f.description}</div></td>
                                        <td className={td}>{f.category}</td>
                                        <td className={td}>{f.defaultEnabled ? t('on') : t('off')}</td>
                                        <td className={td}><StatusBadge status={f.evaluation.enabled ? 'ENABLED' : 'DISABLED'} /><div className="text-[11px] text-[#697386]">{f.evaluation.source}</div></td>
                                    </tr>
                                ))}
                            </tbody>
                        </Table>
                    </Card>
                    {canManage && (
                        <Card title={t('proposeTitle')} subtitle={t('proposeSubtitle')}>
                            <div className="space-y-4">
                                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                                    <Field label={t('flag')}><SelectInput value={form.flagKey} onChange={(flagKey) => setForm({ ...form, flagKey })} options={data.flags.map((f) => ({ value: f.key, label: f.key }))} placeholder={t('pickFlag')} /></Field>
                                    <Field label={t('value')}><SelectInput value={form.enabled} onChange={(enabled) => setForm({ ...form, enabled })} options={[{ value: 'true', label: t('on') }, { value: 'false', label: t('off') }]} /></Field>
                                    <div className="pt-6"><Checkbox checked={form.emergency} onChange={(emergency) => setForm({ ...form, emergency })} label={t('emergency')} /></div>
                                </div>
                                <Field label={t('reason')} error={form.reason && form.reason.trim().length < 3 ? t('reasonShort') : undefined}><TextInput value={form.reason} onChange={(reason) => setForm({ ...form, reason })} maxLength={300} /></Field>
                                <div className="flex justify-end">
                                    <Btn variant="primary" busy={act.busy === 'propose'} disabled={!form.flagKey || form.reason.trim().length < 3} onClick={propose}>{t('propose')}</Btn>
                                </div>
                            </div>
                        </Card>
                    )}
                </div>
            )}
        </LendingShell>
    );
}
