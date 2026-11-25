"use client";

import { useEffect, useRef } from "react";

export interface StreamItem {
  label: string;
  action: string;
  kind: "pass" | "block" | "held";
  /** Pass: the shortened tx hash; blocked or held: "CODE · meaning". */
  tail: string;
  href: string | null;
}

export interface StreamCounts {
  proposed: number;
  allowed: number;
  blocked: number;
}

/** Lane offsets from the first lane, in px; lanes are tried in this order. */
const LANE_GAP = 56;
const ORDER = [0, 3, 1, 4, 2, 5];
const HOLD = 2.4;
const FADE = 0.5;

const clamp = (x: number, a = 0, b = 1) => Math.max(a, Math.min(b, x));
const easeOut = (t: number) => 1 - Math.pow(1 - t, 4);
const fmt = (n: number) => n.toLocaleString("en-US");

interface Slot {
  item: StreamItem;
  el: HTMLDivElement;
  stamp: HTMLDivElement | null;
  flash: HTMLDivElement;
  tail: HTMLSpanElement;
  w: number;
  spawn: number;
  lane: number;
  state: string;
  counted: boolean;
}

/**
 * The homepage stream: the latest real decisions of the public demo accounts, replayed oldest first, then
 * looping. One requestAnimationFrame loop writes only transform and opacity; it pauses off screen and in a
 * hidden tab. The scheduler is a port of the reference: a new item every 0.6 s into the first free lane.
 */
export function Stream({ items, counts }: { items: StreamItem[]; counts: StreamCounts | null }) {
  const root = useRef<HTMLDivElement>(null);
  const counterRefs = useRef<(HTMLElement | null)[]>([]);

  useEffect(() => {
    const host = root.current;
    if (!host) return;
    const hero = host.closest("section") ?? host;
    const nodes = Array.from(host.querySelectorAll<HTMLDivElement>("[data-item]"));
    let slots: Slot[] = [];
    let X = 0;
    let speed = 0;
    let width = 0;
    let firstLane = 0;
    let cycleEnd = 0;
    let t0 = performance.now() / 1000;
    let pausedAt: number | null = null;
    let raf = 0;
    let visible = true;
    let total = { ...(counts ?? { proposed: 0, allowed: 0, blocked: 0 }) };
    const counterEls = () => {
      const els = document.querySelectorAll<HTMLElement>("[data-counter]");
      counterRefs.current = Array.from(els);
    };

    function measure() {
      const line = document.querySelector(".the-line");
      X = line ? line.getBoundingClientRect().left + 1 : window.innerWidth * 0.39583;
      width = window.innerWidth;
      speed = width * 0.1615;
      firstLane = (hero as HTMLElement).offsetHeight * 0.6;
    }

    function schedule(start: number) {
      const free = ORDER.map(() => -1e9);
      let k = 0;
      slots.forEach((s, i) => {
        const want = start + i * 0.6;
        let pick = 0;
        let best = 1e9;
        for (let j = 0; j < ORDER.length; j++) {
          const L = ORDER[(k + j) % ORDER.length];
          const ok = Math.max(want, free[L]);
          if (ok < best - 1e-6) { best = ok; pick = L; }
        }
        k++;
        s.spawn = best;
        s.lane = firstLane + pick * LANE_GAP;
        s.counted = false;
        const x0 = -s.w - 20;
        const hit = s.spawn + (X - 8 - s.w - x0) / speed;
        free[pick] = s.item.kind === "pass" ? s.spawn + (s.w + 60) / speed : hit + HOLD + FADE - (X - s.w - 18) / speed + 0.3;
      });
      cycleEnd = Math.max(...slots.map((s) => {
        const x0 = -s.w - 20;
        const hit = s.spawn + (X - 8 - s.w - x0) / speed;
        return s.item.kind === "pass" ? s.spawn + (width + s.w + 40) / speed : hit + HOLD + FADE;
      }));
    }

    function frame(now: number) {
      raf = requestAnimationFrame(frame);
      const t = now / 1000 - t0;
      if (t > cycleEnd + 0.5) {
        t0 = now / 1000;
        schedule(0.3);
        return;
      }
      for (const s of slots) {
        const x0 = -s.w - 20;
        const dt = t - s.spawn;
        if (dt < 0) {
          if (s.state !== "wait") { s.el.style.opacity = "0"; s.flash.style.opacity = "0"; if (s.stamp) s.stamp.style.opacity = "0"; s.state = "wait"; s.el.dataset.s = ""; s.tail.textContent = ""; }
          continue;
        }
        const hitT = (X - 8 - s.w - x0) / speed;
        const after = dt - hitT;
        let x = x0 + speed * dt;
        if (after >= 0 && !s.counted) {
          s.counted = true;
          total = { proposed: total.proposed + 1, allowed: total.allowed + (s.item.kind === "pass" ? 1 : 0), blocked: total.blocked + (s.item.kind === "block" ? 1 : 0) };
          const [p, a, b] = counterRefs.current;
          if (p) p.textContent = fmt(total.proposed);
          if (a) a.textContent = fmt(total.allowed);
          if (b) b.textContent = fmt(total.blocked);
        }
        if (s.item.kind === "pass") {
          if (after >= 0) {
            if (s.state !== "pass") { s.el.dataset.s = "pass"; s.tail.textContent = `✓ ${s.item.tail}`; s.state = "pass"; }
            s.flash.style.opacity = String(Math.sin(Math.PI * clamp(after / 0.45)));
          } else if (s.state !== "move") {
            s.el.dataset.s = ""; s.tail.textContent = ""; s.flash.style.opacity = "0"; s.state = "move";
          }
          s.el.style.transform = `translate3d(${x}px, ${s.lane}px, 0)`;
          s.el.style.opacity = String(1 - clamp((x - width * 0.78) / (width * 0.16)));
        } else {
          if (after >= 0) {
            x = X - 8 - s.w;
            if (s.state !== "stop") { s.el.dataset.s = s.item.kind; s.state = "stop"; }
            const shake = Math.sin(clamp(after / 0.3) * Math.PI * 3) * 4 * (1 - clamp(after / 0.3));
            const out = 1 - clamp((after - HOLD) / FADE);
            s.el.style.transform = `translate3d(${x + shake}px, ${s.lane}px, 0)`;
            s.el.style.opacity = String(out);
            s.flash.style.opacity = String(Math.sin(Math.PI * clamp(after / 0.5)));
            if (s.stamp) {
              s.stamp.style.opacity = String(easeOut(clamp(after / 0.3)) * out);
              s.stamp.style.transform = `translate3d(${(1 - easeOut(clamp(after / 0.4))) * -12}px, ${s.lane}px, 0)`;
            }
          } else {
            if (s.state !== "move") { s.el.dataset.s = ""; s.flash.style.opacity = "0"; if (s.stamp) s.stamp.style.opacity = "0"; s.state = "move"; }
            s.el.style.transform = `translate3d(${x}px, ${s.lane}px, 0)`;
            s.el.style.opacity = "1";
          }
        }
        s.flash.style.transform = `translate3d(0, ${s.lane}px, 0)`;
      }
    }

    function start() {
      if (raf || !visible || document.hidden) return;
      if (pausedAt !== null) { t0 += performance.now() / 1000 - pausedAt; pausedAt = null; }
      raf = requestAnimationFrame(frame);
    }
    function stop() {
      if (!raf) return;
      cancelAnimationFrame(raf);
      raf = 0;
      pausedAt = performance.now() / 1000;
    }

    let io: IntersectionObserver | null = null;
    const onVis = () => (document.hidden ? stop() : start());
    let resizeTimer = 0;
    const onResize = () => {
      window.clearTimeout(resizeTimer);
      resizeTimer = window.setTimeout(() => { measure(); t0 = performance.now() / 1000; schedule(0.3); }, 200);
    };
    let cancelled = false;

    document.fonts.ready.then(() => {
      if (cancelled) return;
      counterEls();
      measure();
      slots = nodes.map((el, i) => ({
        item: items[i],
        el,
        stamp: host.querySelector<HTMLDivElement>(`[data-stamp="${i}"]`),
        flash: host.querySelector<HTMLDivElement>(`[data-flash="${i}"]`)!,
        tail: el.querySelector<HTMLSpanElement>(".tail")!,
        w: el.offsetWidth,
        spawn: 0,
        lane: 0,
        state: "",
        counted: false,
      }));
      t0 = performance.now() / 1000;
      // During the opening animation the stream starts at 3.9 s, as the buttons arrive.
      schedule(document.documentElement.classList.contains("intro-page") ? 3.9 : 0.4);
      io = new IntersectionObserver(([e]) => { visible = e.isIntersecting; if (visible) start(); else stop(); });
      io.observe(hero);
      document.addEventListener("visibilitychange", onVis);
      window.addEventListener("resize", onResize);
      start();
    });

    return () => {
      cancelled = true;
      stop();
      io?.disconnect();
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("resize", onResize);
    };
  }, [items, counts]);

  return (
    <div ref={root} aria-hidden className="stream stream-live">
      {items.map((it, i) => (
        <div key={i}>
          <div data-item className="stream-item">
            <span className="ag">{it.label}</span>
            <span>{it.action}</span>
            {it.kind === "pass" && it.href ? (
              <a className="tail" href={it.href} target="_blank" rel="noopener noreferrer" tabIndex={-1} />
            ) : (
              <span className="tail" />
            )}
          </div>
          {it.kind !== "pass" ? (
            <div data-stamp={i} data-k={it.kind} className="stream-stamp">
              <i />
              {it.tail}
            </div>
          ) : null}
          <div data-flash={i} data-k={it.kind} className="stream-flash" />
        </div>
      ))}
    </div>
  );
}
