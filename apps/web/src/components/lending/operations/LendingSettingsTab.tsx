"use client";

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import api from '@/lib/api';
import { useToast } from '@/components/ui/toast';
import { JsonDiff } from '../JsonDiff';
import { jsonDiff } from '../policies/types';
import { StatusBadge } from '../StatusBadge';
import { Btn, Card, Empty, ErrorBox, Field, Notice, Spinner, Table, TextArea, td, th } from '../ui';
import { useAction, useApi } from '../useAsync';
import { useWorkspace } from '@/lib/workspace';
import { EditorModeSwitch, StructuredJsonEditor, jsonProblem } from '../StructuredJsonEditor';
import { fmtDateTime } from '../format';
import { Person } from '../People';
import type { TenantSecuritySettings } from '../types';

interface SettingsRow {
    id: string; version: number; status: string; settings: unknown; makerId: string; checkerId: string | null;
    decidedAt: string | null; reason: string; createdAt: string;
}
interface SettingsList { active: SettingsRow | null; versions: SettingsRow[]; effective: Record<string, unknown>; defaults: Record<string, unknown> }

/** What each setting means, for the read-only view. Keys are dotted paths; translated as LendingOps.settings.labels.<path with _>. */
const LABELS: Record<string, string> = {
    'regulatory.classes': 'Regulatory loan classes, short-term loans (days past due → provision rate)',
    'regulatory.longTermClasses': 'Regulatory loan classes, long-term loans (days past due → provision rate)',
    'regulatory.shortTermMaxDays': 'Short-term loans: original term up to this many days (longer loans use the long-term classes)',
    'regulatory.restructured.minClass': 'Restructured loans: lowest class while on probation',
    'regulatory.restructured.minProbationInstalments': 'Restructured loans: fewest consecutive on-time instalments that end probation',
    'regulatory.writeOffMinDpd.shortTerm': 'Write-off: fewest days past due, short-term loans (empty: the Loss class)',
    'regulatory.writeOffMinDpd.longTerm': 'Write-off: fewest days past due, long-term loans (empty: the Loss class)',
    'regulatory.sizeBandEdgesUsd': 'Regulatory return: loan-size band edges (USD)',
    'regulatory.sizeBandKhrPerUsd': 'Regulatory return: KHR per USD for the size bands',
    'regulatory.rateBandEdgesPct': 'Regulatory return: interest-rate band edges (% a year)',
    'accounting.cash': 'Cash / bank account',
    'accounting.retainedEarnings': 'Retained earnings (year-end close)',
    'accounting.regulatoryReserve': 'Regulatory reserve (equity; NBC provision above the ECL allowance)',
    'accounting.migrationClearing': 'Migration clearing (opening balances)',
    'accounting.fxPosition': 'FX position',
    'accounting.fxGainLoss': 'FX gain / loss',
    'accounting.unidentifiedSuspense': 'Unidentified receipts (suspense)',
    'accounting.legacy.loansReceivable': 'Original loan book: loans receivable',
    'accounting.legacy.interestIncome': 'Original loan book: interest income',
    'accounting.legacy.penaltyIncome': 'Original loan book: penalty income',
    'accounting.legacy.feeIncome': 'Original loan book: fee income',
    'accounting.legacy.loanLossAllowance': 'Original loan book: loan-loss allowance',
    'accounting.legacy.provisionExpense': 'Original loan book: provision expense',
    'accounting.legacy.writeOffExpense': 'Original loan book: write-off expense',
    'payments.maxFileLines': 'Payment files: most lines per file',
    'payments.maxBackdateDays': 'Unidentified receipts and payment files: most days back-dated',
    'access.maxDelegationDays': 'Longest delegation of authority (days)',
    'legacyServicing.defaultAfterDaysOverdue': 'Original loan book: mark DEFAULTED after days overdue',
    'legacyServicing.penaltyCapRate': 'Original loan book: most late penalty on one instalment (fraction of its principal + interest)',
    'scoring.monitoring.badDaysPastDue': 'Scorecard monitoring: a loan is bad once an instalment is this many days late',
    'scoring.monitoring.performanceMonths': 'Scorecard monitoring: … within this many months of disbursement',
    'scoring.monitoring.baselineWindowDays': 'Scorecard monitoring: baseline window for stability (days)',
    'scoring.monitoring.recentWindowDays': 'Scorecard monitoring: recent window for stability (days)',
    'scoring.monitoring.psiEpsilon': 'Scorecard monitoring: share given to an empty grade in the stability index',
    'scoring.consent.maxValidityDays': 'Alternative data: longest a customer consent may run (days)',
    'scoring.alternativeData.maxRecordAgeDays': 'Alternative data: verified records older than this no longer count (days)',
    'scoring.alternativeData.digitalChannels': 'Alternative data: payment channels counted as digital repayments',
    'security.requireMfaForAdmins': 'Tenant administrators must use an authenticator',
    'telegramBot.allowLoanApplications': 'Customers may apply for loans in the Telegram bot',
    'consumerProtection.lenderLegalName': 'Key facts statement: lender’s legal name (empty: the organisation name)',
    'consumerProtection.licenceNumber': 'Key facts statement: NBC licence number',
    'consumerProtection.complaints.phone': 'Complaints: phone',
    'consumerProtection.complaints.email': 'Complaints: email',
    'consumerProtection.complaints.address': 'Complaints: address',
    'consumerProtection.regulatorContact': 'Complaints: the regulator’s consumer-protection contact',
    'consumerProtection.coolingOffDays': 'Cooling-off: days after disbursement the customer may cancel (0 = no cooling-off)',
    'consumerProtection.coolingOffChargesAccruedInterest': 'Cooling-off: interest accrued to the cancellation date is payable',
    'consumerProtection.coolingOffRefundsLenderFees': 'Cooling-off: the lender’s upfront fees are refunded',
    'affordability.maxLendersPerBorrower': 'Affordability: most lenders a borrower may owe, counting this one (empty = no limit)',
    'affordability.includeOwnLoans': 'Affordability: count the borrower’s other loans with this lender in the debt-service ratio',
    'affordability.includeFacilityMinimumPayments': 'Affordability: count credit-line and card minimum payments in the debt-service ratio',
    'aml.screening.matchThreshold': 'AML: name similarity (0–1) that counts as a watch-list match',
    'aml.screening.tokenFloor': 'AML: least similarity for two name parts to be paired',
    'aml.screening.singleTokenPenalty': 'AML: multiplier for a one-word name inside a longer one',
    'aml.screening.ignoredTitles': 'AML: titles and honorifics ignored in names',
    'aml.screening.rescreenBatchSize': 'AML: customers re-screened per step after a list is activated',
    'aml.watchList.maxEntries': 'AML: most entries in one watch-list version',
    'aml.risk.weights.pep': 'AML risk weight: politically exposed person',
    'aml.risk.weights.highRiskCountry': 'AML risk weight: higher-risk nationality',
    'aml.risk.weights.highRiskOccupation': 'AML risk weight: higher-risk occupation or business',
    'aml.risk.weights.highRiskProduct': 'AML risk weight: higher-risk product type',
    'aml.risk.weights.cashIntensive': 'AML risk weight: cash intensity',
    'aml.risk.mediumAt': 'AML risk: score from which a customer is MEDIUM',
    'aml.risk.highAt': 'AML risk: score from which a customer is HIGH',
    'aml.risk.pepAlwaysHigh': 'AML risk: a politically exposed person is always HIGH',
    'aml.risk.highRiskCountries': 'AML risk: higher-risk nationalities (ISO codes)',
    'aml.risk.highRiskOccupations': 'AML risk: higher-risk occupations and businesses',
    'aml.risk.cashIntensiveOccupations': 'AML risk: cash-intensive occupations',
    'aml.risk.highRiskProductFamilies': 'AML risk: higher-risk product families',
    'aml.risk.cashShareThreshold': 'AML risk: share of repayments in cash (0–1) that makes a customer cash intensive',
    'aml.risk.cashLookbackDays': 'AML risk: days of repayments looked at for the cash share',
    'aml.risk.reviewMonths.LOW': 'AML review: months between reviews of a LOW-risk customer',
    'aml.risk.reviewMonths.MEDIUM': 'AML review: months between reviews of a MEDIUM-risk customer',
    'aml.risk.reviewMonths.HIGH': 'AML review: months between reviews of a HIGH-risk customer',
    'aml.ctr.thresholds.USD': 'Cash transaction report threshold (USD)',
    'aml.ctr.thresholds.KHR': 'Cash transaction report threshold (KHR)',
    'aml.ctr.cashChannels': 'Cash transaction report: payment channels that are cash',
    'aml.retentionYearsAfterRelationship': 'AML records kept for this many years after the relationship ends',
    'operations.alertEmails': 'Operational alerts: e-mail addresses of the lender’s operations contacts (besides the platform operator)',
};

/** On/off settings worth seeing at a glance, with the value used when none is set. */
const SWITCHES: { path: string; read: (s: TenantSecuritySettings) => boolean | undefined; fallback: boolean; hint: string }[] = [
    { path: 'security.requireMfaForAdmins', read: (s) => s.security?.requireMfaForAdmins, fallback: true, hint: 'requireMfaForAdmins' },
    { path: 'telegramBot.allowLoanApplications', read: (s) => s.telegramBot?.allowLoanApplications, fallback: false, hint: 'allowLoanApplications' },
];

function flatten(v: unknown, prefix = ''): [string, unknown][] {
    if (v && typeof v === 'object' && !Array.isArray(v))
        return Object.entries(v as Record<string, unknown>).flatMap(([k, x]) => flatten(x, prefix ? `${prefix}.${k}` : k));
    return [[prefix, v]];
}
const show = (v: unknown) => (Array.isArray(v) && v.every((x) => typeof x !== 'object') ? v.join(', ') : typeof v === 'object' ? JSON.stringify(v) : String(v));

/**
 * The lender's own operating parameters (DECISIONS D-071): regulatory return
 * bands and classes, tenant-level ledger accounts, payment-file and
 * delegation limits. Finance proposes a complete version; a different user
 * with the approval permission (risk) approves it. Until one is approved the
 * defaults apply — the values the platform used before these were settings.
 */
export function LendingSettingsTab() {
    const { showToast } = useToast();
    const list = useApi<SettingsList>('/lending/ops/settings');
    const [draft, setDraft] = useState('');
    const [reason, setReason] = useState('');
    const [problem, setProblem] = useState('');
    const [mode, setMode] = useState<'form' | 'json'>('form');
    const [formInvalid, setFormInvalid] = useState(0);
    const [formKey, setFormKey] = useState(0);
    const { busy, error, run, clearError } = useAction();
    const { can, access } = useWorkspace();
    const me = access?.principal.id;
    const canPropose = can('tenant_settings.manage');
    const canDecide = can('tenant_settings.approve');
    const t = useTranslations('LendingOps.settings');
    const labels: Record<string, string> = Object.fromEntries(Object.entries(LABELS).map(([k, v]) => {
        const key = `labels.${k.replace(/\./g, '_')}`;
        return [k, t.has(key) ? t(key) : v];
    }));

    if (!list.data) return list.error ? <ErrorBox error={list.error} /> : <Spinner />;
    const { active, versions, effective, defaults } = list.data;
    const defaultsFlat = new Map(flatten(defaults));

    const propose = async () => {
        const bad = jsonProblem(draft);
        if (bad) { setProblem(t('invalidJson', { error: bad })); return; }
        const settings: unknown = JSON.parse(draft);
        setProblem('');
        const res = await run('propose', () => api.post('/lending/ops/settings', { settings, reason: reason.trim() || undefined }));
        if (res) { showToast(t('proposed'), 'success'); setDraft(''); list.reload(); }
    };
    const decide = async (id: string, approve: boolean) => {
        const res = await run(`${id}:${approve}`, () => api.post(`/lending/ops/settings/${id}/decision`, { approve }));
        if (res) { showToast(approve ? t('approved') : t('rejected'), 'success'); list.reload(); }
    };

    return (
        <div className="space-y-4">
            {!active && (
                <Notice tone="info" title={t('defaultsInForce')}>
                    {t('defaultsInForceBody')}
                </Notice>
            )}
            <Card title={t('switches.title')} subtitle={t('switches.subtitle')} bodyClass="p-0">
                <ul className="divide-y divide-[#F0F2F5]">
                    {SWITCHES.map((sw) => {
                        const on = sw.read(effective as TenantSecuritySettings) ?? sw.fallback;
                        return (
                            <li key={sw.path} className="flex items-start justify-between gap-4 px-5 py-3">
                                <div>
                                    <p className="text-[13px] font-semibold text-[#1A1F36]">{labels[sw.path]}</p>
                                    <p className="text-[12px] text-[#697386]">{t(`switches.${sw.hint}`)}</p>
                                </div>
                                <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ${on ? 'bg-emerald-50 text-emerald-700' : 'bg-[#F0F2F5] text-[#697386]'}`}>
                                    {on ? t('switches.on') : t('switches.off')}
                                </span>
                            </li>
                        );
                    })}
                </ul>
            </Card>
            <Card title={active ? t('inForce', { version: active.version }) : t('inForceDefaults')} subtitle={active?.decidedAt ? t('approvedAt', { at: fmtDateTime(active.decidedAt) }) : undefined} bodyClass="p-0">
                <Table>
                    <thead><tr className="border-b border-[#E3E8EE] bg-[#F7FAFC]"><th className={th}>{t('colSetting')}</th><th className={th}>{t('colValue')}</th><th className={th}>{t('colDefault')}</th></tr></thead>
                    <tbody className="divide-y divide-[#F0F2F5]">
                        {flatten(effective).map(([k, v]) => (
                            <tr key={k}>
                                <td className={td}>{labels[k] ?? k}<div className="font-mono text-[11px] text-[#697386]">{k}</div></td>
                                <td className={`${td} font-mono text-[12px]`}>{show(v)}</td>
                                <td className={`${td} font-mono text-[12px] text-[#697386]`}>{show(defaultsFlat.get(k))}</td>
                            </tr>
                        ))}
                    </tbody>
                </Table>
            </Card>
            <Card title={t('versions')} bodyClass="p-0">
                {versions.length === 0 ? <Empty>{t('noVersions')}</Empty> : (
                    <Table>
                        <thead><tr className="border-b border-[#E3E8EE] bg-[#F7FAFC]"><th className={th}>{t('colVersion')}</th><th className={th}>{t('colStatus')}</th><th className={th}>{t('colProposed')}</th><th className={th}>{t('colNote')}</th><th className={th}></th></tr></thead>
                        <tbody className="divide-y divide-[#F0F2F5]">
                            {versions.map((v) => (
                                <tr key={v.id}>
                                    <td className={td}>v{v.version}</td>
                                    <td className={td}><StatusBadge status={v.status} /></td>
                                    <td className={`${td} whitespace-nowrap`}>{fmtDateTime(v.createdAt)} · <Person id={v.makerId} /></td>
                                    <td className={td}>{v.reason || '—'}</td>
                                    <td className={td}>
                                        {v.status === 'PENDING' && (
                                            <div className="flex gap-2">
                                                <Btn size="sm" variant="primary" onClick={() => decide(v.id, true)} busy={busy === `${v.id}:true`} disabled={!canDecide || v.makerId === me} reason={!canDecide ? t('needApprove') : v.makerId === me ? t('ownApprove') : undefined}>{t('approve')}</Btn>
                                                <Btn size="sm" variant="danger" onClick={() => decide(v.id, false)} busy={busy === `${v.id}:false`} disabled={!canDecide || v.makerId === me} reason={!canDecide ? t('needApprove') : v.makerId === me ? t('ownDecide') : undefined}>{t('reject')}</Btn>
                                            </div>
                                        )}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </Table>
                )}
            </Card>
            <Card
                title={t('proposeTitle')}
                subtitle={t('proposeSubtitle')}
                actions={<Btn size="sm" onClick={() => { setDraft(JSON.stringify(effective, null, 2)); setProblem(''); setFormInvalid(0); setFormKey((k) => k + 1); }}>{t('startFromInForce')}</Btn>}
            >
                {draft === '' ? <p className="text-[13px] text-[#697386]">{t('startHint')}</p> : (
                    <div className="space-y-3">
                        <EditorModeSwitch mode={mode} onChange={(m) => { if (m === 'form' && jsonProblem(draft)) return; setMode(m); setFormInvalid(0); setFormKey((k) => k + 1); }} />
                        {mode === 'form' && !jsonProblem(draft) ? (
                            <StructuredJsonEditor key={formKey} value={JSON.parse(draft)} labels={labels} onChange={(next) => setDraft(JSON.stringify(next, null, 2))} onValidity={setFormInvalid} />
                        ) : (
                            <Field label={t('settingsJson')} error={problem || jsonProblem(draft) || undefined}>
                                <TextArea value={draft} onChange={(v) => { setDraft(v); setProblem(''); }} rows={18} className="font-mono text-[12px]" />
                            </Field>
                        )}
                        {(() => { try { return <JsonDiff diff={jsonDiff(effective, JSON.parse(draft))} emptyLabel={t('sameAsInForce')} />; } catch { return null; } })()}
                        <Field label={t('why')}><TextArea value={reason} onChange={setReason} rows={2} maxLength={500} /></Field>
                        <ErrorBox error={error} onDismiss={clearError} />
                        <Btn variant="primary" onClick={propose} busy={busy === 'propose'} disabled={!canPropose || !!jsonProblem(draft) || (mode === 'form' && formInvalid > 0)} reason={!canPropose ? t('needManage') : undefined}>{t('propose')}</Btn>
                    </div>
                )}
            </Card>
            {error && !draft && <ErrorBox error={error} onDismiss={clearError} />}
        </div>
    );
}
