CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS organizations (
  id uuid PRIMARY KEY,
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS accounts (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  email text NOT NULL UNIQUE,
  display_name text NOT NULL,
  role text NOT NULL CHECK (role IN ('admin', 'teacher', 'student')),
  password_hash text NOT NULL,
  disabled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash text NOT NULL UNIQUE,
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('teacher', 'student')),
  created_by uuid NOT NULL REFERENCES accounts(id),
  expires_at timestamptz NOT NULL,
  accepted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE SEQUENCE IF NOT EXISTS sync_change_sequence;

CREATE TABLE IF NOT EXISTS sync_records (
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  entity_type text NOT NULL,
  entity_id text NOT NULL,
  payload jsonb,
  version bigint NOT NULL DEFAULT 1,
  change_sequence bigint NOT NULL DEFAULT nextval('sync_change_sequence'),
  updated_by uuid REFERENCES accounts(id),
  deleted_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, entity_type, entity_id)
);

CREATE INDEX IF NOT EXISTS sync_records_changes_idx
  ON sync_records (organization_id, change_sequence);

CREATE TABLE IF NOT EXISTS collaboration_documents (
  document_name text PRIMARY KEY,
  state bytea NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS media_objects (
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  content_hash text NOT NULL,
  object_key text NOT NULL,
  media_type text NOT NULL,
  size_bytes bigint NOT NULL,
  created_by uuid REFERENCES accounts(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, content_hash)
);
