import { openDatabase } from "@berlinale/db";
import { applyMigrations } from "@berlinale/db/migrate";

export function runInitDb(dbPath: string): void {
  const db = openDatabase(dbPath);
  try {
    const applied = applyMigrations(db);
    console.log(`Applied ${applied} migrations`);
  } finally {
    db.close(false);
  }
}
