"use client";

import { useTranslations } from 'next-intl';
import { useWorkspace } from '@/lib/workspace';
import { Field, SelectInput, TextInput } from '../ui';
import { useApi } from '../useAsync';
import type { ProductConfig, Terms } from '../types';

type PolicyKind = 'PREPAYMENT' | 'LATE_CHARGES' | 'ALLOCATION' | 'NON_ACCRUAL';
type Menu = { menu: string[]; defaultCode: string; parameterBounds?: Record<string, { min: number; max: number }> };
export type PolicyChoicesValue = NonNullable<Terms['policies']>;

/** The product version's policy menus (POLICY_MODEL.md), or null while unknown. */
export function usePolicyMenus(productVersionId: string | null | undefined) {
    const { can } = useWorkspace();
    const pv = useApi<{ config?: ProductConfig }>(productVersionId && can('loan_product.read') ? `/lending/product-versions/${productVersionId}` : null);
    const menus = (pv.data?.config?.policies ?? {}) as Partial<Record<PolicyKind, Menu>>;
    return { menus, config: pv.data?.config ?? null, loading: pv.loading };
}

/** Problems with the chosen parameter values (each must be a number inside the product's bounds). */
export function policyProblems(value: PolicyChoicesValue | undefined, menus: Partial<Record<PolicyKind, Menu>>, t: (k: string, v?: Record<string, string | number>) => string): string[] {
    const errs: string[] = [];
    for (const [kind, choice] of Object.entries(value ?? {}) as [PolicyKind, { parameters?: Record<string, number> }][]) {
        for (const [name, v] of Object.entries(choice?.parameters ?? {})) {
            const b = menus[kind]?.parameterBounds?.[name];
            if (!Number.isFinite(v)) errs.push(t('policy.errNumber', { name }));
            else if (b && (v < b.min || v > b.max)) errs.push(t('policy.errRange', { name, min: b.min, max: b.max }));
        }
    }
    return errs;
}

/**
 * Choose a non-default policy from the product's menu and set the parameters
 * the product lets a contract adjust. Left blank, the product default applies.
 * The choice travels in `terms.policies` and is checked by the API when the
 * application is saved, and resolved at booking.
 */
export function PolicyChoices({ productVersionId, value, onChange }: {
    productVersionId: string | null | undefined;
    value: PolicyChoicesValue | undefined;
    onChange: (v: PolicyChoicesValue | undefined) => void;
}) {
    const t = useTranslations('Customers');
    const { menus } = usePolicyMenus(productVersionId);
    const kinds = Object.keys(menus) as PolicyKind[];
    if (!productVersionId || kinds.length === 0) return null;

    const set = (kind: PolicyKind, next: { code?: string; parameters?: Record<string, number> }) => {
        const all = { ...(value ?? {}) } as Record<string, { code?: string; parameters?: Record<string, number> }>;
        const params = next.parameters && Object.keys(next.parameters).length ? next.parameters : undefined;
        if (!next.code && !params) delete all[kind];
        else all[kind] = { ...(next.code ? { code: next.code } : {}), ...(params ? { parameters: params } : {}) };
        onChange(Object.keys(all).length ? (all as PolicyChoicesValue) : undefined);
    };

    return (
        <div className="space-y-2">
            <div className="text-[12px] font-semibold text-[#3C4257]">{t('policy.title')}</div>
            <p className="text-[11px] text-[#697386]">{t('policy.hint')}</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {kinds.map((kind) => {
                    const m = menus[kind]!;
                    const current = (value as Record<string, { code?: string; parameters?: Record<string, number> }> | undefined)?.[kind] ?? {};
                    const bounds = Object.entries(m.parameterBounds ?? {});
                    return (
                        <div key={kind} className="rounded border border-[#E3E8EE] p-3 space-y-2">
                            <Field label={t(`policy.kinds.${kind}`)}>
                                <SelectInput
                                    value={current.code ?? ''}
                                    onChange={(code) => set(kind, { ...current, code: code || undefined })}
                                    options={m.menu.filter((c) => c !== m.defaultCode).map((c) => ({ value: c, label: c }))}
                                    placeholder={t('policy.default', { code: m.defaultCode })}
                                />
                            </Field>
                            {bounds.map(([name, b]) => {
                                const v = current.parameters?.[name];
                                const bad = v !== undefined && (!Number.isFinite(v) || v < b.min || v > b.max);
                                return (
                                    <Field
                                        key={name}
                                        label={name}
                                        hint={t('policy.paramHint', { min: b.min, max: b.max })}
                                        error={bad ? t('policy.errRange', { name, min: b.min, max: b.max }) : undefined}
                                    >
                                        <TextInput
                                            value={v === undefined ? '' : String(v)}
                                            inputMode="decimal"
                                            placeholder={t('policy.paramDefault')}
                                            onChange={(raw) => {
                                                const params = { ...(current.parameters ?? {}) };
                                                if (raw.trim() === '') delete params[name];
                                                else params[name] = Number(raw);
                                                set(kind, { ...current, parameters: params });
                                            }}
                                        />
                                    </Field>
                                );
                            })}
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
