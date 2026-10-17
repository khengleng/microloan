"use client";

import { useState } from 'react';
import { CheckCircle2, XCircle } from 'lucide-react';
import { LendingShell } from '../LendingShell';
import { Btn, Card, Empty, ErrorBox, Field, Notice, Spinner, Table, TextInput, td, tdR, th, thR } from '../ui';
import { qs, useApi } from '../useAsync';
import { fmtMoney } from '../format';

interface TbRow {
    code: string; name: string; type: string | null;
    legacyDebit: string; legacyCredit: string; legacyBalance: string;
    lendingDebit: string; lendingCredit: string; lendingBalance: string;
    combinedBalance: string;
}
interface TbCurrency {
    currency: string; rows: TbRow[];
    totals: { legacyDebit: string; legacyCredit: string; lendingDebit: string; lendingCredit: string; debit: string; credit: string; legacyBalanced: boolean; lendingBalanced: boolean; balanced: boolean };
}
interface Combined { asOf: string; currencies: TbCurrency[] }

const zero = (v: string) => /^-?0(\.0+)?$/.test(v);
const amt = (v: string) => (zero(v) ? <span className="text-[#AAB7C4]">—</span> : fmtMoney(v));
/** Debit balances positive, credit balances shown as "Cr". */
const bal = (v: string) => (zero(v) ? <span className="text-[#AAB7C4]">0</span> : v.startsWith('-') ? <>{fmtMoney(v.slice(1))} <span className="text-[10px] text-[#8792A2]">Cr</span></> : <>{fmtMoney(v)} <span className="text-[10px] text-[#8792A2]">Dr</span></>);

function Balanced({ ok, label }: { ok: boolean; label: string }) {
    return ok
        ? <span className="inline-flex items-center gap-1 text-[12px] font-semibold text-emerald-700"><CheckCircle2 size={14} /> {label} balances</span>
        : <span className="inline-flex items-center gap-1 text-[12px] font-semibold text-red-600"><XCircle size={14} /> {label} does not balance</span>;
}

export function CombinedTrialBalanceView() {
    const [draft, setDraft] = useState('');
    const [asOf, setAsOf] = useState('');
    const { data, error, loading } = useApi<Combined>(`/lending/regulatory/combined-trial-balance${qs({ asOf })}`);
    return (
        <LendingShell
            title="Combined ledger"
            subtitle="One trial balance for both loan books: the legacy journal and the lending journal side by side, on the shared chart of accounts."
            actions={
                <div className="flex items-end gap-2">
                    <Field label="As of">
                        <TextInput type="date" value={draft} onChange={setDraft} />
                    </Field>
                    <Btn onClick={() => setAsOf(draft)}>Show</Btn>
                    {asOf && <Btn variant="ghost" onClick={() => { setDraft(''); setAsOf(''); }}>Business date</Btn>}
                </div>
            }
        >
            <ErrorBox error={error} />
            <Notice tone="info">
                Each book must balance on its own; the combined column is what a single general ledger would show. Loans receivable (1200) and the allowance (1300) here are what the regulatory return reconciles to.
            </Notice>
            {loading && !data ? <Spinner /> : data && (
                <>
                    <p className="text-[13px] text-[#697386]">Balances at the end of <b className="text-[#1A1F36]">{data.asOf}</b>.</p>
                    {data.currencies.length === 0 && <Card><Empty>No postings in either book yet.</Empty></Card>}
                    {data.currencies.map((c) => (
                        <Card key={c.currency} title={`${c.currency} trial balance`} bodyClass="p-0"
                            actions={<div className="flex flex-wrap gap-3"><Balanced ok={c.totals.legacyBalanced} label="Legacy" /><Balanced ok={c.totals.lendingBalanced} label="Lending" /><Balanced ok={c.totals.balanced} label="Combined" /></div>}>
                            <Table>
                                <thead className="bg-[#F7FAFC] border-b border-[#E3E8EE]">
                                    <tr>
                                        <th className={th} rowSpan={2}>Account</th>
                                        <th className={`${th} text-center border-l border-[#E3E8EE]`} colSpan={2}>Legacy loans</th>
                                        <th className={`${th} text-center border-l border-[#E3E8EE]`} colSpan={2}>Lending platform</th>
                                        <th className={`${thR} border-l border-[#E3E8EE]`} rowSpan={2}>Combined balance</th>
                                    </tr>
                                    <tr>
                                        <th className={`${thR} border-l border-[#E3E8EE]`}>Debit</th><th className={thR}>Credit</th>
                                        <th className={`${thR} border-l border-[#E3E8EE]`}>Debit</th><th className={thR}>Credit</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-[#F0F2F5]">
                                    {c.rows.map((r) => (
                                        <tr key={r.code} className={['1200', '1300'].includes(r.code) ? 'bg-[#F8F9FF]' : ''}>
                                            <td className={td}><span className="font-mono text-[12px] text-[#697386] mr-2">{r.code}</span>{r.name}{r.type && <span className="ml-2 text-[10px] uppercase text-[#AAB7C4]">{r.type}</span>}</td>
                                            <td className={`${tdR} border-l border-[#F0F2F5]`}>{amt(r.legacyDebit)}</td>
                                            <td className={tdR}>{amt(r.legacyCredit)}</td>
                                            <td className={`${tdR} border-l border-[#F0F2F5]`}>{amt(r.lendingDebit)}</td>
                                            <td className={tdR}>{amt(r.lendingCredit)}</td>
                                            <td className={`${tdR} border-l border-[#F0F2F5] font-semibold text-[#1A1F36]`}>{bal(r.combinedBalance)}</td>
                                        </tr>
                                    ))}
                                </tbody>
                                <tfoot className="border-t-2 border-[#E3E8EE] bg-[#F7FAFC] font-bold">
                                    <tr>
                                        <td className={td}>Total</td>
                                        <td className={`${tdR} border-l border-[#F0F2F5]`}>{fmtMoney(c.totals.legacyDebit)}</td>
                                        <td className={tdR}>{fmtMoney(c.totals.legacyCredit)}</td>
                                        <td className={`${tdR} border-l border-[#F0F2F5]`}>{fmtMoney(c.totals.lendingDebit)}</td>
                                        <td className={tdR}>{fmtMoney(c.totals.lendingCredit)}</td>
                                        <td className={`${tdR} border-l border-[#F0F2F5]`}>Dr {fmtMoney(c.totals.debit)} / Cr {fmtMoney(c.totals.credit)}</td>
                                    </tr>
                                </tfoot>
                            </Table>
                        </Card>
                    ))}
                </>
            )}
        </LendingShell>
    );
}
