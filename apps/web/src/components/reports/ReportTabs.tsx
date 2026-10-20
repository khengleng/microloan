"use client";

import { useTranslations } from 'next-intl';
import { ReportTabKey } from './types';

const TABS: { key: ReportTabKey; labelKey: string }[] = [
  { key: 'overview', labelKey: 'overview' },
  { key: 'loan-portfolio', labelKey: 'loanPortfolio' },
  { key: 'collections', labelKey: 'collections' },
  { key: 'borrowers', labelKey: 'borrowers' },
  { key: 'risk', labelKey: 'risk' },
];

export function ReportTabs({
  activeTab,
  onChange,
}: {
  activeTab: ReportTabKey;
  onChange: (tab: ReportTabKey) => void;
}) {
  const t = useTranslations('Reports.analytics.tabs');
  return (
    <div className="flex flex-wrap gap-2">
      {TABS.map((tab) => (
        <button
          key={tab.key}
          onClick={() => onChange(tab.key)}
          className={`px-4 py-2 rounded-md text-sm font-semibold transition-colors ${
            activeTab === tab.key
              ? 'bg-blue-600 text-white'
              : 'bg-white border border-slate-200 text-slate-700 hover:bg-slate-50'
          }`}
        >
          {t(tab.labelKey)}
        </button>
      ))}
    </div>
  );
}

