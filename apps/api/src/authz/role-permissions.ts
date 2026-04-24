import type { Role } from '@microloan/db';
import { Permission } from './permission.enum';

// Support both canonical and legacy role names to allow safe migrations.
type RoleLike = Role | 'TENANT_ADMIN' | 'BRANCH_MANAGER' | 'LOAN_OFFICER' | 'CREDIT_OFFICER' |
  'APPROVER' | 'ACCOUNTANT' | 'AUDITOR' | 'CUSTOMER_SUPPORT' | 'BORROWER' | 'ADMIN' | 'OPERATOR' | 'FINANCE' | 'SALES' | 'CX';

const rolePermissions: Record<RoleLike, Permission[]> = {
  SUPERADMIN: Object.values(Permission),
  TENANT_ADMIN: [
    Permission.USER_CREATE,
    Permission.USER_UPDATE,
    Permission.USER_UPDATE_ROLE,
    Permission.USER_DISABLE,
    Permission.USER_DELETE,
    Permission.CONFIG_UPDATE,
    Permission.CUSTOMER_CREATE,
    Permission.CUSTOMER_VIEW,
    Permission.CUSTOMER_UPDATE,
    Permission.LOAN_APPLICATION_CREATE,
    Permission.LOAN_APPLICATION_REVIEW,
    Permission.LOAN_APPROVE,
    Permission.LOAN_REJECT,
    Permission.LOAN_DISBURSE,
    Permission.LOAN_REPAYMENT_POST,
    Permission.DOCUMENT_UPLOAD,
    Permission.DOCUMENT_VIEW,
    Permission.DOCUMENT_DELETE,
    Permission.AUDIT_VIEW,
  ],
  BRANCH_MANAGER: [
    Permission.CUSTOMER_CREATE,
    Permission.CUSTOMER_VIEW,
    Permission.CUSTOMER_UPDATE,
    Permission.LOAN_APPLICATION_CREATE,
    Permission.LOAN_APPLICATION_REVIEW,
    Permission.DOCUMENT_UPLOAD,
    Permission.DOCUMENT_VIEW,
    Permission.LOAN_REPAYMENT_POST,
  ],
  LOAN_OFFICER: [
    Permission.CUSTOMER_CREATE,
    Permission.CUSTOMER_VIEW,
    Permission.LOAN_APPLICATION_CREATE,
    Permission.DOCUMENT_UPLOAD,
    Permission.DOCUMENT_VIEW,
  ],
  CREDIT_OFFICER: [
    Permission.CUSTOMER_VIEW,
    Permission.LOAN_APPLICATION_REVIEW,
    Permission.DOCUMENT_VIEW,
  ],
  APPROVER: [
    Permission.CUSTOMER_VIEW,
    Permission.LOAN_APPROVE,
    Permission.LOAN_REJECT,
    Permission.DOCUMENT_VIEW,
  ],
  ACCOUNTANT: [
    Permission.CUSTOMER_VIEW,
    Permission.LOAN_DISBURSE,
    Permission.LOAN_REPAYMENT_POST,
    Permission.DOCUMENT_VIEW,
  ],
  AUDITOR: [
    Permission.CUSTOMER_VIEW,
    Permission.DOCUMENT_VIEW,
    Permission.AUDIT_VIEW,
  ],
  CUSTOMER_SUPPORT: [
    Permission.CUSTOMER_VIEW,
    Permission.CUSTOMER_UPDATE,
    Permission.DOCUMENT_VIEW,
  ],
  BORROWER: [
    Permission.DOCUMENT_VIEW,
  ],
  // Legacy role aliases
  ADMIN: [],
  OPERATOR: [],
  FINANCE: [],
  SALES: [],
  CX: [],
};

const legacyToCanonical: Record<string, RoleLike> = {
  ADMIN: 'TENANT_ADMIN',
  OPERATOR: 'LOAN_OFFICER',
  FINANCE: 'ACCOUNTANT',
  SALES: 'CUSTOMER_SUPPORT',
  CX: 'CUSTOMER_SUPPORT',
};

export function canonicalRole(role: string): RoleLike {
  return (legacyToCanonical[role] as RoleLike) || (role as RoleLike);
}

export function permissionsForRole(role: string): Set<Permission> {
  const canonical = canonicalRole(role);
  return new Set(rolePermissions[canonical] || []);
}

