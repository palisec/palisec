-- Loosening delay: whether a loosening activation waits is decided inside the activation transaction.

CREATE OR REPLACE FUNCTION ps_activate_policy(
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
  v_bound  integer;
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

  -- p_delay says the change loosens; it waits only if an agent depends on this policy, counted here under
  -- the policy row lock so a concurrent bind cannot slip between the count and the activation.
  SELECT (SELECT count(*) FROM agents WHERE policy_id = p_policy AND status <> 'revoked')
       + (SELECT count(*) FROM pending_changes WHERE org_id = p_org AND state = 'pending' AND kind = 'agent_rebind' AND setting->>'policy_id' = p_policy::text)
    INTO v_bound;
  p_delay := p_delay AND v_bound > 0;
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
