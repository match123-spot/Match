-- Multi-tenant org model: shipper/carrier companies become first-class,
-- multi-user entities instead of an implicit 1 login = 1 company.
--
-- Existing shippers/carriers are backfilled into approved organizations
-- (they're pre-existing demo/test data, not real signups awaiting vetting)
-- so nothing already working breaks. New signups from here on land
-- 'pending' until an admin approves them.

CREATE TABLE organizations (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type          TEXT NOT NULL CHECK (type IN ('shipper', 'carrier')),
  company_name  TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'suspended')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_organizations_status ON organizations(status);

ALTER TABLE shippers ADD COLUMN org_id UUID;
ALTER TABLE carriers ADD COLUMN org_id UUID;

-- Backfill: one org per existing shipper/carrier row, pre-approved.
DO $$
DECLARE
  r RECORD;
  new_org_id UUID;
BEGIN
  FOR r IN SELECT * FROM shippers LOOP
    INSERT INTO organizations (type, company_name, status)
    VALUES ('shipper', r.company_name, 'approved')
    RETURNING id INTO new_org_id;
    UPDATE shippers SET org_id = new_org_id WHERE id = r.id;
  END LOOP;

  FOR r IN SELECT * FROM carriers LOOP
    INSERT INTO organizations (type, company_name, status)
    VALUES ('carrier', r.company_name, 'approved')
    RETURNING id INTO new_org_id;
    UPDATE carriers SET org_id = new_org_id WHERE id = r.id;
  END LOOP;
END $$;

ALTER TABLE shippers ALTER COLUMN org_id SET NOT NULL;
ALTER TABLE carriers ALTER COLUMN org_id SET NOT NULL;
ALTER TABLE shippers ADD CONSTRAINT shippers_org_id_fkey FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE;
ALTER TABLE carriers ADD CONSTRAINT carriers_org_id_fkey FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE;
CREATE UNIQUE INDEX idx_shippers_org_id ON shippers(org_id);
CREATE UNIQUE INDEX idx_carriers_org_id ON carriers(org_id);

-- users.org_id: any user belonging to an org can act for it (multi-user).
ALTER TABLE users ADD COLUMN org_id UUID REFERENCES organizations(id) ON DELETE CASCADE;
UPDATE users u SET org_id = s.org_id FROM shippers s WHERE s.user_id = u.id;
UPDATE users u SET org_id = c.org_id FROM carriers c WHERE c.user_id = u.id;
CREATE INDEX idx_users_org_id ON users(org_id);

-- company_name now lives on organizations; user_id on shippers/carriers is
-- superseded by org_id (an org, not a single user, owns these profiles).
ALTER TABLE shippers DROP COLUMN company_name;
ALTER TABLE carriers DROP COLUMN company_name;
DROP INDEX idx_shippers_user_id;
DROP INDEX idx_carriers_user_id;
ALTER TABLE shippers DROP COLUMN user_id;
ALTER TABLE carriers DROP COLUMN user_id;

-- Lightweight audit trail: which specific user approved on behalf of their
-- org (useful once a company has more than one dispatcher/planner).
ALTER TABLE matches ADD COLUMN shipper_approved_by UUID REFERENCES users(id);
ALTER TABLE matches ADD COLUMN carrier_approved_by UUID REFERENCES users(id);
