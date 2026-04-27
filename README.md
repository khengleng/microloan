# Magic Money (Cambodia-first MVP)

Magic Money is a multi-tenant, Khmer/English micro-lending operations platform designed from scratch for digital lenders. It allows you to:
- Manage borrowers.
- Issue loans (Flat & Reducing Balance methods supported).
- Generate deterministic repayment schedules.
- Log prepayments correctly allocating to interest then principal.
- Track Portfolio at Risk (PAR) in the Dashboard.
- Export Loan Books and Repayment ledgers as CSV.
- Track user actions via a comprehensive Audit Log.

## Tech Stack
- **Monorepo**: pnpm + Turborepo
- **Frontend** (`apps/web`): Next.js (App Router), Tailwind CSS, next-intl for i18n
- **Backend** (`apps/api`): NestJS, JWT Auth
- **Database** (`packages/db`): PostgreSQL via Prisma
- **Shared Utils** (`packages/shared`): TS types and shared loan formula calculators

---

## Local Development

### Prerequisites
- Node.js 20+
- pnpm (`npm install -g pnpm`)
- PostgreSQL database (local or via cloud provider)

### Setup Steps
1. Install dependencies:
   ```bash
   pnpm install
   ```

2. Setup `.env`:
   ```bash
   cp .env.example .env
   # Fill all required variables before running the API
   ```
   Minimum required variables:
   - `DATABASE_URL`
   - `JWT_ACCESS_SECRET` (>= 32 chars)
   - `JWT_REFRESH_SECRET` (>= 32 chars)
   - `JWT_REFRESH_TOKEN_PEPPER` (>= 16 chars)
   - `CORS_ORIGINS`
   - `REDIS_URL` (required in production)
   - `AWS_REGION`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_S3_BUCKET_NAME` (required in production)
   - `BOOTSTRAP_SUPERADMIN_EMAIL`, `BOOTSTRAP_SUPERADMIN_PASSWORD`
   - `NEXT_PUBLIC_CLARITY_PROJECT_ID` (web behavioral analytics, optional)

3. Setup Database (Schema & Seed):
   ```bash
   pnpm db:migrate:deploy
   pnpm db:seed
   ```
   In `development`, seed also creates sample borrower/loan data.
   In `staging/production`, seed only bootstraps platform superadmin safely.

4. Start Dev Environments (Next.js & NestJS concurrent):
   ```bash
   pnpm dev
   ```
   - **API Server** will be at: `http://localhost:3001`
   - **Web Server** will be at: `http://localhost:3000`

### Microsoft Clarity (Web Analytics)
- Set `NEXT_PUBLIC_CLARITY_PROJECT_ID` in the web environment.
- Clarity is initialized client-side and tracks journey events (login, registration, loan workflow, KYC, repayments) plus scoped tags.
- Sensitive fields (credentials, PII, financial inputs) are explicitly masked in UI forms.
- Identification uses internal user subject IDs only (no raw emails or password/token values).

---

## Deployment (Railway.com)

Both Next.js web app and NestJS API can be deployed seamlessly to [Railway](https://railway.app), sharing the same repository but running as distinct services.

### Steps to Deploy
1. **Create a Railway Project**: Add a **PostgreSQL Database**.
2. **Add API Service**:
   - Create a new service from your GitHub repo.
   - Set **Root Directory** to `apps/api`.
   - Setup Environment Variables:
     - `DATABASE_URL` = (From the Postgres service)
     - `JWT_ACCESS_SECRET` = (Your secure random string)
     - `JWT_REFRESH_SECRET` = (Your secure random string)
     - `JWT_REFRESH_TOKEN_PEPPER` = (Strong random pepper)
     - `CORS_ORIGINS` = `https://<YOUR-WEB-DOMAIN>.up.railway.app`
     - `REDIS_URL` = (Managed Redis connection string)
     - `AWS_REGION`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_S3_BUCKET_NAME`
     - `NODE_ENV` = `production`
   - **Migrations**: Run `npx prisma migrate deploy` as a separate release/one-off step. Do not couple migrations to app container startup. Do not run `prisma db push` in production.

3. **Add Web Service**:
   - Create a second service from the same GitHub repo.
   - Set **Root Directory** to `apps/web`.
   - Setup Environment Variables:
     - `NEXT_PUBLIC_API_URL` = `https://<YOUR-API-DOMAIN>.up.railway.app/v1`
     - `NEXT_PUBLIC_CLARITY_PROJECT_ID` = `<YOUR_CLARITY_PROJECT_ID>`
     - `NODE_ENV` = `production`

---

## Built with ❤️
Designed for lending operations robustness, minimal technical debt edge cases, and high portability.

## Security & Production Readiness Checks

Run before any production rollout:

```bash
pnpm run security:scan-hardcodes
pnpm run security:scan-timebombs
pnpm run security:scan-memory-stores
pnpm run security:prod-config-check
pnpm --filter api typecheck
pnpm --filter web typecheck
```
