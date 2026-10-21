import type { Metadata } from "next";
import { PageHeader, Section } from "@/components/ui";

export const metadata: Metadata = {
  title: "Changelog",
  description: "Versioned changes to Palisec.",
  alternates: { canonical: "/changelog" },
};

const ENTRIES = [
  {
    version: "0.1.0",
    date: "2026-10-21",
    tag: "Pre-release",
    changes: [
      "Canonical policy schema 1.0 with JSON Schema, TypeScript types and validation.",
      "Deterministic reference evaluator with fixed evaluation order and stable reason codes.",
      "Browser policy workbench running the reference evaluator on example data.",
      "Public site and documentation, with maturity labels on every capability.",
      "Added RW_REQUEST_001 for request schema failures.",
    ],
  },
];

export default function ChangelogPage() {
  return (
    <>
      <PageHeader eyebrow="Changelog" title="Changes, by version." />
      <Section>
        <ol className="space-y-12">
          {ENTRIES.map((e) => (
            <li key={e.version} className="grid gap-4 md:grid-cols-[200px_1fr]">
              <div>
                <p className="font-mono text-lg text-fg">{e.version}</p>
                <p className="label mt-1">{e.date} · {e.tag}</p>
              </div>
              <ul className="space-y-2 border-l border-line pl-6 text-sm leading-relaxed text-soft">
                {e.changes.map((c) => <li key={c}>{c}</li>)}
              </ul>
            </li>
          ))}
        </ol>
      </Section>
    </>
  );
}
