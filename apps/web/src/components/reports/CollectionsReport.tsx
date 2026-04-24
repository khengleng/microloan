"use client";

import { KpiCard } from './KpiCard';
import { ReportChartCard } from './ReportChartCard';
import { ReportDataTable } from './ReportDataTable';
import { ReportResponse } from './types';
import { ExportButtons } from './ExportButtons';

const COLUMNS = [
  { key: 'repaymentId', label: 'Repayment ID', sortable: true },
  { key: 'loanId', label: 'Loan ID', sortable: true },
  { key: 'borrower', label: 'Borrower', sortable: true },
  { key: 'branch', label: 'Branch', sortable: true },
  { key: 'collector', label: 'Collector', sortable: true },
  { key: 'paymentDate', label: 'Payment Date', type: 'date' as const, sortable: true },
  { key: 'dueDate', label: 'Due Date', type: 'date' as const, sortable: true },
  { key: 'amountPaid', label: 'Amount Paid', type: 'currency' as const, sortable: true },
  { key: 'principalPaid', label: 'Principal', type: 'currency' as const, sortable: true },
  { key: 'interestPaid', label: 'Interest', type: 'currency' as const, sortable: true },
  { key: 'penaltyPaid', label: 'Penalty', type: 'currency' as const, sortable: true },
  { key: 'paymentMethod', label: 'Method', sortable: true },
  { key: 'status', label: 'Status', sortable: true },
  { key: 'daysLate', label: 'Days Late', type: 'number' as const, sortable: true },
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

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-end">
        <ExportButtons disabled={loading} onExport={onExport} />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
        <KpiCard title="Total Collected" value={kpis.totalCollected} />
        <KpiCard title="Principal Collected" value={kpis.principalCollected} />
        <KpiCard title="Interest Collected" value={kpis.interestCollected} />
        <KpiCard title="Penalty Collected" value={kpis.penaltyCollected} />
        <KpiCard title="Repayments" value={kpis.numberOfRepayments} />
        <KpiCard title="Collection Rate" value={kpis.collectionRate} />
        <KpiCard title="Overdue Collected" value={kpis.overdueCollected} />
        <KpiCard title="Missed Repayments" value={kpis.missedRepayments} />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <ReportChartCard title="Collection Trend" type="line" xKey="month" yKey="amount" data={(charts.collectionTrend as Record<string, unknown>[]) || []} />
        <ReportChartCard title="Principal vs Interest" type="bar" xKey="name" yKey="value" data={(charts.principalVsInterest as Record<string, unknown>[]) || []} />
        <ReportChartCard title="Status Breakdown" type="pie" xKey="name" yKey="value" data={(charts.repaymentStatusBreakdown as Record<string, unknown>[]) || []} />
        <ReportChartCard title="Payment Method" type="pie" xKey="name" yKey="value" data={(charts.paymentMethodDistribution as Record<string, unknown>[]) || []} />
        <ReportChartCard title="By Branch" type="bar" xKey="name" yKey="value" data={(charts.branchPerformance as Record<string, unknown>[]) || []} />
        <ReportChartCard title="By Loan Officer" type="bar" xKey="name" yKey="value" data={(charts.loanOfficerPerformance as Record<string, unknown>[]) || []} />
      </div>

      <ReportDataTable
        title="Collections Preview"
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
