/**
 * The line: one fixed, glowing vertical rule at --line-x, with the two backgrounds,
 * the grain and the AGENT / CHAIN labels. Decorative only.
 */
export function TheLine() {
  return (
    <>
      <div aria-hidden className="site-bg" data-intro-bg />
      <svg aria-hidden className="site-grain" width="100%" height="100%">
        <filter id="site-grain">
          <feTurbulence type="fractalNoise" baseFrequency="0.8" numOctaves="3" stitchTiles="stitch" />
        </filter>
        <rect width="100%" height="100%" filter="url(#site-grain)" />
      </svg>
      <div aria-hidden className="the-line" data-intro-line />
    </>
  );
}

/** "AGENT" and "CHAIN" at the top of each page; they scroll away with it. */
export function SideLabels() {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0" data-intro-labels>
      <span className="side-label agent">AGENT</span>
      <span className="side-label chain">CHAIN</span>
    </div>
  );
}
