import { RETRYABLE, type ReasonCode } from "@palisec/policy-schema";
import { PalisecApprovalError, PalisecConfigError, PalisecDeniedError, PalisecError, PalisecTimeoutError } from "./errors";
import {
  SUPPORTED_CHAINS,
  type Address,
  type AuthorizationResult,
  type Hex,
  type Intent,
  type LogEvent,
  type Operation,
  type PalisecConfig,
  type SupportedChainId,
} from "./types";

const KEY = /^ps_test_[0-9a-f]{48}$/;
const DEFAULT_BASE = "https://palisec.tech/api/v1";
const RETRY_STATUS = new Set([429, 502, 503, 504]);
const USABLE = new Set(["authorized", "approved"]);

/** Masks Palisec API keys anywhere in a string, for logs and error reports. */
export function redact(text: string): string {
  return text.replace(/ps_test_[0-9a-f]{8,}/g, (k) => `${k.slice(0, 12)}…[redacted]`);
}

/** The minimum of a viem WalletClient that `sendTransaction` needs. */
export interface SendingWallet {
  account?: { address: Address } | null;
  sendTransaction(args: { to: Address; value?: bigint; data?: Hex; gas?: bigint; account?: unknown; chain?: unknown }): Promise<Hex>;
  chain?: unknown;
}

interface RawOperation {
  operation_id: string | null;
  request_id: string;
  decision: Operation["decision"];
  state: Operation["state"];
  reason_code: ReasonCode | null;
  message: string;
  retryable: boolean;
  policy_id: string | null;
  policy_version: number | null;
  authorization_id: string | null;
  expires_at: string | null;
  checks: Operation["checks"];
  dry_run: boolean;
  details?: Record<string, unknown>;
}

function toOperation(r: RawOperation): Operation {
  return {
    operationId: r.operation_id,
    requestId: r.request_id,
    decision: r.decision,
    state: r.state,
    reasonCode: r.reason_code,
    message: r.message,
    retryable: r.retryable,
    policyId: r.policy_id,
    policyVersion: r.policy_version,
    authorizationId: r.authorization_id,
    expiresAt: r.expires_at ? new Date(r.expires_at) : null,
    checks: r.checks ?? [],
    dryRun: r.dry_run,
    ...(r.details ? { details: r.details } : {}),
  };
}

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(t);
      reject(new PalisecTimeoutError("Aborted"));
    });
  });

export class PalisecClient {
  readonly chainId: SupportedChainId;
  private readonly base: string;
  private readonly key: string;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly log: (e: LogEvent) => void;
  private readonly fetchImpl: typeof fetch;

  constructor(config: PalisecConfig) {
    if (!KEY.test(config.apiKey ?? "")) throw new PalisecConfigError("apiKey must be a Palisec agent key (ps_test_ followed by 48 hex characters)");
    const chainId = config.chainId ?? 46630;
    if (!(SUPPORTED_CHAINS as readonly number[]).includes(chainId))
      throw new PalisecConfigError(`chainId ${chainId} is not supported; supported: ${SUPPORTED_CHAINS.join(", ")}`);
    const base = (config.baseUrl ?? DEFAULT_BASE).replace(/\/+$/, "");
    if (!/^https:\/\//.test(base) && !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\//.test(`${base}/`))
      throw new PalisecConfigError("baseUrl must use HTTPS (plain HTTP is allowed only for localhost)");
    this.chainId = chainId;
    this.base = base;
    this.key = config.apiKey;
    this.timeoutMs = config.timeoutMs ?? 15_000;
    this.maxRetries = Math.max(0, Math.min(config.maxRetries ?? 2, 5));
    this.log = config.logger ?? (() => {});
    const f = config.fetch ?? globalThis.fetch;
    if (!f) throw new PalisecConfigError("No fetch implementation available; pass config.fetch (Node 18+ has one built in)");
    this.fetchImpl = f.bind(globalThis);
  }

  /** Converts an intent to the API body. The sender is not sent: it is the agent's registered account. */
  private body(intent: Intent) {
    if (!/^0x[0-9a-fA-F]{40}$/.test(intent.to)) throw new PalisecConfigError("intent.to must be a 20-byte hex address");
    const data = intent.data ?? "0x";
    const deadline = Math.floor(Date.now() / 1000) + Math.min(Math.max(intent.deadlineSeconds ?? 120, 1), 3600);
    const gas = intent.gasLimit ?? (data === "0x" ? 21_000 : 250_000);
    return {
      request_id: intent.requestId ?? crypto.randomUUID(),
      chain_id: this.chainId,
      to: intent.to,
      value_wei: BigInt(intent.value ?? 0).toString(),
      data,
      gas_limit: Number(gas),
      deadline,
    };
  }

  private async request<T>(method: string, path: string, opts: { body?: unknown; idempotencyKey?: string; retry: boolean }): Promise<T> {
    const attempts = opts.retry ? this.maxRetries + 1 : 1;
    let last: unknown;
    for (let attempt = 1; attempt <= attempts; attempt++) {
      const started = Date.now();
      this.log({ type: "request", method, path, attempt });
      try {
        const headers: Record<string, string> = { authorization: `Bearer ${this.key}`, accept: "application/json" };
        if (opts.body !== undefined) headers["content-type"] = "application/json";
        if (opts.idempotencyKey) headers["idempotency-key"] = opts.idempotencyKey;
        const res = await this.fetchImpl(`${this.base}${path}`, {
          method,
          headers,
          body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
          signal: AbortSignal.timeout(this.timeoutMs),
        });
        const text = await res.text();
        let json: Record<string, unknown> = {};
        try {
          json = text ? JSON.parse(text) : {};
        } catch {
          json = {};
        }
        const err = json.error as { code?: string; message?: string; retryable?: boolean } | undefined;
        const requestId = (json.request_id as string | undefined) ?? null;
        this.log({ type: "response", method, path, attempt, status: res.status, requestId, durationMs: Date.now() - started, ...(err?.code ? { code: err.code } : {}) });
        if (res.ok) return json as T;
        const code = err?.code ?? (res.status === 401 ? "PS_AUTH_001" : "PS_STATE_001");
        const retryable = err?.retryable ?? RETRYABLE[code as ReasonCode] ?? RETRY_STATUS.has(res.status);
        last = new PalisecError(redact(err?.message ?? `HTTP ${res.status}`), code, res.status, requestId, retryable);
        if (!(opts.retry && RETRY_STATUS.has(res.status))) throw last;
      } catch (e) {
        if (e instanceof PalisecError && !(opts.retry && e.status !== null && RETRY_STATUS.has(e.status))) throw e;
        if (!(e instanceof PalisecError)) {
          const timedOut = e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError");
          last = timedOut
            ? new PalisecTimeoutError(`${method} ${path} timed out after ${this.timeoutMs} ms`)
            : new PalisecError(`Network error calling ${method} ${path}`, "PS_SDK_NETWORK", null, null, true);
          if (!opts.retry) throw last;
        }
      }
      if (attempt < attempts) {
        const wait = Math.min(250 * 2 ** (attempt - 1), 4000) + Math.floor(Math.random() * 100);
        this.log({ type: "retry", method, path, attempt, durationMs: wait });
        await sleep(wait);
      }
    }
    this.log({ type: "error", method, path, attempt: attempts, code: last instanceof PalisecError ? last.code : "PS_SDK_NETWORK" });
    throw last;
  }

  /**
   * Asks Palisec whether this transaction may be sent, and records the decision with its budget
   * reservation. Safe to retry: the request ID is the idempotency key, so a retry returns the
   * original decision instead of a second one. Returns ALLOW, DENY or REQUIRES_HUMAN_SIGNATURE;
   * it does not throw on DENY. Use `sendTransaction` to have the SDK enforce the decision.
   */
  async authorize(intent: Intent): Promise<AuthorizationResult> {
    const body = this.body(intent);
    const raw = await this.request<RawOperation>("POST", "/operations", { body, idempotencyKey: body.request_id, retry: true });
    return toOperation(raw) as AuthorizationResult;
  }

  /** Dry run: the same evaluation against live state, reserving nothing and recording nothing. */
  async evaluate(intent: Intent): Promise<Operation> {
    return toOperation(await this.request<RawOperation>("POST", "/authorizations/evaluate", { body: this.body(intent), retry: true }));
  }

  /** Reads one of this agent's operations. */
  async getOperation(operationId: string): Promise<Operation> {
    if (!/^[0-9a-f-]{36}$/i.test(operationId)) throw new PalisecConfigError("operationId must be an operation's id");
    return toOperation(await this.request<RawOperation>("GET", `/operations/${operationId}`, { retry: true }));
  }

  /** Withdraws an operation that is still waiting for approval. Authorized operations keep their budget until they expire. */
  async cancel(operationId: string): Promise<Operation> {
    if (!/^[0-9a-f-]{36}$/i.test(operationId)) throw new PalisecConfigError("operationId must be an operation's id");
    return toOperation(await this.request<RawOperation>("POST", `/operations/${operationId}/cancel`, { retry: false }));
  }

  /**
   * Waits for an approver's decision on a held operation. Resolves with the approved operation
   * (now carrying an authorization) or throws PalisecApprovalError if it is rejected, expires or
   * is withdrawn, and PalisecTimeoutError if `timeoutMs` passes first.
   */
  async waitForApproval(operationId: string, opts: { timeoutMs?: number; intervalMs?: number; signal?: AbortSignal } = {}): Promise<Operation> {
    const until = Date.now() + (opts.timeoutMs ?? 15 * 60_000);
    const interval = Math.max(opts.intervalMs ?? 5000, 1000);
    for (;;) {
      const op = await this.getOperation(operationId);
      if (op.state === "approved") return op;
      if (op.state !== "pending_approval") throw new PalisecApprovalError(op);
      if (Date.now() + interval > until) throw new PalisecTimeoutError(`No approval decision for ${operationId} within the timeout`);
      await sleep(interval, opts.signal);
    }
  }

  /**
   * Authorizes, then sends with your viem wallet only if allowed. Throws PalisecDeniedError on
   * DENY (nothing is sent). A held operation is either awaited (`waitForApproval: true`) or
   * returned to you unsent, with `hash: null`, so you can poll it later.
   *
   * The wallet must be the agent's registered account. This enforces the decision in your
   * process only: until the on-chain module ships, a key that skips Palisec can still transact.
   */
  async sendTransaction(
    wallet: SendingWallet,
    intent: Intent,
    opts: { waitForApproval?: boolean; approvalTimeoutMs?: number } = {},
  ): Promise<{ operation: Operation; hash: Hex | null }> {
    const requestId = intent.requestId ?? crypto.randomUUID();
    let op: Operation = await this.authorize({ ...intent, requestId });
    if (op.decision === "DENY") throw new PalisecDeniedError(op);
    if (op.state === "pending_approval") {
      if (!opts.waitForApproval) return { operation: op, hash: null };
      op = await this.waitForApproval(op.operationId!, { ...(opts.approvalTimeoutMs ? { timeoutMs: opts.approvalTimeoutMs } : {}) });
    }
    if (!USABLE.has(op.state) || !op.authorizationId) throw new PalisecDeniedError(op);
    if (op.expiresAt && op.expiresAt.getTime() <= Date.now()) throw new PalisecTimeoutError("The authorization expired before sending");
    const account = typeof op.details?.account === "string" ? (op.details.account as string) : null;
    const sender = wallet.account?.address;
    if (account && sender && account.toLowerCase() !== sender.toLowerCase())
      throw new PalisecConfigError(`The wallet ${sender} is not the agent's registered account ${account}`);
    const hash = await wallet.sendTransaction({
      to: intent.to,
      value: BigInt(intent.value ?? 0),
      data: intent.data ?? "0x",
      gas: BigInt(intent.gasLimit ?? ((intent.data ?? "0x") === "0x" ? 21_000 : 250_000)),
      account: wallet.account ?? undefined,
      chain: wallet.chain,
    });
    return { operation: op, hash };
  }
}

/** Creates a client. Keep the API key server-side. */
export function createPalisec(config: PalisecConfig): PalisecClient {
  return new PalisecClient(config);
}
