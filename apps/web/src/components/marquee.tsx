import { CubeGlyph } from "./cube";

/** Endless strip of utility marks. Content is duplicated once so the loop is seamless. */
export function Marquee({ items, reverse = false }: { items: string[]; reverse?: boolean }) {
  const row = (hidden: boolean) => (
    <ul aria-hidden={hidden} className="flex shrink-0 items-center gap-12 pr-12">
      {items.map((t) => (
        <li key={t} className="flex items-center gap-3 whitespace-nowrap font-pixel text-[12px] uppercase tracking-[0.04em] text-bone/70">
          <CubeGlyph size={12} />
          {t}
        </li>
      ))}
    </ul>
  );
  return (
    <div className="group relative flex overflow-hidden [mask-image:linear-gradient(90deg,transparent,black_10%,black_90%,transparent)]">
      <div className="flex w-max animate-marquee group-hover:[animation-play-state:paused]" style={reverse ? { animationDirection: "reverse" } : undefined}>
        {row(false)}
        {row(true)}
      </div>
    </div>
  );
}
