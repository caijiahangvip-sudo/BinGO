ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS invite_code_hash text,
  ADD COLUMN IF NOT EXISTS invite_code_updated_at timestamptz,
  ADD COLUMN IF NOT EXISTS invite_code_enabled boolean NOT NULL DEFAULT true;

ALTER TABLE accounts
  ALTER COLUMN email DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS username text;

CREATE UNIQUE INDEX IF NOT EXISTS accounts_username_unique_idx
  ON accounts (lower(username))
  WHERE username IS NOT NULL;

CREATE TABLE IF NOT EXISTS device_sessions (
  id uuid PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  refresh_token_hash text NOT NULL UNIQUE,
  device_name text NOT NULL,
  platform text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  refresh_expires_at timestamptz NOT NULL,
  revoked_at timestamptz
);

CREATE INDEX IF NOT EXISTS device_sessions_account_idx
  ON device_sessions (account_id, revoked_at, last_seen_at DESC);

ALTER TABLE sync_records
  ADD COLUMN IF NOT EXISTS owner_account_id uuid,
  ADD COLUMN IF NOT EXISTS visibility text NOT NULL DEFAULT 'private';

UPDATE sync_records
SET owner_account_id = updated_by
WHERE owner_account_id IS NULL AND updated_by IS NOT NULL;

UPDATE sync_records record
SET owner_account_id = (
  SELECT id
  FROM accounts
  WHERE accounts.organization_id = record.organization_id
  ORDER BY CASE WHEN role = 'admin' THEN 0 ELSE 1 END, created_at
  LIMIT 1
)
WHERE record.owner_account_id IS NULL;

UPDATE sync_records
SET visibility = 'organization'
WHERE owner_account_id IS NOT NULL;

ALTER TABLE sync_records
  ALTER COLUMN owner_account_id SET NOT NULL,
  ADD CONSTRAINT sync_records_visibility_check CHECK (visibility IN ('private', 'organization'));

ALTER TABLE sync_records
  DROP CONSTRAINT IF EXISTS sync_records_pkey;

ALTER TABLE sync_records
  ADD PRIMARY KEY (organization_id, owner_account_id, entity_type, entity_id);

ALTER TABLE sync_records
  ADD CONSTRAINT sync_records_owner_fk
  FOREIGN KEY (owner_account_id) REFERENCES accounts(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS sync_records_owner_changes_idx
  ON sync_records (organization_id, owner_account_id, change_sequence);
