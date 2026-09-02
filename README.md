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
npm run db:migrate     # applies every migration in src/db/migrations/
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
| `ANTHROPIC_WORKSPACE_ID` | Optional — scopes API usage to a specific Anthropic workspace |
| `DATABASE_URL` | Postgres connection string |
| `SENDGRID_API_KEY` | Transactional email (match/booking notifications) |
| `SENDGRID_FROM_EMAIL` | Verified sender address for outbound email |
| `NODE_ENV` | `development` \| `production` \| `test` |
| `PORT` | API port (default 4000) |
| `JWT_SECRET` | Signing secret for auth tokens |

Frontend (`frontend/.env.local`, never committed):

| Var | Purpose |
|---|---|
| `NEXT_PUBLIC_API_URL` | Backend API base URL |

## Testing

```bash
cd backend
npm test    # unit + integration + e2e, against an isolated freightcopilot_test database
```

Tests never touch the dev/demo data — `test/testDb.js` drops and recreates a dedicated `freightcopilot_test`
database (on the same Postgres server pointed to by `DATABASE_URL`) and runs every migration against it before
each test file. CI (`.github/workflows/ci.yml`) runs the same suite against a fresh Postgres service container
on every push/PR, plus a frontend lint + build check.

## Build order

1. Scaffold + env + database schema ✅
2. Auth (JWT) + onboarding forms ✅
3. Carrier availability form ✅
4. Mocked shipment data + matching engine ✅
5. Dual approval workflow (20-min window, auto-rematch) ✅
6. Ratings/reputation system ✅
7. Email notifications (SendGrid) ✅
8. Multi-tenant organizations + admin approval gate ✅
9. Test suite + CI ✅
10. AI-recommended pricing, live capacity/demand map, configurable auto-approval, truck right-sizing ✅
11. Predictive "day ahead" insights on both dashboards ✅

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the full technical architecture and open follow-ups.

## Deployment targets

- Frontend → Vercel (auto-deploys on push to `main`, root directory `frontend/`)
- Backend + Postgres → Railway (auto-deploys on push to `main`, root directory `backend/`)
