/**
 * Per-page Open Graph data. Each page passes its own path, so link previews carry that page's URL
 * (og:url) rather than the homepage's. Title and description are inherited from the page's own
 * metadata. A page's openGraph object replaces the layout's, so the shared preview image is named
 * here too (app/opengraph-image.png; X uses app/twitter-image.png automatically).
 */
export const OG_IMAGE = {
  url: "/opengraph-image.png",
  width: 1200,
  height: 630,
  type: "image/png",
  alt: "Palisec: Limits AI agents can't override. The line between the agent side and the chain side.",
};

export const pageOpenGraph = (path: string) => ({ type: "website" as const, siteName: "Palisec", url: path, images: [OG_IMAGE] });
