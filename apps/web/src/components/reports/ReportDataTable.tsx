"use client";

import { ChevronLeft, ChevronRight, ChevronsUpDown } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ReportColumn } from './types';

function fmt(value: unknown, type: ReportColumn['type']) {
  if (value === null || value === undefined || value === '') return '-';
  if (type === 'currency' && typeof value === 'number') {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }).format(value);
  }
  if (type === 'percent' && typeof value === 'number') {
    return `${value.toFixed(2)}%`;
  }
  if (type === 'number' && typeof value === 'number') {
    return value.toLocaleString();
  }
  if (type === 'date') {
    const d = new Date(String(value));
    if (Number.isNaN(d.getTime())) return String(value);
    return d.toLocaleDateString();
  }
  if (typeof value === 'number') return value.toLocaleString();
  return String(value);
}

export function ReportDataTable({
  title,
  columns,
  rows,
  loading,
  error,
  page,
  limit,
  total,
  sortBy,
  sortOrder,
  onSort,
  onPageChange,
}: {
  title: string;
  columns: ReportColumn[];
  rows: Record<string, unknown>[];
  loading: boolean;
  error: string | null;
  page: number;
  limit: number;
  total: number;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
  onSort: (key: string) => void;
  onPageChange: (page: number) => void;
}) {
  const pages = Math.max(1, Math.ceil(total / limit));

  return (
    <Card className="border-slate-200 shadow-sm">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-bold text-slate-800">{title}</CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-200">
            <thead className="bg-slate-50">
              <tr>
                {columns.map((c) => (
                  <th key={c.key} className="px-4 py-3 text-left text-[11px] uppercase tracking-wide font-bold text-slate-500 whitespace-nowrap">
                    {c.sortable ? (
                      <button
                        onClick={() => onSort(c.key)}
                        className="inline-flex items-center gap-1 hover:text-slate-700"
                      >
                        {c.label}
                        <ChevronsUpDown size={12} className={sortBy === c.key ? 'text-blue-600' : ''} />
                        {sortBy === c.key && <span className="text-[10px]">{sortOrder === 'asc' ? 'ASC' : 'DESC'}</span>}
                      </button>
                    ) : c.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 bg-white">
              {loading && Array.from({ length: 6 }).map((_, i) => (
                <tr key={i} className="animate-pulse">
                  <td colSpan={columns.length} className="px-4 py-6 bg-slate-50/50" />
                </tr>
              ))}

              {!loading && error && (
                <tr>
                  <td colSpan={columns.length} className="px-4 py-12 text-center text-sm text-red-600">{error}</td>
                </tr>
              )}

              {!loading && !error && rows.length === 0 && (
                <tr>
                  <td colSpan={columns.length} className="px-4 py-12 text-center text-sm text-slate-500">
                    No data for selected filters.
                  </td>
                </tr>
              )}

              {!loading && !error && rows.map((row, idx) => (
                <tr key={`${idx}-${String(row[columns[0]?.key || 'id'] || idx)}`} className="hover:bg-slate-50/80">
                  {columns.map((c) => (
                    <td key={c.key} className="px-4 py-3 text-sm text-slate-700 whitespace-nowrap">
                      {fmt(row[c.key], c.type)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="flex items-center justify-between px-4 py-3 border-t border-slate-200 bg-slate-50/70">
          <button
            className="btn-ghost text-sm disabled:opacity-50"
            disabled={page <= 1}
            onClick={() => onPageChange(Math.max(1, page - 1))}
          >
            <ChevronLeft size={14} /> Previous
          </button>
          <span className="text-xs text-slate-500">
            {total === 0 ? 0 : ((page - 1) * limit) + 1}-{Math.min(page * limit, total)} of {total.toLocaleString()}
          </span>
          <button
            className="btn-ghost text-sm disabled:opacity-50"
            disabled={page >= pages}
            onClick={() => onPageChange(Math.min(pages, page + 1))}
          >
            Next <ChevronRight size={14} />
          </button>
        </div>
      </CardContent>
    </Card>
  );
}
