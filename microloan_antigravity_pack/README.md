# Magic Money (MVP) — Cambodia-first Micro‑Lending Backoffice

Magic Money is a multi‑tenant, Khmer/English micro‑lending operations platform designed to replace Excel for small digital lenders.

## What it does (MVP)
### Core modules
- **Multi‑tenant SaaS**
  - Each lender is a tenant
  - Strict `tenantId` scoping for all business data
- **Users & Roles (RBAC)**
  - `ADMIN`, `OPS`, `AUDITOR`
- **Borrowers**
  - Create / view / update
- **Loans**
  - Create loan + generate repayment schedule
  - Disburse loan (status change)
  - View loan details, schedule, repayments
- **Repayments**
  - Post repayments
  - Allocate payment to **interest then principal**
  - Auto-mark installments as paid
- **Dashboard**
  - Outstanding principal
  - Due today / due next 7 days
  - PAR30 / PAR90
- **Reports**
  - CSV export: Loan Book, Repayments, PAR
- **Audit Trail**
  - Record who did what and when (CRUD on key entities)
- **Localization**
  - Khmer + English UI toggle (i18n-ready)

---

## Tech stack
- Monorepo: **pnpm + Turborepo**
- Web: **Next.js (App Router) + Tailwind + shadcn/ui**
- API: **NestJS**
- DB: **PostgreSQL**
- ORM: **Prisma**
- Shared types: `packages/shared`
- DB schema/migrations: `packages/db`

---

## Repository structure
```
apps/
  web/        # Next.js admin portal
  api/        # NestJS REST API
packages/
  db/         # Prisma schema, migrations, Prisma client
  shared/     # shared types and helpers
```

---

## Features & workflows (detail)

### 1) Authentication & RBAC
- Email/password login
- JWT access token + refresh token rotation
- Role-based guards:
  - ADMIN: full access
  - OPS: day-to-day operations
  - AUDITOR: read-only access

### 2) Borrower Management
- Create borrower profile
- Edit borrower details
- View borrower loans and repayment status

### 3) Loan Management
- Create loan with:
  - principal, annual rate, term, interest method (FLAT/REDUCING)
- Generate repayment schedule
- Disburse loan
- Track status:
  - DRAFT, DISBURSED, CLOSED, DEFAULTED

### 4) Repayments
- Post repayment amount and date
- Deterministic allocation:
  - pay due interest first, then principal
- Installments updated automatically

### 5) Portfolio Risk (PAR)
- PAR30: loans with installments 30+ days overdue
- PAR90: loans with installments 90+ days overdue
- Dashboard aggregates basic portfolio health

### 6) Reports / CSV Exports
- Loan book export (all active loans)
- Repayment history export
- PAR export (PAR30/PAR90 lists)

### 7) Audit Logging
- Track create/update/delete for:
  - Borrowers
  - Loans
  - Repayments
- Store actor user, timestamp, entity, entityId, metadata

### 8) Khmer + English Toggle
- i18n-ready UI using translation files
- Khmer-safe font (e.g., Noto Sans Khmer)
- Language toggle in top navigation

---

## Local development

### Prerequisites
- Node.js 20+
- pnpm
- PostgreSQL (local or Railway)

### Setup
1) Install dependencies at repo root:
```bash
pnpm install
```

2) Configure environment variables:
- Copy `.env.example` → `.env` and fill values.

3) Run Prisma migrations and generate client:
```bash
pnpm -C packages/db migrate:dev
pnpm -C packages/db generate
```

4) Run dev servers:
```bash
pnpm dev
```

Expected:
- API runs on `http://localhost:3001` (or configured port)
- Web runs on `http://localhost:3000`

### Seed data
A seed script is included to create:
- tenant
- admin user
- sample borrower/loan/schedule/repayment

Run:
```bash
pnpm seed
```

---

## Railway deployment (everything on Railway)

### What you deploy
- 1 Railway project
- 1 Postgres database
- 2 services from the same repo:
  - **api** (root dir: `apps/api`)
  - **web** (root dir: `apps/web`)

### Steps
1) Create a new Railway project.
2) Add **PostgreSQL**.
3) Add service **api** from GitHub repo:
   - Root Directory: `apps/api`
4) Add service **web** from GitHub repo:
   - Root Directory: `apps/web`
5) Set environment variables:

#### API service env vars
- `DATABASE_URL` (Railway provides via Postgres)
- `JWT_ACCESS_SECRET`
- `JWT_REFRESH_SECRET`
- `JWT_ACCESS_TTL=15m`
- `JWT_REFRESH_TTL=30d`
- `CORS_ORIGIN=<your web public url>`
- `NODE_ENV=production`

#### Web service env vars
- `NEXT_PUBLIC_API_URL=<your api public url>`
- `NODE_ENV=production`

6) Ensure Prisma migrations run on deploy:
- API should run: `prisma migrate deploy` during deployment (see repo scripts).

---

## Pricing model (business-ready)
- Subscription plans (mid-tier)
- Tiered implementation fee based on active loan volume:
  - 0–2,000 loans
  - 2,000–10,000 loans
  - 10,000+ loans

(Implementation is configuration + migration + training; no bespoke feature development.)

---

## Roadmap (post‑MVP)
- Fee rules (late fees, penalties, restructuring)
- More interest methods (declining, compounding variants)
- Bulk import tools + template validator
- Integrations (payments, SMS reminders)
- Portfolio benchmarking (anonymized metrics)
- Country expansion packs (Indonesia, Laos, Timor-Leste, then Africa/LatAm)

---

## License
Proprietary (recommended for commercial SaaS). Change if needed.
