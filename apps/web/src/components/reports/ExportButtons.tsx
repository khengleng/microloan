"use client";

import { Download } from 'lucide-react';

export function ExportButtons({
  disabled,
  onExport,
}: {
  disabled?: boolean;
  onExport: (format: 'csv' | 'xlsx') => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <button className="btn-ghost text-sm" disabled={disabled} onClick={() => onExport('csv')}>
        <Download size={14} /> Export CSV
      </button>
      <button className="btn-primary text-sm" disabled={disabled} onClick={() => onExport('xlsx')}>
        <Download size={14} /> Export Excel
      </button>
    </div>
  );
}
