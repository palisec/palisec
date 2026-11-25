"use client";

import { useState } from "react";
import { CopyButton } from "../copy-button";

const TABS = [
  { k: "TypeScript", line: "npm install @palisec/sdk" },
  { k: "Python", line: "pip install palisec" },
  { k: "MCP", line: '{ "mcpServers": { "palisec": { "type": "http", "url": "https://palisec.tech/api/mcp", "headers": { "Authorization": "Bearer ${PALISEC_API_KEY}" } } } }' },
  { k: "REST", line: 'curl -H "Authorization: Bearer $PALISEC_API_KEY" -H "Content-Type: application/json" -d @request.json https://palisec.tech/api/v1/authorizations/evaluate' },
];

/** The install line for each way in. */
export function InstallTabs() {
  const [tab, setTab] = useState(0);
  const t = TABS[tab];
  return (
    <div className="rounded-[10px] border border-line bg-[rgb(1_20_19/0.6)]">
      <div role="tablist" aria-label="Install" className="flex flex-wrap gap-1 border-b border-line px-3 pt-2">
        {TABS.map((x, i) => (
          <button
            key={x.k}
            role="tab"
            aria-selected={i === tab}
            onClick={() => setTab(i)}
            className={`-mb-px border-b-2 px-3 py-2 font-utility text-[14.5px] font-medium ${i === tab ? "border-aqua text-mist" : "border-transparent text-silver hover:text-mist"}`}
          >
            {x.k}
          </button>
        ))}
      </div>
      <div className="flex items-center justify-between gap-4 px-4 py-4">
        <code className="min-w-0 overflow-x-auto whitespace-nowrap font-mono text-[14.5px] text-aqua">{t.line}</code>
        <CopyButton text={t.line} />
      </div>
    </div>
  );
}
