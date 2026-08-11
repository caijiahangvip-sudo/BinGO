CREATE TABLE IF NOT EXISTS learning_classes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text NOT NULL DEFAULT '',
  enabled boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES accounts(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS learning_classes_org_idx ON learning_classes (organization_id, enabled, created_at DESC);

CREATE TABLE IF NOT EXISTS class_invites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  class_id uuid NOT NULL REFERENCES learning_classes(id) ON DELETE CASCADE,
  code_hash text NOT NULL UNIQUE,
  code_hint text NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  max_uses integer,
  used_count integer NOT NULL DEFAULT 0,
  expires_at timestamptz,
  created_by uuid REFERENCES accounts(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  disabled_at timestamptz
);
CREATE INDEX IF NOT EXISTS class_invites_class_idx ON class_invites (class_id, enabled, created_at DESC);

CREATE TABLE IF NOT EXISTS class_memberships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  class_id uuid NOT NULL REFERENCES learning_classes(id) ON DELETE CASCADE,
  student_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  joined_at timestamptz NOT NULL DEFAULT now(),
  left_at timestamptz,
  UNIQUE (class_id, student_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS class_memberships_one_primary_idx ON class_memberships (student_id) WHERE left_at IS NULL;

CREATE TABLE IF NOT EXISTS teacher_invites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  class_id uuid REFERENCES learning_classes(id) ON DELETE SET NULL,
  code_hash text NOT NULL UNIQUE,
  code_hint text NOT NULL,
  name text NOT NULL,
  assignment_role text NOT NULL CHECK (assignment_role IN ('vesta', 'minerva', 'apollo')),
  subject_name text NOT NULL DEFAULT '',
  enabled boolean NOT NULL DEFAULT true,
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '7 days'),
  used_by uuid REFERENCES accounts(id) ON DELETE SET NULL,
  used_at timestamptz,
  created_by uuid REFERENCES accounts(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS teacher_invites_org_idx ON teacher_invites (organization_id, enabled, created_at DESC);

CREATE TABLE IF NOT EXISTS teacher_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  class_id uuid NOT NULL REFERENCES learning_classes(id) ON DELETE CASCADE,
  teacher_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  assignment_role text NOT NULL CHECK (assignment_role IN ('vesta', 'minerva', 'apollo')),
  subject_name text NOT NULL DEFAULT '',
  active boolean NOT NULL DEFAULT true,
  assigned_by uuid REFERENCES accounts(id) ON DELETE SET NULL,
  assigned_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (class_id, teacher_id, assignment_role, subject_name)
);
CREATE INDEX IF NOT EXISTS teacher_assignments_teacher_idx ON teacher_assignments (teacher_id, active, assigned_at DESC);

CREATE TABLE IF NOT EXISTS teacher_assignment_proposals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  class_id uuid NOT NULL REFERENCES learning_classes(id) ON DELETE CASCADE,
  proposed_by uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  teacher_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  assignment_role text NOT NULL CHECK (assignment_role IN ('minerva', 'apollo')),
  subject_name text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled')),
  decided_by uuid REFERENCES accounts(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  decided_at timestamptz
);

CREATE TABLE IF NOT EXISTS study_groups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text NOT NULL DEFAULT '',
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS study_group_invites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id uuid NOT NULL REFERENCES study_groups(id) ON DELETE CASCADE,
  code_hash text NOT NULL UNIQUE,
  code_hint text NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  expires_at timestamptz,
  max_uses integer,
  used_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS study_group_members (
  group_id uuid NOT NULL REFERENCES study_groups(id) ON DELETE CASCADE,
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  member_role text NOT NULL DEFAULT 'member' CHECK (member_role IN ('owner', 'moderator', 'member')),
  joined_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (group_id, account_id)
);
CREATE INDEX IF NOT EXISTS study_group_members_account_idx ON study_group_members (account_id, joined_at DESC);

CREATE TABLE IF NOT EXISTS learning_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  author_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  class_id uuid REFERENCES learning_classes(id) ON DELETE CASCADE,
  group_id uuid REFERENCES study_groups(id) ON DELETE CASCADE,
  title text NOT NULL,
  description text NOT NULL DEFAULT '',
  resources jsonb NOT NULL DEFAULT '[]'::jsonb,
  rubric jsonb NOT NULL DEFAULT '[]'::jsonb,
  task_kind text NOT NULL CHECK (task_kind IN ('goal', 'practice', 'assessment')),
  requirement text NOT NULL CHECK (requirement IN ('required', 'optional')),
  subject_name text NOT NULL DEFAULT '',
  due_at timestamptz,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'closed', 'archived')),
  published_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((class_id IS NOT NULL)::int + (group_id IS NOT NULL)::int = 1)
);
CREATE INDEX IF NOT EXISTS learning_tasks_class_idx ON learning_tasks (class_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS learning_tasks_group_idx ON learning_tasks (group_id, status, created_at DESC);

CREATE TABLE IF NOT EXISTS task_submissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id uuid NOT NULL REFERENCES learning_tasks(id) ON DELETE CASCADE,
  student_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  summary text NOT NULL DEFAULT '',
  evidence jsonb NOT NULL DEFAULT '[]'::jsonb,
  status text NOT NULL DEFAULT 'submitted' CHECK (status IN ('draft', 'submitted', 'returned', 'graded')),
  ai_suggestion jsonb,
  teacher_grade jsonb,
  submitted_at timestamptz NOT NULL DEFAULT now(),
  graded_at timestamptz,
  graded_by uuid REFERENCES accounts(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (task_id, student_id)
);
CREATE INDEX IF NOT EXISTS task_submissions_student_idx ON task_submissions (student_id, submitted_at DESC);

CREATE TABLE IF NOT EXISTS direct_conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  participant_low uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  participant_high uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (participant_low::text < participant_high::text),
  UNIQUE (participant_low, participant_high)
);

CREATE TABLE IF NOT EXISTS encrypted_objects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  mime_type text NOT NULL,
  file_name text NOT NULL,
  size_bytes bigint NOT NULL,
  encrypted_payload text,
  storage_path text,
  encryption_iv text NOT NULL,
  encryption_tag text NOT NULL,
  encryption_key_version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (encrypted_payload IS NOT NULL OR storage_path IS NOT NULL)
);

CREATE TABLE IF NOT EXISTS encrypted_object_grants (
  object_id uuid NOT NULL REFERENCES encrypted_objects(id) ON DELETE CASCADE,
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  granted_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (object_id, account_id)
);

CREATE TABLE IF NOT EXISTS direct_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES direct_conversations(id) ON DELETE CASCADE,
  sender_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  encrypted_payload text NOT NULL,
  encryption_iv text NOT NULL,
  encryption_tag text NOT NULL,
  encryption_key_version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);
CREATE INDEX IF NOT EXISTS direct_messages_conversation_idx ON direct_messages (conversation_id, created_at DESC);

CREATE TABLE IF NOT EXISTS group_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id uuid NOT NULL REFERENCES study_groups(id) ON DELETE CASCADE,
  sender_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  encrypted_payload text NOT NULL,
  encryption_iv text NOT NULL,
  encryption_tag text NOT NULL,
  encryption_key_version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);
CREATE INDEX IF NOT EXISTS group_messages_group_idx ON group_messages (group_id, created_at DESC);

CREATE TABLE IF NOT EXISTS notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  notification_type text NOT NULL,
  title text NOT NULL,
  body text NOT NULL DEFAULT '',
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  read_at timestamptz
);
CREATE INDEX IF NOT EXISTS notifications_account_idx ON notifications (account_id, read_at, created_at DESC);
