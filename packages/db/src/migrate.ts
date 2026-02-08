import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { SqliteDb } from "./client";

export function applyMigrations(db: SqliteDb, migrationsDir?: string): number {
  const dir = migrationsDir ?? join(import.meta.dir, "..", "migrations");

  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  const applied = new Set(
    db
      .query<{ version: string }, []>("SELECT version FROM schema_migrations")
      .all()
      .map((row) => row.version),
  );

  const migrationFiles = readdirSync(dir)
    .filter((name) => name.endsWith(".sql"))
    .sort();

  let count = 0;
  const insertMigration = db.query(
    "INSERT INTO schema_migrations (version) VALUES (?)",
  );

  for (const file of migrationFiles) {
    if (applied.has(file)) {
      continue;
    }
    const sql = readFileSync(join(dir, file), "utf8");
    const tx = db.transaction(() => {
      db.exec(sql);
      insertMigration.run(file);
    });
    tx();
    count += 1;
  }

  return count;
}
