-- Holder mandates hardening: a signed proposal is single-use (nonce per proposer), and closing claims the
-- proposal first (claimed_at) so its result is applied once.
ALTER TABLE mandate_proposals ADD COLUMN nonce text;
ALTER TABLE mandate_proposals ADD COLUMN claimed_at timestamptz;
CREATE UNIQUE INDEX mandate_proposals_nonce ON mandate_proposals (mandate_id, proposer, nonce);
