-- FreightCopilot database schema
-- Run via: psql $DATABASE_URL -f src/db/schema.sql

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================
-- USERS (shared login table for both shipper and carrier sides)
-- ============================================================
CREATE TABLE users (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email           TEXT UNIQUE NOT NULL,
  password_hash   TEXT NOT NULL,
  role            TEXT NOT NULL CHECK (role IN ('shipper', 'carrier', 'admin')),
  full_name       TEXT NOT NULL,
  phone           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- SHIPPERS (transport planners / companies posting freight)
-- ============================================================
CREATE TABLE shippers (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  company_name      TEXT NOT NULL,
  billing_address   TEXT,
  otm_source_id     TEXT, -- reference id from (mocked) OTM TMS pull
  auto_approve_max_cost NUMERIC(10,2), -- NULL = auto-approval disabled; else auto-approve matches at/below this rate
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_shippers_user_id ON shippers(user_id);

-- ============================================================
-- CARRIERS (dispatchers / trucking companies offering capacity)
-- ============================================================
CREATE TABLE carriers (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id               UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  company_name          TEXT NOT NULL,
  fleet_size            INTEGER NOT NULL DEFAULT 1,
  base_location         TEXT NOT NULL, -- free-text city/region, e.g. "Melbourne, VIC"
  base_lat              DOUBLE PRECISION,
  base_lng              DOUBLE PRECISION,
  historical_acceptance_rate NUMERIC(5,2) NOT NULL DEFAULT 100.00, -- % of matches accepted, feeds scoring
  auto_approve_min_income NUMERIC(10,2), -- NULL = auto-approval disabled; else auto-approve matches at/above this rate
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_carriers_user_id ON carriers(user_id);

-- ============================================================
-- CARRIER AVAILABILITY (manual daily truck availability entries)
-- ============================================================
CREATE TABLE carrier_availability (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  carrier_id        UUID NOT NULL REFERENCES carriers(id) ON DELETE CASCADE,
  available_date    DATE NOT NULL,
  truck_type        TEXT NOT NULL, -- e.g. 'B-double', 'semi', 'rigid', 'refrigerated'
  truck_capacity_kg INTEGER NOT NULL,
  origin_region      TEXT NOT NULL,
  origin_lat         DOUBLE PRECISION,
  origin_lng         DOUBLE PRECISION,
  window_start       TIMESTAMPTZ NOT NULL,
  window_end         TIMESTAMPTZ NOT NULL,
  is_booked          BOOLEAN NOT NULL DEFAULT false,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (carrier_id, available_date, truck_type, origin_region, window_start)
);

CREATE INDEX idx_carrier_availability_carrier_id ON carrier_availability(carrier_id);
CREATE INDEX idx_carrier_availability_date ON carrier_availability(available_date);

-- ============================================================
-- SHIPMENTS (mocked OTM pulls + shipper-created loads)
-- ============================================================
CREATE TABLE shipments (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shipper_id          UUID NOT NULL REFERENCES shippers(id) ON DELETE CASCADE,
  otm_shipment_ref     TEXT, -- mocked OTM reference id
  origin_region        TEXT NOT NULL,
  origin_lat           DOUBLE PRECISION,
  origin_lng           DOUBLE PRECISION,
  destination_region    TEXT NOT NULL,
  destination_lat       DOUBLE PRECISION,
  destination_lng       DOUBLE PRECISION,
  weight_kg            INTEGER NOT NULL,
  truck_type_required   TEXT NOT NULL,
  pickup_window_start   TIMESTAMPTZ NOT NULL,
  pickup_window_end     TIMESTAMPTZ NOT NULL,
  quoted_rate           NUMERIC(10,2), -- AI-recommended freight rate (AUD), drives auto-approval thresholds
  rate_reasoning        TEXT, -- Claude's rationale for the recommended rate
  status                TEXT NOT NULL DEFAULT 'pending'
                          CHECK (status IN ('pending', 'matching', 'awaiting_approval', 'booked', 'cancelled', 'completed')),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_shipments_shipper_id ON shipments(shipper_id);
CREATE INDEX idx_shipments_status ON shipments(status);

-- ============================================================
-- MATCHES (compatibility score + dual approval workflow)
-- ============================================================
CREATE TABLE matches (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shipment_id               UUID NOT NULL REFERENCES shipments(id) ON DELETE CASCADE,
  carrier_id                UUID NOT NULL REFERENCES carriers(id) ON DELETE CASCADE,
  carrier_availability_id    UUID REFERENCES carrier_availability(id) ON DELETE SET NULL,

  -- scoring breakdown (0-100 each component, weighted total 1-100)
  score_total                NUMERIC(5,2) NOT NULL,
  score_distance              NUMERIC(5,2) NOT NULL, -- 30%
  score_timing                NUMERIC(5,2) NOT NULL, -- 25%
  score_utilization           NUMERIC(5,2) NOT NULL, -- 15%
  score_reliability           NUMERIC(5,2) NOT NULL, -- 20%
  score_acceptance_rate        NUMERIC(5,2) NOT NULL, -- 10%

  status                      TEXT NOT NULL DEFAULT 'pending'
                                CHECK (status IN ('pending', 'shipper_approved', 'carrier_approved', 'dual_approved', 'rejected', 'expired', 'booked')),
  shipper_approved_at          TIMESTAMPTZ,
  carrier_approved_at          TIMESTAMPTZ,
  rejected_by                  TEXT CHECK (rejected_by IN ('shipper', 'carrier')),
  approval_deadline            TIMESTAMPTZ NOT NULL, -- created_at + 20 minutes
  is_rematch_of                UUID REFERENCES matches(id) ON DELETE SET NULL, -- links to prior expired/rejected match

  created_at                   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_matches_shipment_id ON matches(shipment_id);
CREATE INDEX idx_matches_carrier_id ON matches(carrier_id);
CREATE INDEX idx_matches_status ON matches(status);
CREATE INDEX idx_matches_approval_deadline ON matches(approval_deadline);

-- ============================================================
-- RATINGS (Uber-style, bidirectional)
-- ============================================================
CREATE TABLE ratings (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id           UUID NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  rater_role         TEXT NOT NULL CHECK (rater_role IN ('shipper', 'carrier')), -- who is giving the rating
  rated_shipper_id    UUID REFERENCES shippers(id) ON DELETE CASCADE,
  rated_carrier_id    UUID REFERENCES carriers(id) ON DELETE CASCADE,

  star_rating         SMALLINT NOT NULL CHECK (star_rating BETWEEN 1 AND 5),

  -- carrier-rated-by-shipper metrics
  on_time              BOOLEAN,
  completed            BOOLEAN,
  had_damage_or_complaint BOOLEAN,

  -- shipper-rated-by-carrier metrics
  response_time_minutes INTEGER,
  was_cancelled          BOOLEAN,

  comment              TEXT,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),

  CHECK (
    (rater_role = 'carrier' AND rated_shipper_id IS NOT NULL AND rated_carrier_id IS NULL) OR
    (rater_role = 'shipper' AND rated_carrier_id IS NOT NULL AND rated_shipper_id IS NULL)
  )
);

CREATE INDEX idx_ratings_match_id ON ratings(match_id);
CREATE INDEX idx_ratings_rated_shipper_id ON ratings(rated_shipper_id);
CREATE INDEX idx_ratings_rated_carrier_id ON ratings(rated_carrier_id);
