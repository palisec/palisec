"use client";

import { useEffect, useState } from "react";

/** The URL fragment (without #), kept in sync with navigation. Deep links select records. */
export function useHashSelection(): [string | null, (id: string) => void] {
  const [hash, setHash] = useState<string | null>(null);
  useEffect(() => {
    const read = () => setHash(window.location.hash.slice(1) || null);
    read();
    window.addEventListener("hashchange", read);
    return () => window.removeEventListener("hashchange", read);
  }, []);
  const select = (id: string) => {
    window.history.replaceState(null, "", `#${id}`);
    setHash(id);
  };
  return [hash, select];
}
