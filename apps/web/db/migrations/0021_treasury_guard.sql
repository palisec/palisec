-- Treasury guard (policy schema 1.6): each operation records how much of the project token it sells
-- through an allowed venue, and the atomic record function rechecks the rolling 24-hour sell cap against
-- every sell still holding (authorized, approved or awaiting approval), per account, so concurrent
-- requests can never sell past the cap together.
ALTER TABLE operations ADD COLUMN IF NOT EXISTS treasury_sold numeric NOT NULL DEFAULT 0 CHECK (treasury_sold >= 0);
CREATE INDEX IF NOT EXISTS operations_treasury_window ON operations (chain_id, lower(account), created_at) WHERE treasury_sold > 0;

CREATE OR REPLACE FUNCTION ps_record_operation(op jsonb, lim jsonb) RETURNS jsonb
LANGUAGE plpgsql AS $$
DECLARE
  v_agent    uuid := (op->>'agent_id')::uuid;
  v_org      uuid := (op->>'org_id')::uuid;
  v_policy   uuid := nullif(op->>'policy_id', '')::uuid;
  v_decision text := op->>'decision';
  v_code     text := nullif(op->>'reason_code', '');
  v_message  text := op->>'message';
  v_checks   jsonb := coalesce(op->'checks', '[]'::jsonb);
  v_existing operations%ROWTYPE;
  v_used     numeric;
  v_open     integer;
  v_id       uuid;
  v_state    text;
  v_fail     text;
  v_sold     numeric := coalesce(nullif(op->>'treasury_sold', '')::numeric, 0);
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('ps_op:' || coalesce(v_policy::text, v_agent::text), 0));
  -- Treasury guard: sells are counted per account, so two agents or policies on one account share the window.
  IF v_sold > 0 THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('ps_treasury:' || (op->>'chain_id') || ':' || lower(op->>'account'), 0));
  END IF;

  IF op->>'idempotency_key' IS NOT NULL THEN
    SELECT * INTO v_existing FROM operations WHERE agent_id = v_agent AND idempotency_key = op->>'idempotency_key';
    IF FOUND THEN
      RETURN jsonb_build_object(
        'outcome', CASE WHEN v_existing.request_hash = op->>'request_hash' THEN 'idempotent' ELSE 'idempotency_conflict' END,
        'id', v_existing.id);
    END IF;
  END IF;

  IF EXISTS (SELECT 1 FROM operations WHERE agent_id = v_agent AND request_id = op->>'request_id') THEN
    RETURN jsonb_build_object('outcome', 'replay');
  END IF;

  IF v_decision <> 'DENY' THEN
    IF (SELECT emergency_stop FROM organizations WHERE id = v_org) THEN
      v_fail := 'PS_PAUSED_001:Organization emergency stop is active.';
    ELSIF (SELECT status FROM agents WHERE id = v_agent) IS DISTINCT FROM 'active' THEN
      v_fail := 'PS_PAUSED_001:Agent is paused or revoked.';
    ELSIF (SELECT active_version FROM policies WHERE id = v_policy AND disabled_at IS NULL)
          IS DISTINCT FROM (op->>'policy_version')::int THEN
      v_fail := 'PS_POLICY_001:The active policy version changed during evaluation.';
    ELSE
      SELECT coalesce(sum(usd_micros), 0) INTO v_used FROM operations
        WHERE policy_id = v_policy AND created_at > now() - interval '1 hour' AND ps_holds_budget(state, expires_at);
      SELECT count(*) INTO v_open FROM operations
        WHERE policy_id = v_policy AND created_at > now() - interval '1 day' AND ps_is_open(state, expires_at);
      IF v_used + (op->>'usd_micros')::numeric > (lim->>'hourly_budget_usd_micros')::numeric THEN
        v_fail := 'PS_BUDGET_001:Hourly budget exhausted by concurrent requests.';
      ELSIF v_open >= (lim->>'max_pending_operations')::int THEN
        v_fail := 'PS_RATE_001:Pending operation limit reached by concurrent requests.';
      ELSIF EXISTS (SELECT 1 FROM operations WHERE agent_id = v_agent AND calldata_fp = op->>'calldata_fp' AND state <> 'denied'
                    AND created_at > now() - make_interval(secs => (lim->>'identical_calldata_seconds')::int)) THEN
        v_fail := 'PS_LOOP_001:Identical calldata was authorized within the cooldown.';
      ELSIF EXISTS (SELECT 1 FROM operations WHERE agent_id = v_agent AND intent_fp = op->>'intent_fp' AND state <> 'denied'
                    AND created_at > now() - make_interval(secs => (lim->>'identical_intent_seconds')::int)) THEN
        v_fail := 'PS_LOOP_001:An equivalent intent was authorized within the cooldown.';
      ELSIF v_sold > 0 AND lim->>'treasury_cap' IS NOT NULL AND v_sold + (
              SELECT coalesce(sum(treasury_sold), 0) FROM operations
              WHERE chain_id = (op->>'chain_id')::int AND lower(account) = lower(op->>'account')
                AND created_at > now() - interval '24 hours' AND ps_holds_budget(state, expires_at))
            > (lim->>'treasury_cap')::numeric THEN
        v_fail := 'PS_TREASURY_002:Daily sell cap reached by concurrent requests.';
      END IF;
    END IF;
    IF v_fail IS NOT NULL THEN
      v_decision := 'DENY';
      v_code := split_part(v_fail, ':', 1);
      v_message := substr(v_fail, length(v_code) + 2);
      v_checks := v_checks || jsonb_build_array(jsonb_build_object(
        'id', 'commit', 'label', 'Atomic reservation against authoritative state', 'status', 'fail',
        'detail', v_message, 'enforcement', 'live'));
    END IF;
  END IF;

  v_state := CASE v_decision WHEN 'ALLOW' THEN 'authorized' WHEN 'DENY' THEN 'denied' ELSE 'pending_approval' END;

  BEGIN
    INSERT INTO operations (
      org_id, agent_id, credential_id, policy_id, policy_version, request_id, idempotency_key, request_hash,
      chain_id, account, target, value_wei, data, selector, gas_limit, fee_wei, usd_micros, deadline,
      calldata_fp, intent_fp, decision, reason_code, message, checks, state, authorization_id, expires_at, treasury_sold)
    VALUES (
      v_org, v_agent, nullif(op->>'credential_id', '')::uuid, v_policy, (op->>'policy_version')::int,
      op->>'request_id', op->>'idempotency_key', op->>'request_hash',
      (op->>'chain_id')::int, op->>'account', op->>'target', (op->>'value_wei')::numeric, op->>'data',
      op->>'selector', (op->>'gas_limit')::bigint, (op->>'fee_wei')::numeric,
      CASE WHEN v_decision = 'DENY' THEN 0 ELSE coalesce((op->>'usd_micros')::numeric, 0) END,
      to_timestamp((op->>'deadline')::bigint),
      op->>'calldata_fp', op->>'intent_fp', v_decision, v_code, v_message, v_checks, v_state,
      CASE WHEN v_decision = 'ALLOW' THEN op->>'authorization_id' END,
      CASE v_decision
        WHEN 'ALLOW' THEN now() + make_interval(secs => (op->>'authorization_ttl')::int)
        WHEN 'REQUIRES_HUMAN_SIGNATURE' THEN now() + make_interval(secs => (op->>'approval_ttl')::int)
      END,
      CASE WHEN v_decision = 'DENY' THEN 0 ELSE v_sold END)
    RETURNING id INTO v_id;
  EXCEPTION WHEN unique_violation THEN
    RETURN jsonb_build_object('outcome', 'replay');
  END;

  INSERT INTO audit_events (org_id, actor_agent_id, type, detail)
  VALUES (v_org, v_agent,
    CASE v_decision WHEN 'ALLOW' THEN 'operation.authorized' WHEN 'DENY' THEN 'operation.denied' ELSE 'operation.pending_approval' END,
    jsonb_build_object('operation_id', v_id, 'request_id', op->>'request_id', 'reason_code', v_code,
      'policy_version', (op->>'policy_version')::int, 'target', op->>'target', 'selector', op->>'selector',
      'usd_micros', CASE WHEN v_decision = 'DENY' THEN '0' ELSE op->>'usd_micros' END));

  RETURN jsonb_build_object('outcome', 'recorded', 'id', v_id, 'decision', v_decision, 'reason_code', v_code, 'message', v_message);
END;
$$;
