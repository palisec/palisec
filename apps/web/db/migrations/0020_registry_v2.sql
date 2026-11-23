-- Policy registry v2: every published commitment records which registry it was sent to, so the move to
-- the v2 registry starts from a clean record while the v1 history stays readable.
ALTER TABLE peaa_commitments ADD COLUMN IF NOT EXISTS registry text CHECK (registry ~ '^0x[0-9a-f]{40}$');
UPDATE peaa_commitments SET registry = '0x20d6b38b47f7cb765a2318a1f318ed54a6f87e92' WHERE registry IS NULL;
CREATE INDEX IF NOT EXISTS peaa_commitments_registry ON peaa_commitments (agent_id, registry, kind);
