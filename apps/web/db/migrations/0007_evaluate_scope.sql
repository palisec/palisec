-- An evaluate-only API key scope, for the homepage's Live API demo.
-- A key whose only scope is authorizations:evaluate can run dry runs (POST /v1/authorizations/evaluate)
-- and nothing else: no operations, no execution, no reads of records. Additive: existing keys keep
-- their scopes; the column default (keys created without a scope list) is unchanged.

ALTER TABLE api_credentials DROP CONSTRAINT IF EXISTS api_credentials_scopes_check;
ALTER TABLE api_credentials ADD CONSTRAINT api_credentials_scopes_check
  CHECK (scopes <@ ARRAY['operations:write', 'operations:read', 'policy:read', 'audit:read', 'mcp', 'authorizations:evaluate']::text[] AND cardinality(scopes) >= 1);
