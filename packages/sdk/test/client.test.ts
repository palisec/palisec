import { describe, expect, it, vi } from "vitest";
import {
  createPalisec,
  PalisecApprovalError,
  PalisecConfigError,
  PalisecDeniedError,
  PalisecError,
  PalisecTimeoutError,
  redact,
  type LogEvent,
} from "../src/index";

const KEY = `ps_test_${"ab".repeat(24)}`;
const TO = "0x2222222222222222222222222222222222222222" as const;
const ACCOUNT = "0x1111111111111111111111111111111111111111" as const;
const OP_ID = "11111111-2222-3333-4444-555555555555";

const op = (over: Record<string, unknown> = {}) => ({
  operation_id: OP_ID,
  request_id: "r1",
  decision: "ALLOW",
  state: "authorized",
  reason_code: null,
  message: "Authorized.",
  retryable: false,
  policy_id: "p",
  policy_version: 1,
  authorization_id: "ps_auth_x",
  expires_at: new Date(Date.now() + 300_000).toISOString(),
  checks: [],
  dry_run: false,
  details: { account: ACCOUNT },
  ...over,
});

function server(responses: (Response | Error)[]) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    const next = responses.shift();
    if (!next) throw new Error("no more responses");
    if (next instanceof Error) throw next;
    return next;
  });
  return { fetch: fetch as unknown as typeof globalThis.fetch, calls };
}
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("configuration", () => {
  it("rejects malformed keys, unsupported chains and plain HTTP", () => {
    expect(() => createPalisec({ apiKey: "sk_live_x" })).toThrow(PalisecConfigError);
    expect(() => createPalisec({ apiKey: KEY, chainId: 4663 as never })).toThrow(/not supported/);
    expect(() => createPalisec({ apiKey: KEY, baseUrl: "http://example.com/api/v1" })).toThrow(/HTTPS/);
    expect(() => createPalisec({ apiKey: KEY, baseUrl: "http://localhost:3000/api/v1", fetch: server([]).fetch })).not.toThrow();
  });
});

describe("authorize", () => {
  it("sends the request with the key in a header and the request ID as idempotency key", async () => {
    const s = server([json(201, op())]);
    const ps = createPalisec({ apiKey: KEY, fetch: s.fetch });
    const res = await ps.authorize({ to: TO, value: 5n, data: "0xa9059cbb", requestId: "r1" });
    expect(res.decision).toBe("ALLOW");
    expect(res.expiresAt).toBeInstanceOf(Date);
    const { url, init } = s.calls[0]!;
    expect(url).toBe("https://palisec.tech/api/v1/operations");
    const headers = init.headers as Record<string, string>;
    expect(headers.authorization).toBe(`Bearer ${KEY}`);
    expect(headers["idempotency-key"]).toBe("r1");
    const body = JSON.parse(String(init.body));
    expect(body).toMatchObject({ request_id: "r1", chain_id: 46630, to: TO, value_wei: "5", data: "0xa9059cbb", gas_limit: 250000 });
    expect(body).not.toHaveProperty("from");
    expect(url).not.toContain("ps_test_");
  });

  it("returns DENY as a value, not an error", async () => {
    const s = server([json(201, op({ decision: "DENY", state: "denied", reason_code: "PS_BUDGET_001", authorization_id: null, message: "Over budget" }))]);
    const res = await createPalisec({ apiKey: KEY, fetch: s.fetch }).authorize({ to: TO });
    expect(res.decision).toBe("DENY");
    expect(res.reasonCode).toBe("PS_BUDGET_001");
  });

  it("retries 503 and network errors with the same idempotency key, then succeeds", async () => {
    const s = server([json(503, { request_id: "a", error: { code: "PS_STATE_001", message: "down", retryable: true } }), new TypeError("fetch failed"), json(201, op())]);
    const res = await createPalisec({ apiKey: KEY, fetch: s.fetch, maxRetries: 2 }).authorize({ to: TO, requestId: "same" });
    expect(res.decision).toBe("ALLOW");
    expect(s.calls).toHaveLength(3);
    for (const c of s.calls) expect((c.init.headers as Record<string, string>)["idempotency-key"]).toBe("same");
  });

  it("maps API errors to PalisecError with the stable code and does not retry a 409", async () => {
    const s = server([json(409, { request_id: "q", error: { code: "PS_REPLAY_001", message: "request_id already used", retryable: false } })]);
    const err = await createPalisec({ apiKey: KEY, fetch: s.fetch }).authorize({ to: TO }).catch((e) => e);
    expect(err).toBeInstanceOf(PalisecError);
    expect(err).toMatchObject({ code: "PS_REPLAY_001", status: 409, requestId: "q", retryable: false });
    expect(s.calls).toHaveLength(1);
  });

  it("reports a timeout as PalisecTimeoutError", async () => {
    const abort = Object.assign(new Error("timed out"), { name: "TimeoutError" });
    const s = server([abort]);
    const err = await createPalisec({ apiKey: KEY, fetch: s.fetch, maxRetries: 0 }).authorize({ to: TO }).catch((e) => e);
    expect(err).toBeInstanceOf(PalisecTimeoutError);
  });
});

describe("cancel", () => {
  it("is never retried, because it changes state", async () => {
    const s = server([json(503, { error: { code: "PS_STATE_001", message: "down", retryable: true } })]);
    await expect(createPalisec({ apiKey: KEY, fetch: s.fetch }).cancel(OP_ID)).rejects.toBeInstanceOf(PalisecError);
    expect(s.calls).toHaveLength(1);
  });
});

describe("sendTransaction", () => {
  const wallet = () => ({ account: { address: ACCOUNT }, sendTransaction: vi.fn(async () => "0xhash" as `0x${string}`) });

  it("sends only on ALLOW, with the gas the fee was bounded on", async () => {
    const w = wallet();
    const s = server([json(201, op())]);
    const res = await createPalisec({ apiKey: KEY, fetch: s.fetch }).sendTransaction(w, { to: TO, value: 1n });
    expect(res.hash).toBe("0xhash");
    expect(w.sendTransaction).toHaveBeenCalledWith(expect.objectContaining({ to: TO, value: 1n, gas: 21000n }));
  });

  it("never calls the wallet on DENY", async () => {
    const w = wallet();
    const s = server([json(201, op({ decision: "DENY", state: "denied", reason_code: "PS_TARGET_001", authorization_id: null }))]);
    await expect(createPalisec({ apiKey: KEY, fetch: s.fetch }).sendTransaction(w, { to: TO })).rejects.toBeInstanceOf(PalisecDeniedError);
    expect(w.sendTransaction).not.toHaveBeenCalled();
  });

  it("refuses a wallet that is not the agent's registered account", async () => {
    const w = { ...wallet(), account: { address: TO } };
    const s = server([json(201, op())]);
    await expect(createPalisec({ apiKey: KEY, fetch: s.fetch }).sendTransaction(w, { to: TO })).rejects.toBeInstanceOf(PalisecConfigError);
    expect(w.sendTransaction).not.toHaveBeenCalled();
  });

  it("returns a held operation unsent unless asked to wait", async () => {
    const w = wallet();
    const held = op({ decision: "REQUIRES_HUMAN_SIGNATURE", state: "pending_approval", reason_code: "PS_HUMAN_001", authorization_id: null });
    const res = await createPalisec({ apiKey: KEY, fetch: server([json(201, held)]).fetch }).sendTransaction(w, { to: TO });
    expect(res.hash).toBeNull();
    expect(res.operation.state).toBe("pending_approval");
    expect(w.sendTransaction).not.toHaveBeenCalled();
  });

  it("waits for approval, then sends", async () => {
    vi.useFakeTimers();
    const w = wallet();
    const held = op({ decision: "REQUIRES_HUMAN_SIGNATURE", state: "pending_approval", authorization_id: null });
    const approved = op({ decision: "REQUIRES_HUMAN_SIGNATURE", state: "approved", authorization_id: "ps_auth_y" });
    const s = server([json(201, held), json(200, held), json(200, approved)]);
    const p = createPalisec({ apiKey: KEY, fetch: s.fetch }).sendTransaction(w, { to: TO }, { waitForApproval: true });
    await vi.advanceTimersByTimeAsync(6000);
    const res = await p;
    vi.useRealTimers();
    expect(res.hash).toBe("0xhash");
    expect(res.operation.authorizationId).toBe("ps_auth_y");
  });
});

describe("waitForApproval", () => {
  it("throws PalisecApprovalError when rejected", async () => {
    const s = server([json(200, op({ decision: "REQUIRES_HUMAN_SIGNATURE", state: "rejected", authorization_id: null }))]);
    await expect(createPalisec({ apiKey: KEY, fetch: s.fetch }).waitForApproval(OP_ID)).rejects.toBeInstanceOf(PalisecApprovalError);
  });
});

describe("redaction", () => {
  it("masks keys in text and never puts them in log events", async () => {
    expect(redact(`key ${KEY} leaked`)).not.toContain(KEY);
    const events: LogEvent[] = [];
    const s = server([json(201, op())]);
    await createPalisec({ apiKey: KEY, fetch: s.fetch, logger: (e) => events.push(e) }).authorize({ to: TO });
    expect(events.length).toBeGreaterThan(0);
    expect(JSON.stringify(events)).not.toContain(KEY);
  });
});
