"use client";

import { KpiCard } from './KpiCard';
import { ReportChartCard } from './ReportChartCard';
import { ReportDataTable } from './ReportDataTable';
import { ReportResponse } from './types';
import { ExportButtons } from './ExportButtons';

const COLUMNS = [
  { key: 'loanId', label: 'Loan ID', sortable: true },
  { key: 'borrower', label: 'Borrower', sortable: true },
  { key: 'branch', label: 'Branch', sortable: true },
  { key: 'outstandingBalance', label: 'Outstanding', type: 'currency' as const, sortable: true },
  { key: 'daysPastDue', label: 'DPD', type: 'number' as const, sortable: true },
  { key: 'agingBucket', label: 'Aging Bucket', sortable: true },
  { key: 'riskGrade', label: 'Risk Grade', sortable: true },
  { key: 'overdueAmount', label: 'Overdue', type: 'currency' as const, sortable: true },
  { key: 'lastRepaymentDate', label: 'Last Repayment', type: 'date' as const, sortable: true },
  { key: 'assignedOfficer', label: 'Assigned Officer', sortable: true },
  { key: 'recommendedAction', label: 'Recommended Action', sortable: false },
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

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-end">
        <ExportButtons disabled={loading} onExport={onExport} />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
        <KpiCard title="PAR 1" value={kpis.par1} />
        <KpiCard title="PAR 7" value={kpis.par7} />
        <KpiCard title="PAR 30" value={kpis.par30} />
        <KpiCard title="NPL Ratio" value={kpis.nplRatio} />
        <KpiCard title="Write-off Amount" value={kpis.writeOffAmount} />
        <KpiCard title="Overdue Amount" value={kpis.overdueAmount} />
        <KpiCard title="Total Exposure" value={kpis.totalExposure} />
        <KpiCard title="High-risk Exposure" value={kpis.highRiskExposure} />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <ReportChartCard title="PAR Trend" type="bar" xKey="bucket" yKey="value" data={(charts.parTrend as Record<string, unknown>[]) || []} />
        <ReportChartCard title="Aging Distribution" type="pie" xKey="name" yKey="value" data={(charts.agingBucketDistribution as Record<string, unknown>[]) || []} />
        <ReportChartCard title="Overdue by Branch" type="bar" xKey="name" yKey="value" data={(charts.overdueByBranch as Record<string, unknown>[]) || []} />
        <ReportChartCard title="Risk by Product" type="bar" xKey="name" yKey="value" data={(charts.riskExposureByProduct as Record<string, unknown>[]) || []} />
        <ReportChartCard title="Top 10 High-risk Loans" type="bar" xKey="loanId" yKey="overdueAmount" data={(charts.topHighRiskLoans as Record<string, unknown>[]) || []} />
        <ReportChartCard title="Loan Status Funnel" type="bar" xKey="stage" yKey="value" data={(charts.loanStatusFunnel as Record<string, unknown>[]) || []} />
      </div>

      <ReportDataTable
        title="Risk Details"
        columns={COLUMNS}
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
