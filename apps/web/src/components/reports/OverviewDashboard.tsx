"use client";

import { useTranslations } from 'next-intl';
import { KpiCard } from './KpiCard';
import { ReportChartCard } from './ReportChartCard';
import { ReportDataTable } from './ReportDataTable';
import { ReportResponse } from './types';

const COLUMNS = [
  { key: 'loanId', sortable: true },
  { key: 'borrower', sortable: true },
  { key: 'branch', sortable: true },
  { key: 'outstandingBalance', type: 'currency' as const, sortable: true },
  { key: 'daysPastDue', type: 'number' as const, sortable: true },
  { key: 'status', sortable: true },
];

export function OverviewDashboard({
  data,
  loading,
  error,
  sortBy,
  sortOrder,
  onSort,
  onPageChange,
}: {
  data: ReportResponse | null;
  loading: boolean;
  error: string | null;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
  onSort: (key: string) => void;
  onPageChange: (page: number) => void;
}) {
  const kpis = data?.kpis || {};
  const charts = data?.charts || {};
  const rows = data?.rows || [];
  const pagination = data?.pagination || { page: 1, limit: 20, total: 0 };
  const t = useTranslations('Reports.analytics');
  const columns = COLUMNS.map((c) => ({ ...c, label: t(`columns.${c.key}`) }));
  const kpi = (k: string) => ({ title: t(`kpi.${k}`), formatKey: k });

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
        <KpiCard {...kpi('portfolioOutstanding')} value={kpis.totalPortfolioOutstanding} />
        <KpiCard {...kpi('totalBorrowers')} value={kpis.totalBorrowers} />
        <KpiCard {...kpi('activeLoans')} value={kpis.activeLoans} />
        <KpiCard {...kpi('monthlyCollection')} value={kpis.monthlyCollection} />
        <KpiCard {...kpi('par30')} value={kpis.par30Pct} />
        <KpiCard {...kpi('nplRatio')} value={kpis.nplRatio} />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <ReportChartCard title={t('charts.disbursementTrend')} type="line" xKey="month" yKey="amount" data={(charts.disbursementTrend as Record<string, unknown>[]) || []} />
        <ReportChartCard title={t('charts.collectionTrend')} type="line" xKey="month" yKey="amount" data={(charts.collectionTrend as Record<string, unknown>[]) || []} />
        <ReportChartCard title={t('charts.riskBreakdown')} type="pie" xKey="name" yKey="value" data={(charts.riskBreakdown as Record<string, unknown>[]) || []} />
      </div>

      <ReportDataTable
        title={t('tables.recentOverdue')}
        columns={columns}
        rows={rows}
        loading={loading}
        error={error}
        page={pagination.page}
        limit={pagination.limit}
        total={pagination.total}
        sortBy={sortBy}
        sortOrder={sortOrder}
        onSort={onSort}
        onPageChange={onPageChange}
      />
    </div>
  );
}
