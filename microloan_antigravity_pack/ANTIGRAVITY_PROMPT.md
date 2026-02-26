# Antigravity Prompt Command — MicroLend OS (Cambodia-first)

You are **Antigravity**, an autonomous senior full‑stack engineer + DevOps. Build and deploy the **MicroLend OS** MVP from scratch.

## Hard requirements
- **Monorepo** (single GitHub repo) named `microloan`
- Package manager: **pnpm**
- Monorepo orchestration: **Turborepo**
- Frontend: **Next.js (App Router) + Tailwind + shadcn/ui**
- Backend: **NestJS**
- DB: **PostgreSQL**
- ORM: **Prisma** (single source of truth in `packages/db`)
- Shared types/utilities: `packages/shared`
- Deploy everything on **Railway.com**:
  - 1 Railway Project
  - 1 Postgres service
  - 2 web services from the same repo: `apps/api` and `apps/web`
- Provide Khmer + English **UI toggle** (i18n-ready from day one)
- Multi-tenant SaaS (each lender is a tenant) using **shared schema + tenant_id** on all business tables
- Security: JWT access + refresh tokens, RBAC (ADMIN / OPS / AUDITOR)
- Add audit logging for create/update/delete actions on key entities
- Export CSV reports (loan book, repayments, PAR report)
- Must be stable, boring, and production-friendly (no experimental dependencies)

## Deliverables (must be committed to repo)
1) Working codebase with:
   - `apps/web` (Next.js)
   - `apps/api` (NestJS)
   - `packages/db` (Prisma schema + migrations + Prisma client)
   - `packages/shared` (types)
2) `README.md` with:
   - local dev steps
   - Railway deploy steps
   - env vars
   - feature list
3) `.env.example` (root or per-app) showing required variables (no secrets)
4) Seed script to create:
   - 1 tenant
   - 1 admin user
   - sample borrower + sample loan + schedule + repayment
5) Minimal automated checks:
   - eslint + typecheck for web and api
   - prisma format validation

---

## Product scope (MVP)
Goal: Replace Excel for small lenders (<10k active loans) in Cambodia.

### Entities
- Tenant
- User (role-based)
- Borrower
- Loan
- RepaymentSchedule (generated)
- Repayment
- AuditLog

### Core workflows
1) **Auth**
   - Login with email/password
   - Refresh token rotation
   - RBAC guards
2) **Borrowers**
   - List / Create / View / Edit
3) **Loans**
   - Create loan
   - Generate repayment schedule on creation
   - Disburse loan (status change)
   - View loan details incl. schedule and repayments
4) **Repayments**
   - Post repayment amount
   - Allocate to interest then principal (simple, deterministic)
   - Mark schedule installments paid as appropriate
5) **Dashboard**
   - Outstanding principal
   - Due today / due next 7 days
   - PAR30 and PAR90
6) **Reports**
   - CSV export: loan book, repayment history, PAR report
7) **Localization**
   - Khmer + English toggle for UI text (use `next-intl` or `react-i18next`)
   - Use a Khmer-capable font (e.g., Noto Sans Khmer)
8) **Audit Trail**
   - Create an audit log row for CRUD operations on Borrower, Loan, Repayment

### Interest methods (MVP)
Support exactly two methods at launch:
- **FLAT**
- **REDUCING BALANCE**
(Keep formulas transparent and testable; add more later.)

---

## Tech implementation details (must follow)
### Monorepo structure
```
microloan/
  apps/
    api/
    web/
  packages/
    db/
    shared/
  turbo.json
  pnpm-workspace.yaml
  package.json
  tsconfig.base.json
```

### Multi-tenancy
- Every business table includes `tenantId`
- JWT payload contains `tenantId` and `role`
- A NestJS guard/middleware injects `tenantId` into request context
- All Prisma queries are scoped by `tenantId` (enforce centrally; do not rely on developers remembering)

### API design
- REST endpoints under `/v1`
- DTO validation with class-validator
- Return consistent response shapes and proper HTTP status codes
- CORS locked down to the deployed web domain (env var)

### Web design
- Simple SaaS admin layout: sidebar + topbar
- Pages:
  - /login
  - /dashboard
  - /borrowers
  - /borrowers/new
  - /borrowers/[id]
  - /loans
  - /loans/new
  - /loans/[id]
  - /repayments (or within loan detail)
  - /reports
- Include language toggle in the topbar

### Railway deployment
- Two Railway services from same repo
- Set root directory per service:
  - api: `apps/api`
  - web: `apps/web`
- Ensure build/start commands work in Railway
- Migrations: run `prisma migrate deploy` automatically on api deploy (safe)
  - Provide a `railway:deploy` script or `postinstall` logic that Railway can run
- Output exact env vars needed for Railway

---

## Required environment variables
### API service
- DATABASE_URL (provided by Railway Postgres)
- JWT_ACCESS_SECRET
- JWT_REFRESH_SECRET
- JWT_ACCESS_TTL (default 15m)
- JWT_REFRESH_TTL (default 30d)
- CORS_ORIGIN (web URL)
- NODE_ENV=production

### WEB service
- NEXT_PUBLIC_API_URL (api URL)
- NODE_ENV=production

---

## Acceptance checklist (must pass)
- `pnpm install` at repo root succeeds
- `pnpm build` succeeds for both apps
- Local dev:
  - `pnpm dev` runs web + api
  - web can login and call api
- Tenant isolation verified:
  - create two tenants, users cannot access other tenant data
- Khmer/English toggle works in UI
- CSV exports download correctly
- Railway deployment steps in README are accurate and minimal

---

## Start now
1) Initialize the monorepo skeleton
2) Implement Prisma schema + migrations
3) Implement NestJS auth + tenant scoping
4) Implement core lending workflows
5) Implement Next.js UI pages
6) Add seed script and docs
7) Provide final commit-ready repo with instructions
