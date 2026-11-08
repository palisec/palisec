"""Stable reason codes (spec 5.7). Mirrors packages/policy-schema/src/codes.ts; a test keeps them equal."""

from __future__ import annotations

REASON_CODES: dict[str, str] = {
    "PS_AUTH_001": "Authentication failed",
    "PS_POLICY_001": "No valid active policy",
    "PS_POLICY_002": "Explicit deny rule matched",
    "PS_TARGET_001": "Target contract not allowed",
    "PS_METHOD_001": "Function selector not allowed",
    "PS_BUDGET_001": "Budget limit exceeded",
    "PS_RATE_001": "Rate limit exceeded",
    "PS_LOOP_001": "Repeated intent or calldata detected",
    "PS_REPLAY_001": "Duplicate or expired authorization",
    "PS_ATTEST_001": "Enclave attestation invalid",
    "PS_SIM_001": "Simulation failed",
    "PS_FEE_001": "Fee estimation unavailable or invalid",
    "PS_HUMAN_001": "Human approval required",
    "PS_PAUSED_001": "Agent or account is paused",
    "PS_STATE_001": "Authoritative state unavailable",
    "PS_CHAIN_001": "Chain or bundler unavailable",
    "PS_REQUEST_001": "Request failed schema validation",
}

#: Whether a client may retry the same request after the condition clears.
RETRYABLE: dict[str, bool] = {
    "PS_AUTH_001": False,
    "PS_POLICY_001": False,
    "PS_POLICY_002": False,
    "PS_TARGET_001": False,
    "PS_METHOD_001": False,
    "PS_BUDGET_001": True,
    "PS_RATE_001": True,
    "PS_LOOP_001": False,
    "PS_REPLAY_001": False,
    "PS_ATTEST_001": True,
    "PS_SIM_001": False,
    "PS_FEE_001": True,
    "PS_HUMAN_001": False,
    "PS_PAUSED_001": True,
    "PS_STATE_001": True,
    "PS_CHAIN_001": True,
    "PS_REQUEST_001": False,
}
