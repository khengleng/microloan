"use client";

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import api from '@/lib/api';
import { useToast } from '@/components/ui/toast';
import type { Family, Issue, ProductConfig, TemplateDetail } from '../types';
import { useAction, useApi, toApiError, type ApiErrorInfo } from '../useAsync';
import { Btn, Card, ErrorBox, Field, Spinner, TextInput, Notice } from '../ui';
import { StatusBadge } from '../StatusBadge';
import { useLendingHref } from '../LendingShell';
import { ConfigEditor } from './ConfigEditor';
import { setPath } from './configSchema';

const CODE_RE = /^[A-Z0-9_-]{2,32}$/;

export function normalizeIssues(issues: Issue[] | undefined): Issue[] {
    return (issues ?? []).map((i) => ({ ...i, path: i.path.replace(/^config\.?/, '') }));
}

export function NewProductWizard({ onClose }: { onClose: () => void }) {
    const router = useRouter();
    const href = useLendingHref();
    const { showToast } = useToast();
    const catalogue = useApi<Family[]>('/lending/catalogue');
    const [template, setTemplate] = useState<TemplateDetail | null>(null);
    const [loadErr, setLoadErr] = useState<ApiErrorInfo | null>(null);
    const [loadingTpl, setLoadingTpl] = useState<string | null>(null);
    const [code, setCode] = useState('');
    const [name, setName] = useState('');
    const [config, setConfig] = useState<ProductConfig | null>(null);
    const { busy, error, run } = useAction();

    const pick = async (tplCode: string) => {
        setLoadingTpl(tplCode);
        setLoadErr(null);
        try {
            const r = await api.get<TemplateDetail>(`/lending/templates/${encodeURIComponent(tplCode)}`);
            setTemplate(r.data);
            setConfig(r.data.defaultConfig);
            setName(String((r.data.defaultConfig?.identity as Record<string, unknown> | undefined)?.name ?? r.data.name));
        } catch (e) {
            setLoadErr(toApiError(e));
        } finally {
            setLoadingTpl(null);
        }
    };

    const submit = () => run('create', async () => {
        const r = await api.post<{ product: { id: string }; version: { id: string } }>('/lending/products', {
            templateCode: template!.code, code, name, config,
        });
        showToast('Product created as a draft version', 'success');
        router.push(href(`/lending/products/versions/${r.data.version.id}`));
    });

    if (!template || !config) {
        return (
            <Card title="New product — choose a template" subtitle="Only templates whose required capabilities are implemented can be configured." actions={<Btn size="sm" onClick={onClose}>Cancel</Btn>}>
                <ErrorBox error={loadErr} />
                {catalogue.loading && !catalogue.data ? <Spinner /> : catalogue.error ? <ErrorBox error={catalogue.error} /> : (
                    <div className="space-y-4">
                        {(catalogue.data ?? []).map((f) => (
                            <div key={f.code}>
                                <p className="text-[12px] font-bold uppercase tracking-wide text-[#8792A2] mb-1.5">{f.name}</p>
                                <div data-tour="product-template-grid" className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2">
                                    {f.templates.map((t) => (
                                        <button key={t.code} type="button" disabled={!t.available || !!loadingTpl} onClick={() => pick(t.code)}
                                            title={t.available ? undefined : `Missing: ${t.missing.map((m) => `${m.id} (${m.status})`).join(', ')}`}
                                            className={`text-left rounded border p-3 transition-colors ${t.available ? 'border-[#E3E8EE] hover:border-[#635BFF] bg-white' : 'border-slate-200 bg-slate-50 text-slate-400 cursor-not-allowed'}`}>
                                            <div className="flex items-center justify-between gap-2">
                                                <span className="text-[13px] font-semibold">{t.name}</span>
                                                {loadingTpl === t.code ? <span className="text-[11px]">Loading…</span> : t.available ? <StatusBadge status="IMPLEMENTED" /> : <StatusBadge status="NOT_IMPLEMENTED" />}
                                            </div>
                                            <p className="text-[11px] mt-0.5 line-clamp-2">{t.description}</p>
                                            {!t.available && <p className="text-[10px] mt-1">Missing {t.missing.length} capability(ies)</p>}
                                        </button>
                                    ))}
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </Card>
        );
    }

    const codeErr = code && !CODE_RE.test(code) ? 'A–Z, 0–9, _ and -; 2–32 characters' : undefined;
    const issues = normalizeIssues(error?.issues);

    return (
        <Card
            title={`New product from ${template.name}`}
            subtitle={<span className="font-mono">{template.code}</span>}
            actions={<>
                <Btn size="sm" onClick={() => { setTemplate(null); setConfig(null); }}>Change template</Btn>
                <Btn size="sm" onClick={onClose}>Cancel</Btn>
            </>}
        >
            <div className="space-y-4">
                {template.availability && !template.availability.available && (
                    <Notice tone="warn" title="This template cannot be activated yet">
                        Missing: {template.availability.missing.map((m) => `${m.id} (${m.status})`).join(', ')}
                    </Notice>
                )}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <Field label="Product code" hint="Unique; A–Z, 0–9, _ and -" error={codeErr}>
                        <TextInput value={code} onChange={(v) => setCode(v.toUpperCase())} placeholder="PERSONAL_STD" />
                    </Field>
                    <Field label="Product name">
                        <TextInput value={name} onChange={(v) => { setName(v); setConfig((c) => (c ? setPath(c, 'identity.name', v) : c)); }} />
                    </Field>
                </div>
                <ConfigEditor config={config} onChange={setConfig} issues={issues} />
                <ErrorBox error={error && !error.issues?.length ? error : error ? { ...error, issues: undefined, message: `${error.message} — see the highlighted steps.` } : null} />
                <div className="flex justify-end gap-2">
                    <Btn data-tour="product-create-draft" variant="primary" busy={busy === 'create'} disabled={!CODE_RE.test(code) || name.trim().length < 2} onClick={submit}>Create draft product</Btn>
                </div>
            </div>
        </Card>
    );
}
