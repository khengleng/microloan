"use client";

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import api from '@/lib/api';
import { useToast } from '@/components/ui/toast';
import { useAuth } from '@/lib/auth-context';
import { ReportFilters } from '@/components/reports/ReportFilters';
import { ReportTabs } from '@/components/reports/ReportTabs';
import { BorrowersReport } from '@/components/reports/BorrowersReport';
import { CollectionsReport } from '@/components/reports/CollectionsReport';
import { LoanPortfolioReport } from '@/components/reports/LoanPortfolioReport';
import { OverviewDashboard } from '@/components/reports/OverviewDashboard';
import { RiskReport } from '@/components/reports/RiskReport';
import { OptionItem, ReportFilters as ReportFiltersType, ReportResponse, ReportTabKey } from '@/components/reports/types';

const DEFAULT_FILTERS: ReportFiltersType = {
  page: 1,
  limit: 20,
  sortBy: 'createdAt',
  sortOrder: 'desc',
  currency: 'USD',
};

const STATUS_OPTIONS: OptionItem[] = [
  { label: 'Pending', value: 'PENDING' },
  { label: 'Approved', value: 'APPROVED' },
  { label: 'Disbursed', value: 'DISBURSED' },
  { label: 'Closed', value: 'CLOSED' },
  { label: 'Defaulted', value: 'DEFAULTED' },
  { label: 'On Time', value: 'ON_TIME' },
  { label: 'Late', value: 'LATE' },
  { label: 'Active', value: 'ACTIVE' },
  { label: 'Inactive', value: 'INACTIVE' },
];

const RISK_OPTIONS: OptionItem[] = [
  { label: 'Low', value: 'Low' },
  { label: 'Medium', value: 'Medium' },
  { label: 'High', value: 'High' },
  { label: 'Critical', value: 'Critical' },
];

function endpoint(tab: ReportTabKey) {
  if (tab === 'overview') return 'overview';
  if (tab === 'loan-portfolio') return 'loan-portfolio';
  if (tab === 'collections') return 'collections';
  if (tab === 'borrowers') return 'borrowers';
  return 'risk';
}

function exportEndpoint(tab: ReportTabKey) {
  if (tab === 'loan-portfolio') return 'loan-portfolio';
  if (tab === 'collections') return 'collections';
  if (tab === 'borrowers') return 'borrowers';
  if (tab === 'risk') return 'risk';
  return null;
}

function clean(filters: ReportFiltersType) {
  return Object.fromEntries(Object.entries(filters).filter(([, value]) => value !== undefined && value !== ''));
}

export default function ReportsPage() {
  const t = useTranslations('Reports');
  const { showToast } = useToast();
  const { user } = useAuth();

  const [activeTab, setActiveTab] = useState<ReportTabKey>('overview');
  const [filters, setFilters] = useState<ReportFiltersType>(DEFAULT_FILTERS);
  const [appliedFilters, setAppliedFilters] = useState<ReportFiltersType>(DEFAULT_FILTERS);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<ReportResponse | null>(null);

  const [branches, setBranches] = useState<OptionItem[]>([]);
  const [officers, setOfficers] = useState<OptionItem[]>([]);
  const [products, setProducts] = useState<OptionItem[]>([]);
  const [borrowers, setBorrowers] = useState<OptionItem[]>([]);

  const isBorrower = user?.role === 'BORROWER';

  const loadFilterOptions = useCallback(async () => {
    try {
      const [usersRes, productsRes, borrowersRes] = await Promise.all([
        api.get('/users').catch(() => ({ data: [] })),
        api.get('/loan-products').catch(() => ({ data: [] })),
        api.get('/borrowers', { params: { page: 1, limit: 200 } }).catch(() => ({ data: { data: [] } })),
      ]);

      const usersData = Array.isArray(usersRes.data) ? usersRes.data : [];
      const productsData = Array.isArray(productsRes.data) ? productsRes.data : [];
      const borrowersData = Array.isArray(borrowersRes.data?.data) ? borrowersRes.data.data : [];

      const branchSet = new Map<string, string>();
      for (const u of usersData as Array<{ branchId?: string | null }>) {
        if (u.branchId) {
          branchSet.set(u.branchId, u.branchId);
        }
      }

      setOfficers(usersData.map((u: { id: string; email: string }) => ({ value: u.id, label: u.email })));
      setProducts(productsData.map((p: { id: string; name: string }) => ({ value: p.id, label: p.name })));
      setBorrowers(borrowersData.map((b: { id: string; firstName: string; lastName: string }) => ({ value: b.id, label: `${b.firstName} ${b.lastName}`.trim() })));
      setBranches(Array.from(branchSet.entries()).map(([value, label]) => ({ value, label })));
    } catch {
      // Non-blocking: filters can still be applied with date/search/status.
    }
  }, []);

  const loadReport = useCallback(async (tab: ReportTabKey, query: ReportFiltersType) => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.get(`/reports/${endpoint(tab)}`, { params: clean(query) });
      setData(res.data);
    } catch (e: any) {
      setData(null);
      const message = e?.response?.data?.message || 'Unable to load report data for selected filters.';
      setError(Array.isArray(message) ? message[0] : message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadFilterOptions();
  }, [loadFilterOptions]);

  useEffect(() => {
    loadReport(activeTab, appliedFilters);
  }, [activeTab, appliedFilters, loadReport]);

  const onApply = () => setAppliedFilters(filters);

  const onReset = () => {
    setFilters(DEFAULT_FILTERS);
    setAppliedFilters(DEFAULT_FILTERS);
  };

  const onSort = (key: string) => {
    const nextOrder: 'asc' | 'desc' = filters.sortBy === key && filters.sortOrder === 'asc' ? 'desc' : 'asc';
    const next = { ...filters, sortBy: key, sortOrder: nextOrder, page: 1 };
    setFilters(next);
    setAppliedFilters(next);
  };

  const onPageChange = (page: number) => {
    const next = { ...filters, page };
    setFilters(next);
    setAppliedFilters(next);
  };

  const onExport = async (format: 'csv' | 'xlsx') => {
    const exp = exportEndpoint(activeTab);
    if (!exp) return;

    try {
      const res = await api.get(`/reports/${exp}/export`, {
        params: { ...clean(appliedFilters), format },
        responseType: 'blob',
      });
      const url = window.URL.createObjectURL(new Blob([res.data]));
      const a = document.createElement('a');
      a.href = url;
      a.download = `${exp}_${new Date().toISOString().slice(0, 10)}.${format}`;
      a.click();
      window.URL.revokeObjectURL(url);
      showToast(t('exportSuccess'), 'success');
    } catch {
      showToast(t('exportFail'), 'error');
    }
  };

  const filterOptions = useMemo(() => ({
    branches,
    officers,
    products,
    borrowers,
    statuses: STATUS_OPTIONS,
    riskGrades: RISK_OPTIONS,
    currencies: [{ label: 'USD', value: 'USD' }],
  }), [branches, officers, products, borrowers]);

  return (
    <div className="max-w-7xl space-y-5">
      <div className="bg-white border border-slate-200 rounded-lg p-5">
        <h1 className="text-2xl font-black text-slate-900">{t('title')}</h1>
        <p className="text-sm text-slate-500 mt-1">{t('subtitle')}</p>
      </div>

      {isBorrower ? (
        <div className="bg-white border border-red-200 text-red-700 rounded-lg p-5 text-sm">
          {t('forbidden')}
        </div>
      ) : (
        <>
          <ReportTabs activeTab={activeTab} onChange={setActiveTab} />

          <ReportFilters
            tab={activeTab}
            filters={filters}
            setFilters={setFilters}
            onApply={onApply}
            onReset={onReset}
            options={filterOptions}
          />

          {activeTab === 'overview' && (
            <OverviewDashboard
              data={data}
              loading={loading}
              error={error}
              sortBy={filters.sortBy}
              sortOrder={filters.sortOrder}
              onSort={onSort}
              onPageChange={onPageChange}
            />
          )}

          {activeTab === 'loan-portfolio' && (
            <LoanPortfolioReport
              data={data}
              loading={loading}
              error={error}
              sortBy={filters.sortBy}
              sortOrder={filters.sortOrder}
              onSort={onSort}
              onPageChange={onPageChange}
              onExport={onExport}
            />
          )}

          {activeTab === 'collections' && (
            <CollectionsReport
              data={data}
              loading={loading}
              error={error}
              sortBy={filters.sortBy}
              sortOrder={filters.sortOrder}
              onSort={onSort}
              onPageChange={onPageChange}
              onExport={onExport}
            />
          )}

          {activeTab === 'borrowers' && (
            <BorrowersReport
              data={data}
              loading={loading}
              error={error}
              sortBy={filters.sortBy}
              sortOrder={filters.sortOrder}
              onSort={onSort}
              onPageChange={onPageChange}
              onExport={onExport}
            />
          )}

          {activeTab === 'risk' && (
            <RiskReport
              data={data}
              loading={loading}
              error={error}
              sortBy={filters.sortBy}
              sortOrder={filters.sortOrder}
              onSort={onSort}
              onPageChange={onPageChange}
              onExport={onExport}
            />
          )}
        </>
      )}
    </div>
  );
}
