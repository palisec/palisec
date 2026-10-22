/** Parse a decimal string into an integer of `decimals` places, without floats. */
export function parseUnits(input: string, decimals: number): bigint | null {
  const m = /^\s*(\d{1,30})(?:\.(\d*))?\s*$/.exec(input);
  if (!m) return null;
  const frac = (m[2] ?? "").slice(0, decimals).padEnd(decimals, "0");
  return BigInt(m[1]!) * 10n ** BigInt(decimals) + BigInt(frac || "0");
}

export function formatUnits(v: string | bigint, decimals: number): string {
  const n = BigInt(v);
  const base = 10n ** BigInt(decimals);
  const frac = (n % base).toString().padStart(decimals, "0").replace(/0+$/, "");
  return frac ? `${n / base}.${frac}` : `${n / base}`;
}

/** 0x1234…cdef */
export function shortHex(v: string, head = 6, tail = 4): string {
  return v.length > head + tail + 1 ? `${v.slice(0, head)}…${v.slice(-tail)}` : v;
}

/** Simulated clock time as an ISO-like UTC string: 2026-01-01 00:14:05 UTC */
export function formatSimTime(unix: number): string {
  return `${new Date(unix * 1000).toISOString().replace("T", " ").slice(0, 19)} UTC`;
}

export function formatDuration(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const m = Math.floor(s / 60);
  return m > 0 ? `${m}m ${String(s % 60).padStart(2, "0")}s` : `${s}s`;
}
