-- Part 3: agents, API credentials, policies with immutable versions, and an organization stop switch.
-- Every multi-row change is one SQL statement (Neon's HTTPS driver has no interactive transactions).

-- Disables new authorizations for the whole organization (spec §11.8).
ALTER TABLE organizations ADD COLUMN emergency_stop boolean NOT NULL DEFAULT false;

-- One row per policy. The draft is editable; activation copies it into an immutable version.
CREATE TABLE policies (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id            uuid NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  -- The document's own policy_id, e.g. "policy_trading_001".
  policy_key        text NOT NULL CHECK (policy_key ~ '^[a-z0-9_]{3,64}$'),
  name              text NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
  draft             jsonb,
  draft_updated_at  timestamptz,
  draft_updated_by  uuid REFERENCES users (id),
  active_version    integer,
  disabled_at       timestamptz,
  created_by        uuid REFERENCES users (id),
  created_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, policy_key)
);
CREATE INDEX policies_org ON policies (org_id, created_at);

-- Activated versions never change. Evaluations name the version they used.
CREATE TABLE policy_versions (
  policy_id     uuid NOT NULL REFERENCES policies (id) ON DELETE CASCADE,
  version       integer NOT NULL CHECK (version >= 1),
  document      jsonb NOT NULL,
  -- SHA-256 of the canonical document, so an activation can be bound to what the user reviewed.
  document_hash text NOT NULL CHECK (document_hash ~ '^[0-9a-f]{64}$'),
  activated_by  uuid REFERENCES users (id),
  activated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (policy_id, version)
);

CREATE FUNCTION policy_versions_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'policy_versions is immutable';
END;
$$;
CREATE TRIGGER policy_versions_no_update BEFORE UPDATE ON policy_versions
  FOR EACH ROW EXECUTE FUNCTION policy_versions_immutable();

CREATE TABLE agents (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  name        text NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
  -- The smart account the agent acts for; the bound policy must protect the same account.
  chain_id    integer NOT NULL,
  account     text NOT NULL CHECK (account ~ '^0x[0-9a-fA-F]{40}$'),
  policy_id   uuid REFERENCES policies (id) ON DELETE SET NULL,
  status      text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'revoked')),
  status_changed_at  timestamptz,
  status_changed_by  uuid REFERENCES users (id),
  created_by  uuid REFERENCES users (id),
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX agents_org ON agents (org_id, created_at);

-- API credentials belong to one agent. Only a SHA-256 of the secret is stored; the secret is shown once.
CREATE TABLE api_credentials (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        uuid NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  agent_id      uuid NOT NULL REFERENCES agents (id) ON DELETE CASCADE,
  label         text NOT NULL CHECK (length(label) BETWEEN 1 AND 80),
  -- The non-secret start of the key, shown in lists so a key can be recognized.
  prefix        text NOT NULL CHECK (length(prefix) <= 32),
  secret_hash   bytea NOT NULL UNIQUE,
  created_by    uuid REFERENCES users (id),
  created_at    timestamptz NOT NULL DEFAULT now(),
  last_used_at  timestamptz,
  revoked_at    timestamptz,
  revoked_by    uuid REFERENCES users (id)
);
CREATE INDEX api_credentials_agent ON api_credentials (agent_id);
CREATE INDEX api_credentials_org ON api_credentials (org_id, created_at);

-- Events caused by an agent's API credential rather than a signed-in person.
ALTER TABLE audit_events ADD COLUMN actor_agent_id uuid REFERENCES agents (id);
CREATE INDEX audit_events_org_seq ON audit_events (org_id, seq DESC);
