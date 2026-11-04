"use client";

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";

/**
 * Live console state. Signed-in members see their organization's real data; everyone else keeps the
 * browser simulation. A signed-in member can still switch to the simulation to experiment.
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
export type Mode = "loading" | "simulation" | "live";

interface SessionValue {
  mode: Mode;
  me: Me | null;
  org: Org | null;
  setOrgId: (id: string) => void;
  preferSimulation: (on: boolean) => void;
  /** Bumped after any change, so views and the shell refetch. */
  version: number;
  refresh: () => void;
}

const Ctx = createContext<SessionValue | null>(null);
const SIM_KEY = "rw.console.preferSimulation";
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
  const [me, setMe] = useState<Me | null>(null);
  const [checked, setChecked] = useState(false);
  // The mode stays "loading" until the session check finishes, so server and client render alike.
  const [simPref, setSimPref] = useState(() => typeof window !== "undefined" && localStorage.getItem(SIM_KEY) === "1");
  const [orgId, setOrgIdState] = useState<string | null>(null);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    // Without a session cookie the server answers 401 without touching the database.
    fetch("/api/v1/me", { credentials: "same-origin", cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((m: Me | null) => {
        if (m?.organizations?.length) {
          const saved = localStorage.getItem(ORG_KEY);
          const id = m.organizations.some((o) => o.id === saved) ? saved! : m.organizations[0]!.id;
          currentOrg = id;
          setOrgIdState(id);
          setMe(m);
        }
      })
      .catch(() => null)
      .finally(() => setChecked(true));
  }, []);

  const setOrgId = useCallback((id: string) => {
    currentOrg = id;
    localStorage.setItem(ORG_KEY, id);
    setOrgIdState(id);
    setVersion((v) => v + 1);
  }, []);

  const preferSimulation = useCallback((on: boolean) => {
    localStorage.setItem(SIM_KEY, on ? "1" : "0");
    setSimPref(on);
  }, []);

  const mode: Mode = !checked ? "loading" : me && !simPref ? "live" : "simulation";
  const org = me?.organizations.find((o) => o.id === orgId) ?? null;
  const refresh = useCallback(() => setVersion((v) => v + 1), []);

  return <Ctx.Provider value={{ mode, me, org, setOrgId, preferSimulation, version, refresh }}>{children}</Ctx.Provider>;
}

export function useConsoleSession(): SessionValue {
  const v = useContext(Ctx);
  if (!v) throw new Error("ConsoleSessionProvider missing");
  return v;
}

/** Fetches a live resource; refetches when the session version changes or `reload` is called. */
export function useLive<T>(path: string | null) {
  const { version, mode } = useConsoleSession();
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!path || mode !== "live") return;
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
  }, [path, version, tick, mode]);
  return { data, error, reload: () => setTick((t) => t + 1), loading: data === null && error === null };
}

export const can = {
  manage: (r?: Role) => r === "owner" || r === "admin",
  operate: (r?: Role) => r === "owner" || r === "admin" || r === "operator",
  approve: (r?: Role) => r === "owner" || r === "admin" || r === "approver",
  own: (r?: Role) => r === "owner",
};

/** Renders the live view for signed-in members and the simulation otherwise. */
export function ModeView({ live, simulation }: { live: ReactNode; simulation: ReactNode }) {
  const { mode } = useConsoleSession();
  if (mode === "loading") return <p className="py-10 text-center font-utility text-[11px] uppercase tracking-[0.08em] text-dim">Loading console…</p>;
  return <>{mode === "live" ? live : simulation}</>;
}
