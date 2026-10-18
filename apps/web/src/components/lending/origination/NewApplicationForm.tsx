"use client";

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import api from '@/lib/api';
import { useWorkspace } from '@/lib/workspace';
import { ActionPanel, Btn, ErrorBox, Field, Notice, SelectInput, TextArea, TextInput } from '../ui';
import { clean, qs, useAction, useApi } from '../useAsync';
import { todayIso } from '../format';
import type { Product } from '../types';
import { emptyTermsDraft, TermsFields, termsFromDraft, validateTerms } from './TermsFields';
import { PolicyChoices, policyProblems, usePolicyMenus, type PolicyChoicesValue } from './PolicyChoices';
import { useBorrowerNames } from '../groups/borrowers';
import type { BorrowerGroupDetail } from '../groups/types';

interface LegacyBorrower { id: string; firstName?: string | null; lastName?: string | null; phone?: string | null; nationalId?: string | null }

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function NewApplicationForm({ onCreated, onClose, refinancesLoanId: initialRefinance = '', groupId: initialGroup = '' }: { onCreated: (id: string) => void; onClose: () => void; refinancesLoanId?: string; groupId?: string }) {
    const tc = useTranslations('Customers');
    const { can } = useWorkspace();
    const [search, setSearch] = useState('');
    const [query, setQuery] = useState('');
    const [borrowerId, setBorrowerId] = useState('');
    const [productId, setProductId] = useState('');
    const [terms, setTerms] = useState(() => emptyTermsDraft(todayIso()));
    const [purpose, setPurpose] = useState('');
    // Refinancing: the new loan's proceeds settle this existing loan of the same borrower.
    const [refinancesLoanId, setRefinancesLoanId] = useState(initialRefinance);
    const [localErrors, setLocalErrors] = useState<string[]>([]);
    // A group loan: the group, and the member who signs for it (the leader by default).
    const [groupId, setGroupId] = useState(initialGroup);
    const [policies, setPolicies] = useState<PolicyChoicesValue | undefined>(undefined);
    const { busy, error, run, clearError } = useAction();

    const borrowers = useApi<{ data: LegacyBorrower[] }>(`/borrowers${qs({ search: query, limit: 20, page: 1 })}`);
    const products = useApi<Product[]>('/lending/products');
    const activeProducts = (products.data ?? []).filter((p) => p.activeVersion && typeof p.activeVersion === 'object');
    const product = activeProducts.find((p) => p.id === productId);
    const versionId = product && typeof product.activeVersion === 'object' && product.activeVersion ? product.activeVersion.id : null;
    const { menus, config } = usePolicyMenus(versionId);
    const liability = (config?.identity as { liability?: string } | undefined)?.liability;
    const groupProduct = liability ? liability !== 'INDIVIDUAL' : null;
    const mayReadGroups = can('borrower_group.read');
    const groups = useApi<{ data: { id: string; code: string; name: string; status: string; memberCount: number }[] }>(mayReadGroups ? '/lending/applications/groups?status=ACTIVE' : null);
    const group = useApi<BorrowerGroupDetail>(groupId ? `/lending/applications/groups/${groupId}` : null);
    const activeMembers = (group.data?.members ?? []).filter((m) => !m.leftOn);
    const memberName = useBorrowerNames(activeMembers.map((m) => m.borrowerId));
    const showGroup = mayReadGroups && (groupProduct === true || (groupProduct === null && !!groupId));

    // Choosing a group proposes its leader as the applicant.
    useEffect(() => {
        const leader = activeMembers.find((m) => m.role === 'LEADER');
        if (groupId && leader && !activeMembers.some((m) => m.borrowerId === borrowerId)) setBorrowerId(leader.borrowerId);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [group.data]);
    // Policy choices belong to one product version.
    useEffect(() => { setPolicies(undefined); }, [versionId]);

    const borrowerOptions = (borrowers.data?.data ?? []).map((b) => ({
        value: b.id,
        label: `${[b.firstName, b.lastName].filter(Boolean).join(' ') || '(no name)'}${b.phone ? ` · ${b.phone}` : ''} · ${b.id.slice(0, 8)}`,
    }));
    // Keep a pasted UUID selectable even when it is not in the search results.
    if (borrowerId && UUID_RE.test(borrowerId) && !borrowerOptions.some((o) => o.value === borrowerId)) {
        borrowerOptions.unshift({ value: borrowerId, label: `${borrowerId} (pasted)` });
    }

    const submit = async () => {
        const errs = validateTerms(terms);
        if (!UUID_RE.test(borrowerId.trim())) errs.unshift('Select a borrower or paste a valid borrower UUID.');
        if (!productId) errs.unshift('Select a product.');
        if (refinancesLoanId.trim() && !UUID_RE.test(refinancesLoanId.trim())) errs.unshift('The loan to refinance must be a loan account id.');
        if (groupProduct === true && !groupId) errs.unshift(tc('groupApp.errNoGroup'));
        if (groupId && groupProduct !== false && group.data && !activeMembers.some((m) => m.borrowerId === borrowerId.trim())) errs.unshift(tc('groupApp.errNotMember'));
        errs.push(...policyProblems(policies, menus, tc));
        setLocalErrors(errs);
        if (errs.length) return;
        const res = await run('create', () =>
            api.post<{ id: string }>('/lending/applications', clean({
                borrowerId: borrowerId.trim(),
                productId,
                terms: { ...termsFromDraft(terms), policies },
                purpose: purpose.trim(),
                refinancesLoanId: refinancesLoanId.trim(),
                // An individual product refuses a group, so it is only sent for a group product (or when unknown).
                groupId: groupProduct === false ? undefined : groupId || undefined,
            })),
        );
        if (res?.data?.id) onCreated(res.data.id);
    };

    return (
        <ActionPanel title="New application" onClose={onClose}>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                <div className="space-y-2">
                    {showGroup && (
                        <>
                            <Field label={tc('groupApp.group')} hint={tc('groupApp.groupHint')} error={groups.error ? groups.error.message : undefined}>
                                <SelectInput
                                    value={groupId}
                                    onChange={setGroupId}
                                    options={[
                                        ...(groups.data?.data ?? []).map((g) => ({ value: g.id, label: `${g.name} (${g.code}) · ${tc('groupApp.members', { n: g.memberCount })}` })),
                                        ...(groupId && !(groups.data?.data ?? []).some((g) => g.id === groupId) && group.data ? [{ value: groupId, label: `${group.data.name} (${group.data.code})` }] : []),
                                    ]}
                                    placeholder={groups.loading ? tc('loading') : tc('groupApp.pickGroup')}
                                />
                            </Field>
                            {groupId && activeMembers.length > 0 && (
                                <Field label={tc('groupApp.signatory')} hint={tc('groupApp.signatoryHint')}>
                                    <SelectInput
                                        value={activeMembers.some((m) => m.borrowerId === borrowerId) ? borrowerId : ''}
                                        onChange={setBorrowerId}
                                        options={activeMembers.map((m) => ({ value: m.borrowerId, label: `${memberName(m.borrowerId)}${m.role === 'LEADER' ? ` · ${tc('groupApp.leader')}` : ''}` }))}
                                        placeholder={tc('groupApp.pickMember')}
                                    />
                                </Field>
                            )}
                        </>
                    )}
                    {!(showGroup && groupId) && (<>
                    <Field label="Find borrower" hint="Search the borrower register, then pick one below">
                        <div className="flex gap-2">
                            <TextInput
                                value={search}
                                onChange={setSearch}
                                placeholder="Name, phone, ID…"
                                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); setQuery(search.trim()); } }}
                            />
                            <Btn onClick={() => setQuery(search.trim())} busy={borrowers.loading}>Search</Btn>
                        </div>
                    </Field>
                    <Field label="Borrower" error={borrowers.error ? `Could not load borrowers: ${borrowers.error.message}` : undefined}>
                        <SelectInput
                            value={borrowerOptions.some((o) => o.value === borrowerId) ? borrowerId : ''}
                            onChange={setBorrowerId}
                            options={borrowerOptions}
                            placeholder={borrowers.loading ? 'Loading…' : borrowerOptions.length ? 'Select a borrower' : 'No borrowers found'}
                        />
                    </Field>
                    <Field label="…or paste borrower UUID">
                        <TextInput value={borrowerId} onChange={setBorrowerId} placeholder="00000000-0000-0000-0000-000000000000" className="font-mono" />
                    </Field>
                    </>)}
                </div>
                <div className="space-y-2">
                    <Field
                        label="Product"
                        hint="Only products with an active version can take applications"
                        error={products.error ? `Could not load products: ${products.error.message}` : undefined}
                    >
                        <SelectInput
                            value={productId}
                            onChange={setProductId}
                            options={activeProducts.map((p) => ({
                                value: p.id,
                                label: `${p.name} (${p.code})${p.activeVersion && typeof p.activeVersion === 'object' ? ` · v${p.activeVersion.version}` : ''}`,
                            }))}
                            placeholder={products.loading ? 'Loading…' : activeProducts.length ? 'Select a product' : 'No active products'}
                        />
                    </Field>
                    <Field label="Purpose" hint="Optional">
                        <TextArea value={purpose} onChange={setPurpose} rows={2} maxLength={500} />
                    </Field>
                    <Field label="Refinances loan" hint="Optional — the new loan pays this loan off at disbursement (same borrower; the product must allow refinancing)">
                        <TextInput value={refinancesLoanId} onChange={setRefinancesLoanId} placeholder="Loan account id" className="font-mono" />
                    </Field>
                </div>
            </div>
            <TermsFields value={terms} onChange={setTerms} />
            <PolicyChoices productVersionId={versionId} value={policies} onChange={setPolicies} />
            {localErrors.length > 0 && (
                <Notice tone="warn" title="Please fix">
                    <ul className="list-disc pl-4">{localErrors.map((e) => <li key={e}>{e}</li>)}</ul>
                </Notice>
            )}
            <ErrorBox error={error} onDismiss={clearError} />
            <div className="flex gap-2">
                <Btn variant="primary" onClick={submit} busy={busy === 'create'}>Create draft application</Btn>
                <Btn variant="ghost" onClick={onClose}>Cancel</Btn>
            </div>
        </ActionPanel>
    );
}
