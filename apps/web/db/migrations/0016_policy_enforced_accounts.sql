-- Policy publishing: draft ERC "Policy-Enforced Agent Accounts". Opted-in agents have their policy commitments
-- published to the on-chain registry (once the account itself has declared Palisec's signers there),
-- and their committed policy documents are publicly readable by hash. Additive: nothing existing changes.

CREATE TABLE peaa_accounts (
  agent_id        uuid PRIMARY KEY REFERENCES agents (id) ON DELETE CASCADE,
  publish_policy  boolean NOT NULL DEFAULT true,   -- serve the committed documents at policyURI
  syncing_until   timestamptz,                     -- claim, so two syncs never send the same change twice
  last_synced_at  timestamptz,
  last_error      text,
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- Every commitment published on chain, with the exact document whose hash was committed.
CREATE TABLE peaa_commitments (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id      uuid NOT NULL REFERENCES agents (id) ON DELETE CASCADE,
  chain_id      integer NOT NULL,
  account       text NOT NULL CHECK (account ~ '^0x[0-9a-fA-F]{40}$'),
  kind          text NOT NULL CHECK (kind IN ('activated', 'pending', 'cancelled', 'stop', 'lift', 'mandate')),
  policy_hash   text CHECK (policy_hash ~ '^0x[0-9a-f]{64}$'),
  version       integer,
  effective_at  timestamptz,
  document      jsonb,
  tx_hash       text NOT NULL CHECK (tx_hash ~ '^0x[0-9a-f]{64}$'),
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX peaa_commitments_hash ON peaa_commitments (policy_hash) WHERE document IS NOT NULL;
CREATE INDEX peaa_commitments_agent ON peaa_commitments (agent_id, created_at DESC);

-- Opt in the two Palisec demo smart accounts on mainnet.
INSERT INTO peaa_accounts (agent_id)
SELECT DISTINCT ON (lower(account)) id FROM agents
WHERE chain_id = 4663 AND status <> 'revoked'
  AND lower(account) IN ('0x375bdf5da6b7440889e50f13c894a3c4ac988329', '0x9aec761b2f0fda08c683e8388478c9a2f7c9170c')
ORDER BY lower(account), created_at DESC
ON CONFLICT DO NOTHING;
