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

## 5. Config strategy — killing the hardcoded constants

**Decision: versioned config file**, not env vars, not DB-admin-editable (yet — revisit once you're actively tuning weights against real match outcomes, at which point promoting specific values to DB-backed settings is a small follow-up, not a rewrite).

Currently hardcoded across the codebase:

| Constant | File | Value |
|---|---|---|
| Scoring weights (distance/timing/utilization/reliability/acceptance) | `matchingService.js` | 30/25/15/20/10 |
| `MAX_PICKUP_DISTANCE_KM` | `matchingService.js` | 150 |
| `TRUCK_CLASS_RANK`, `TRUCK_RATE_MULTIPLIER`, `PALLET_CAPACITY` | `matchingService.js` | inline objects |
| `REGION_COORDS` (AU/NZ hub lat/lng) | `geo.js` | inline lookup table |
| Approval window (20 min) | `matchWorkflowService.js` | inline |
| Auto-rematch candidate limit | `matchingService.js` | inline `limit = 5` |

**Target shape:** one `backend/src/config/matching.config.js`, exporting all of the above as named constants, imported everywhere they're currently inlined. No behavior change — purely extracting magic numbers into one reviewable, versioned place. `REGION_COORDS` stays here too until real geocoding replaces it (a separate, larger decision — see §8).

This is mechanical and low-risk; I can do this refactor as soon as you want, independent of the org migration.

## 6. Testing & CI

**Decision: full test suite, per the v2 brief §8.3** — required before the MVP is considered complete, not deferred:

1. **Unit tests** for the matching engine (`matchingService.js`: `scoreTiming`, `scoreUtilization`, `utilizationRatio`, `distanceKmAndScore`, the right-sizing classification logic) and the approval workflow (`matchWorkflowService.js`: dual-approval state transitions, timeout → auto-rematch, auto-approval threshold checks). The config extraction in §5 makes this practical — scoring functions become pure and importable without a live DB.
2. **Integration tests** for API endpoints — auth, availability, shipments, matches, ratings — against a real (throwaway) Postgres, not mocked.
3. **One end-to-end test** covering the full flow: signup → carrier posts availability → shipper pulls a mock shipment → match requested → dual approval → booking → rating. This is the "MVP complete" gate the brief describes.

GitHub Actions workflow (`.github/workflows/ci.yml`), triggered on every push/PR:
1. `npm run lint` in `frontend/`
2. `node --check` across `backend/src/**/*.js` (fast syntax gate before the slower suite runs)
3. Backend unit + integration tests against a Postgres service container (GitHub Actions provides this natively)
4. The E2E test

This needs GitHub push access to actually run — see §7, being fixed now. None of this test suite exists yet; it's scoped as an implementation task alongside the org-model migration in §2, not yet written.

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
