-- Phase 9: loss limits the agent can't override. Palisec records the account's value itself (the
-- public RPC keeps no history), with deposits and withdrawals taken out, and latches a breach until the
-- owner resets it (a new policy version with loss_limit.reset_epoch + 1, which is a delayed loosening).
-- State belongs to one policy and account: another organization's policy on the same address can never
-- pause, reset or move the window of yours. Additive: nothing existing changes.

CREATE TABLE loss_limit_state (
  policy_id          uuid NOT NULL REFERENCES policies (id) ON DELETE CASCADE,
  chain_id           integer NOT NULL,
  account            text NOT NULL CHECK (account ~ '^0x[0-9a-f]{40}$'),
  -- The policy's reset_epoch these rows belong to; a new epoch clears the pause and restarts the window.
  epoch              integer NOT NULL,
  -- Peaks count only from here: the epoch's start, or a restart after a gap longer than the window.
  window_started_at  timestamptz NOT NULL DEFAULT now(),
  paused_code        text CHECK (paused_code IN ('PS_LOSS_001', 'PS_LOSS_002')),
  paused_at          timestamptz,
  last_error         text,
  updated_at         timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (policy_id, chain_id, account)
);

CREATE TABLE loss_snapshots (
  id                bigserial PRIMARY KEY,
  policy_id         uuid NOT NULL REFERENCES policies (id) ON DELETE CASCADE,
  chain_id          integer NOT NULL,
  account           text NOT NULL CHECK (account ~ '^0x[0-9a-f]{40}$'),
  epoch             integer NOT NULL,
  block             bigint NOT NULL,
  taken_at          timestamptz NOT NULL DEFAULT now(),
  value_usd_micros  numeric(78, 0) NOT NULL CHECK (value_usd_micros >= 0),
  -- Deposits minus withdrawals since window_started_at, at the prices of the snapshot that saw them.
  flows_usd_micros  numeric(80, 0) NOT NULL,
  balances          jsonb NOT NULL,
  prices            jsonb NOT NULL
);
CREATE INDEX loss_snapshots_account ON loss_snapshots (policy_id, chain_id, account, taken_at DESC);
