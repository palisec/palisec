-- Phase 9: opt the loss-limit demo smart account on mainnet into policy publishing (Phase 8 registry),
-- so its loss-limit policy changes and reset are committed on chain. Additive: nothing existing changes.
INSERT INTO peaa_accounts (agent_id)
SELECT DISTINCT ON (lower(account)) id FROM agents
WHERE chain_id = 4663 AND status <> 'revoked'
  AND lower(account) = '0x667729a0e035332f63e69626cd7a97863c49fd77'
ORDER BY lower(account), created_at DESC
ON CONFLICT DO NOTHING;
