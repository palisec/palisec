"use client";

import { usePathname, useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";

/**
 * Console session. Every console page needs a signed-in member: an expired or revoked session is
 * cleared and sent to /login. If the control plane cannot be reached the console shows that and does
 * nothing (fail closed); it never falls back to example data.
 */

export type Role = "owner" | "admin" | "operator" | "approver" | "viewer";
export interface Org {
  id: string;
  name: string;
  role: Role;
}
export interface Me {
  address: string;
  organizations: Org[];
}
export type Status = "loading" | "ready" | "unavailable" | "no_org";

interface SessionValue {
  status: Status;
  me: Me | null;
  org: Org | null;
  setOrgId: (id: string) => void;
  /** Bumped after any change, so views and the shell refetch. */
  version: number;
  refresh: () => void;
}

const Ctx = createContext<SessionValue | null>(null);
const ORG_KEY = "rw.console.org";

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

let currentOrg: string | null = null;

/** Same-origin JSON call with the selected organization. Throws ApiError with the stable code. */
export async function api<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const headers: Record<string, string> = {};
  if (init.body !== undefined) headers["content-type"] = "application/json";
  if (currentOrg) headers["x-rw-org"] = currentOrg;
  const res = await fetch(`/api/v1${path}`, {
    method: init.method ?? "GET",
    headers,
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
    credentials: "same-origin",
    cache: "no-store",
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, body?.error?.code ?? "RW_STATE_001", body?.error?.message ?? `Request failed (${res.status})`);
  return body as T;
}

export function ConsoleSessionProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [me, setMe] = useState<Me | null>(null);
  const [status, setStatus] = useState<Status>("loading");
  const [orgId, setOrgIdState] = useState<string | null>(null);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let live = true;
    fetch("/api/v1/me", { credentials: "same-origin", cache: "no-store" })
      .then(async (r) => {
        if (!live) return;
        if (r.status === 401) {
          // Expired or revoked: clear the cookie so the entry redirect does not loop, then sign in again.
          await fetch("/api/v1/auth/logout", { method: "POST", credentials: "same-origin" }).catch(() => null);
          router.replace(`/login?next=${encodeURIComponent(pathname)}`);
          return;
        }
        if (!r.ok) return setStatus("unavailable");
        const m = (await r.json()) as Me;
        setMe(m);
        if (!m.organizations?.length) return setStatus("no_org");
        const saved = localStorage.getItem(ORG_KEY);
        const id = m.organizations.some((o) => o.id === saved) ? saved! : m.organizations[0]!.id;
        currentOrg = id;
        setOrgIdState(id);
        setStatus("ready");
      })
      .catch(() => live && setStatus("unavailable"));
    return () => {
      live = false;
    };
    // The session is checked once per console visit; pages refetch their own data.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setOrgId = useCallback((id: string) => {
    currentOrg = id;
    localStorage.setItem(ORG_KEY, id);
    setOrgIdState(id);
    setVersion((v) => v + 1);
  }, []);

  const org = me?.organizations.find((o) => o.id === orgId) ?? null;
  const refresh = useCallback(() => setVersion((v) => v + 1), []);

  return <Ctx.Provider value={{ status, me, org, setOrgId, version, refresh }}>{children}</Ctx.Provider>;
}

export function useConsoleSession(): SessionValue {
  const v = useContext(Ctx);
  if (!v) throw new Error("ConsoleSessionProvider missing");
  return v;
}

/** Fetches a live resource; refetches when the session version changes or `reload` is called. */
export function useLive<T>(path: string | null) {
  const { version, status } = useConsoleSession();
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!path || status !== "ready") return;
    let live = true;
    api<T>(path)
      .then((d) => {
        if (!live) return;
        setData(d);
        setError(null);
      })
      .catch((e) => live && setError(e instanceof ApiError ? e : new ApiError(0, "RW_STATE_001", "Network error")));
    return () => {
      live = false;
    };
  }, [path, version, tick, status]);
  return { data, error, reload: () => setTick((t) => t + 1), loading: data === null && error === null };
}

export const can = {
  manage: (r?: Role) => r === "owner" || r === "admin",
  operate: (r?: Role) => r === "owner" || r === "admin" || r === "operator",
  approve: (r?: Role) => r === "owner" || r === "admin" || r === "approver",
  own: (r?: Role) => r === "owner",
};
