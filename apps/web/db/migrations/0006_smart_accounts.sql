-- Part 8: execution through PALISEC smart accounts (Safe + 4337 module, PALISEC co-signer).
--
-- An allowed or approved operation can be executed once through the agent's Safe:
--   prepare  -> user_op holds the exact unsigned user operation PALISEC built from the evaluated intent
--   submit   -> submitted_at is claimed in one statement (with its audit event), PALISEC co-signs,
--               and the bundler returns user_op_hash
--   receipt  -> transaction_hash, executed_at and execution_success once the bundler reports inclusion
-- A failed submission clears submitted_at so the same prepared operation can be retried.

ALTER TABLE operations
  ADD COLUMN user_op           jsonb,
  ADD COLUMN user_op_hash      text CHECK (user_op_hash ~ '^0x[0-9a-f]{64}$'),
  ADD COLUMN submitted_at      timestamptz,
  ADD COLUMN transaction_hash  text CHECK (transaction_hash ~ '^0x[0-9a-f]{64}$'),
  ADD COLUMN executed_at       timestamptz,
  ADD COLUMN execution_success boolean;

CREATE UNIQUE INDEX operations_user_op_hash ON operations (user_op_hash) WHERE user_op_hash IS NOT NULL;
CREATE INDEX operations_in_flight ON operations (org_id, submitted_at) WHERE submitted_at IS NOT NULL AND executed_at IS NULL;
