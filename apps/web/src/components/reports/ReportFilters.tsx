"use client";

import type React from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { OptionItem, ReportFilters as ReportFiltersType, ReportTabKey } from './types';

function forTab(tab: ReportTabKey) {
  if (tab === 'overview') return ['status', 'branchId', 'loanOfficerId'];
  if (tab === 'loan-portfolio') return ['status', 'branchId', 'loanOfficerId', 'productId', 'borrowerId', 'riskGrade', 'currency'];
  if (tab === 'collections') return ['status', 'branchId', 'loanOfficerId', 'borrowerId', 'currency'];
  if (tab === 'borrowers') return ['status', 'branchId', 'riskGrade'];
  return ['status', 'branchId', 'loanOfficerId', 'productId', 'riskGrade', 'currency'];
}

export function ReportFilters({
  tab,
  filters,
  setFilters,
  onApply,
  onReset,
  options,
}: {
  tab: ReportTabKey;
  filters: ReportFiltersType;
  setFilters: (next: ReportFiltersType) => void;
  onApply: () => void;
  onReset: () => void;
  options: {
    branches: OptionItem[];
    officers: OptionItem[];
    products: OptionItem[];
    borrowers: OptionItem[];
    statuses: OptionItem[];
    riskGrades: OptionItem[];
    currencies: OptionItem[];
  };
}) {
  const visible = new Set(forTab(tab));
  const on = (key: keyof ReportFiltersType) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setFilters({ ...filters, [key]: e.target.value || undefined, page: 1 });

  return (
    <Card className="border-slate-200 shadow-sm">
      <CardContent className="p-4 space-y-3">
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
          <Input type="date" value={filters.from || ''} onChange={on('from')} />
          <Input type="date" value={filters.to || ''} onChange={on('to')} />
          <Input placeholder="Search borrower, loan ID..." value={filters.search || ''} onChange={on('search')} />
          {visible.has('branchId') && (
            <Select value={filters.branchId || ''} onChange={on('branchId')}>
              <option value="">All branches</option>
              {options.branches.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </Select>
          )}
          {visible.has('loanOfficerId') && (
            <Select value={filters.loanOfficerId || ''} onChange={on('loanOfficerId')}>
              <option value="">All loan officers</option>
              {options.officers.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </Select>
          )}
          {visible.has('productId') && (
            <Select value={filters.productId || ''} onChange={on('productId')}>
              <option value="">All products</option>
              {options.products.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </Select>
          )}
          {visible.has('status') && (
            <Select value={filters.status || ''} onChange={on('status')}>
              <option value="">All statuses</option>
              {options.statuses.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </Select>
          )}
          {visible.has('borrowerId') && (
            <Select value={filters.borrowerId || ''} onChange={on('borrowerId')}>
              <option value="">All borrowers</option>
              {options.borrowers.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </Select>
          )}
          {visible.has('riskGrade') && (
            <Select value={filters.riskGrade || ''} onChange={on('riskGrade')}>
              <option value="">All risk grades</option>
              {options.riskGrades.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </Select>
          )}
          {visible.has('currency') && (
            <Select value={filters.currency || ''} onChange={on('currency')}>
              <option value="">All currencies</option>
              {options.currencies.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </Select>
          )}
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onReset}>Reset Filters</Button>
          <Button onClick={onApply}>Apply Filters</Button>
        </div>
      </CardContent>
    </Card>
  );
}
