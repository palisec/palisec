import "server-only";
import { HttpError } from "../http";

/*
 * Model provider abstraction (spec 2.0 §13). One adapter for the OpenAI-compatible chat-completions
 * API, which Groq (the default, free tier), OpenAI, Google's Gemini endpoint and others accept. The
 * product never depends on one vendor: change PALISEC_AGENT_BASE_URL and PALISEC_AGENT_MODEL.
 * The key stays on the server; it is never sent to a browser.
 */

export interface ToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
}

export interface ToolSpec {
  type: "function";
  function: { name: string; description: string; parameters: Record<string, unknown> };
}

export interface Provider {
  name: string;
  model: string;
  configured: boolean;
  complete(messages: ChatMessage[], tools: ToolSpec[], signal?: AbortSignal): Promise<ChatMessage>;
}

const DEFAULT_BASE = "https://api.groq.com/openai/v1";
const DEFAULT_MODEL = "openai/gpt-oss-120b";
const TIMEOUT_MS = 25_000;

function baseUrl(): string {
  const raw = (process.env.PALISEC_AGENT_BASE_URL || DEFAULT_BASE).replace(/\/+$/, "");
  // A local test model server may use http; never on Vercel.
  if (!raw.startsWith("https://") && !(process.env.VERCEL !== "1" && /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?\//.test(`${raw}/`)))
    throw new HttpError(503, "PS_STATE_001", "PALISEC_AGENT_BASE_URL must be an https URL", false);
  return raw;
}

export function provider(): Provider {
  const key = process.env.PALISEC_AGENT_API_KEY ?? "";
  const model = process.env.PALISEC_AGENT_MODEL || DEFAULT_MODEL;
  const name = process.env.PALISEC_AGENT_PROVIDER || (process.env.PALISEC_AGENT_BASE_URL ? "openai-compatible" : "groq");
  return {
    name,
    model,
    configured: key !== "",
    async complete(messages, tools, signal) {
      if (!key) throw new HttpError(503, "PS_STATE_001", "The PALISEC Agent model is not configured on this deployment (PALISEC_AGENT_API_KEY)", false);
      const res = await fetch(`${baseUrl()}/chat/completions`, {
        method: "POST",
        redirect: "error",
        signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(TIMEOUT_MS)]) : AbortSignal.timeout(TIMEOUT_MS),
        headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
        body: JSON.stringify({
          model,
          messages: messages.map((m) => ({
            role: m.role,
            content: m.content,
            ...(m.tool_calls ? { tool_calls: m.tool_calls } : {}),
            ...(m.tool_call_id ? { tool_call_id: m.tool_call_id } : {}),
          })),
          ...(tools.length ? { tools, tool_choice: "auto" } : {}),
          temperature: 0.2,
          max_tokens: 1500,
        }),
      }).catch(() => null);
      if (!res) throw new HttpError(503, "PS_STATE_001", "The model provider did not respond", true);
      if (res.status === 429) throw new HttpError(429, "PS_RATE_001", "The model provider's free-tier limit was reached. Try again shortly.", true);
      if (!res.ok) throw new HttpError(503, "PS_STATE_001", `The model provider returned HTTP ${res.status}`, true);
      const json = (await res.json().catch(() => null)) as { choices?: { message?: ChatMessage }[] } | null;
      const msg = json?.choices?.[0]?.message;
      if (!msg || (typeof msg.content !== "string" && !Array.isArray(msg.tool_calls)))
        throw new HttpError(503, "PS_STATE_001", "The model provider returned an invalid response", true);
      return {
        role: "assistant",
        content: typeof msg.content === "string" ? msg.content.slice(0, 8000) : null,
        ...(Array.isArray(msg.tool_calls) && msg.tool_calls.length
          ? {
              tool_calls: msg.tool_calls.slice(0, 6).map((t) => ({
                id: String(t.id ?? crypto.randomUUID()).slice(0, 64),
                type: "function" as const,
                function: { name: String(t.function?.name ?? "").slice(0, 64), arguments: String(t.function?.arguments ?? "{}").slice(0, 16_000) },
              })),
            }
          : {}),
      };
    },
  };
}
