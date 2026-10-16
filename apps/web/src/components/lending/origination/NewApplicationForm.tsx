"use client";

import { useState } from 'react';
import api from '@/lib/api';
import { ActionPanel, Btn, ErrorBox, Field, Notice, SelectInput, TextArea, TextInput } from '../ui';
import { clean, qs, useAction, useApi } from '../useAsync';
import { todayIso } from '../format';
import type { Product } from '../types';
import { emptyTermsDraft, TermsFields, termsFromDraft, validateTerms } from './TermsFields';

interface LegacyBorrower { id: string; firstName?: string | null; lastName?: string | null; phone?: string | null; nationalId?: string | null }

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function NewApplicationForm({ onCreated, onClose }: { onCreated: (id: string) => void; onClose: () => void }) {
    const [search, setSearch] = useState('');
    const [query, setQuery] = useState('');
    const [borrowerId, setBorrowerId] = useState('');
    const [productId, setProductId] = useState('');
    const [terms, setTerms] = useState(() => emptyTermsDraft(todayIso()));
    const [purpose, setPurpose] = useState('');
    const [localErrors, setLocalErrors] = useState<string[]>([]);
    const { busy, error, run, clearError } = useAction();

    const borrowers = useApi<{ data: LegacyBorrower[] }>(`/borrowers${qs({ search: query, limit: 20, page: 1 })}`);
    const products = useApi<Product[]>('/lending/products');
    const activeProducts = (products.data ?? []).filter((p) => p.activeVersion && typeof p.activeVersion === 'object');

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
        setLocalErrors(errs);
        if (errs.length) return;
        const res = await run('create', () =>
            api.post<{ id: string }>('/lending/applications', clean({
                borrowerId: borrowerId.trim(),
                productId,
                terms: termsFromDraft(terms),
                purpose: purpose.trim(),
            })),
        );
        if (res?.data?.id) onCreated(res.data.id);
    };

    return (
        <ActionPanel title="New application" onClose={onClose}>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                <div className="space-y-2">
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
                </div>
            </div>
            <TermsFields value={terms} onChange={setTerms} />
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
