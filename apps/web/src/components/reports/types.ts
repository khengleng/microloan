export type ReportTabKey = 'overview' | 'loan-portfolio' | 'collections' | 'borrowers' | 'risk';

export type ReportFilters = {
  from?: string;
  to?: string;
  tenantId?: string;
  branchId?: string;
  loanOfficerId?: string;
  productId?: string;
  status?: string;
  borrowerId?: string;
  riskGrade?: string;
  currency?: string;
  page?: number;
  limit?: number;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
  search?: string;
};

export type ReportResponse = {
  filters: Record<string, unknown>;
  kpis: Record<string, number | string>;
  charts: Record<string, unknown>;
  rows: Record<string, unknown>[];
  pagination: {
    page: number;
    limit: number;
    total: number;
  };
};

export type OptionItem = {
  label: string;
  value: string;
};

export type ReportColumn = {
  key: string;
  label: string;
  sortable?: boolean;
  type?: 'text' | 'currency' | 'date' | 'number' | 'percent';
};
