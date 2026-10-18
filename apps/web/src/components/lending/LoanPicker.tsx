"use client";

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import api from '@/lib/api';
import { inputCls } from './ui';

interface LoanHit { id: string; reference: string; status: string; currency: string; borrowerId: string }

/**
 * Pick a lending loan account by typing part of its reference (GET
 * /lending/loans?search=, within the caller's scope); `value` is the loan id.
 * A pasted loan id is accepted as-is.
 */
export function LoanPicker({ value, onChange, status, placeholder, className = '' }: {
    value: string; onChange: (id: string, loan: LoanHit | null) => void; status?: string; placeholder?: string; className?: string;
}) {
    const t = useTranslations('LendingUi');
    const [q, setQ] = useState('');
    const [open, setOpen] = useState(false);
    const [hits, setHits] = useState<LoanHit[]>([]);
    const [chosen, setChosen] = useState<LoanHit | null>(null);
    useEffect(() => {
        if (!open) return;
        let live = true;
        const timer = setTimeout(() => {
            api.get<{ data: LoanHit[] }>('/lending/loans', { params: { search: q.trim() || undefined, status } }).then(
                (r) => { if (live) setHits((r.data?.data ?? []).slice(0, 20)); },
                () => { if (live) setHits([]); },
            );
        }, 200);
        return () => { live = false; clearTimeout(timer); };
    }, [q, open, status]);
    const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    return (
        <div className={`relative ${className}`}>
            <input
                className={inputCls}
                value={open ? q : chosen?.id === value ? chosen.reference : value}
                placeholder={placeholder ?? t('loanSearch')}
                onFocus={() => { setOpen(true); setQ(''); }}
                onBlur={() => setTimeout(() => setOpen(false), 150)}
                onChange={(e) => {
                    setQ(e.target.value);
                    if (UUID.test(e.target.value.trim())) { setChosen(null); onChange(e.target.value.trim(), null); }
                }}
            />
            {open && (
                <ul className="absolute z-20 mt-1 max-h-60 w-full overflow-auto rounded border border-[#E3E8EE] bg-white shadow-lg">
                    {hits.length === 0 ? <li className="px-2.5 py-1.5 text-[12px] text-[#697386]">{t('noLoans')}</li> : hits.map((l) => (
                        <li key={l.id}>
                            <button
                                type="button"
                                className="w-full px-2.5 py-1.5 text-left text-[13px] hover:bg-[#F7FAFC]"
                                onMouseDown={(e) => e.preventDefault()}
                                onClick={() => { setChosen(l); onChange(l.id, l); setOpen(false); }}
                            >
                                <span className="font-mono">{l.reference}</span> <span className="text-[11px] text-[#697386]">{l.currency} · {l.status}</span>
                            </button>
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
}
