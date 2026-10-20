"use client";

import { Download } from 'lucide-react';
import { useTranslations } from 'next-intl';

export function ExportButtons({
  disabled,
  onExport,
}: {
  disabled?: boolean;
  onExport: (format: 'csv' | 'xlsx') => void;
}) {
  const t = useTranslations('Reports.analytics.export');
  return (
    <div className="flex items-center gap-2">
      <button className="btn-ghost text-sm" disabled={disabled} onClick={() => onExport('csv')}>
        <Download size={14} /> {t('csv')}
      </button>
      <button className="btn-primary text-sm" disabled={disabled} onClick={() => onExport('xlsx')}>
        <Download size={14} /> {t('excel')}
      </button>
    </div>
  );
}
