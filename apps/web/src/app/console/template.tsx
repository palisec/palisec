/** Re-mounts on every console navigation so each screen comes into focus. */
export default function ConsoleTemplate({ children }: { children: React.ReactNode }) {
  return <div className="page-enter">{children}</div>;
}
