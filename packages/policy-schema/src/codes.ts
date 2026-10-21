/**
 * Stable, machine-readable reason codes (spec §5.7).
 * Codes are append-only: never renumber or reuse a code.
 */
export const REASON_CODES = {
  RW_AUTH_001: "Authentication failed",
  RW_POLICY_001: "No valid active policy",
  RW_POLICY_002: "Explicit deny rule matched",
  RW_TARGET_001: "Target contract not allowed",
  RW_METHOD_001: "Function selector not allowed",
  RW_BUDGET_001: "Budget limit exceeded",
  RW_RATE_001: "Rate limit exceeded",
  RW_LOOP_001: "Repeated intent or calldata detected",
  RW_REPLAY_001: "Duplicate or expired authorization",
  RW_ATTEST_001: "Enclave attestation invalid",
  RW_SIM_001: "Simulation failed",
  RW_FEE_001: "Fee estimation unavailable or invalid",
  RW_HUMAN_001: "Human approval required",
  RW_PAUSED_001: "Agent or account is paused",
  RW_STATE_001: "Authoritative state unavailable",
  RW_CHAIN_001: "Chain or bundler unavailable",
  // Extension to the §5.7 table: request schema failures need their own code.
  RW_REQUEST_001: "Request failed schema validation",
} as const;

export type ReasonCode = keyof typeof REASON_CODES;

/** Whether a client may retry the same request after the condition clears. */
export const RETRYABLE: Record<ReasonCode, boolean> = {
  RW_AUTH_001: false,
  RW_POLICY_001: false,
  RW_POLICY_002: false,
  RW_TARGET_001: false,
  RW_METHOD_001: false,
  RW_BUDGET_001: true,
  RW_RATE_001: true,
  RW_LOOP_001: false,
  RW_REPLAY_001: false,
  RW_ATTEST_001: true,
  RW_SIM_001: false,
  RW_FEE_001: true,
  RW_HUMAN_001: false,
  RW_PAUSED_001: true,
  RW_STATE_001: true,
  RW_CHAIN_001: true,
  RW_REQUEST_001: false,
};
