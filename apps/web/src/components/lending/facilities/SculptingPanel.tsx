"use client";

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import api from '@/lib/api';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { ActionPanel, Btn, ErrorBox, Field, KV, Notice, TextInput } from '../ui';
import { clean, useAction } from '../useAsync';
import { addDecimal, fmtMoney } from '../format';
import { Money } from '../MoneyCell';
import { SculptedTable } from '../projects/ProjectFinanceCard';

const MONEY_RE = /^\d+(\.\d{1,4})?$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

interface SculptResult {
    sculptedDscr: string; minDscr: string | null; averageDscr: string | null; targetDscr: string; maxDebt: string; balloon: string;
    startDate: string; maturityDate: string; explanation: string[];
    lines: { number: number; dueDate: string; cfads: string; openingBalance: string; interest: string; principal: string; debtService: string; dscr: string | null; closingBalance: string }[];
}

/** Add whole months to a YYYY-MM-DD date, clamping to the month's last day. */
function addMonths(date: string, months: number): string {
    const [y, m, d] = date.split('-').map(Number);
    const total = y * 12 + (m - 1) + months;
    const ny = Math.floor(total / 12);
    const nm = (total % 12) + 1;
    const last = new Date(Date.UTC(ny, nm, 0)).getUTCDate();
    return `${ny}-${String(nm).padStart(2, '0')}-${String(Math.min(d, last)).padStart(2, '0')}`;
}

/**
 * Project term-out (LT-17): enter the projected CFADS per repayment date,
 * preview the profile sculpted to the product's target DSCR, then term the
 * facility out on it.
 */
export function SculptingPanel({ facilityId, currency, availabilityEnd, maturityDate, canTermOut, onDone, onClose }: {
    facilityId: string; currency: string; availabilityEnd: string; maturityDate: string; canTermOut: boolean;
    onDone: (msg: string) => void; onClose: () => void;
}) {
    const t = useTranslations('LendingFacilities.sculpting');
    const confirm = useConfirm();
    const [rows, setRows] = useState<{ dueDate: string; cfads: string }[]>([]);
    const [gen, setGen] = useState({ every: '6', count: '4', amount: '' });
    const [balloon, setBalloon] = useState('');
    const [principal, setPrincipal] = useState('');
    const [result, setResult] = useState<SculptResult | null>(null);
    const [problem, setProblem] = useState('');
    const { busy, error, run, clearError } = useAction();

    const generate = () => {
        const every = Number(gen.every);
        const count = Number(gen.count);
        if (!Number.isInteger(every) || every < 1 || !Number.isInteger(count) || count < 1 || count > 120) { setProblem(t('problems.wholeNumbers')); return; }
        if (gen.amount && !MONEY_RE.test(gen.amount)) { setProblem(t('problems.cfadsDecimal')); return; }
        setProblem('');
        setRows(Array.from({ length: count }, (_, i) => ({ dueDate: addMonths(availabilityEnd, every * (i + 1)), cfads: gen.amount })));
        setResult(null);
    };
    const body = () => {
        if (!rows.length || rows.some((r) => !DATE_RE.test(r.dueDate) || !MONEY_RE.test(r.cfads))) { setProblem(t('problems.periodIncomplete')); return null; }
        if (balloon && !MONEY_RE.test(balloon)) { setProblem(t('problems.balloonDecimal')); return null; }
        setProblem('');
        return clean({ cfads: rows, balloonAmount: balloon });
    };
    const preview = async () => {
        const b = body();
        if (!b) return;
        const r = await run('preview', () => api.post<SculptResult>(`/lending/facilities/${facilityId}/sculpting-preview`, clean({ ...b, principal })));
        if (r) setResult(r.data);
    };
    const termOut = async () => {
        const b = body();
        if (!b || !result) return;
        const ok = await confirm({
            title: t('confirm.title'),
            message: t('confirm.message', { count: rows.length, ratio: result.sculptedDscr, end: rows[rows.length - 1].dueDate }),
            confirmLabel: t('confirm.confirm'),
            variant: 'danger',
        });
        if (!ok) return;
        const r = await run('termout', () => api.post<{ principal: string; months: number }>(`/lending/facilities/${facilityId}/term-out`, b));
        if (r) onDone(t('toast.termedOut', { currency, amount: fmtMoney(r.data.principal), count: r.data.months }));
    };
    const total = rows.reduce((acc, r) => (MONEY_RE.test(r.cfads) ? addDecimal(acc, r.cfads) : acc), '0');

    return (
        <ActionPanel title={t('title')} onClose={onClose}>
            <p className="text-[13px] text-[#3C4257]">
                {t('intro', { maturity: maturityDate })}
            </p>
            <div className="flex flex-wrap items-end gap-2">
                <Field label={t('fields.every')}><TextInput value={gen.every} onChange={(v) => setGen({ ...gen, every: v })} inputMode="numeric" className="w-20" /></Field>
                <Field label={t('fields.periods')}><TextInput value={gen.count} onChange={(v) => setGen({ ...gen, count: v })} inputMode="numeric" className="w-20" /></Field>
                <Field label={t('fields.cfadsEach', { currency })} hint={t('fields.cfadsEachHint')}><TextInput value={gen.amount} onChange={(v) => setGen({ ...gen, amount: v })} inputMode="decimal" className="w-36" /></Field>
                <Btn onClick={generate}>{t('actions.layOut', { date: availabilityEnd })}</Btn>
            </div>
            {rows.length > 0 && (
                <div className="space-y-1">
                    {rows.map((r, i) => (
                        <div key={i} className="flex items-center gap-2">
                            <span className="w-6 text-[12px] text-[#697386]">{i + 1}</span>
                            <TextInput type="date" value={r.dueDate} onChange={(v) => { const next = [...rows]; next[i] = { ...r, dueDate: v }; setRows(next); setResult(null); }} className="w-44" />
                            <TextInput value={r.cfads} onChange={(v) => { const next = [...rows]; next[i] = { ...r, cfads: v }; setRows(next); setResult(null); }} inputMode="decimal" placeholder="CFADS" className="w-40" />
                            <Btn size="sm" variant="ghost" onClick={() => { setRows(rows.filter((_, k) => k !== i)); setResult(null); }}>{t('actions.remove')}</Btn>
                        </div>
                    ))}
                    <p className="text-[12px] text-[#697386]">{t('totalCfads', { currency, amount: fmtMoney(total) })}</p>
                </div>
            )}
            <div className="flex flex-wrap items-end gap-2">
                <Field label={t('fields.balloon')} hint={t('fields.balloonHint')}><TextInput value={balloon} onChange={(v) => { setBalloon(v); setResult(null); }} inputMode="decimal" className="w-36" /></Field>
                <Field label={t('fields.principal')} hint={t('fields.principalHint')}><TextInput value={principal} onChange={setPrincipal} inputMode="decimal" className="w-40" /></Field>
            </div>
            {problem && <p className="text-[12px] text-red-600">{problem}</p>}
            {result && (
                <div className="space-y-2">
                    <KV cols={4} items={[
                        [t('result.coverRatio'), t('result.coverRatioValue', { ratio: Number(result.sculptedDscr).toFixed(2), target: result.targetDscr })],
                        [t('result.lowestDscr'), result.minDscr ? `${Number(result.minDscr).toFixed(2)}×` : '—'],
                        [t('result.maxDebt'), <Money key="m" value={result.maxDebt} currency={currency} />],
                        [t('result.starts'), result.startDate],
                    ]} />
                    {result.explanation.map((e, i) => <p key={i} className="text-[12px] text-[#697386]">{e}</p>)}
                    <SculptedTable lines={result.lines} currency={currency} />
                </div>
            )}
            {!canTermOut && <Notice tone="warn">{t('cannotTermOut')}</Notice>}
            <ErrorBox error={error} onDismiss={clearError} />
            <div className="flex gap-2">
                <Btn onClick={preview} busy={busy === 'preview'}>{t('actions.preview')}</Btn>
                <Btn variant="danger" onClick={termOut} busy={busy === 'termout'} disabled={!result || !canTermOut} reason={!result ? t('actions.previewFirst') : undefined}>{t('actions.termOut')}</Btn>
            </div>
        </ActionPanel>
    );
}
