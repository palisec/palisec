#!/usr/bin/env node
/**
 * Applies db/migrations/*.sql in filename order, each in its own transaction, exactly once.
 * Runs before `next build`. Without a database URL it exits cleanly so the site still builds;
 * the API then fails closed with RW_STATE_001.
 */
import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import postgres from "postgres";

const url = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
if (!url) {
  console.log("[migrate] DATABASE_URL not set; skipping migrations.");
  process.exit(0);
}

const dir = join(dirname(fileURLToPath(import.meta.url)), "..", "db", "migrations");
const sql = postgres(url, { max: 1, onnotice: () => {} });
// Concurrent builds (production + preview) must not race on the same database.
const LOCK_KEY = 4663_0001;

try {
  await sql`SELECT pg_advisory_lock(${LOCK_KEY})`;
  await sql`CREATE TABLE IF NOT EXISTS schema_migrations (version text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`;
  const applied = new Set((await sql`SELECT version FROM schema_migrations`).map((r) => r.version));
  const files = (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort();
  let count = 0;
  for (const file of files) {
    const version = file.replace(/\.sql$/, "");
    if (applied.has(version)) continue;
    const body = await readFile(join(dir, file), "utf8");
    await sql.begin(async (tx) => {
      await tx.unsafe(body);
      await tx`INSERT INTO schema_migrations (version) VALUES (${version})`;
    });
    console.log(`[migrate] applied ${version}`);
    count++;
  }
  console.log(`[migrate] up to date (${count} applied, ${files.length} total).`);
} catch (err) {
  console.error("[migrate] failed:", err.message);
  process.exitCode = 1;
} finally {
  await sql`SELECT pg_advisory_unlock(${LOCK_KEY})`.catch(() => {});
  await sql.end({ timeout: 5 });
}
