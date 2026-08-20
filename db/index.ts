import { env } from "cloudflare:workers";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "./schema";

const RUNTIME_METADATA_TABLE = "runtime_metadata";

export type D1Health = {
  database: "ok";
  baseMigration: "applied" | "pending";
};

export function getD1(): D1Database {
  const runtimeEnv = env as unknown as { DB?: D1Database };

  if (!runtimeEnv.DB) {
    throw new Error(
      "Cloudflare D1 binding `DB` is unavailable. Set the `d1` field in .openai/hosting.json to `DB` or let your control plane inject the real binding values before using the database."
    );
  }

  return runtimeEnv.DB;
}

export function getDb() {
  const d1 = getD1();

  return drizzle(d1, { schema });
}

/**
 * Read-only D1 smoke test used by the Sites runtime preflight route.
 *
 * The probe intentionally reads SQLite's built-in catalog instead of touching
 * application records. It can therefore run before or after the base
 * migration and never reveals private data.
 */
export async function readD1Health(): Promise<D1Health> {
  const d1 = getD1();
  const result = await d1
    .prepare("SELECT 1 AS ok")
    .first<{ ok: number }>();

  if (result?.ok !== 1) {
    throw new Error("D1 health query returned an unexpected result");
  }

  const migrationTable = await d1
    .prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ? LIMIT 1",
    )
    .bind(RUNTIME_METADATA_TABLE)
    .first<{ name: string }>();

  return {
    database: "ok",
    baseMigration: migrationTable?.name === RUNTIME_METADATA_TABLE ? "applied" : "pending",
  };
}
