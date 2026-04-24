"use client";

import { KpiCard } from './KpiCard';
import { ReportChartCard } from './ReportChartCard';
import { ReportDataTable } from './ReportDataTable';
import { ReportResponse } from './types';
import { ExportButtons } from './ExportButtons';

const COLUMNS = [
  { key: 'borrowerId', label: 'Borrower ID', sortable: true },
  { key: 'name', label: 'Name', sortable: true },
  { key: 'phone', label: 'Phone', sortable: true },
  { key: 'idNumber', label: 'ID Number', sortable: true },
  { key: 'branch', label: 'Branch', sortable: true },
  { key: 'occupation', label: 'Occupation', sortable: true },
  { key: 'registrationDate', label: 'Registered On', type: 'date' as const, sortable: true },
  { key: 'kycStatus', label: 'KYC Status', sortable: true },
  { key: 'activeLoanCount', label: 'Active Loans', type: 'number' as const, sortable: true },
  { key: 'outstandingBalance', label: 'Outstanding', type: 'currency' as const, sortable: true },
  { key: 'riskGrade', label: 'Risk Grade', sortable: true },
  { key: 'status', label: 'Status', sortable: true },
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

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-end">
        <ExportButtons disabled={loading} onExport={onExport} />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
        <KpiCard title="Total Borrowers" value={kpis.totalBorrowers} />
        <KpiCard title="Active Borrowers" value={kpis.activeBorrowers} />
        <KpiCard title="New This Month" value={kpis.newBorrowersThisMonth} />
        <KpiCard title="With Active Loans" value={kpis.borrowersWithActiveLoans} />
        <KpiCard title="Average Loan Size" value={kpis.averageLoanSize} />
        <KpiCard title="High Risk Borrowers" value={kpis.highRiskBorrowers} />
        <KpiCard title="Incomplete KYC" value={kpis.incompleteKycCount} />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <ReportChartCard title="Borrower Growth" type="line" xKey="month" yKey="value" data={(charts.borrowerGrowth as Record<string, unknown>[]) || []} />
        <ReportChartCard title="By Branch" type="bar" xKey="name" yKey="value" data={(charts.distributionByBranch as Record<string, unknown>[]) || []} />
        <ReportChartCard title="By Occupation" type="pie" xKey="name" yKey="value" data={(charts.distributionByOccupation as Record<string, unknown>[]) || []} />
        <ReportChartCard title="Risk Breakdown" type="pie" xKey="name" yKey="value" data={(charts.riskGradeBreakdown as Record<string, unknown>[]) || []} />
        <ReportChartCard title="KYC Completion" type="pie" xKey="name" yKey="value" data={(charts.kycCompletionStatus as Record<string, unknown>[]) || []} />
      </div>

      <ReportDataTable
        title="Borrowers Preview"
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
