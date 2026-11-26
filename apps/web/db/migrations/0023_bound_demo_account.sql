-- Treasury guard: opt the fully bound demo smart account on mainnet (recovery owner: a 31-day timelock) into
-- policy publishing, so its treasury guard is committed on the registry like the first demo account's.
-- Additive: nothing existing changes.
INSERT INTO peaa_accounts (agent_id)
SELECT DISTINCT ON (lower(account)) id FROM agents
WHERE chain_id = 4663 AND status <> 'revoked'
  AND lower(account) = '0x42ed29379374567c3b540cc8f1c01e4fae422522'
ORDER BY lower(account), created_at DESC
ON CONFLICT DO NOTHING;
