"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

const clamp = (x: number, a = 0, b = 1) => Math.max(a, Math.min(b, x));
const easeOut = (t: number) => 1 - Math.pow(1 - t, 4);
const reduced = () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Runs `fn` once when the element's top is within `px` of the viewport top edge... bottom. */
function useOnce<T extends HTMLElement>(offsetFromTop: number, fn: (el: T) => void) {
  const ref = useRef<T>(null);
  const fnRef = useRef(fn);
  useEffect(() => {
    fnRef.current = fn;
  });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let done = false;
    let raf = 0;
    const check = () => {
      raf = 0;
      if (done) return;
      if (el.getBoundingClientRect().top < offsetFromTop) {
        done = true;
        window.removeEventListener("scroll", onScroll);
        fnRef.current(el);
      }
    };
    const onScroll = () => { if (!raf) raf = requestAnimationFrame(check); };
    window.addEventListener("scroll", onScroll, { passive: true });
    check();
    return () => { window.removeEventListener("scroll", onScroll); cancelAnimationFrame(raf); };
  }, [offsetFromTop]);
  return ref;
}

/** "The line" statement: words light up in order over the 700 px of scrolling before it reaches the top area. */
export function Statement({ text, endWords = 4 }: { text: string; endWords?: number }) {
  const ref = useRef<HTMLParagraphElement>(null);
  const words = text.split(" ");
  useEffect(() => {
    const el = ref.current;
    if (!el || reduced()) return;
    const spans = Array.from(el.querySelectorAll<HTMLSpanElement>(".sw"));
    let raf = 0;
    let lit = -1;
    const update = () => {
      raf = 0;
      const top = el.getBoundingClientRect().top;
      const target = window.innerHeight * 0.2;
      // 0 when the paragraph is 700 px below the top area, 1 when it reaches it.
      const p = clamp((target + 700 - top) / 700);
      const n = Math.floor(p * spans.length * 1.05);
      if (n === lit) return;
      lit = n;
      spans.forEach((s, i) => { if (i < n) s.setAttribute("data-lit", ""); else s.removeAttribute("data-lit"); });
    };
    const onScroll = () => { if (!raf) raf = requestAnimationFrame(update); };
    window.addEventListener("scroll", onScroll, { passive: true });
    update();
    return () => { window.removeEventListener("scroll", onScroll); cancelAnimationFrame(raf); };
  }, []);
  return (
    <p ref={ref} data-statement className="t-statement text-mist">
      {words.map((w, i) => (
        <span key={i}>
          <span className={`sw ${i >= words.length - endWords ? "end" : ""}`}>{w}</span>
          {i < words.length - 1 ? " " : ""}
        </span>
      ))}
    </p>
  );
}

export interface LimitRowData {
  id: string;
  word: string;
  text: string;
  code: string;
  viz: "spend" | "loss" | "approve" | "vote" | "stop" | "delay" | "assets";
}

/** An illustration of how a rule looks: never live data, never a time like "today". */
function Viz({ kind, p }: { kind: LimitRowData["viz"]; p: number }) {
  const lab = "mb-3 flex justify-between font-mono text-[12.5px] text-silver";
  const meter = (pct: number, deny: boolean) => (
    <div className="h-2 overflow-hidden rounded-full bg-line">
      <div className={`h-full origin-left rounded-full ${deny ? "bg-deny" : "bg-aqua"}`} style={{ transform: `scaleX(${clamp(pct / 100)})` }} />
    </div>
  );
  if (kind === "spend") {
    const v = Math.min(500, Math.round(540 * p));
    return <div><div className={lab}><span>hourly budget</span><span>${v} / $500</span></div>{meter(v / 5, v >= 500)}{v >= 500 ? <div className={`${lab} mt-3 !text-deny`}><span>● blocked</span></div> : null}</div>;
  }
  if (kind === "loss") {
    const v = 5.4 * p;
    return <div><div className={lab}><span>drawdown</span><span>−{v.toFixed(1)}% / 5%</span></div>{meter((v / 5) * 100, v >= 5)}{v >= 5 ? <div className={`${lab} mt-3 !text-deny`}><span>● agent stopped</span></div> : null}</div>;
  }
  if (kind === "approve") {
    return <div><div className={lab}><span>$2,150 › $2,000 threshold</span></div><div className={`${lab} ${p > 0.6 ? "!text-allow" : "!text-review"}`}><span>{p > 0.6 ? "● approved by a member" : "● held for a person"}</span></div></div>;
  }
  if (kind === "vote") {
    const f = 72 * p;
    const a = 28 * p;
    return (
      <div>
        <div className={lab}><span>for {Math.round(f)}%</span><span>against {Math.round(a)}%</span></div>
        <div className="flex h-2 overflow-hidden rounded-full bg-line"><div className="h-full bg-aqua" style={{ width: `${f}%` }} /><div className="h-full bg-deny/60" style={{ width: `${a}%` }} /></div>
      </div>
    );
  }
  if (kind === "stop") {
    return <div className={`${lab} ${p > 0.4 ? "!text-deny" : "!text-allow"}`}><span>{p > 0.4 ? "● stopped · held by the account" : "● running"}</span></div>;
  }
  if (kind === "delay") {
    const s = 86400 - Math.floor(p * 40);
    const hh = String(Math.floor(s / 3600)).padStart(2, "0");
    const mm = String(Math.floor((s % 3600) / 60)).padStart(2, "0");
    const ss = String(s % 60).padStart(2, "0");
    return <div><div className={lab}><span>$500 → $2,000 / hour</span></div><div className="font-mono text-[30px] tabular-nums text-review">{hh}:{mm}:{ss}</div></div>;
  }
  return <div><div className={lab}><span>sell leg simulated</span></div><div className={`${lab} ${p > 0.4 ? "!text-deny" : ""}`}><span>{p > 0.4 ? "● 20% sell tax · blocked" : "checking…"}</span></div></div>;
}

function VizPlayer({ kind, play }: { kind: LimitRowData["viz"]; play: boolean }) {
  const [p, setP] = useState(1);
  const started = useRef(false);
  useEffect(() => {
    if (!play || reduced()) return;
    started.current = true;
    let raf = 0;
    const t0 = performance.now();
    const tick = (now: number) => {
      const q = easeOut(clamp((now - t0 - 150) / 1100));
      setP(q);
      if (q < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [play]);
  return <Viz kind={kind} p={p} />;
}

/** The limits list: the row whose centre is closest to 52% of the viewport is active. */
export function LimitsList({ rows, wordClass = "t-giant" }: { rows: LimitRowData[]; wordClass?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(-1);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const items = Array.from(el.querySelectorAll<HTMLElement>(".limit-row"));
    let raf = 0;
    const update = () => {
      raf = 0;
      const mid = window.innerHeight * 0.52;
      let best = -1;
      let dist = Infinity;
      items.forEach((r, i) => {
        const b = r.getBoundingClientRect();
        if (b.bottom < 0 || b.top > window.innerHeight) return;
        const d = Math.abs(b.top + b.height / 2 - mid);
        if (d < dist) { dist = d; best = i; }
      });
      setActive(best);
    };
    const onScroll = () => { if (!raf) raf = requestAnimationFrame(update); };
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    update();
    return () => { window.removeEventListener("scroll", onScroll); window.removeEventListener("resize", onScroll); cancelAnimationFrame(raf); };
  }, []);
  return (
    <div ref={ref}>
      {rows.map((r, i) => (
        <div key={r.id} id={r.id} className="limit-row" data-on={i === active ? "" : undefined}>
          <div className="split py-8">
            <div className="split-l min-w-0 space-y-3 pt-2">
              <p className="ld text-[clamp(17px,1.1vw,21px)] leading-[1.45]">{r.text}</p>
              <p className="lc font-mono text-[13px]">{r.code}</p>
            </div>
            <div className="split-r grid min-w-0 items-start gap-6 lg:grid-cols-[1fr_340px]">
              <p className={`lw ${wordClass}`}>{r.word}</p>
              <div className="lv pt-3" aria-hidden>
                <VizPlayer kind={r.viz} play={i === active} />
              </div>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

/** Proof: when the section's top is 500 px into the viewport, the totals count up and the rows draw in, once. */
export function ProofReveal({ totals, children }: { totals: { value: number | null; id: string }[]; children: ReactNode }) {
  const ref = useOnce<HTMLDivElement>(typeof window === "undefined" ? 0 : window.innerHeight - 500, (el) => {
    el.querySelector(".proof-rows")?.setAttribute("data-on", "");
    if (reduced()) return;
    const els = totals.map((t) => el.querySelector<HTMLElement>(`[data-total="${t.id}"]`));
    const t0 = performance.now();
    const tick = (now: number) => {
      const p = easeOut(clamp((now - t0 - 200) / 1600));
      totals.forEach((t, i) => { const e = els[i]; if (e && t.value !== null) e.textContent = Math.round(t.value * p).toLocaleString("en-US"); });
      if (p < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  return <div ref={ref}>{children}</div>;
}

/** The registry address types itself across the line; left of the line it is mist, right of it aqua. */
export function TypedAddress({ address, caption, href }: { address: string; caption: ReactNode; href: string }) {
  const chars = address.split("");
  const wrap = useRef<HTMLDivElement>(null);
  const ref = useOnce<HTMLDivElement>(typeof window === "undefined" ? 0 : window.innerHeight - 200, (el) => {
    const spans = Array.from(el.querySelectorAll<HTMLSpanElement>(".type-ch"));
    if (reduced()) { spans.forEach((s) => s.setAttribute("data-on", "")); el.setAttribute("data-typed", ""); return; }
    const t0 = performance.now();
    const tick = (now: number) => {
      const n = Math.floor(clamp((now - t0 - 600) / 1600) * spans.length);
      spans.forEach((s, i) => { if (i < n) s.setAttribute("data-on", ""); });
      if (now - t0 > 2300) el.setAttribute("data-typed", "");
      if (n < spans.length || now - t0 <= 2300) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  // Color each character by which side of the line it sits on.
  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const paint = () => {
      const line = document.querySelector(".the-line")?.getBoundingClientRect().left ?? window.innerWidth * 0.39583;
      el.querySelectorAll<HTMLSpanElement>(".type-ch").forEach((s) => {
        const b = s.getBoundingClientRect();
        s.style.color = b.left + b.width / 2 < line ? "var(--color-mist)" : "var(--color-aqua)";
      });
    };
    document.fonts.ready.then(paint);
    window.addEventListener("resize", paint);
    return () => window.removeEventListener("resize", paint);
  }, []);
  return (
    <div ref={ref} className="px-5 text-center">
      <a ref={wrap as never} href={href} target="_blank" rel="noopener noreferrer" className="inline-block whitespace-nowrap font-mono text-[clamp(13px,2.9vw,56px)] tracking-[-0.02em]" aria-label={`Policy registry v3 ${address} on the explorer`}>
        {chars.map((c, i) => <span key={i} className="type-ch">{c}</span>)}
        <span aria-hidden className="caret">▍</span>
      </a>
      <p className="type-caption t-label mt-6">{caption}</p>
    </div>
  );
}

/** Closing: the two halves meet at the line, once, when the section enters. */
export function Closing({ children }: { children: ReactNode }) {
  const ref = useOnce<HTMLDivElement>(typeof window === "undefined" ? 0 : window.innerHeight - 200, (el) => el.setAttribute("data-met", ""));
  return <div ref={ref}>{children}</div>;
}
