import { openDatabase } from "@berlinale/db";

export function runVerifyDb(dbPath: string): void {
  const db = openDatabase(dbPath);

  try {
    const tables = [
      "ingest_runs",
      "raw_pages",
      "raw_entities_current",
      "raw_entities_versions",
      "films",
      "people",
      "film_credits",
      "venues",
      "screenings",
      "film_external_ids",
      "film_external_ratings",
    ];

    for (const table of tables) {
      const row = db
        .query<{ count: number }, []>(`SELECT COUNT(*) AS count FROM ${table}`)
        .get();
      console.log(`${table}=${row?.count ?? 0}`);
    }

    const orphanScreenings = db
      .query<{ count: number }, []>(`
        SELECT COUNT(*) AS count
        FROM screenings s
        LEFT JOIN films f ON f.film_id = s.film_id
        WHERE f.film_id IS NULL
      `)
      .get();

    if ((orphanScreenings?.count ?? 0) > 0) {
      throw new Error(`Orphan screenings found: ${orphanScreenings?.count ?? 0}`);
    }

    console.log("verify=ok");
  } finally {
    db.close(false);
  }
}
