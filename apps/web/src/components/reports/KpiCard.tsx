"use client";

import { createContext, useContext } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { money } from '@/lib/currency';

/** The reporting currency the API totalled the report in (response `currency`). */
export const ReportCurrencyContext = createContext<string | undefined>(undefined);

function formatValue(value: unknown, key: string, currency?: string) {
  if (typeof value !== 'number') return String(value ?? '-');
  if (/rate|ratio|percentage|par/i.test(key)) return `${value.toFixed(2)}%`;
  if (/count|total|number|loans|borrowers/i.test(key) && Number.isInteger(value)) return value.toLocaleString();
  return money(value, currency);
}

export function KpiCard({ title, value, formatKey }: { title: string; value: unknown; formatKey?: string }) {
  const currency = useContext(ReportCurrencyContext);
  return (
    <Card className="border-slate-200 shadow-sm">
      <CardContent className="p-4">
        <p className="text-[11px] uppercase tracking-wide text-slate-500 font-semibold">{title}</p>
        <p className="mt-2 text-2xl font-black text-slate-900">{formatValue(value, formatKey ?? title, currency)}</p>
      </CardContent>
    </Card>
  );
}

