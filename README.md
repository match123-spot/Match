# FreightCopilot

Real-time AI freight optimization platform matching shipper demand with carrier capacity (AU/NZ, MVP).

## Structure

```
FreightCopilot/
  backend/    Node.js + Express API, PostgreSQL, Claude API matching engine
  frontend/   Next.js app (shipper + carrier portals)
```

## Prerequisites

- Node.js 24 (installed via nvm — run `nvm use` if you have multiple versions)
- A PostgreSQL database (Railway managed Postgres for deployment; any local/managed Postgres works for dev)

## Backend setup

```bash
cd backend
npm install
cp .env.example .env   # then fill in real values — see below
npm run db:migrate     # creates all tables from src/db/schema.sql
npm run dev            # http://localhost:4000, health check at /health
```

## Frontend setup

```bash
cd frontend
npm install
cp .env.example .env.local
npm run dev            # http://localhost:3000
```

## Environment variables

Backend (`backend/.env`, never committed):

| Var | Purpose |
|---|---|
| `ANTHROPIC_API_KEY` | Claude API key, used by the matching engine |
| `DATABASE_URL` | Postgres connection string |
| `SENDGRID_API_KEY` | Transactional email (booking confirmations) |
| `NODE_ENV` | `development` \| `production` |
| `PORT` | API port (default 4000) |
| `JWT_SECRET` | Signing secret for auth tokens |

Frontend (`frontend/.env.local`, never committed):

| Var | Purpose |
|---|---|
| `NEXT_PUBLIC_API_URL` | Backend API base URL |

## Build order

1. Scaffold + env + database schema ✅
2. Auth (JWT) + onboarding forms
3. Carrier availability form
4. Mocked shipment data + matching engine
5. Dual approval workflow (20-min window, auto-rematch)
6. Ratings/reputation system
7. Email notifications (SendGrid)

## Deployment targets

- Frontend → Vercel
- Backend + Postgres → Railway
