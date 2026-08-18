import { sqliteTable, text } from "drizzle-orm/sqlite-core";

/**
 * Small, non-user-facing table created by the Sites D1 base migration.
 *
 * Product tables are introduced in later migrations. Keeping this metadata
 * table separate gives BR-003 a stable, harmless migration/read check without
 * prematurely choosing application schema or storing user data.
 */
export const runtimeMetadata = sqliteTable("runtime_metadata", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});
