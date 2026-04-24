"use client";

import { KpiCard } from './KpiCard';
import { ReportChartCard } from './ReportChartCard';
import { ReportDataTable } from './ReportDataTable';
import { ReportResponse } from './types';
import { ExportButtons } from './ExportButtons';

const COLUMNS = [
  { key: 'loanId', label: 'Loan ID', sortable: true },
  { key: 'borrowerName', label: 'Borrower', sortable: true },
  { key: 'branch', label: 'Branch', sortable: true },
  { key: 'loanOfficer', label: 'Loan Officer', sortable: true },
  { key: 'product', label: 'Product', sortable: true },
  { key: 'principal', label: 'Principal', type: 'currency' as const, sortable: true },
  { key: 'outstandingBalance', label: 'Outstanding', type: 'currency' as const, sortable: true },
  { key: 'interestRate', label: 'Interest Rate', type: 'percent' as const, sortable: true },
  { key: 'term', label: 'Term', type: 'number' as const, sortable: true },
  { key: 'disbursementDate', label: 'Disbursed On', type: 'date' as const, sortable: true },
  { key: 'maturityDate', label: 'Maturity', type: 'date' as const, sortable: true },
  { key: 'status', label: 'Status', sortable: true },
  { key: 'daysPastDue', label: 'DPD', type: 'number' as const, sortable: true },
  { key: 'riskGrade', label: 'Risk Grade', sortable: true },
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

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-end">
        <ExportButtons disabled={loading} onExport={onExport} />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
        <KpiCard title="Outstanding Principal" value={kpis.totalOutstandingPrincipal} />
        <KpiCard title="Active Loans" value={kpis.totalActiveLoans} />
        <KpiCard title="Disbursed Amount" value={kpis.totalDisbursedAmount} />
        <KpiCard title="Avg Interest Rate" value={kpis.averageInterestRate} />
        <KpiCard title="PAR 1" value={kpis.par1} />
        <KpiCard title="PAR 7" value={kpis.par7} />
        <KpiCard title="PAR 30" value={kpis.par30} />
        <KpiCard title="NPL Amount" value={kpis.nplAmount} />
        <KpiCard title="Portfolio At Risk" value={kpis.portfolioAtRiskPercentage} />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <ReportChartCard title="Outstanding by Status" type="pie" xKey="name" yKey="value" data={(charts.outstandingByStatus as Record<string, unknown>[]) || []} />
        <ReportChartCard title="Disbursement Trend" type="line" xKey="month" yKey="amount" data={(charts.disbursementTrend as Record<string, unknown>[]) || []} />
        <ReportChartCard title="PAR Trend" type="bar" xKey="bucket" yKey="value" data={(charts.parTrend as Record<string, unknown>[]) || []} />
        <ReportChartCard title="By Product" type="bar" xKey="name" yKey="value" data={(charts.distributionByProduct as Record<string, unknown>[]) || []} />
        <ReportChartCard title="By Branch" type="bar" xKey="name" yKey="value" data={(charts.distributionByBranch as Record<string, unknown>[]) || []} />
      </div>

      <ReportDataTable
        title="Loan Portfolio Preview"
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
