-- Control-plane foundation: identities, wallet sign-in, sessions, organizations, audit.
-- Postgres is the authoritative store (ROADMAP: architecture decisions).

CREATE TABLE users (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- EIP-55 checksummed; uniqueness is case-insensitive.
  address     text NOT NULL CHECK (address ~ '^0x[0-9a-fA-F]{40}$'),
  created_at  timestamptz NOT NULL DEFAULT now(),
  last_login  timestamptz
);
CREATE UNIQUE INDEX users_address_key ON users (lower(address));

-- One row per issued SIWE challenge. The server writes the exact message; the client only signs it.
CREATE TABLE auth_challenges (
  nonce        text PRIMARY KEY CHECK (length(nonce) BETWEEN 16 AND 64),
  address      text NOT NULL,
  domain       text NOT NULL,
  chain_id     integer NOT NULL,
  message      text NOT NULL CHECK (length(message) <= 2048),
  issued_at    timestamptz NOT NULL DEFAULT now(),
  expires_at   timestamptz NOT NULL,
  consumed_at  timestamptz
);
CREATE INDEX auth_challenges_expires ON auth_challenges (expires_at);

-- Only a SHA-256 of the session token is stored.
CREATE TABLE sessions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash  bytea NOT NULL UNIQUE,
  user_id     uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL,
  revoked_at  timestamptz
);
CREATE INDEX sessions_user ON sessions (user_id);

CREATE TABLE organizations (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE memberships (
  org_id      uuid NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  user_id     uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  role        text NOT NULL CHECK (role IN ('owner', 'admin', 'operator', 'approver', 'viewer')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, user_id)
);
CREATE INDEX memberships_user ON memberships (user_id);

-- Append-only at the database level: updates and deletes raise.
CREATE TABLE audit_events (
  seq             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  event_id        uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  org_id          uuid REFERENCES organizations (id),
  actor_user_id   uuid REFERENCES users (id),
  type            text NOT NULL CHECK (length(type) <= 64),
  detail          jsonb NOT NULL DEFAULT '{}'::jsonb,
  schema_version  text NOT NULL DEFAULT '1.0',
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_events_org_time ON audit_events (org_id, created_at DESC);

CREATE FUNCTION audit_events_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'audit_events is append-only';
END;
$$;
CREATE TRIGGER audit_events_no_update BEFORE UPDATE OR DELETE ON audit_events
  FOR EACH ROW EXECUTE FUNCTION audit_events_immutable();
