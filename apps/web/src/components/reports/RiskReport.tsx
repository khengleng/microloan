"use client";

import { useTranslations } from 'next-intl';
import { KpiCard } from './KpiCard';
import { ReportChartCard } from './ReportChartCard';
import { ReportDataTable } from './ReportDataTable';
import { ReportResponse } from './types';
import { ExportButtons } from './ExportButtons';

const COLUMNS = [
  { key: 'loanId', sortable: true },
  { key: 'borrower', sortable: true },
  { key: 'branch', sortable: true },
  { key: 'outstandingBalance', type: 'currency' as const, sortable: true },
  { key: 'daysPastDue', type: 'number' as const, sortable: true },
  { key: 'agingBucket', sortable: true },
  { key: 'riskGrade', sortable: true },
  { key: 'overdueAmount', type: 'currency' as const, sortable: true },
  { key: 'lastRepaymentDate', type: 'date' as const, sortable: true },
  { key: 'assignedOfficer', sortable: true },
  { key: 'recommendedAction', sortable: false },
];

export function RiskReport({
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
        <KpiCard {...kpi('par1')} value={kpis.par1} />
        <KpiCard {...kpi('par7')} value={kpis.par7} />
        <KpiCard {...kpi('par30')} value={kpis.par30} />
        <KpiCard {...kpi('nplRatio')} value={kpis.nplRatio} />
        <KpiCard {...kpi('writeOffAmount')} value={kpis.writeOffAmount} />
        <KpiCard {...kpi('overdueAmount')} value={kpis.overdueAmount} />
        <KpiCard {...kpi('totalExposure')} value={kpis.totalExposure} />
        <KpiCard {...kpi('highRiskExposure')} value={kpis.highRiskExposure} />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <ReportChartCard title={t('charts.parTrend')} type="bar" xKey="bucket" yKey="value" data={(charts.parTrend as Record<string, unknown>[]) || []} />
        <ReportChartCard title={t('charts.agingDistribution')} type="pie" xKey="name" yKey="value" data={(charts.agingBucketDistribution as Record<string, unknown>[]) || []} />
        <ReportChartCard title={t('charts.overdueByBranch')} type="bar" xKey="name" yKey="value" data={(charts.overdueByBranch as Record<string, unknown>[]) || []} />
        <ReportChartCard title={t('charts.riskByProduct')} type="bar" xKey="name" yKey="value" data={(charts.riskExposureByProduct as Record<string, unknown>[]) || []} />
        <ReportChartCard title={t('charts.topHighRiskLoans')} type="bar" xKey="loanId" yKey="overdueAmount" data={(charts.topHighRiskLoans as Record<string, unknown>[]) || []} />
        <ReportChartCard title={t('charts.loanStatusFunnel')} type="bar" xKey="stage" yKey="value" data={(charts.loanStatusFunnel as Record<string, unknown>[]) || []} />
      </div>

      <ReportDataTable
        title={t('tables.risk')}
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
