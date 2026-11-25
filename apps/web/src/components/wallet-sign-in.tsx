"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { rememberWallet } from "@/lib/browser-wallet";

interface Eip1193 {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
}
interface WalletInfo {
  uuid: string;
  name: string;
  icon: string;
  rdns?: string;
  provider: Eip1193;
}
type Health = "loading" | "ok" | "unconfigured" | "unreachable";
type Step = "idle" | "connecting" | "signing" | "verifying" | "error";

const STEP_TEXT: Record<Step, string> = {
  idle: "",
  connecting: "Waiting for the wallet to share an address…",
  signing: "Check your wallet: sign the message to continue.",
  verifying: "Verifying signature…",
  error: "",
};

function utf8ToHex(s: string): string {
  return "0x" + Array.from(new TextEncoder().encode(s), (b) => b.toString(16).padStart(2, "0")).join("");
}

async function api<T>(path: string, init?: RequestInit): Promise<{ ok: boolean; status: number; body: T }> {
  const res = await fetch(path, { ...init, headers: { "content-type": "application/json", ...init?.headers }, credentials: "same-origin", cache: "no-store" });
  return { ok: res.ok, status: res.status, body: (await res.json().catch(() => ({}))) as T };
}

/**
 * Where to go after sign-in. Only console paths are accepted, so a crafted ?next= link cannot send a
 * freshly signed-in user to another site (open redirect).
 */
function nextPath(): string {
  const next = new URLSearchParams(window.location.search).get("next") ?? "";
  return /^\/console(\/[A-Za-z0-9/_-]*)?(\?[A-Za-z0-9_=&%-]*)?$/.test(next) ? next : "/console";
}

/** EIP-6963 discovery: every installed wallet announces itself; window.ethereum is the fallback. */
function useWallets(): WalletInfo[] {
  const [wallets, setWallets] = useState<WalletInfo[]>([]);
  useEffect(() => {
    const found = new Map<string, WalletInfo>();
    const onAnnounce = (e: Event) => {
      const d = (e as CustomEvent).detail as { info: { uuid: string; name: string; icon: string }; provider: Eip1193 };
      if (!d?.info?.uuid || found.has(d.info.uuid)) return;
      found.set(d.info.uuid, { ...d.info, provider: d.provider });
      setWallets([...found.values()]);
    };
    window.addEventListener("eip6963:announceProvider", onAnnounce);
    window.dispatchEvent(new Event("eip6963:requestProvider"));
    const fallback = window.setTimeout(() => {
      const injected = (window as unknown as { ethereum?: Eip1193 }).ethereum;
      if (found.size === 0 && injected) setWallets([{ uuid: "injected", name: "Browser wallet", icon: "", provider: injected }]);
    }, 400);
    return () => {
      window.removeEventListener("eip6963:announceProvider", onAnnounce);
      clearTimeout(fallback);
    };
  }, []);
  return wallets;
}

export function WalletSignIn() {
  const wallets = useWallets();
  const [health, setHealth] = useState<Health>("loading");
  const [me, setMe] = useState<{ address: string } | null>(null);
  // Set when the page has not moved 2 s after the session was created: show a link instead of waiting.
  const [stuck, setStuck] = useState(false);
  /**
   * A full navigation, not the client router: a wallet extension reconnecting (or two extensions
   * competing for window.ethereum) can interrupt a client-side transition and leave the page waiting.
   */
  function openConsole() {
    window.location.assign(nextPath());
    window.setTimeout(() => setStuck(true), 2000);
  }
  const [step, setStep] = useState<Step>("idle");
  const [error, setError] = useState("");

  useEffect(() => {
    let live = true;
    (async () => {
      // Shallow: viewing this page must not wake the database. A real outage surfaces on sign-in.
      const h = await api<{ components?: { database?: string } }>("/api/v1/health?shallow=1").catch(() => null);
      const db = h?.body.components?.database;
      const state: Health = db === "configured" || db === "ok" ? "ok" : db === "unconfigured" ? "unconfigured" : "unreachable";
      if (!live) return;
      setHealth(state);
      if (state === "ok") {
        // Already signed in: go straight to the console.
        const m = await api<{ address: string }>("/api/v1/me").catch(() => null);
        if (live && m?.ok) {
          setMe(m.body);
          openConsole();
        }
      }
    })();
    return () => {
      live = false;
    };
  }, []);

  async function signIn(w: WalletInfo) {
    setError("");
    try {
      setStep("connecting");
      // Ask the wallet to show its account picker, so the member chooses which account signs in.
      // Wallets that do not support it simply skip to the account they already share.
      await w.provider.request({ method: "wallet_requestPermissions", params: [{ eth_accounts: {} }] }).catch((e: { code?: number }) => {
        if (e?.code === 4001) throw e;
      });
      const accounts = (await w.provider.request({ method: "eth_requestAccounts" })) as string[];
      const address = accounts?.[0];
      if (!address) throw new Error("The wallet did not share an address.");
      const chainId = parseInt((await w.provider.request({ method: "eth_chainId" })) as string, 16);

      const ch = await api<{ nonce: string; message: string; error?: { message: string } }>("/api/v1/auth/challenges", {
        method: "POST",
        body: JSON.stringify({ address, chain_id: chainId }),
      });
      if (!ch.ok) throw new Error(ch.body.error?.message ?? "Could not create a sign-in challenge.");

      setStep("signing");
      const signature = (await w.provider.request({ method: "personal_sign", params: [utf8ToHex(ch.body.message), address] })) as string;

      setStep("verifying");
      const v = await api<{ address: string; error?: { message: string } }>("/api/v1/auth/verify", {
        method: "POST",
        body: JSON.stringify({ nonce: ch.body.nonce, signature }),
      });
      if (!v.ok) throw new Error(v.body.error?.message ?? "Signature verification failed.");
      // The console signs and sends with this same extension, never another one that owns window.ethereum.
      rememberWallet(w);
      setMe({ address: v.body.address });
      setStep("idle");
      openConsole();
    } catch (e) {
      const code = (e as { code?: number }).code;
      setError(code === 4001 ? "Request rejected in the wallet. Nothing was signed." : e instanceof Error ? e.message : "Sign-in failed.");
      setStep("error");
    }
  }

  const busy = step === "connecting" || step === "signing" || step === "verifying";

  if (me) {
    return (
      <div className="space-y-2 px-6 py-6" role="status">
        <p className="font-mono text-[11px] tracking-[0.08em] text-allow">→ SIGNED IN</p>
        <p className="break-all font-mono text-xs text-soft">{me.address}</p>
        <p className="text-sm text-muted">Opening the console…</p>
        {stuck ? (
          <a href={nextPath()} className="inline-block text-sm text-aqua underline underline-offset-4">Open the console</a>
        ) : null}
      </div>
    );
  }

  return (
    <>
      <div className="space-y-3 px-6 py-6">
        {health === "ok" && wallets.length > 0
          ? wallets.map((w) => (
              <button
                key={w.uuid}
                type="button"
                disabled={busy}
                onClick={() => signIn(w)}
                className="flex h-11 w-full items-center justify-between border border-line-strong px-4 text-sm text-fg transition-colors hover:border-aqua/60 disabled:cursor-wait disabled:opacity-60"
              >
                <span className="flex items-center gap-3">
                  {/* eslint-disable-next-line @next/next/no-img-element -- wallet icons are data: URIs announced by the extension */}
                  {w.icon ? <img src={w.icon} alt="" width={18} height={18} className="size-[18px]" /> : null}
                  Sign in with {w.name}
                </span>
                <span className="font-mono text-[10px] text-dim">SIWE</span>
              </button>
            ))
          : (
            <button type="button" disabled className="flex h-11 w-full items-center justify-between border border-line-strong px-4 text-sm text-soft disabled:cursor-not-allowed disabled:opacity-50">
              Sign in with wallet
              <span className="font-mono text-[10px] text-dim">SIWE</span>
            </button>
          )}
        <p aria-live="polite" className="min-h-5 text-xs text-muted">
          {step === "error" ? <span className="text-deny">■ {error}</span> : STEP_TEXT[step]}
        </p>
      </div>
      <div className="border-t border-line px-6 py-4">
        {health === "loading" ? (
          <p className="font-mono text-[11px] tracking-[0.08em] text-dim">CHECKING AUTHENTICATION SERVICE…</p>
        ) : health !== "ok" ? (
          <>
            <p className="font-mono text-[11px] tracking-[0.08em] text-review">
              ◆ AUTHENTICATION SERVICE {health === "unconfigured" ? "NOT CONFIGURED" : "UNREACHABLE"}
            </p>
            <p className="mt-2 text-sm leading-relaxed text-muted">
              Sign-in needs the control-plane database, which {health === "unconfigured" ? "this deployment has not been connected to" : "is not responding"}. Nothing can be authorized while it is down. Check{" "}
              <Link href="/status" className="text-fg underline decoration-line-strong underline-offset-4">status</Link> and try again shortly.
            </p>
          </>
        ) : wallets.length === 0 ? (
          <p className="text-sm leading-relaxed text-muted">
            No browser wallet detected. Install an EIP-1193 wallet extension such as MetaMask or Rabby, then reload. Mobile wallets are not supported yet.
          </p>
        ) : (
          <p className="text-sm leading-relaxed text-muted">
            Your wallet will ask you to sign a message naming this site, a one-time nonce and a five-minute expiry. It is not a transaction, moves no funds and grants no spending permission.
          </p>
        )}
      </div>
    </>
  );
}
