"use client";

import { useTranslations } from 'next-intl';
import { KpiCard } from './KpiCard';
import { ReportChartCard } from './ReportChartCard';
import { ReportDataTable } from './ReportDataTable';
import { ReportResponse } from './types';
import { ExportButtons } from './ExportButtons';

const COLUMNS = [
  { key: 'repaymentId', sortable: true },
  { key: 'loanId', sortable: true },
  { key: 'borrower', sortable: true },
  { key: 'branch', sortable: true },
  { key: 'collector', sortable: true },
  { key: 'paymentDate', type: 'date' as const, sortable: true },
  { key: 'dueDate', type: 'date' as const, sortable: true },
  { key: 'amountPaid', type: 'currency' as const, sortable: true },
  { key: 'principalPaid', type: 'currency' as const, sortable: true },
  { key: 'interestPaid', type: 'currency' as const, sortable: true },
  { key: 'penaltyPaid', type: 'currency' as const, sortable: true },
  { key: 'paymentMethod', sortable: true },
  { key: 'status', sortable: true },
  { key: 'daysLate', type: 'number' as const, sortable: true },
];

export function CollectionsReport({
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
        <KpiCard {...kpi('totalCollected')} value={kpis.totalCollected} />
        <KpiCard {...kpi('principalCollected')} value={kpis.principalCollected} />
        <KpiCard {...kpi('interestCollected')} value={kpis.interestCollected} />
        <KpiCard {...kpi('penaltyCollected')} value={kpis.penaltyCollected} />
        <KpiCard {...kpi('repayments')} value={kpis.numberOfRepayments} />
        <KpiCard {...kpi('collectionRate')} value={kpis.collectionRate} />
        <KpiCard {...kpi('overdueCollected')} value={kpis.overdueCollected} />
        <KpiCard {...kpi('missedRepayments')} value={kpis.missedRepayments} />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <ReportChartCard title={t('charts.collectionTrend')} type="line" xKey="month" yKey="amount" data={(charts.collectionTrend as Record<string, unknown>[]) || []} />
        <ReportChartCard title={t('charts.principalVsInterest')} type="bar" xKey="name" yKey="value" data={(charts.principalVsInterest as Record<string, unknown>[]) || []} />
        <ReportChartCard title={t('charts.statusBreakdown')} type="pie" xKey="name" yKey="value" data={(charts.repaymentStatusBreakdown as Record<string, unknown>[]) || []} />
        <ReportChartCard title={t('charts.paymentMethod')} type="pie" xKey="name" yKey="value" data={(charts.paymentMethodDistribution as Record<string, unknown>[]) || []} />
        <ReportChartCard title={t('charts.byBranch')} type="bar" xKey="name" yKey="value" data={(charts.branchPerformance as Record<string, unknown>[]) || []} />
        <ReportChartCard title={t('charts.byLoanOfficer')} type="bar" xKey="name" yKey="value" data={(charts.loanOfficerPerformance as Record<string, unknown>[]) || []} />
      </div>

      <ReportDataTable
        title={t('tables.collections')}
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
