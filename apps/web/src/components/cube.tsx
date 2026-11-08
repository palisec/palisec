import type { CSSProperties } from "react";

/**
 * The Citrine Cube: the only dimensional element in the system. Pure CSS 3D with an
 * inner gradient and a soft outer glow. Decorative, so hidden from assistive tech.
 */
export function Cube({
  size = 120,
  spin = true,
  spinSeconds = 18,
  glow = true,
  tilt,
  className = "",
  style,
}: {
  size?: number;
  spin?: boolean;
  spinSeconds?: number;
  glow?: boolean;
  /** Static rotation when not spinning, e.g. "rotateX(-20deg) rotateY(30deg)". */
  tilt?: string;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <div
      aria-hidden
      className={`cube-scene relative ${className}`}
      style={{ "--s": `${size}px`, "--spin": `${spinSeconds}s`, ...style } as CSSProperties}
    >
      {glow && <div className="cube-glow" />}
      <div className="cube" data-spin={spin} style={tilt && !spin ? { transform: tilt } : undefined}>
        {["f1", "f2", "f3", "f4", "f5", "f6"].map((f) => (
          <div key={f} className={`cube-face ${f}`} />
        ))}
      </div>
    </div>
  );
}

/** Flat cube glyph for small inline uses (buttons, list markers). */
export function CubeGlyph({ size = 14, className = "" }: { size?: number; className?: string }) {
  return (
    <svg aria-hidden width={size} height={size} viewBox="0 0 16 16" className={className}>
      <path d="M8 1 14.5 4.75v6.5L8 15 1.5 11.25v-6.5Z" fill="#9cf6ee" fillOpacity="0.9" />
      <path d="M8 1 14.5 4.75 8 8.5 1.5 4.75Z" fill="#cbfffc" />
      <path d="M8 8.5V15" stroke="#111" strokeOpacity="0.35" />
    </svg>
  );
}

/** 3×3 pixel glyph used as the left-side seed in buttons. Pixels shift on hover. */
export function PixelIcon({ dark = false }: { dark?: boolean }) {
  const on = dark ? "bg-abyss" : "bg-aqua";
  return (
    <span aria-hidden className="grid grid-cols-3 gap-[1.5px]">
      {[1, 0, 1, 0, 1, 0, 1, 0, 1].map((v, i) => (
        <span
          key={i}
          className={`h-[3px] w-[3px] transition-opacity duration-300 ${on} ${v ? "opacity-100 group-hover:opacity-30" : "opacity-30 group-hover:opacity-100"}`}
        />
      ))}
    </span>
  );
}
