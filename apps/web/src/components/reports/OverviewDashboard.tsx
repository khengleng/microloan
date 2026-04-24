"use client";

import { KpiCard } from './KpiCard';
import { ReportChartCard } from './ReportChartCard';
import { ReportDataTable } from './ReportDataTable';
import { ReportResponse } from './types';

const COLUMNS = [
  { key: 'loanId', label: 'Loan ID', sortable: true },
  { key: 'borrower', label: 'Borrower', sortable: true },
  { key: 'branch', label: 'Branch', sortable: true },
  { key: 'outstandingBalance', label: 'Outstanding', type: 'currency' as const, sortable: true },
  { key: 'daysPastDue', label: 'DPD', type: 'number' as const, sortable: true },
  { key: 'status', label: 'Status', sortable: true },
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

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
        <KpiCard title="Portfolio Outstanding" value={kpis.totalPortfolioOutstanding} />
        <KpiCard title="Total Borrowers" value={kpis.totalBorrowers} />
        <KpiCard title="Active Loans" value={kpis.activeLoans} />
        <KpiCard title="Monthly Collection" value={kpis.monthlyCollection} />
        <KpiCard title="PAR 30" value={kpis.par30Pct} />
        <KpiCard title="NPL Ratio" value={kpis.nplRatio} />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <ReportChartCard title="Disbursement Trend" type="line" xKey="month" yKey="amount" data={(charts.disbursementTrend as Record<string, unknown>[]) || []} />
        <ReportChartCard title="Collection Trend" type="line" xKey="month" yKey="amount" data={(charts.collectionTrend as Record<string, unknown>[]) || []} />
        <ReportChartCard title="Risk Breakdown" type="pie" xKey="name" yKey="value" data={(charts.riskBreakdown as Record<string, unknown>[]) || []} />
      </div>

      <ReportDataTable
        title="Recent Overdue Loans"
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
