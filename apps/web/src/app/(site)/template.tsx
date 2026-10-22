/** Re-mounts on every navigation, so each route comes into focus rather than snapping in. */
export default function SiteTemplate({ children }: { children: React.ReactNode }) {
  return <div className="page-enter">{children}</div>;
}
