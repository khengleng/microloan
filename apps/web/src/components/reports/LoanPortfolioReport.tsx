"use client";

import { useTranslations } from 'next-intl';
import { KpiCard } from './KpiCard';
import { ReportChartCard } from './ReportChartCard';
import { ReportDataTable } from './ReportDataTable';
import { ReportResponse } from './types';
import { ExportButtons } from './ExportButtons';

const COLUMNS = [
  { key: 'loanId', sortable: true },
  { key: 'borrowerName', sortable: true },
  { key: 'branch', sortable: true },
  { key: 'loanOfficer', sortable: true },
  { key: 'product', sortable: true },
  { key: 'principal', type: 'currency' as const, sortable: true },
  { key: 'outstandingBalance', type: 'currency' as const, sortable: true },
  { key: 'interestRate', type: 'percent' as const, sortable: true },
  { key: 'term', type: 'number' as const, sortable: true },
  { key: 'disbursementDate', type: 'date' as const, sortable: true },
  { key: 'maturityDate', type: 'date' as const, sortable: true },
  { key: 'status', sortable: true },
  { key: 'daysPastDue', type: 'number' as const, sortable: true },
  { key: 'riskGrade', sortable: true },
];

export function LoanPortfolioReport({
  data,
  loading,
  error,
  sortBy,
  sortOrder,
  onSort,
  onPageChange,
  onExport,
}: {
  data: ReportResponse | null;
  loading: boolean;
  error: string | null;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
  onSort: (key: string) => void;
  onPageChange: (page: number) => void;
  onExport: (format: 'csv' | 'xlsx') => void;
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
      <div className="flex items-center justify-end">
        <ExportButtons disabled={loading} onExport={onExport} />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
        <KpiCard {...kpi('outstandingPrincipal')} value={kpis.totalOutstandingPrincipal} />
        <KpiCard {...kpi('activeLoans')} value={kpis.totalActiveLoans} />
        <KpiCard {...kpi('disbursedAmount')} value={kpis.totalDisbursedAmount} />
        <KpiCard {...kpi('avgInterestRate')} value={kpis.averageInterestRate} />
        <KpiCard {...kpi('par1')} value={kpis.par1} />
        <KpiCard {...kpi('par7')} value={kpis.par7} />
        <KpiCard {...kpi('par30')} value={kpis.par30} />
        <KpiCard {...kpi('nplAmount')} value={kpis.nplAmount} />
        <KpiCard {...kpi('portfolioAtRisk')} value={kpis.portfolioAtRiskPercentage} />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <ReportChartCard title={t('charts.outstandingByStatus')} type="pie" xKey="name" yKey="value" data={(charts.outstandingByStatus as Record<string, unknown>[]) || []} />
        <ReportChartCard title={t('charts.disbursementTrend')} type="line" xKey="month" yKey="amount" data={(charts.disbursementTrend as Record<string, unknown>[]) || []} />
        <ReportChartCard title={t('charts.parTrend')} type="bar" xKey="bucket" yKey="value" data={(charts.parTrend as Record<string, unknown>[]) || []} />
        <ReportChartCard title={t('charts.byProduct')} type="bar" xKey="name" yKey="value" data={(charts.distributionByProduct as Record<string, unknown>[]) || []} />
        <ReportChartCard title={t('charts.byBranch')} type="bar" xKey="name" yKey="value" data={(charts.distributionByBranch as Record<string, unknown>[]) || []} />
      </div>

      <ReportDataTable
        title={t('tables.loanPortfolio')}
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
