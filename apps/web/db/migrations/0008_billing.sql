-- Billing: decision credits, metering and Pro by holdings. Additive only.
--
-- billing_accounts: one row per organization, created on first use. Holds the opaque purchase account
--   (what buyers pass to the PalisecCredits contract), the prepaid credit balance, this month's metered
--   decisions and the cached Pro check.
-- credit_ledger: append-only history of every change to a credit balance (purchase, spend, refund,
--   grant, adjustment), each with a reason and a reference. A purchase is unique per (chain, tx, log).
-- chain_scan_state: how far the purchase events have been read, per contract.

CREATE TABLE billing_accounts (
  org_id            uuid PRIMARY KEY REFERENCES organizations (id) ON DELETE CASCADE,
  purchase_account  text NOT NULL UNIQUE CHECK (purchase_account ~ '^0x[0-9a-f]{64}$')
                    DEFAULT '0x' || replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''),
  credits           bigint NOT NULL DEFAULT 0 CHECK (credits >= 0),
  month             text NOT NULL DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM') CHECK (month ~ '^\d{4}-\d{2}$'),
  used_in_month     integer NOT NULL DEFAULT 0 CHECK (used_in_month >= 0),
  pro               boolean NOT NULL DEFAULT false,
  pro_balance       numeric(78, 0),
  pro_checked_at    timestamptz,
  agent_day         date,
  agent_requests    integer NOT NULL DEFAULT 0 CHECK (agent_requests >= 0),
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE credit_ledger (
  seq          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  org_id       uuid NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  kind         text NOT NULL CHECK (kind IN ('purchase', 'spend', 'refund', 'grant', 'adjustment')),
  credits      bigint NOT NULL CHECK (credits <> 0),
  reason       text NOT NULL CHECK (length(reason) BETWEEN 1 AND 200),
  ref          text CHECK (ref IS NULL OR length(ref) <= 200),
  chain_id     integer,
  tx_hash      text CHECK (tx_hash IS NULL OR tx_hash ~ '^0x[0-9a-f]{64}$'),
  log_index    integer,
  asset        text CHECK (asset IS NULL OR asset IN ('USDG', 'ETH', 'PALISEC')),
  amount_paid  numeric(78, 0),
  usd_micros   bigint,
  burned       numeric(78, 0),
  payer        text CHECK (payer IS NULL OR payer ~ '^0x[0-9a-f]{40}$'),
  block_number bigint,
  created_at   timestamptz NOT NULL DEFAULT now(),
  CHECK ((kind = 'purchase') = (tx_hash IS NOT NULL))
);
CREATE UNIQUE INDEX credit_ledger_event ON credit_ledger (chain_id, tx_hash, log_index) WHERE tx_hash IS NOT NULL;
CREATE INDEX credit_ledger_org_time ON credit_ledger (org_id, created_at DESC);

CREATE FUNCTION credit_ledger_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'credit_ledger is append-only';
END;
$$;
CREATE TRIGGER credit_ledger_no_update BEFORE UPDATE OR DELETE ON credit_ledger
  FOR EACH ROW EXECUTE FUNCTION credit_ledger_immutable();

CREATE TABLE chain_scan_state (
  key         text PRIMARY KEY CHECK (length(key) <= 120),
  last_block  bigint NOT NULL CHECK (last_block >= 0),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- Meters one mainnet decision for an organization, atomically: this month's free allowance first, then
-- one prepaid credit (with its ledger row). Returns 'free', 'credit' or 'none' (nothing consumed), plus
-- what is left. The row lock serializes concurrent requests, so a credit is never spent twice.
CREATE FUNCTION ps_meter_decision(p_org uuid, p_month text, p_free integer, p_ref text) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  r billing_accounts%ROWTYPE;
  v_used integer;
BEGIN
  INSERT INTO billing_accounts (org_id, month) VALUES (p_org, p_month) ON CONFLICT (org_id) DO NOTHING;
  SELECT * INTO r FROM billing_accounts WHERE org_id = p_org FOR UPDATE;
  v_used := CASE WHEN r.month = p_month THEN r.used_in_month ELSE 0 END;
  IF v_used < p_free THEN
    UPDATE billing_accounts SET month = p_month, used_in_month = v_used + 1 WHERE org_id = p_org;
    RETURN jsonb_build_object('source', 'free', 'used', v_used + 1, 'free', p_free, 'credits', r.credits);
  END IF;
  IF r.credits > 0 THEN
    UPDATE billing_accounts SET month = p_month, used_in_month = v_used + 1, credits = credits - 1 WHERE org_id = p_org;
    INSERT INTO credit_ledger (org_id, kind, credits, reason, ref) VALUES (p_org, 'spend', -1, 'mainnet decision', p_ref);
    RETURN jsonb_build_object('source', 'credit', 'used', v_used + 1, 'free', p_free, 'credits', r.credits - 1);
  END IF;
  UPDATE billing_accounts SET month = p_month, used_in_month = v_used WHERE org_id = p_org AND month <> p_month;
  RETURN jsonb_build_object('source', 'none', 'used', v_used, 'free', p_free, 'credits', 0);
END;
$$;

-- Gives back what ps_meter_decision took when no decision was recorded (idempotent replay, refused request).
CREATE FUNCTION ps_unmeter_decision(p_org uuid, p_month text, p_source text, p_ref text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF p_source = 'free' THEN
    UPDATE billing_accounts SET used_in_month = greatest(used_in_month - 1, 0) WHERE org_id = p_org AND month = p_month;
  ELSIF p_source = 'credit' THEN
    UPDATE billing_accounts SET credits = credits + 1, used_in_month = greatest(used_in_month - 1, 0) WHERE org_id = p_org;
    INSERT INTO credit_ledger (org_id, kind, credits, reason, ref) VALUES (p_org, 'refund', 1, 'no decision recorded', p_ref);
  END IF;
END;
$$;

-- Credits one confirmed purchase event exactly once: the ledger's unique (chain, tx, log) index makes a
-- second call a no-op. Returns the organization credited, or null (unknown account or already recorded).
CREATE FUNCTION ps_credit_purchase(p jsonb) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE
  v_org uuid;
BEGIN
  SELECT org_id INTO v_org FROM billing_accounts WHERE purchase_account = p->>'account' FOR UPDATE;
  IF v_org IS NULL THEN RETURN NULL; END IF;
  INSERT INTO credit_ledger (org_id, kind, credits, reason, ref, chain_id, tx_hash, log_index, asset, amount_paid, usd_micros, burned, payer, block_number)
  VALUES (v_org, 'purchase', (p->>'credits')::bigint, 'credits purchased on chain', p->>'account', (p->>'chain_id')::int, p->>'tx_hash',
          (p->>'log_index')::int, p->>'asset', (p->>'amount_paid')::numeric, (p->>'usd_micros')::bigint, (p->>'burned')::numeric, p->>'payer', (p->>'block_number')::bigint)
  ON CONFLICT (chain_id, tx_hash, log_index) WHERE tx_hash IS NOT NULL DO NOTHING;
  IF NOT FOUND THEN RETURN NULL; END IF;
  UPDATE billing_accounts SET credits = credits + (p->>'credits')::bigint WHERE org_id = v_org;
  RETURN v_org;
END;
$$;

-- Counts one PALISEC Agent request for today (UTC) if the plan's daily limit allows it, in one statement.
CREATE FUNCTION ps_count_agent_request(p_org uuid, p_limit integer) RETURNS boolean LANGUAGE plpgsql AS $$
DECLARE
  v_today date := (now() AT TIME ZONE 'UTC')::date;
BEGIN
  INSERT INTO billing_accounts (org_id) VALUES (p_org) ON CONFLICT (org_id) DO NOTHING;
  UPDATE billing_accounts
     SET agent_requests = CASE WHEN agent_day = v_today THEN agent_requests + 1 ELSE 1 END, agent_day = v_today
   WHERE org_id = p_org AND (agent_day IS DISTINCT FROM v_today OR agent_requests < p_limit);
  RETURN FOUND;
END;
$$;
