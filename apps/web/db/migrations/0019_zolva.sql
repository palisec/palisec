-- Zolva: an agent's track record from Zolva (paper trading), the two-sided link, and bigger limits
-- once proven (policy schema 1.4). Display data never reaches a decision; only the engine input
-- `proven_record` does, and it can only unlock limits the policy itself names.

-- The Zolva agent this agent is linked to (set by the organization), and the agent ID its account
-- declared on chain in AgentLinks (read from chain, cached).
ALTER TABLE agents
  ADD COLUMN zolva_agent_id text CHECK (zolva_agent_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'),
  ADD COLUMN zolva_declared_id text CHECK (char_length(zolva_declared_id) <= 128),
  ADD COLUMN zolva_declared_read_at timestamptz,
  -- When bigger limits took effect after the loosening delay; NULL while locked or pending.
  ADD COLUMN proven_unlocked_at timestamptz;

-- At most one agent per organization per Zolva agent.
CREATE UNIQUE INDEX agents_zolva_once_per_org ON agents (org_id, zolva_agent_id) WHERE zolva_agent_id IS NOT NULL AND status <> 'revoked';

-- One row per Zolva agent: the reduced record and Zolva's replay check, read at most every 5 minutes
-- (record) and every hour (replay check), claimed in one statement so servers never read twice.
CREATE TABLE zolva_cache (
  zolva_agent_id  text PRIMARY KEY CHECK (zolva_agent_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'),
  record          jsonb,
  fetched_at      timestamptz,
  claimed_at      timestamptz,
  verify          jsonb,
  verified_at     timestamptz,
  verify_claimed_at timestamptz,
  next_allowed_at timestamptz,
  last_error      text CHECK (char_length(last_error) <= 64),
  last_error_at   timestamptz
);

DO $$
DECLARE c record;
BEGIN
  FOR c IN SELECT conname FROM pg_constraint WHERE conrelid = 'pending_changes'::regclass AND contype = 'c'
           AND pg_get_constraintdef(oid) LIKE '%mandate_envelope%' AND pg_get_constraintdef(oid) LIKE '%policy_activation%' LOOP
    EXECUTE format('ALTER TABLE pending_changes DROP CONSTRAINT %I', c.conname);
  END LOOP;
  FOR c IN SELECT conname FROM pg_constraint WHERE conrelid = 'pending_changes'::regclass AND contype = 'c'
           AND pg_get_constraintdef(oid) LIKE '%agent_upoch%' AND pg_get_constraintdef(oid) LIKE '%agent_id IS NOT NULL%' LOOP
    EXECUTE format('ALTER TABLE pending_changes DROP CONSTRAINT %I', c.conname);
  END LOOP;
END $$;
ALTER TABLE pending_changes ADD CONSTRAINT pending_changes_kind_allowed_v3 CHECK (kind IN ('policy_activation', 'agent_rebind', 'agent_resume', 'emergency_lift', 'delay_change', 'agent_upoch', 'mandate_envelope', 'proven_unlock'));
ALTER TABLE pending_changes ADD CONSTRAINT pending_changes_agent_required_v2 CHECK (kind NOT IN ('agent_rebind', 'agent_resume', 'agent_upoch', 'proven_unlock') OR agent_id IS NOT NULL);
CREATE UNIQUE INDEX pending_one_proven_unlock ON pending_changes (agent_id) WHERE state = 'pending' AND kind = 'proven_unlock';

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
    ELSIF r.kind = 'proven_unlock' THEN
      -- Only if the agent is still linked to the same Zolva agent; otherwise the unlock simply lapses.
      UPDATE agents SET proven_unlocked_at = now()
        WHERE id = r.agent_id AND status <> 'revoked' AND zolva_agent_id IS NOT DISTINCT FROM r.setting->>'zolva_agent_id';
      INSERT INTO audit_events (org_id, actor_user_id, actor_agent_id, type, detail) VALUES (r.org_id, r.requested_by, r.agent_id, 'agent.proven_unlocked',
        jsonb_build_object('agent_id', r.agent_id, 'zolva_agent_id', r.setting->>'zolva_agent_id', 'pending_change_id', r.id, 'after_delay', true));
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

CREATE OR REPLACE FUNCTION ps_request_pending(p_org uuid, p_user uuid, p_kind text, p_agent uuid, p_setting jsonb, p_diff jsonb, p_summary text, p_delay_seconds integer)
RETURNS jsonb
LANGUAGE plpgsql AS $$
DECLARE
  v_existing pending_changes%ROWTYPE;
  v_pid      uuid;
  v_eff      timestamptz := now() + make_interval(secs => p_delay_seconds);
BEGIN
  SELECT * INTO v_existing FROM pending_changes
  WHERE org_id = p_org AND state = 'pending' AND kind = p_kind
    AND (p_kind NOT IN ('agent_rebind', 'agent_resume', 'agent_upoch', 'proven_unlock') OR agent_id = p_agent)
  FOR UPDATE;
  IF FOUND THEN
    IF v_existing.kind IN ('agent_rebind', 'agent_upoch') AND v_existing.setting IS DISTINCT FROM p_setting
       OR v_existing.kind = 'delay_change' AND v_existing.setting IS DISTINCT FROM p_setting THEN
      -- A different target value: the old request is superseded and the delay starts again.
      UPDATE pending_changes SET state = 'cancelled', resolved_at = now(), resolved_by = p_user, resolution = 'superseded' WHERE id = v_existing.id;
      INSERT INTO audit_events (org_id, actor_user_id, type, detail) VALUES (p_org, p_user, 'policy.loosening_cancelled',
        jsonb_build_object('pending_change_id', v_existing.id, 'kind', v_existing.kind, 'agent_id', v_existing.agent_id, 'reason', 'superseded'));
    ELSE
      RETURN jsonb_build_object('outcome', 'already_pending', 'pending_change_id', v_existing.id, 'effective_at', v_existing.effective_at);
    END IF;
  END IF;
  -- Agent rebinds and resumes share one slot per agent.
  IF p_kind IN ('agent_rebind', 'agent_resume') AND EXISTS (
       SELECT 1 FROM pending_changes WHERE agent_id = p_agent AND state = 'pending' AND kind IN ('agent_rebind', 'agent_resume')) THEN
    RETURN jsonb_build_object('outcome', 'conflict');
  END IF;
  INSERT INTO pending_changes (org_id, kind, agent_id, setting, diff, summary, requested_by, effective_at)
  VALUES (p_org, p_kind, p_agent, p_setting, p_diff, p_summary, p_user, v_eff) RETURNING id INTO v_pid;
  INSERT INTO audit_events (org_id, actor_user_id, actor_agent_id, type, detail) VALUES (p_org, p_user, p_agent, 'policy.loosening_pending',
    jsonb_build_object('pending_change_id', v_pid, 'kind', p_kind, 'agent_id', p_agent, 'setting', p_setting, 'effective_at', v_eff, 'diff', p_diff));
  RETURN jsonb_build_object('outcome', 'pending', 'pending_change_id', v_pid, 'effective_at', v_eff);
END;
$$;
