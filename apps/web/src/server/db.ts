import "server-only";
import { neon } from "@neondatabase/serverless";
import postgres from "postgres";
import { databaseUrl } from "./config";

export type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
export type Query = (strings: TemplateStringsArray, ...values: unknown[]) => Promise<Row[]>;

const globalForDb = globalThis as unknown as { __rwQuery?: Query };

/**
 * Every statement is sent on its own, so a change that must be atomic has to be one statement.
 *
 * Neon is reached through its HTTPS driver, which suits short-lived serverless functions and has no
 * interactive transactions. Other databases (local Postgres) use a plain connection; `prepare: false`
 * keeps it compatible with transaction-mode poolers.
 */
export function db(): Query {
  if (!globalForDb.__rwQuery) {
    const url = databaseUrl();
    if (!url) throw new StateUnavailable("DATABASE_URL is not configured");
    if (new URL(url).hostname.endsWith(".neon.tech")) {
      const sql = neon(url);
      globalForDb.__rwQuery = (strings, ...values) => sql(strings, ...values) as Promise<Row[]>;
    } else {
      const sql = postgres(url, { prepare: false, max: 5, idle_timeout: 20, connect_timeout: 10, onnotice: () => {} });
      globalForDb.__rwQuery = (strings, ...values) => sql(strings, ...(values as never[])) as unknown as Promise<Row[]>;
    }
  }
  return globalForDb.__rwQuery;
}

export class StateUnavailable extends Error {}
