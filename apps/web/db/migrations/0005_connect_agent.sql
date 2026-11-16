-- Palisec 2.0: PALISEC Connect (integrations, scopes, webhooks) and the native PALISEC Agent.
-- Additive only. Existing agents and keys keep working: keys created before this migration receive
-- every scope that existed implicitly (operations, reads, MCP).

-- ------------------------------------------------------------ integrations = registered agents
ALTER TABLE agents ADD COLUMN framework text CHECK (framework IS NULL OR length(framework) BETWEEN 1 AND 40);
ALTER TABLE agents ADD COLUMN description text CHECK (description IS NULL OR length(description) <= 280);

ALTER TABLE api_credentials ADD COLUMN scopes text[] NOT NULL
  DEFAULT ARRAY['operations:write', 'operations:read', 'policy:read', 'audit:read', 'mcp']
  CHECK (scopes <@ ARRAY['operations:write', 'operations:read', 'policy:read', 'audit:read', 'mcp']::text[] AND cardinality(scopes) >= 1);
ALTER TABLE api_credentials ADD COLUMN rotated_from uuid REFERENCES api_credentials (id);

-- ------------------------------------------------------------ webhooks
CREATE TABLE webhooks (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  -- https is enforced by the application (a local test receiver may use http; never on Vercel).
  url             text NOT NULL CHECK (url ~ '^https?://' AND length(url) <= 500),
  description     text CHECK (description IS NULL OR length(description) <= 120),
  events          text[] NOT NULL CHECK (cardinality(events) >= 1),
  -- AES-256-GCM ciphertext of the signing secret (key: PALISEC_SECRETS_KEY). Needed to sign, so not hashed.
  secret_enc      bytea NOT NULL,
  secret_prefix   text NOT NULL,
  status          text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  created_by      uuid REFERENCES users (id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  last_delivery_at timestamptz,
  consecutive_failures integer NOT NULL DEFAULT 0
);
CREATE INDEX webhooks_org ON webhooks (org_id);

CREATE TABLE webhook_deliveries (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  webhook_id      uuid NOT NULL REFERENCES webhooks (id) ON DELETE CASCADE,
  org_id          uuid NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  -- The event's stable ID: receivers deduplicate on it, and one event is delivered once per webhook.
  event_id        uuid NOT NULL,
  event_type      text NOT NULL CHECK (length(event_type) <= 64),
  payload         jsonb NOT NULL,
  status          text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'delivered', 'failed')),
  attempts        integer NOT NULL DEFAULT 0,
  last_status     integer,
  last_error      text CHECK (last_error IS NULL OR length(last_error) <= 300),
  created_at      timestamptz NOT NULL DEFAULT now(),
  delivered_at    timestamptz,
  UNIQUE (webhook_id, event_id)
);
CREATE INDEX webhook_deliveries_webhook ON webhook_deliveries (webhook_id, created_at DESC);

-- ------------------------------------------------------------ security findings (alerts)
CREATE TABLE security_findings (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  category        text NOT NULL CHECK (category IN (
    'unusual_proposal', 'repeated_denial', 'spending_threshold', 'unfamiliar_recipient', 'unapproved_contract',
    'unexpected_selector', 'failed_approval', 'replay_attempt', 'invalid_signature', 'signing_failure',
    'attestation_mismatch', 'integration_credential_failure', 'emergency_stop', 'account_pause')),
  severity        text NOT NULL CHECK (severity IN ('info', 'warning', 'critical')),
  title           text NOT NULL CHECK (length(title) <= 160),
  -- Evidence: record references (operation, agent, audit event IDs) and the numbers that triggered it.
  evidence        jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- One open finding per condition: repeated detections update it instead of duplicating it.
  fingerprint     text NOT NULL CHECK (length(fingerprint) <= 200),
  source          text NOT NULL CHECK (source IN ('detector', 'agent', 'operator')),
  agent_run_id    uuid,
  status          text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'acknowledged', 'resolved')),
  occurrences     integer NOT NULL DEFAULT 1,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  decided_by      uuid REFERENCES users (id)
);
CREATE UNIQUE INDEX security_findings_open ON security_findings (org_id, fingerprint) WHERE status <> 'resolved';
CREATE INDEX security_findings_org ON security_findings (org_id, updated_at DESC);

-- ------------------------------------------------------------ native agent
CREATE TABLE agent_configurations (
  org_id          uuid PRIMARY KEY REFERENCES organizations (id) ON DELETE CASCADE,
  enabled         boolean NOT NULL DEFAULT true,
  -- 0 observe, 1 assist (drafts, simulations), 2 confirmed actions. Level 3 is not offered.
  autonomy_level  integer NOT NULL DEFAULT 1 CHECK (autonomy_level BETWEEN 0 AND 2),
  disabled_tools  text[] NOT NULL DEFAULT '{}',
  updated_by      uuid REFERENCES users (id),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE agent_runs (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  user_id         uuid NOT NULL REFERENCES users (id),
  title           text NOT NULL CHECK (length(title) <= 120),
  status          text NOT NULL CHECK (status IN ('ready', 'running', 'completed', 'failed', 'cancelled')),
  provider        text NOT NULL,
  model           text NOT NULL,
  instructions_version text NOT NULL,
  -- Conversation: user, assistant and tool messages. Tool outputs are already minimized and redacted.
  messages        jsonb NOT NULL DEFAULT '[]'::jsonb,
  steps           integer NOT NULL DEFAULT 0,
  error           text CHECK (error IS NULL OR length(error) <= 300),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX agent_runs_org ON agent_runs (org_id, updated_at DESC);

CREATE TABLE agent_tool_calls (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id          uuid NOT NULL REFERENCES agent_runs (id) ON DELETE CASCADE,
  org_id          uuid NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  user_id         uuid NOT NULL REFERENCES users (id),
  tool            text NOT NULL CHECK (length(tool) <= 64),
  risk            text NOT NULL CHECK (risk IN ('read', 'draft', 'action')),
  input           jsonb NOT NULL,
  output          jsonb,
  -- Record references the answer can cite: operation, policy, agent, audit and finding IDs.
  evidence        jsonb NOT NULL DEFAULT '[]'::jsonb,
  status          text NOT NULL CHECK (status IN ('ok', 'error', 'refused')),
  error           text CHECK (error IS NULL OR length(error) <= 300),
  duration_ms     integer NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX agent_tool_calls_run ON agent_tool_calls (run_id, created_at);

-- Actions the agent prepared that a member must confirm. Executed as that member, through the
-- existing control-plane functions and their role checks; never by the agent.
CREATE TABLE agent_action_requests (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  run_id          uuid NOT NULL REFERENCES agent_runs (id) ON DELETE CASCADE,
  tool_call_id    uuid REFERENCES agent_tool_calls (id),
  action          text NOT NULL CHECK (action IN ('emergency_stop', 'agent_pause', 'policy_draft')),
  params          jsonb NOT NULL,
  impact          text NOT NULL CHECK (length(impact) <= 600),
  status          text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'confirmed', 'rejected', 'expired', 'failed')),
  result          jsonb,
  requested_at    timestamptz NOT NULL DEFAULT now(),
  expires_at      timestamptz NOT NULL DEFAULT now() + interval '30 minutes',
  decided_by      uuid REFERENCES users (id),
  decided_at      timestamptz
);
CREATE INDEX agent_action_requests_run ON agent_action_requests (run_id);
