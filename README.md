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
   # Ensure DATABASE_URL is set correctly in .env
   ```

3. Setup Database (Schema & Seed):
   ```bash
   pnpm db:push
   pnpm db:seed
   ```
   *The seed script creates a default tenant "Acme Lending", an admin user (`admin@acme.com` / `password123`), and test loan setup.*

4. Start Dev Environments (Next.js & NestJS concurrent):
   ```bash
   pnpm dev
   ```
   - **API Server** will be at: `http://localhost:3001`
   - **Web Server** will be at: `http://localhost:3000`

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
     - `CORS_ORIGIN` = `https://<YOUR-WEB-DOMAIN>.up.railway.app`
     - `NODE_ENV` = `production`
   - **Migrations**: Railway will auto deploy, you can set a custom start command to include: `npx prisma migrate deploy && node dist/main.js` if you are using migrations. (Otherwise `pnpm db:push` handles schema syncs safely at the MVP stage).

3. **Add Web Service**:
   - Create a second service from the same GitHub repo.
   - Set **Root Directory** to `apps/web`.
   - Setup Environment Variables:
     - `NEXT_PUBLIC_API_URL` = `https://<YOUR-API-DOMAIN>.up.railway.app/v1`
     - `NODE_ENV` = `production`

---

## Built with ❤️
Designed for lending operations robustness, minimal technical debt edge cases, and high portability.
