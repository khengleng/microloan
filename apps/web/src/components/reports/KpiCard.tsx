"use client";

import { Card, CardContent } from '@/components/ui/card';

function formatValue(value: unknown, key: string) {
  if (typeof value !== 'number') return String(value ?? '-');
  if (/rate|ratio|percentage|par/i.test(key)) return `${value.toFixed(2)}%`;
  if (/count|total|number|loans|borrowers/i.test(key) && Number.isInteger(value)) return value.toLocaleString();
  return `$${value.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
}

export function KpiCard({ title, value }: { title: string; value: unknown }) {
  return (
    <Card className="border-slate-200 shadow-sm">
      <CardContent className="p-4">
        <p className="text-[11px] uppercase tracking-wide text-slate-500 font-semibold">{title}</p>
        <p className="mt-2 text-2xl font-black text-slate-900">{formatValue(value, title)}</p>
      </CardContent>
    </Card>
  );
}

