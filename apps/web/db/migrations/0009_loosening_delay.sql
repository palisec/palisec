-- Phase 6: loosening delay.
--
-- Any change that weakens an organization's rules waits in pending_changes until effective_at; until
-- then the current state keeps deciding every request. Tightening applies at once. Pending changes are
-- applied by ps_apply_due(), which every decision snapshot, console read and the health check calls,
-- so a due change is in force for the first request after effective_at.

ALTER TABLE organizations
  ADD COLUMN loosening_delay_seconds integer NOT NULL DEFAULT 3600 CHECK (loosening_delay_seconds BETWEEN 1 AND 259200),
  ADD COLUMN stop_lift_delay_seconds integer NOT NULL DEFAULT 900 CHECK (stop_lift_delay_seconds BETWEEN 1 AND 259200);

CREATE TABLE pending_changes (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  kind            text NOT NULL CHECK (kind IN ('policy_activation', 'agent_rebind', 'agent_resume', 'emergency_lift', 'delay_change')),
  policy_id       uuid REFERENCES policies (id) ON DELETE CASCADE,
  policy_version  integer,
  agent_id        uuid REFERENCES agents (id) ON DELETE CASCADE,
  -- agent_rebind: {"policy_id": uuid|null}; delay_change: {"loosening_delay_seconds": n, "stop_lift_delay_seconds": n}
  setting         jsonb,
  -- The exact difference, as classified: [{path, kind, from, to, note}]
  diff            jsonb NOT NULL DEFAULT '[]'::jsonb,
  summary         text NOT NULL DEFAULT '',
  requested_by    uuid REFERENCES users (id),
  requested_at    timestamptz NOT NULL DEFAULT now(),
  effective_at    timestamptz NOT NULL,
  state           text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending', 'applied', 'cancelled')),
  resolved_at     timestamptz,
  resolved_by     uuid REFERENCES users (id),
  resolution      text,
  CHECK (kind <> 'policy_activation' OR (policy_id IS NOT NULL AND policy_version IS NOT NULL)),
  CHECK (kind NOT IN ('agent_rebind', 'agent_resume') OR agent_id IS NOT NULL)
);
CREATE INDEX pending_changes_open ON pending_changes (org_id, effective_at) WHERE state = 'pending';
CREATE INDEX pending_changes_org_time ON pending_changes (org_id, requested_at DESC);
-- At most one open change per policy, per agent, and per organization setting.
CREATE UNIQUE INDEX pending_one_activation ON pending_changes (policy_id) WHERE state = 'pending' AND kind = 'policy_activation';
CREATE UNIQUE INDEX pending_one_agent_change ON pending_changes (agent_id) WHERE state = 'pending' AND kind IN ('agent_rebind', 'agent_resume');
CREATE UNIQUE INDEX pending_one_lift ON pending_changes (org_id) WHERE state = 'pending' AND kind = 'emergency_lift';
CREATE UNIQUE INDEX pending_one_delay ON pending_changes (org_id) WHERE state = 'pending' AND kind = 'delay_change';

ALTER TABLE security_findings DROP CONSTRAINT IF EXISTS security_findings_category_check;
ALTER TABLE security_findings ADD CONSTRAINT security_findings_category_check CHECK (category IN (
  'unusual_proposal', 'repeated_denial', 'spending_threshold', 'unfamiliar_recipient', 'unapproved_contract',
  'unexpected_selector', 'failed_approval', 'replay_attempt', 'invalid_signature', 'signing_failure',
  'attestation_mismatch', 'integration_credential_failure', 'emergency_stop', 'account_pause',
  'policy_loosening_pending'));

/*
 * Applies every pending change that is due (one organization, or all when p_org is NULL) and returns
 * them as a JSON array for webhooks. Rows are locked and skipped when another caller holds them, so a
 * change is applied once. Each application writes its audit events in the same transaction.
 */
CREATE FUNCTION ps_apply_due(p_org uuid) RETURNS jsonb
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

/*
 * Activates a reviewed draft as version p_next. With p_delay, the version is recorded but waits as a
 * pending change (the current version keeps deciding); without, it applies now. Either way an open
 * pending activation of the same policy is superseded (cancelled) first, so a tightening can never be
 * overtaken later by an older, looser pending version. Guards: the active version and draft must be
 * what the caller classified, and p_next must be the next free version number.
 */
CREATE FUNCTION ps_activate_policy(
  p_policy uuid, p_org uuid, p_user uuid, p_expected_active integer, p_draft jsonb, p_next integer,
  p_document jsonb, p_hash text, p_delay boolean, p_diff jsonb, p_summary text
) RETURNS jsonb
LANGUAGE plpgsql AS $$
DECLARE
  p        policies%ROWTYPE;
  v_delay  integer;
  v_pid    uuid;
  v_eff    timestamptz;
  c        record;
BEGIN
  SELECT * INTO p FROM policies WHERE id = p_policy AND org_id = p_org FOR UPDATE;
  IF NOT FOUND OR p.active_version IS DISTINCT FROM p_expected_active OR p.draft IS DISTINCT FROM p_draft
     OR p_next <> coalesce((SELECT max(version) FROM policy_versions WHERE policy_id = p_policy), 0) + 1 THEN
    RETURN jsonb_build_object('outcome', 'conflict');
  END IF;

  FOR c IN UPDATE pending_changes SET state = 'cancelled', resolved_at = now(), resolved_by = p_user, resolution = 'superseded'
           WHERE policy_id = p_policy AND state = 'pending' AND kind = 'policy_activation' RETURNING id, policy_version
  LOOP
    INSERT INTO audit_events (org_id, actor_user_id, type, detail) VALUES (p_org, p_user, 'policy.loosening_cancelled',
      jsonb_build_object('pending_change_id', c.id, 'kind', 'policy_activation', 'policy_id', p_policy, 'version', c.policy_version, 'reason', 'superseded'));
  END LOOP;

  INSERT INTO policy_versions (policy_id, version, document, document_hash, activated_by)
  VALUES (p_policy, p_next, p_document, p_hash, p_user);
  INSERT INTO audit_events (org_id, actor_user_id, type, detail) VALUES (p_org, p_user, 'policy.activation_requested',
    jsonb_build_object('policy_id', p_policy, 'policy_key', p.policy_key, 'version', p_next, 'document_hash', p_hash,
      'loosening', p_delay, 'diff', p_diff));

  IF p_delay THEN
    SELECT loosening_delay_seconds INTO v_delay FROM organizations WHERE id = p_org;
    v_eff := now() + make_interval(secs => v_delay);
    INSERT INTO pending_changes (org_id, kind, policy_id, policy_version, diff, summary, requested_by, effective_at)
    VALUES (p_org, 'policy_activation', p_policy, p_next, p_diff, p_summary, p_user, v_eff) RETURNING id INTO v_pid;
    INSERT INTO audit_events (org_id, actor_user_id, type, detail) VALUES (p_org, p_user, 'policy.loosening_pending',
      jsonb_build_object('pending_change_id', v_pid, 'kind', 'policy_activation', 'policy_id', p_policy, 'policy_key', p.policy_key,
        'version', p_next, 'effective_at', v_eff, 'diff', p_diff));
    RETURN jsonb_build_object('outcome', 'pending', 'version', p_next, 'pending_change_id', v_pid, 'effective_at', v_eff);
  END IF;

  UPDATE policies SET active_version = p_next, disabled_at = NULL WHERE id = p_policy;
  INSERT INTO audit_events (org_id, actor_user_id, type, detail) VALUES (p_org, p_user, 'policy.activated',
    jsonb_build_object('policy_id', p_policy, 'policy_key', p.policy_key, 'version', p_next, 'document_hash', p_hash, 'diff', p_diff));
  RETURN jsonb_build_object('outcome', 'applied', 'version', p_next);
END;
$$;

/*
 * Records any other loosening (agent rebind or resume, emergency-stop lift, shorter delays) as a pending
 * change, unless the same kind is already pending for that target (then that one is returned).
 */
CREATE FUNCTION ps_request_pending(p_org uuid, p_user uuid, p_kind text, p_agent uuid, p_setting jsonb, p_diff jsonb, p_summary text, p_delay_seconds integer)
RETURNS jsonb
LANGUAGE plpgsql AS $$
DECLARE
  v_existing pending_changes%ROWTYPE;
  v_pid      uuid;
  v_eff      timestamptz := now() + make_interval(secs => p_delay_seconds);
BEGIN
  SELECT * INTO v_existing FROM pending_changes
  WHERE org_id = p_org AND state = 'pending' AND kind = p_kind
    AND (p_kind NOT IN ('agent_rebind', 'agent_resume') OR agent_id = p_agent)
  FOR UPDATE;
  IF FOUND THEN
    IF v_existing.kind = 'agent_rebind' AND v_existing.setting IS DISTINCT FROM p_setting
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

/* Cancels one open change at once. Returns the cancelled row, or NULL when it was not open. */
CREATE FUNCTION ps_cancel_pending(p_id uuid, p_org uuid, p_user uuid, p_reason text) RETURNS jsonb
LANGUAGE plpgsql AS $$
DECLARE
  r pending_changes%ROWTYPE;
BEGIN
  UPDATE pending_changes SET state = 'cancelled', resolved_at = now(), resolved_by = p_user, resolution = p_reason
  WHERE id = p_id AND org_id = p_org AND state = 'pending' RETURNING * INTO r;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  INSERT INTO audit_events (org_id, actor_user_id, actor_agent_id, type, detail) VALUES (p_org, p_user, r.agent_id, 'policy.loosening_cancelled',
    jsonb_build_object('pending_change_id', r.id, 'kind', r.kind, 'policy_id', r.policy_id, 'version', r.policy_version,
      'agent_id', r.agent_id, 'setting', r.setting, 'diff', r.diff, 'reason', p_reason));
  RETURN to_jsonb(r);
END;
$$;
