import type { ReactNode } from "react";
import { Cube } from "./cube";

/**
 * The single cream reversal per page. Large translucent cube clusters float at both
 * edges. Generated renders at /media/cubes-left.png and /media/cubes-right.png replace
 * the CSS clusters when present.
 */
const LEFT = [
  { s: 150, x: "-4%", y: "12%", sec: 34, delay: "0s" },
  { s: 90, x: "9%", y: "56%", sec: 26, delay: "-6s" },
  { s: 56, x: "1%", y: "78%", sec: 22, delay: "-3s" },
];
const RIGHT = [
  { s: 170, x: "-6%", y: "30%", sec: 38, delay: "-9s" },
  { s: 84, x: "10%", y: "8%", sec: 24, delay: "-2s" },
  { s: 60, x: "4%", y: "76%", sec: 20, delay: "-5s" },
];

export function ReversalBand({ children, clusterImages }: { children: ReactNode; clusterImages?: { left: string; right: string } }) {
  return (
    <section className="relative overflow-hidden bg-cream text-carbon">
      {/* Daylight from above, falling off toward the dark bands either side */}
      <div aria-hidden className="pointer-events-none absolute inset-0 bg-[radial-gradient(70%_70%_at_50%_0%,#fbfcf4,transparent_70%),linear-gradient(180deg,transparent_60%,rgb(13_14_10/0.06))]" />
      <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-citrine to-transparent" />
      <div aria-hidden className="pointer-events-none absolute inset-y-0 left-0 hidden w-[26%] md:block">
        {clusterImages ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={clusterImages.left} alt="" className="h-full w-full animate-float object-contain object-left" />
        ) : (
          LEFT.map((c, i) => <Floating key={i} {...c} side="left" />)
        )}
      </div>
      <div aria-hidden className="pointer-events-none absolute inset-y-0 right-0 hidden w-[26%] md:block">
        {clusterImages ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={clusterImages.right} alt="" className="h-full w-full animate-float object-contain object-right [animation-delay:-3s]" />
        ) : (
          RIGHT.map((c, i) => <Floating key={i} {...c} side="right" />)
        )}
      </div>
      <div className="relative mx-auto max-w-[1280px] px-4 py-24 text-center sm:px-8 sm:py-32">{children}</div>
    </section>
  );
}

function Floating({ s, x, y, sec, delay, side }: { s: number; x: string; y: string; sec: number; delay: string; side: "left" | "right" }) {
  return (
    <div className="absolute animate-float" style={{ [side]: x, top: y, animationDelay: delay, animationDuration: `${6 + s / 40}s` }}>
      <Cube size={s} spinSeconds={sec} style={{ animationDelay: delay }} />
    </div>
  );
}
