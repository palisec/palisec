import type { ReactNode } from "react";

/**
 * Two columns split at the line: the agent side (labels, counters, codes, steps) on the left,
 * the chain side (headlines, content, tables, code) on the right. Under 1024 px it is one column,
 * left content first.
 */
export function Split({
  left,
  right,
  id,
  className = "",
  as: Tag = "section",
  ...rest
}: {
  left?: ReactNode;
  right?: ReactNode;
  id?: string;
  className?: string;
  as?: "section" | "div" | "header";
} & Omit<React.HTMLAttributes<HTMLElement>, "id" | "className">) {
  return (
    <Tag id={id} className={`split-section ${className}`} {...rest}>
      <div className="split">
        <div className="split-l min-w-0">{left}</div>
        <div className="split-r min-w-0">{right}</div>
      </div>
    </Tag>
  );
}

/** A page header on the split grid: 150 px above it, label left, headline and lede right. */
export function PageHead({ label, title, lede, left }: { label?: string; title: ReactNode; lede?: ReactNode; left?: ReactNode }) {
  return (
    <Split
      as="header"
      className="!pt-[10.625rem]"
      left={
        <div className="space-y-8">
          {label ? <p className="t-label">{label}</p> : null}
          {left}
        </div>
      }
      right={
        <div className="space-y-7">
          <h1 className="t-h1 text-balance">{title}</h1>
          {lede ? <p className="t-lede">{lede}</p> : null}
        </div>
      }
    />
  );
}
