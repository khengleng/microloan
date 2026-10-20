"use client";

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import api from '@/lib/api';
import { ActionPanel, Btn, Card, Disclosure, Empty, ErrorBox, Field, KV, Notice, Spinner, Table, td, th } from '../ui';
import { useAction, useApi } from '../useAsync';
import { fmtDateTime } from '../format';
import { Money } from '../MoneyCell';
import { StatusBadge } from '../StatusBadge';
import { Person } from '../People';
import { ACCEPTED_TYPES, openLink, readFile, type DocumentLink } from '../documents/types';

/* Shapes as returned by GET /lending/applications/:id/key-facts (D-123). */
export interface KeyFactsStatementView {
    id: string; version: number; status: string; termsHash: string; languages: string[];
    documentIds: Record<string, string>;
    facts: {
        currency: string; principal: string; netDisbursement: string;
        facility: { limit: string } | null;
        rates: { nominalAnnualRatePct: string | null; effectiveAnnualRatePct: string | null };
        totals: { fees: string; interest: string | null; repayable: string | null; costOfCredit: string | null };
        schedule: { numberOfInstalments: number; regularInstalment: string; lastDueDate: string } | null;
    };
    coolingOff: { days: number };
    issuedOn: string; createdAt: string; generatedBy: string;
    acceptedAt: string | null; acceptedByType: string | null; acceptedById: string | null; acceptanceMethod: string | null;
    warnings: string[];
}
export interface KeyFactsView {
    applicationStatus: string;
    current: KeyFactsStatementView | null;
    currentTermsHash: string | null;
    bookingBlocker: { code: string; message: string } | null;
    statements: KeyFactsStatementView[];
}

const LANGS = ['en', 'km'] as const;

/** Open one language of a statement through a short-lived document link. */
export function useOpenStatement() {
    const { busy, error, run, clearError } = useAction();
    const open = (documentId: string, key: string) =>
        run(key, async () => {
            const r = await api.post<DocumentLink>(`/lending/documents/${documentId}/link`, {});
            openLink(r.data);
            return r;
        });
    return { busy, error, clearError, open };
}

/**
 * The pre-contract key facts statement of an application (D-123): what was
 * disclosed, in English and Khmer, whether the customer accepted it, and the
 * actions that issue a new one or record the acceptance before booking.
 */
export function KeyFactsCard({ appId, borrowerId, status, can, onChanged }: {
    appId: string; borrowerId: string; status: string;
    can: (code: string) => { allowed: boolean; reason?: string };
    onChanged: (msg: string) => void;
}) {
    const t = useTranslations('LendingOrigination.keyFacts');
    const tf = useTranslations('LendingDocuments.file');
    const kfs = useApi<KeyFactsView>(`/lending/applications/${appId}/key-facts`);
    const { busy, error, run, clearError } = useAction();
    const doc = useOpenStatement();
    const [accepting, setAccepting] = useState(false);
    const [file, setFile] = useState<File | null>(null);

    const v = kfs.data;
    const cur = v?.current ?? null;
    const stale = !!cur && !!v?.currentTermsHash && cur.termsHash !== v.currentTermsHash;
    const approved = status === 'APPROVED';
    const gen = can('key_facts.generate');
    const rec = can('key_facts.record_acceptance');

    const changed = (msg: string) => { kfs.reload(); onChanged(msg); };
    const generate = async () => {
        const res = await run('generate', () => api.post(`/lending/applications/${appId}/key-facts`, {}));
        if (res) changed(t('generated'));
    };
    const accept = async () => {
        if (!cur || !file) return;
        const res = await run('accept', async () => {
            const body = await readFile(file, tf);
            const form = await api.post<{ id: string }>(`/lending/customers/${borrowerId}/documents`, {
                category: 'AGREEMENT', typeCode: 'KEY_FACTS_SIGNED', title: t('signedFormTitle', { version: cur.version }), applicationId: appId, ...body,
            });
            return api.post(`/lending/applications/${appId}/key-facts/${cur.id}/acceptance`, { method: 'SIGNED_FORM', documentId: form.data.id });
        });
        if (res) { setAccepting(false); setFile(null); changed(t('accepted')); }
    };

    const methodLabel = (m: string | null) => (m && t.has(`methods.${m}`) ? t(`methods.${m}`) : m ?? '—');

    return (
        <Card title={t('title')} subtitle={t('subtitle')}>
            {kfs.loading && !v ? <Spinner /> : kfs.error ? <ErrorBox error={kfs.error} /> : !v || v.statements.length === 0 ? (
                <Empty>{approved ? t('noneApproved') : t('noneYet')}</Empty>
            ) : (
                <div className="space-y-3">
                    {cur && (
                        <>
                            <div className="flex flex-wrap items-center gap-2">
                                <span className="text-[13px] font-semibold">{t('version', { version: cur.version })}</span>
                                <StatusBadge status={cur.status} />
                                {stale && <StatusBadge status="STALE" />}
                                <span className="text-[12px] text-[#697386]">{t('issued', { date: cur.issuedOn })}</span>
                            </div>
                            <KV
                                cols={4}
                                items={[
                                    [cur.facts.facility ? t('limit') : t('principal'), <Money key="p" value={cur.facts.facility?.limit ?? cur.facts.principal} currency={cur.facts.currency} />],
                                    [t('nominal'), cur.facts.rates.nominalAnnualRatePct ? `${cur.facts.rates.nominalAnnualRatePct}%` : '—'],
                                    [t('effective'), cur.facts.rates.effectiveAnnualRatePct ? `${cur.facts.rates.effectiveAnnualRatePct}%` : '—'],
                                    [t('fees'), <Money key="f" value={cur.facts.totals.fees} currency={cur.facts.currency} />],
                                    [t('costOfCredit'), cur.facts.totals.costOfCredit ? <Money key="c" value={cur.facts.totals.costOfCredit} currency={cur.facts.currency} /> : '—'],
                                    [t('repayable'), cur.facts.totals.repayable ? <Money key="r" value={cur.facts.totals.repayable} currency={cur.facts.currency} /> : '—'],
                                    [t('instalments'), cur.facts.schedule ? t('instalmentsValue', { count: cur.facts.schedule.numberOfInstalments, last: cur.facts.schedule.lastDueDate }) : '—'],
                                    [t('coolingOff'), cur.coolingOff.days > 0 ? t('coolingOffDays', { days: cur.coolingOff.days }) : t('coolingOffNone')],
                                    [t('acceptance'), cur.acceptedAt
                                        ? <span key="a">{methodLabel(cur.acceptanceMethod)} · {fmtDateTime(cur.acceptedAt)}{cur.acceptedByType === 'STAFF_ON_BEHALF' && cur.acceptedById ? <> · <Person id={cur.acceptedById} /></> : null}</span>
                                        : t('notAccepted')],
                                ]}
                            />
                            {cur.warnings.length > 0 && (
                                <Notice tone="warn" title={t('warningsTitle')}>
                                    <ul className="list-disc pl-4">{cur.warnings.map((w) => <li key={w} className="font-mono text-[11px]">{w}</li>)}</ul>
                                </Notice>
                            )}
                        </>
                    )}
                    {v.bookingBlocker && approved && (
                        <Notice tone="warn" title={t('blocksBooking')}>{v.bookingBlocker.message}</Notice>
                    )}
                    {cur?.status === 'ACCEPTED' && !stale && <Notice tone="success" title={t('readyToBook')}>{t('readyToBookHint')}</Notice>}
                    <div className="flex flex-wrap gap-2">
                        {cur && LANGS.filter((l) => cur.documentIds[l]).map((l) => (
                            <Btn key={l} size="sm" onClick={() => doc.open(cur.documentIds[l], `open-${l}`)} busy={doc.busy === `open-${l}`}>{t(`open.${l}`)}</Btn>
                        ))}
                        {approved && (!cur || stale) && (
                            <Btn size="sm" variant="primary" onClick={generate} busy={busy === 'generate'} disabled={!gen.allowed} reason={gen.reason}>{t('generate')}</Btn>
                        )}
                        {approved && cur?.status === 'ISSUED' && !stale && (
                            <Btn size="sm" variant="primary" onClick={() => setAccepting((x) => !x)} disabled={!rec.allowed} reason={rec.reason}>{t('recordAcceptance')}</Btn>
                        )}
                    </div>
                    <ErrorBox error={doc.error} onDismiss={doc.clearError} />
                    <ErrorBox error={error} onDismiss={clearError} />
                    {accepting && cur && (
                        <ActionPanel title={t('recordAcceptanceTitle', { version: cur.version })} onClose={() => setAccepting(false)}>
                            <p className="text-[12px] text-[#697386]">{t('recordAcceptanceHint')}</p>
                            <Field label={t('signedForm')} hint={t('signedFormHint')}>
                                <input type="file" accept={ACCEPTED_TYPES} onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="text-[13px]" />
                            </Field>
                            <Btn variant="primary" onClick={accept} busy={busy === 'accept'} disabled={!file}>{t('confirmAcceptance')}</Btn>
                        </ActionPanel>
                    )}
                    {v.statements.length > 1 && (
                        <Disclosure summary={t('history', { count: v.statements.length })}>
                            <Table>
                                <thead><tr className="border-b border-[#E3E8EE] bg-[#F7FAFC]"><th className={th}>{t('colVersion')}</th><th className={th}>{t('colStatus')}</th><th className={th}>{t('colIssued')}</th><th className={th}>{t('colAccepted')}</th></tr></thead>
                                <tbody className="divide-y divide-[#F0F2F5]">
                                    {v.statements.map((s) => (
                                        <tr key={s.id}>
                                            <td className={td}>v{s.version}</td>
                                            <td className={td}><StatusBadge status={s.status} /></td>
                                            <td className={td}>{fmtDateTime(s.createdAt)}</td>
                                            <td className={td}>{s.acceptedAt ? `${methodLabel(s.acceptanceMethod)} · ${fmtDateTime(s.acceptedAt)}` : '—'}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </Table>
                        </Disclosure>
                    )}
                </div>
            )}
        </Card>
    );
}

/** The acceptance line shown in the booking panel. */
export function KeyFactsBookingStatus({ appId }: { appId: string }) {
    const t = useTranslations('LendingOrigination.keyFacts');
    const kfs = useApi<KeyFactsView>(`/lending/applications/${appId}/key-facts`);
    const v = kfs.data;
    if (!v) return null;
    if (v.bookingBlocker) return <Notice tone="warn" title={t('blocksBooking')}>{v.bookingBlocker.message}</Notice>;
    if (v.current?.status === 'ACCEPTED')
        return <Notice tone="success" title={t('acceptedForBooking', { version: v.current.version })}>{t('readyToBookHint')}</Notice>;
    return null;
}
