"use client";

import { useEffect, useState } from "react";

/** Time left until a unix time, updated every minute: "29 d 23 h left". */
export function Countdown({ until }: { until: number }) {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    const tick = () => setNow(Math.floor(Date.now() / 1000));
    tick();
    const id = window.setInterval(tick, 60_000);
    return () => window.clearInterval(id);
  }, []);
  if (now === null) return null;
  const left = until - now;
  if (left <= 0) return <span>lock ended</span>;
  const d = Math.floor(left / 86400);
  const h = Math.floor((left % 86400) / 3600);
  const m = Math.floor((left % 3600) / 60);
  return <span className="tabular-nums">{d > 0 ? `${d} d ${h} h left` : `${h} h ${m} min left`}</span>;
}
