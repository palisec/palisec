import Image from "next/image";

/** The PALISEC mark: a hexagonal P around the protected cube. Decorative; the wordmark carries the name. */
export function BrandMark({ size = 20, className = "" }: { size?: number; className?: string }) {
  return <Image src="/brand/palisec-mark-64.png" width={size} height={size} alt="" aria-hidden priority className={`shrink-0 ${className}`} />;
}
