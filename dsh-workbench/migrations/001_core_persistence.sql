-- DSH Workbench authoritative metadata schema.
-- Binary payloads (CSV, HTML, images, reports) belong in object storage. This
-- database keeps only immutable object references, integrity hashes and state.

CREATE TABLE IF NOT EXISTS workspaces (
  id uuid PRIMARY KEY,
  slug text NOT NULL UNIQUE,
  name text NOT NULL,
  created_by_user_id text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT workspaces_slug_format CHECK (slug ~ '^[a-z][a-z0-9-]{1,62}$')
);

CREATE TABLE IF NOT EXISTS workspace_members (
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id text NOT NULL,
  role text NOT NULL,
  joined_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, user_id),
  CONSTRAINT workspace_member_role CHECK (role IN ('owner', 'admin', 'editor', 'viewer'))
);

CREATE TABLE IF NOT EXISTS analysis_sessions (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  created_by_user_id text NOT NULL,
  title text NOT NULL,
  status text NOT NULL DEFAULT 'active',
  source_mode text NOT NULL DEFAULT 'unknown',
  context_summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  closed_at timestamptz,
  CONSTRAINT analysis_session_status CHECK (status IN ('active', 'completed', 'cancelled', 'failed', 'archived')),
  CONSTRAINT analysis_session_source_mode CHECK (source_mode IN ('file', 'omd', 'library', 'feishu', 'mixed', 'unknown'))
);

CREATE TABLE IF NOT EXISTS conversation_messages (
  id uuid PRIMARY KEY,
  session_id uuid NOT NULL REFERENCES analysis_sessions(id) ON DELETE CASCADE,
  sequence_number integer NOT NULL,
  role text NOT NULL,
  content jsonb NOT NULL,
  visible_to_user boolean NOT NULL DEFAULT true,
  tool_name text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT conversation_message_role CHECK (role IN ('user', 'assistant', 'system', 'tool')),
  CONSTRAINT conversation_message_sequence UNIQUE (session_id, sequence_number)
);

CREATE TABLE IF NOT EXISTS agent_runs (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  session_id uuid REFERENCES analysis_sessions(id) ON DELETE SET NULL,
  requested_by_user_id text NOT NULL,
  workflow_version text NOT NULL,
  state text NOT NULL,
  status text NOT NULL DEFAULT 'queued',
  input_summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  result_summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  trace_id text,
  idempotency_key text,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT agent_run_state CHECK (state IN ('data_profile', 'omd_readiness', 'semantic_search', 'entity_details', 'semantic_validate', 'plan', 'await_confirmation', 'spec', 'governance', 'draft', 'completed', 'failed', 'cancelled')),
  CONSTRAINT agent_run_status CHECK (status IN ('queued', 'running', 'completed', 'failed', 'cancelled')),
  CONSTRAINT agent_run_idempotency UNIQUE (workspace_id, idempotency_key)
);

CREATE TABLE IF NOT EXISTS run_steps (
  id uuid PRIMARY KEY,
  run_id uuid NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
  position integer NOT NULL,
  step_key text NOT NULL,
  status text NOT NULL,
  attempt integer NOT NULL DEFAULT 1,
  input_summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  output_summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  error_code text,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT run_step_status CHECK (status IN ('queued', 'running', 'completed', 'failed', 'skipped')),
  CONSTRAINT run_step_position UNIQUE (run_id, position)
);

CREATE TABLE IF NOT EXISTS semantic_contexts (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  session_id uuid REFERENCES analysis_sessions(id) ON DELETE SET NULL,
  run_id uuid UNIQUE REFERENCES agent_runs(id) ON DELETE SET NULL,
  status text NOT NULL,
  provider text NOT NULL DEFAULT 'openmetadata',
  query_text text NOT NULL,
  adopted_assets jsonb NOT NULL DEFAULT '[]'::jsonb,
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  unresolved_items jsonb NOT NULL DEFAULT '[]'::jsonb,
  validated_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT semantic_context_status CHECK (status IN ('verified', 'incomplete', 'unavailable', 'rejected'))
);

CREATE TABLE IF NOT EXISTS dashboard_plans (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  session_id uuid REFERENCES analysis_sessions(id) ON DELETE SET NULL,
  run_id uuid REFERENCES agent_runs(id) ON DELETE SET NULL,
  semantic_context_id uuid REFERENCES semantic_contexts(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'proposed',
  content jsonb NOT NULL,
  created_by_user_id text NOT NULL,
  confirmed_by_user_id text,
  confirmed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT dashboard_plan_status CHECK (status IN ('proposed', 'confirmed', 'superseded', 'rejected'))
);

CREATE TABLE IF NOT EXISTS dashboard_specs (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  plan_id uuid NOT NULL UNIQUE REFERENCES dashboard_plans(id) ON DELETE RESTRICT,
  dashboard_id uuid NOT NULL,
  version integer NOT NULL DEFAULT 1,
  content jsonb NOT NULL,
  semantic_context_id uuid REFERENCES semantic_contexts(id) ON DELETE SET NULL,
  visual_contract jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by_user_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT dashboard_spec_version CHECK (version > 0),
  CONSTRAINT dashboard_spec_dashboard_version UNIQUE (dashboard_id, version)
);

CREATE TABLE IF NOT EXISTS dashboard_revisions (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  dashboard_id uuid NOT NULL,
  spec_id uuid REFERENCES dashboard_specs(id) ON DELETE SET NULL,
  revision_number integer NOT NULL,
  stage text NOT NULL,
  asset_key text NOT NULL,
  manifest jsonb NOT NULL,
  quality_report jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by_user_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  released_at timestamptz,
  CONSTRAINT dashboard_revision_stage CHECK (stage IN ('draft', 'preview', 'released', 'superseded', 'archived')),
  CONSTRAINT dashboard_revision_number CHECK (revision_number > 0),
  CONSTRAINT dashboard_revision_dashboard_number UNIQUE (dashboard_id, revision_number)
);

CREATE TABLE IF NOT EXISTS artifacts (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  owner_type text NOT NULL,
  owner_id uuid NOT NULL,
  object_uri text NOT NULL,
  sha256 char(64) NOT NULL,
  byte_size bigint NOT NULL,
  media_type text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT artifact_owner_type CHECK (owner_type IN ('upload', 'dashboard_revision', 'semantic_context', 'run_step')),
  CONSTRAINT artifact_size_nonnegative CHECK (byte_size >= 0),
  CONSTRAINT artifact_sha256_hex CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  CONSTRAINT artifact_workspace_hash UNIQUE (workspace_id, sha256, object_uri)
);

CREATE TABLE IF NOT EXISTS dashboard_revision_artifacts (
  dashboard_revision_id uuid NOT NULL REFERENCES dashboard_revisions(id) ON DELETE CASCADE,
  artifact_id uuid NOT NULL REFERENCES artifacts(id) ON DELETE RESTRICT,
  role text NOT NULL,
  PRIMARY KEY (dashboard_revision_id, artifact_id),
  CONSTRAINT dashboard_revision_artifact_role CHECK (role IN ('dashboard_html', 'manifest', 'model', 'quality_report', 'thumbnail', 'source_snapshot'))
);

CREATE TABLE IF NOT EXISTS approvals (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  resource_type text NOT NULL,
  resource_id uuid NOT NULL,
  action text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  requested_by_user_id text NOT NULL,
  decided_by_user_id text,
  request_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  decision_note text,
  expires_at timestamptz,
  decided_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT approval_status CHECK (status IN ('pending', 'approved', 'rejected', 'expired', 'cancelled'))
);

CREATE TABLE IF NOT EXISTS audit_events (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  actor_user_id text NOT NULL,
  action text NOT NULL,
  resource_type text NOT NULL,
  resource_id uuid,
  request_id text,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS uploads (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  session_id uuid REFERENCES analysis_sessions(id) ON DELETE SET NULL,
  uploaded_by_user_id text NOT NULL,
  source text NOT NULL,
  original_file_name text NOT NULL,
  object_uri text NOT NULL,
  sha256 char(64) NOT NULL,
  byte_size bigint NOT NULL,
  media_type text NOT NULL,
  status text NOT NULL DEFAULT 'available',
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT upload_source CHECK (source IN ('local_file', 'library', 'feishu', 'omd', 'data_mcp', 'external')),
  CONSTRAINT upload_status CHECK (status IN ('pending', 'available', 'rejected', 'expired', 'deleted')),
  CONSTRAINT upload_size_nonnegative CHECK (byte_size >= 0),
  CONSTRAINT upload_sha256_hex CHECK (sha256 ~ '^[0-9a-f]{64}$')
);

CREATE INDEX IF NOT EXISTS analysis_sessions_workspace_updated_idx ON analysis_sessions (workspace_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS conversation_messages_session_sequence_idx ON conversation_messages (session_id, sequence_number);
CREATE INDEX IF NOT EXISTS agent_runs_workspace_created_idx ON agent_runs (workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS agent_runs_session_created_idx ON agent_runs (session_id, created_at DESC);
CREATE INDEX IF NOT EXISTS run_steps_run_position_idx ON run_steps (run_id, position);
CREATE INDEX IF NOT EXISTS semantic_contexts_workspace_created_idx ON semantic_contexts (workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS dashboard_plans_workspace_created_idx ON dashboard_plans (workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS dashboard_revisions_workspace_dashboard_idx ON dashboard_revisions (workspace_id, dashboard_id, revision_number DESC);
CREATE UNIQUE INDEX IF NOT EXISTS dashboard_revisions_one_released_idx ON dashboard_revisions (dashboard_id) WHERE stage = 'released';
CREATE INDEX IF NOT EXISTS artifacts_workspace_owner_idx ON artifacts (workspace_id, owner_type, owner_id);
CREATE INDEX IF NOT EXISTS approvals_workspace_status_idx ON approvals (workspace_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS audit_events_workspace_occurred_idx ON audit_events (workspace_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS uploads_workspace_created_idx ON uploads (workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS uploads_expiry_idx ON uploads (expires_at) WHERE status = 'available' AND expires_at IS NOT NULL;
