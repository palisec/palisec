-- One draft policy was created with a mistyped ID (the ID field appended to a value filled in from the name).
-- It was never activated: no versions, no agents, no operations, no mandate. Remove it, record the deletion
-- in the audit trail like the console's "Delete draft" does, and keep every earlier audit event. Anything that
-- does not match all of these conditions is left untouched.
WITH p AS (
  DELETE FROM policies x
  WHERE x.policy_key = 'demo_trading_agendemo_tradert' AND x.active_version IS NULL
    AND NOT EXISTS (SELECT 1 FROM policy_versions v WHERE v.policy_id = x.id)
    AND NOT EXISTS (SELECT 1 FROM agents a WHERE a.policy_id = x.id)
    AND NOT EXISTS (SELECT 1 FROM operations o WHERE o.policy_id = x.id)
    AND NOT EXISTS (SELECT 1 FROM mandates m WHERE m.policy_id = x.id)
  RETURNING x.id, x.org_id, x.policy_key, x.name
)
INSERT INTO audit_events (org_id, actor_user_id, type, detail)
SELECT org_id, NULL, 'policy.draft_deleted', jsonb_build_object('policy_id', id, 'policy_key', policy_key, 'name', name, 'reason', 'mistyped policy ID') FROM p;
