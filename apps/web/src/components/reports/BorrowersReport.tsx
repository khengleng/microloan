"use client";

import { useTranslations } from 'next-intl';
import { KpiCard } from './KpiCard';
import { ReportChartCard } from './ReportChartCard';
import { ReportDataTable } from './ReportDataTable';
import { ReportResponse } from './types';
import { ExportButtons } from './ExportButtons';

const COLUMNS = [
  { key: 'borrowerId', sortable: true },
  { key: 'name', sortable: true },
  { key: 'phone', sortable: true },
  { key: 'idNumber', sortable: true },
  { key: 'branch', sortable: true },
  { key: 'occupation', sortable: true },
  { key: 'registrationDate', type: 'date' as const, sortable: true },
  { key: 'kycStatus', sortable: true },
  { key: 'activeLoanCount', type: 'number' as const, sortable: true },
  { key: 'outstandingBalance', type: 'currency' as const, sortable: true },
  { key: 'riskGrade', sortable: true },
  { key: 'status', sortable: true },
];

export function BorrowersReport({
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
        <KpiCard {...kpi('totalBorrowers')} value={kpis.totalBorrowers} />
        <KpiCard {...kpi('activeBorrowers')} value={kpis.activeBorrowers} />
        <KpiCard {...kpi('newThisMonth')} value={kpis.newBorrowersThisMonth} />
        <KpiCard {...kpi('withActiveLoans')} value={kpis.borrowersWithActiveLoans} />
        <KpiCard {...kpi('averageLoanSize')} value={kpis.averageLoanSize} />
        <KpiCard {...kpi('highRiskBorrowers')} value={kpis.highRiskBorrowers} />
        <KpiCard {...kpi('incompleteKyc')} value={kpis.incompleteKycCount} />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <ReportChartCard title={t('charts.borrowerGrowth')} type="line" xKey="month" yKey="value" data={(charts.borrowerGrowth as Record<string, unknown>[]) || []} />
        <ReportChartCard title={t('charts.byBranch')} type="bar" xKey="name" yKey="value" data={(charts.distributionByBranch as Record<string, unknown>[]) || []} />
        <ReportChartCard title={t('charts.byOccupation')} type="pie" xKey="name" yKey="value" data={(charts.distributionByOccupation as Record<string, unknown>[]) || []} />
        <ReportChartCard title={t('charts.riskBreakdown')} type="pie" xKey="name" yKey="value" data={(charts.riskGradeBreakdown as Record<string, unknown>[]) || []} />
        <ReportChartCard title={t('charts.kycCompletion')} type="pie" xKey="name" yKey="value" data={(charts.kycCompletionStatus as Record<string, unknown>[]) || []} />
      </div>

      <ReportDataTable
        title={t('tables.borrowers')}
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
