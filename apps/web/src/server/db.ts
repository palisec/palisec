import "server-only";
import postgres from "postgres";
import { databaseUrl } from "./config";

type Sql = ReturnType<typeof postgres>;

const globalForDb = globalThis as unknown as { __rwSql?: Sql };

/**
 * One pooled client per function instance. `prepare: false` keeps it compatible with
 * transaction-mode poolers such as Neon's pooled endpoint.
 */
export function db(): Sql {
  if (!globalForDb.__rwSql) {
    const url = databaseUrl();
    if (!url) throw new StateUnavailable("DATABASE_URL is not configured");
    globalForDb.__rwSql = postgres(url, { prepare: false, max: 5, idle_timeout: 20, connect_timeout: 10, onnotice: () => {} });
  }
  return globalForDb.__rwSql;
}

export class StateUnavailable extends Error {}
