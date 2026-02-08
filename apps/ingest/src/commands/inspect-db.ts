import { openDatabase } from "@berlinale/db";

type TableInfoRow = {
  cid: number;
  name: string;
  type: string;
  notnull: number;
  dflt_value: string | null;
  pk: number;
};

function printTableInfo(db: ReturnType<typeof openDatabase>, tableName: string): void {
  const rows = db
    .query<TableInfoRow, []>(`PRAGMA table_info(${tableName});`)
    .all()
    .map((row) => ({
      cid: Number(row.cid),
      name: row.name,
      type: row.type,
      notnull: Number(row.notnull),
      dflt_value: row.dflt_value,
      pk: Number(row.pk),
    }));
  console.log(`\n${tableName} columns:`);
  console.table(rows);
}

export function runInspectDb(dbPath: string): void {
  const db = openDatabase(dbPath);

  try {
    const tables = db
      .query<{ name: string }, []>(`
        SELECT name
        FROM sqlite_master
        WHERE type = 'table'
          AND name NOT LIKE 'sqlite_%'
        ORDER BY name
      `)
      .all()
      .map((row) => row.name);

    console.log("tables:");
    for (const table of tables) {
      console.log(`- ${table}`);
    }

    printTableInfo(db, "films");
    printTableInfo(db, "screenings");
    printTableInfo(db, "venues");
  } finally {
    db.close(false);
  }
}
