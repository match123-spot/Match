# FreightCopilot Architecture

**Status:** v0.2, reconciled against `FreightCopilot_MVP_v2.docx` and its `_Addendum.docx` companion (both in the project owner's Downloads folder — worth moving into `docs/` as the canonical source). This document is the technical detail; the brief + addendum are the product/business spec. Where they'd otherwise conflict, resolutions are recorded in §0 below.

## 0. Reconciliation with the v2 MVP brief

| Topic | Resolution |
|---|---|
| Testing scope | **Brief governs.** Full suite required: unit tests (matching + approval workflow), integration tests (API endpoints), one full E2E test of the complete flow — see §6, revised. |
| Domain | **Overrides the brief.** Free Vercel/Railway subdomains for now (both auto-provision SSL) — a real domain is a pre-pilot-customer task, not an MVP-build task. |
| GitHub-connected CI/CD | Brief states this is done; it wasn't. Being fixed now — see §7. |
| Features beyond the brief's slice plan (AI pricing, live map, auto-approval, right-sizing) | **Folded into official MVP scope**, not treated as post-MVP extras. |

## 1. Product context

Multi-tenant AU/NZ freight marketplace matching shipper demand with carrier capacity. Target entry customer: small-medium companies — e.g. a shipper posting ~1 shipment/day out of Auckland, a carrier running ~10 trucks in Auckland. Plan is to scale up to larger shippers/carriers once the small end is proven.

Long-term ambition: for shippers with no TMS of their own, FreightCopilot *is* their shipment management tool, not just a bolt-on matching layer. That capability is **explicitly deferred** (see §4) but the data model below is shaped so it slots in without a rework.

## 2. Tenancy model

**Decision: multi-tenant marketplace, multi-user companies, from the start.**

This is the single biggest architectural commitment in this document, and it invalidates the current schema's core assumption. Today:

```
users (1) ──── (1) shippers
users (1) ──── (1) carriers
```

One login *is* one company. That doesn't hold once a 10-truck carrier has two dispatchers who both need to act on behalf of the same carrier org.

**Target shape:**

```
organizations (id, type: 'shipper' | 'carrier', company_name, status: 'pending' | 'approved' | 'suspended', ...)
users (id, org_id → organizations, email, password_hash, role: 'member' | 'org_admin', ...)
shippers (id, org_id → organizations, ...)   -- org-level profile fields, not user-level
carriers (id, org_id → organizations, ...)
```

- `users.org_id` replaces the implicit 1:1 — any user in a shipper org can act for that shipper (create shipments, approve matches); same for carrier orgs.
- `shippers` / `carriers` become properties of the **organization**, not the individual user who happened to sign up first. Company-level settings (auto-approval thresholds, billing, historical acceptance rate) live here.
- Every tenant-scoped table (`shipments`, `carrier_availability`, `matches`, `ratings`) already hangs off `shipper_id`/`carrier_id`, which now transitively scope to an org — no change needed there beyond the FK target.
- New signups create or join an org: first user for a new company name creates the org (status `pending` — see §5); subsequent signups with a matching company can join it (needs an invite/claim flow — open question, see §8).

**This is a real migration, not a quick patch** — it touches auth (JWT payload needs `org_id`, not just `user_id`), every route that currently does `SELECT id FROM carriers WHERE user_id = $1` (auth middleware, availability, settings, ratings, matches — six route files), and the signup flow. I have not implemented this yet; it should be its own reviewed change, ideally the first thing built once this doc is signed off, since every later feature will assume org-scoping exists.

## 3. Manual shipment creation (no-TMS shippers)

**Decision: next phase.** Architected for, not built.

The schema already supports it cleanly: `shipments.otm_shipment_ref` is nullable, and nothing about the `shipments` table assumes OTM origin. A manually-created shipment is just a row with `otm_shipment_ref = NULL` and a `source` marker. When this phase starts:

- Add `shipments.source TEXT CHECK (source IN ('otm_mock', 'manual', 'otm_live'))` so the UI and any reporting can distinguish provenance.
- Build a shipper-facing "create shipment" form (mirrors the carrier's manual availability form already built) — this is the biggest deferred UI piece.
- The matching engine doesn't care where a shipment came from — no changes needed there.

## 4. Trust & vetting

**Decision: admin approval gate.** New organizations land in `status = 'pending'` on signup and cannot post shipments, offer availability, or appear as match candidates until an admin flips them to `'approved'`.

Needs, once org-scoping lands:
- An `admin` role that can list pending orgs and approve/reject (the `users.role` CHECK already includes `'admin'` — it's just never been used).
- A minimal admin view (even a plain table with an approve button is enough for MVP — no need for a polished admin dashboard yet).
- Matching queries (`rankCandidates` in `matchingService.js`) gain a `AND c.org_status = 'approved'` condition once carriers join `organizations`.

## 5. Config strategy — killing the hardcoded constants — done

**Versioned config file**, not env vars, not DB-admin-editable (yet — revisit once you're actively tuning weights against real match outcomes, at which point promoting specific values to DB-backed settings is a small follow-up, not a rewrite).

Everything that used to be a magic number now lives in `backend/src/config/matching.config.js`: `SCORE_WEIGHTS`, `MAX_PICKUP_DISTANCE_KM`, `UTILIZATION_FULL_RATIO`, `RELIABILITY_NEUTRAL_SCORE`, `TRUCK_CLASS_RANK`, `TRUCK_RATE_MULTIPLIER`, `PALLET_CAPACITY`, `APPROVAL_WINDOW_MS`, `DEFAULT_CANDIDATE_LIMIT`/`CANDIDATE_POOL_SIZE`, and `REGION_COORDS`/`REGION_COUNTRY` (moved out of `geo.js`, which is now purely geometry functions). `matchingService.js`, `matchWorkflowService.js`, `geo.js`, and `routes/matches.js` all import from this one file — no behavior change, verified by the full test suite passing unchanged before and after.

**Went one step further than "one file in the backend":** the frontend had silently duplicated two of these values as separate hardcoded literals (`MAX_PICKUP_DISTANCE_KM = 150` in two different page files, and the 30/25/15/20/10 score weights in the dashboard explainer) — real drift risk, since nothing would have caught them going out of sync with the backend if the backend values ever changed. Added a public `GET /config` endpoint exposing the display-safe subset (`maxPickupDistanceKm`, `approvalWindowMinutes`, `scoreWeights`), and the frontend now fetches it instead of hardcoding — genuinely one source of truth end-to-end, not just within the backend.

`REGION_COORDS` stays here too until real geocoding replaces it (a separate, larger decision — see §9).

## 6. Testing & CI — done

**Full test suite, per the v2 brief §8.3**, using Node's built-in `node:test` (no Jest/Vitest dependency needed) plus `supertest` for HTTP-level API tests:

1. **Unit tests** (`backend/test/unit/`) — pure-function tests for the matching engine (`scoreTiming`, `scoreUtilization`, `utilizationRatio`, `distanceKmAndScore`, truck-class ranking) with no DB, plus DB-backed tests for `rankCandidates` (geographic cutoff, org-approval gate, right-sizing) and the full approval workflow (`matchWorkflowService.js`: dual-approval transitions, auto-approval thresholds, reject → rematch, expiry → rematch).
2. **Integration tests** (`backend/test/integration/`) — supertest against the real Express app (`src/app.js`, split out from `src/index.js` so tests don't bind a port or start the background poller): registration/login, org-join-by-company-name, cross-org isolation (one carrier can't see/delete another's availability), the pending-org match-request block, settings, admin authorization.
3. **One end-to-end test** (`backend/test/e2e/fullFlow.test.js`) — the complete brief §8.3 flow: signup → admin approval → carrier posts availability → match requested → dual approval → booking → shipment complete → both sides rate each other → reputation summaries reflect it.

Every test file runs against an isolated `freightcopilot_test` database (`backend/test/testDb.js` drops, recreates, and migrates it fresh before each file) — never the shared dev/demo data. `npm test` in `backend/` runs the full suite; **44/44 passing** as of this writing.

GitHub Actions (`.github/workflows/ci.yml`), triggered on every push/PR:
1. Backend: syntax gate (`node --check`) → full test suite against a real Postgres service container
2. Frontend: lint → production build

The org migration (§2) shipped in the previous session via careful manual grep + regression testing, which caught a stale `carriers.company_name` reference in the matching query and a stale `req.user.sub` in the ratings-submission route. This suite now covers exactly those same code paths (cross-org isolation, matching eligibility, ratings) automatically — that class of bug would be caught by CI going forward rather than depending on manual review catching it again.

## 7. Deployment topology

**Current state (as of this doc):**
- Backend: Railway, deployed via `railway up` (direct CLI upload of local files — **not** connected to GitHub, so pushes don't auto-deploy)
- Frontend: Vercel, deployed via `vercel --prod` (same — CLI-deployed, not git-connected)
- Postgres: Railway, region `ams` (Amsterdam) — fine per your data-residency answer, revisit before real customer data
- Domains: free subdomains (`*.up.railway.app`, `*.vercel.app`) per your call — revisit before a real pilot customer, mainly for credibility rather than technical need

**Gap:** GitHub push is still blocked (no git credentials configured locally), which is also why CI can't run yet. This is the one piece of the deployment story that needs your action, not mine — once `git push` works, both Railway and Vercel can be pointed at the GitHub repo for auto-deploy on merge to `main`, and the CI gate in §6 becomes a real merge gate instead of a local check.

## 8. Folder structure

Current:

```
FreightCopilot/
  backend/
    src/
      config/       # db.js only, currently
      db/           # schema.sql, migrate.js
      middleware/    # auth.js
      routes/        # one file per resource
      services/      # matching, claude, email, geo, otm mock, auth
  frontend/
    src/
      app/           # Next.js App Router pages
      lib/           # api.js client
      components/    # LiveMap.js
  docs/              # this file
```

Proposed additions as the phases above land:

```
  backend/
    src/
      config/
        db.js
        matching.config.js     # §5 — extracted constants
      services/
        ...
      middleware/
        auth.js
        requireOrgApproved.js  # §4 — gate once orgs exist
  .github/
    workflows/
      ci.yml                  # §6
  docs/
    ARCHITECTURE.md            # this file
    (your MVP brief, once written)
```

No monorepo tooling change needed (no Turborepo/Nx) — two independently-deployed apps sharing nothing but a docs folder doesn't need one at this size, and it would be premature structure for a two-person-or-fewer team.

## 9. Open questions for your brief to resolve

These came up while drafting this doc and don't have a clear answer yet:

1. **Org claiming/invites** — when a second person signs up with the same company name as an existing org, how do they join it rather than creating a duplicate org? (Invite link from an existing org member? Admin manually merges? Match on a company registration number?)
2. **Admin identity** — who is "admin" in practice — just you, or a role other people get? Affects whether the admin approval view needs its own auth hardening.
3. **Real geocoding timeline** — `REGION_COORDS` only covers 11 named AU/NZ hub cities. Fine for a demo; a real carrier's "base location" free-text field won't reliably match. When does this need a real geocoding API (Google/Mapbox/Mapbox has a generous free tier)?
4. **Real OTM integration timeline** — not urgent to answer now, but shapes how abstracted the `otmMockService.js` → real OTM adapter boundary needs to be.
