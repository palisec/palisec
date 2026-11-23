-- Holder mandates. Token holders vote (gasless EIP-712 signatures, weight = balance at a fixed
-- snapshot block, rebuilt from the token's Transfer logs) on typed changes inside an owner-set envelope.
-- A passed proposal compiles into an ordinary policy version activated through ps_activate_policy, with
-- the mandate as the actor; loosening waits out the loosening delay. Envelope loosening is a pending change
-- of kind mandate_envelope.

CREATE TABLE mandates (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                 uuid NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  agent_id               uuid NOT NULL REFERENCES agents (id),
  policy_id              uuid NOT NULL REFERENCES policies (id),
  slug                   text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9][a-z0-9-]{2,47}$'),
  name                   text NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
  chain_id               integer NOT NULL,
  token                  text NOT NULL CHECK (token ~ '^0x[0-9a-fA-F]{40}$'),
  token_symbol           text NOT NULL,
  token_start_block      bigint NOT NULL,
  voting_period_seconds  integer NOT NULL CHECK (voting_period_seconds BETWEEN 60 AND 2592000),
  quorum                 numeric(78,0) NOT NULL CHECK (quorum >= 0),
  pass_bps               integer NOT NULL CHECK (pass_bps BETWEEN 0 AND 9999),
  proposer_min           numeric(78,0) NOT NULL CHECK (proposer_min >= 0),
  envelope               jsonb NOT NULL,
  demo                   boolean NOT NULL DEFAULT false,
  created_by             uuid REFERENCES users (id),
  created_at             timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX mandates_one_per_policy ON mandates (policy_id);

CREATE TABLE mandate_proposals (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mandate_id       uuid NOT NULL REFERENCES mandates (id) ON DELETE CASCADE,
  number           integer NOT NULL,
  title            text NOT NULL CHECK (length(title) BETWEEN 1 AND 120),
  change           jsonb NOT NULL,
  proposer         text NOT NULL,
  proposer_signature text NOT NULL,
  snapshot_block   bigint NOT NULL,
  snapshot_total_supply numeric(78,0) NOT NULL,
  holders          jsonb NOT NULL,
  opens_at         timestamptz NOT NULL DEFAULT now(),
  closes_at        timestamptz NOT NULL,
  -- open -> passed | rejected | failed (could not be counted or compiled: nothing changed)
  state            text NOT NULL DEFAULT 'open' CHECK (state IN ('open', 'passed', 'rejected', 'failed')),
  result           jsonb,
  policy_version   integer,
  applied          text CHECK (applied IN ('applied', 'pending')),
  pending_change_id uuid REFERENCES pending_changes (id),
  closed_at        timestamptz,
  UNIQUE (mandate_id, number)
);
CREATE INDEX mandate_proposals_open ON mandate_proposals (mandate_id, closes_at) WHERE state = 'open';

CREATE TABLE mandate_votes (
  proposal_id   uuid NOT NULL REFERENCES mandate_proposals (id) ON DELETE CASCADE,
  voter         text NOT NULL CHECK (voter ~ '^0x[0-9a-f]{40}$'),
  choice        text NOT NULL CHECK (choice IN ('for', 'against', 'abstain')),
  signature     text NOT NULL,
  weight        numeric(78,0) NOT NULL,
  signed_at     timestamptz NOT NULL DEFAULT now(),
  replaced      integer NOT NULL DEFAULT 0,
  PRIMARY KEY (proposal_id, voter)
);

DO $$
DECLARE c record;
BEGIN
  FOR c IN SELECT conname FROM pg_constraint WHERE conrelid = 'pending_changes'::regclass AND contype = 'c'
           AND pg_get_constraintdef(oid) LIKE '%agent_upoch%' AND pg_get_constraintdef(oid) LIKE '%policy_activation%' LOOP
    EXECUTE format('ALTER TABLE pending_changes DROP CONSTRAINT %I', c.conname);
  END LOOP;
END $$;
ALTER TABLE pending_changes ADD CONSTRAINT pending_changes_kind_allowed_v2 CHECK (kind IN ('policy_activation', 'agent_rebind', 'agent_resume', 'emergency_lift', 'delay_change', 'agent_upoch', 'mandate_envelope'));

CREATE OR REPLACE FUNCTION ps_apply_due(p_org uuid) RETURNS jsonb
LANGUAGE plpgsql AS $$
DECLARE
  r    pending_changes%ROWTYPE;
  out  jsonb := '[]'::jsonb;
  key  text;
BEGIN
  FOR r IN
    SELECT * FROM pending_changes
    WHERE state = 'pending' AND effective_at <= now() AND (p_org IS NULL OR org_id = p_org)
    ORDER BY effective_at
    FOR UPDATE SKIP LOCKED
  LOOP
    IF r.kind = 'policy_activation' THEN
      UPDATE policies SET active_version = r.policy_version, disabled_at = NULL WHERE id = r.policy_id;
      SELECT policy_key INTO key FROM policies WHERE id = r.policy_id;
      INSERT INTO audit_events (org_id, actor_user_id, type, detail) VALUES (r.org_id, r.requested_by, 'policy.activated',
        jsonb_build_object('policy_id', r.policy_id, 'policy_key', key, 'version', r.policy_version, 'pending_change_id', r.id, 'after_delay', true));
    ELSIF r.kind = 'agent_rebind' THEN
      UPDATE agents SET policy_id = nullif(r.setting->>'policy_id', '')::uuid WHERE id = r.agent_id AND status <> 'revoked';
      INSERT INTO audit_events (org_id, actor_user_id, actor_agent_id, type, detail) VALUES (r.org_id, r.requested_by, r.agent_id, 'agent.updated',
        jsonb_build_object('agent_id', r.agent_id, 'policy_id', r.setting->>'policy_id', 'pending_change_id', r.id, 'after_delay', true));
    ELSIF r.kind = 'mandate_envelope' THEN
      UPDATE mandates SET envelope = r.setting->'envelope' WHERE id = (r.setting->>'mandate_id')::uuid AND org_id = r.org_id;
      INSERT INTO audit_events (org_id, actor_user_id, type, detail) VALUES (r.org_id, r.requested_by, 'mandate.envelope_changed',
        jsonb_build_object('mandate_id', r.setting->>'mandate_id', 'envelope', r.setting->'envelope', 'pending_change_id', r.id, 'after_delay', true));
    ELSIF r.kind = 'agent_upoch' THEN
      UPDATE agents SET upoch_workflow_id = nullif(r.setting->>'upoch_workflow_id', '') WHERE id = r.agent_id AND status <> 'revoked';
      INSERT INTO audit_events (org_id, actor_user_id, actor_agent_id, type, detail) VALUES (r.org_id, r.requested_by, r.agent_id, 'agent.updated',
        jsonb_build_object('agent_id', r.agent_id, 'upoch_workflow_id', r.setting->>'upoch_workflow_id', 'pending_change_id', r.id, 'after_delay', true));
    ELSIF r.kind = 'agent_resume' THEN
      UPDATE agents SET status = 'active', status_changed_at = now(), status_changed_by = r.requested_by
        WHERE id = r.agent_id AND status = 'paused';
      INSERT INTO audit_events (org_id, actor_user_id, actor_agent_id, type, detail) VALUES (r.org_id, r.requested_by, r.agent_id, 'agent.resumed',
        jsonb_build_object('agent_id', r.agent_id, 'pending_change_id', r.id, 'after_delay', true));
    ELSIF r.kind = 'emergency_lift' THEN
      UPDATE organizations SET emergency_stop = false WHERE id = r.org_id;
      INSERT INTO audit_events (org_id, actor_user_id, type, detail) VALUES (r.org_id, r.requested_by, 'org.emergency_stop.lifted',
        jsonb_build_object('pending_change_id', r.id, 'after_delay', true));
    ELSIF r.kind = 'delay_change' THEN
      UPDATE organizations SET
        loosening_delay_seconds = coalesce((r.setting->>'loosening_delay_seconds')::int, loosening_delay_seconds),
        stop_lift_delay_seconds = coalesce((r.setting->>'stop_lift_delay_seconds')::int, stop_lift_delay_seconds)
      WHERE id = r.org_id;
      INSERT INTO audit_events (org_id, actor_user_id, type, detail) VALUES (r.org_id, r.requested_by, 'org.delays_changed',
        jsonb_build_object('setting', r.setting, 'pending_change_id', r.id, 'after_delay', true));
    END IF;
    UPDATE pending_changes SET state = 'applied', resolved_at = now(), resolution = 'applied' WHERE id = r.id;
    INSERT INTO audit_events (org_id, actor_user_id, type, detail) VALUES (r.org_id, NULL, 'policy.loosening_applied',
      jsonb_build_object('pending_change_id', r.id, 'kind', r.kind, 'policy_id', r.policy_id, 'version', r.policy_version,
        'agent_id', r.agent_id, 'setting', r.setting, 'diff', r.diff, 'effective_at', r.effective_at));
    out := out || jsonb_build_object('id', r.id, 'org_id', r.org_id, 'kind', r.kind, 'policy_id', r.policy_id,
      'policy_version', r.policy_version, 'agent_id', r.agent_id, 'setting', r.setting, 'summary', r.summary,
      'diff', r.diff, 'effective_at', r.effective_at);
  END LOOP;
  RETURN out;
END;
$$;
