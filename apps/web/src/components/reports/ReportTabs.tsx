"use client";

import { ReportTabKey } from './types';

const TABS: { key: ReportTabKey; label: string }[] = [
  { key: 'overview', label: 'Overview' },
  { key: 'loan-portfolio', label: 'Loan Portfolio' },
  { key: 'collections', label: 'Collections' },
  { key: 'borrowers', label: 'Borrowers' },
  { key: 'risk', label: 'Risk' },
];

export function ReportTabs({
  activeTab,
  onChange,
}: {
  activeTab: ReportTabKey;
  onChange: (tab: ReportTabKey) => void;
}) {
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
          {tab.label}
        </button>
      ))}
    </div>
  );
}

