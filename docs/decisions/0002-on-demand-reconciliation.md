# Decision: reconcile operations on demand, not on a timer

**Status:** Accepted · applies from Part 4 (operations) and Part 9 (bundler submission)

## Context

After an operation is submitted to the bundler, Palisec must learn its outcome (included, reverted, dropped), record the actual fee, and finalize or release its budget reservation (spec §5.6, §6.2). The roadmap originally planned a scheduled job (Vercel Cron) to poll every few minutes.

A review comment proposed reconciling only when someone needs the answer: when the SDK calls `GET /v1/operations/{id}`, when the console opens operations, plus a single delayed check after submission. On a host that sleeps when idle (Railway Serverless) and a database that suspends (Neon Free), a timer would keep both awake and spend credit while nobody is using the product.

## Decision

Adopt on-demand reconciliation, with three amendments that keep it correct.

**Triggers**

1. `GET /v1/operations/{id}`: reconcile that operation before answering.
2. `GET /v1/operations` and the console's operations and dashboard views: reconcile the oldest unresolved operations of that organization, **at most 10 per request**.
3. **Amendment 1: before every `POST /v1/authorizations/evaluate` and `POST /v1/operations`**, reconcile the unresolved operations of the same account and budget window. The comment covered status reads only, but budget headroom matters most at evaluation time. Without this, an agent that never polls would be judged against stale reservations.
4. **One-shot check** about 30 seconds after submission, run as an in-process timer. This is an optimization only. A restart or sleep can lose it, so correctness never depends on it.
5. A **Reconcile now** action in the console for operators.

**Invariants**

- **Amendment 2: unreconciled means still reserved.** A submitted operation keeps its reservation counted against the budget until a verified receipt says otherwise. If nobody asks, budgets become conservative (spend is over-counted), never permissive. This keeps the fail-closed rule (spec §1.2, §13).
- **Expiry is computed, not swept.** Reservations and approvals store `expires_at`; every query treats a past expiry as expired, and the state row is updated the next time it is touched. No timer is needed for expiry.
- **Idempotent and race-safe.** Each transition is a conditional `UPDATE … WHERE state = 'submitted' … RETURNING`. Two requests reconciling the same operation produce exactly one transition and one audit event.
- **Verified receipts only.** Finalize only on a receipt from the configured RPC/bundler at the configured confirmation depth. Disagreement or errors leave the operation pending (spec §13 "RPC disagreement").
- **Bounded cost.** Each operation stores `last_checked_at`; it is checked at most once every 10 seconds, whatever the request volume, and receipts are fetched in one batch per request.

**Amendment 3: visibility.** Because nothing reconciles while nobody is looking, the dashboard and `/api/v1/health` report the **count and age of the oldest unreconciled operation** (spec §7.4 "reservation reconciliation failures"), so a stuck operation is visible rather than silent.

## Consequences

- No cron service and no `CRON_SECRET`. The app and database can sleep when idle.
- The audit trail for an operation nobody looks at stays at "submitted" until the next trigger. This is accepted: the reservation is held, so nothing can be over-spent in the meantime.
- If later traffic shows long-lived unreconciled operations, a low-frequency sweep (e.g. hourly) can be added as a safety net without changing these invariants.

## Corrections to the original comment

- The expensive part of a timer is the RPC and bundler calls and keeping the server awake, not the Postgres queries.
- The "delayed one-shot webhook" needs no external webhook service: it is an in-process delayed task. Bundler-provider webhooks (for example from Alchemy) could replace it later, as long as the same invariants hold.
