"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { SEED_END, SIM_VERSION, seedState, sweep, type SimState } from "./console-sim";

/**
 * Browser-only store for the console simulation. State lives in this tab's
 * localStorage and nowhere else. The simulated clock runs in real time from the end
 * of the seeded history, so approval countdowns and reservation expiries are live;
 * "advance" moves it forward without waiting.
 */

const KEY = "rw-console-sim";
const SEED = seedState();

interface Persisted {
  state: SimState;
  /** Simulated unix seconds at `anchorReal`. */
  anchorSim: number;
  /** Real epoch milliseconds when the anchor was taken. */
  anchorReal: number;
}

let current: Persisted | null = null;
const listeners = new Set<() => void>();

function fresh(): Persisted {
  return { state: SEED, anchorSim: SEED_END, anchorReal: Date.now() };
}

function load(): Persisted {
  if (current) return current;
  try {
    const raw = window.localStorage.getItem(KEY);
    const parsed = raw ? (JSON.parse(raw) as Persisted) : null;
    current = parsed && parsed.state?.sim_version === SIM_VERSION ? parsed : fresh();
  } catch {
    current = fresh();
  }
  return current;
}

function persist() {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(current));
  } catch {
    // Storage blocked or full: the workspace still works for this tab.
  }
}

export function simNow(): number {
  const p = load();
  return p.anchorSim + Math.floor((Date.now() - p.anchorReal) / 1000);
}

function emit() {
  persist();
  listeners.forEach((l) => l());
}

/** Apply a pure transition at the current simulated time. Expired approvals are swept first. */
export function commit(fn: (s: SimState, now: number) => SimState) {
  const p = load();
  const now = simNow();
  const next = fn(sweep(p.state, now), now);
  current = { ...p, state: next };
  emit();
}

/** Move the simulated clock forward without waiting. */
export function advance(seconds: number) {
  const p = load();
  current = { ...p, anchorSim: p.anchorSim + seconds };
  commit((s) => s);
}

export function resetWorkspace() {
  current = fresh();
  emit();
}

function tick() {
  const p = load();
  const next = sweep(p.state, simNow());
  if (next !== p.state) {
    current = { ...p, state: next };
    emit();
  }
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

/** Server and first client render use the seed, so hydration always matches. */
export function useSim(): SimState {
  return useSyncExternalStore(subscribe, () => load().state, () => SEED);
}

/** The simulated clock, re-rendering once a second and sweeping expiries as it goes. */
export function useSimNow(): number {
  const [now, setNow] = useState(SEED_END);
  useEffect(() => {
    const step = () => {
      tick();
      setNow(simNow());
    };
    // Defer the first sweep: an expiry swept mid-hydration would change store data while React is
    // still hydrating a streamed segment, which surfaces as a hydration mismatch.
    let id = 0;
    const start = window.setTimeout(() => {
      step();
      id = window.setInterval(step, 1000);
    }, 1200);
    const unsub = subscribe(() => setNow(simNow()));
    return () => {
      clearTimeout(start);
      clearInterval(id);
      unsub();
    };
  }, []);
  return now;
}

/** Random hex for idempotency keys and simulated secrets. */
export function randomHex(bytes = 16): string {
  const a = new Uint8Array(bytes);
  crypto.getRandomValues(a);
  return Array.from(a, (b) => b.toString(16).padStart(2, "0")).join("");
}
