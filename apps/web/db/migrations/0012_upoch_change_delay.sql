-- Phase 6.5: changing an agent's Upoch workflow while its policy requires Upoch recovery is a loosening,
-- so it waits out the delay like an agent move (pending kind agent_upoch).

DO $$
DECLARE c record;
BEGIN
  -- Drop the two kind checks from 0009 by what they say, whatever Postgres named them.
  FOR c IN SELECT conname FROM pg_constraint WHERE conrelid = 'pending_changes'::regclass AND contype = 'c'
           AND pg_get_constraintdef(oid) LIKE '%agent_resume%' LOOP
    EXECUTE format('ALTER TABLE pending_changes DROP CONSTRAINT %I', c.conname);
  END LOOP;
END $$;
ALTER TABLE pending_changes ADD CONSTRAINT pending_changes_kind_allowed CHECK (kind IN ('policy_activation', 'agent_rebind', 'agent_resume', 'emergency_lift', 'delay_change', 'agent_upoch'));
ALTER TABLE pending_changes ADD CONSTRAINT pending_changes_agent_required CHECK (kind NOT IN ('agent_rebind', 'agent_resume', 'agent_upoch') OR agent_id IS NOT NULL);
CREATE UNIQUE INDEX pending_one_upoch_change ON pending_changes (agent_id) WHERE state = 'pending' AND kind = 'agent_upoch';

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
    AND (p_kind NOT IN ('agent_rebind', 'agent_resume', 'agent_upoch') OR agent_id = p_agent)
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
