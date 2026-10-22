"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";

/** Distance (px) at which a panel's edge starts catching the pointer's light. */
const REACH = 160;

/**
 * One listener lights every on-screen `.panel`: as the pointer approaches, the nearest edge
 * catches a citrine spotlight and the surface a faint sheen, so light moves across the
 * page rather than switching on under the cursor. Only on-screen panels are measured, and
 * nothing is written until the pointer moves, so hydration never sees foreign attributes.
 */
export function PointerLight() {
  const pathname = usePathname();

  useEffect(() => {
    const visible = new Set<HTMLElement>();
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) {
        const el = e.target as HTMLElement;
        if (e.isIntersecting) visible.add(el);
        else visible.delete(el);
      }
    });
    document.querySelectorAll<HTMLElement>(".panel").forEach((el) => io.observe(el));

    const lit = window.matchMedia("(pointer: fine)").matches && !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!lit) return () => io.disconnect();

    let raf = 0;
    let x = -1e4;
    let y = -1e4;
    const paint = () => {
      raf = 0;
      for (const el of visible) {
        const r = el.getBoundingClientRect();
        const d = Math.hypot(Math.max(r.left - x, 0, x - r.right), Math.max(r.top - y, 0, y - r.bottom));
        el.style.setProperty("--mx", `${Math.round(x - r.left)}px`);
        el.style.setProperty("--my", `${Math.round(y - r.top)}px`);
        el.style.setProperty("--glow", Math.max(0, 1 - d / REACH).toFixed(3));
      }
    };
    const schedule = () => {
      if (!raf) raf = requestAnimationFrame(paint);
    };
    const onMove = (e: PointerEvent) => {
      x = e.clientX;
      y = e.clientY;
      schedule();
    };
    const onLeave = () => {
      x = y = -1e4;
      schedule();
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    window.addEventListener("scroll", schedule, { passive: true });
    document.documentElement.addEventListener("pointerleave", onLeave);
    return () => {
      io.disconnect();
      cancelAnimationFrame(raf);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("scroll", schedule);
      document.documentElement.removeEventListener("pointerleave", onLeave);
    };
  }, [pathname]);

  return null;
}
