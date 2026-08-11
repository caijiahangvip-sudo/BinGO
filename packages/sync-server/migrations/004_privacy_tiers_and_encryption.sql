ALTER TABLE accounts
  ADD COLUMN IF NOT EXISTS privacy_tier text NOT NULL DEFAULT 'B',
  ADD COLUMN IF NOT EXISTS admin_alias text;

UPDATE accounts
SET privacy_tier = CASE WHEN role = 'admin' THEN 'A' ELSE COALESCE(privacy_tier, 'B') END
WHERE privacy_tier IS NULL OR (role = 'admin' AND privacy_tier <> 'A');

UPDATE accounts
SET admin_alias = upper(substr(replace(id::text, '-', ''), 1, 10))
WHERE admin_alias IS NULL;

ALTER TABLE accounts
  DROP CONSTRAINT IF EXISTS accounts_privacy_tier_check;
ALTER TABLE accounts
  ADD CONSTRAINT accounts_privacy_tier_check CHECK (privacy_tier IN ('A', 'B', 'C'));
CREATE UNIQUE INDEX IF NOT EXISTS accounts_admin_alias_unique_idx ON accounts (admin_alias);

CREATE TABLE IF NOT EXISTS tiered_invites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  code_hash text NOT NULL UNIQUE,
  code_hint text NOT NULL,
  tier text NOT NULL CHECK (tier IN ('A', 'B', 'C')),
  name text NOT NULL,
  max_uses integer,
  used_count integer NOT NULL DEFAULT 0,
  expires_at timestamptz,
  enabled boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES accounts(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  disabled_at timestamptz
);
CREATE INDEX IF NOT EXISTS tiered_invites_org_idx ON tiered_invites (organization_id, enabled, created_at DESC);

ALTER TABLE support_access_requests
  ADD COLUMN IF NOT EXISTS scope text NOT NULL DEFAULT 'record',
  ADD COLUMN IF NOT EXISTS grant_type text NOT NULL DEFAULT 'once',
  ADD COLUMN IF NOT EXISTS expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS revoked_at timestamptz,
  ADD COLUMN IF NOT EXISTS read_count integer NOT NULL DEFAULT 0;
ALTER TABLE support_access_requests
  DROP CONSTRAINT IF EXISTS support_access_scope_check;
ALTER TABLE support_access_requests
  ADD CONSTRAINT support_access_scope_check CHECK (scope IN ('record', 'category', 'all'));
ALTER TABLE support_access_requests
  DROP CONSTRAINT IF EXISTS support_access_grant_type_check;
ALTER TABLE support_access_requests
  ADD CONSTRAINT support_access_grant_type_check CHECK (grant_type IN ('once', 'day', 'week', 'persistent'));

ALTER TABLE sync_records
  ADD COLUMN IF NOT EXISTS data_category text NOT NULL DEFAULT 'private',
  ADD COLUMN IF NOT EXISTS encrypted_payload text,
  ADD COLUMN IF NOT EXISTS encryption_iv text,
  ADD COLUMN IF NOT EXISTS encryption_tag text,
  ADD COLUMN IF NOT EXISTS encryption_key_version integer NOT NULL DEFAULT 1;
ALTER TABLE sync_records
  DROP CONSTRAINT IF EXISTS sync_records_data_category_check;
ALTER TABLE sync_records
  ADD CONSTRAINT sync_records_data_category_check CHECK (data_category IN ('classroom-definition', 'classroom-memory', 'classroom-activity', 'homework', 'document', 'whiteboard', 'settings', 'profile', 'private', 'organization'));

CREATE TABLE IF NOT EXISTS privacy_tier_change_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  requested_by uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  from_tier text NOT NULL CHECK (from_tier IN ('A', 'B', 'C')),
  to_tier text NOT NULL CHECK (to_tier IN ('A', 'B', 'C')),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled')),
  requested_at timestamptz NOT NULL DEFAULT now(),
  decided_at timestamptz
);
CREATE INDEX IF NOT EXISTS privacy_tier_requests_user_idx ON privacy_tier_change_requests (user_id, status, requested_at DESC);
