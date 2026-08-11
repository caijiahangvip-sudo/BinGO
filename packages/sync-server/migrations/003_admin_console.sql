ALTER TABLE accounts
  ADD COLUMN IF NOT EXISTS pending_deletion_at timestamptz,
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz,
  ADD COLUMN IF NOT EXISTS must_reset_password boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS last_login_at timestamptz;

CREATE TABLE IF NOT EXISTS admin_sessions (
  token_hash text PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  csrf_token_hash text NOT NULL,
  ip_address text,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  idle_expires_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz
);

CREATE INDEX IF NOT EXISTS admin_sessions_account_idx
  ON admin_sessions (account_id, revoked_at, expires_at);

CREATE TABLE IF NOT EXISTS admin_audit_logs (
  id bigserial PRIMARY KEY,
  administrator_id uuid REFERENCES accounts(id) ON DELETE SET NULL,
  action text NOT NULL,
  target_type text,
  target_id text,
  details jsonb,
  ip_address text,
  succeeded boolean NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS admin_audit_logs_created_idx
  ON admin_audit_logs (created_at DESC);

CREATE TABLE IF NOT EXISTS password_reset_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  created_by uuid REFERENCES accounts(id) ON DELETE SET NULL,
  code_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS support_access_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  administrator_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  entity_type text NOT NULL,
  entity_id text NOT NULL,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled', 'consumed')),
  requested_at timestamptz NOT NULL DEFAULT now(),
  decided_at timestamptz,
  consumed_at timestamptz
);

CREATE INDEX IF NOT EXISTS support_access_user_status_idx
  ON support_access_requests (user_id, status, requested_at DESC);

CREATE INDEX IF NOT EXISTS support_access_admin_status_idx
  ON support_access_requests (administrator_id, status, requested_at DESC);

CREATE TABLE IF NOT EXISTS server_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_type text NOT NULL,
  status text NOT NULL CHECK (status IN ('queued', 'running', 'succeeded', 'failed')),
  requested_by uuid REFERENCES accounts(id) ON DELETE SET NULL,
  request jsonb,
  result jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  finished_at timestamptz
);

CREATE INDEX IF NOT EXISTS server_jobs_created_idx ON server_jobs (created_at DESC);
