import { openDatabase } from "@berlinale/db";

type QueryDbOptions = {
  dbPath: string;
  query: string;
  json: boolean;
};

function normalizeValue(value: unknown): unknown {
  if (typeof value === "bigint") {
    return Number(value);
  }
  if (Array.isArray(value)) {
    return value.map((entry) => normalizeValue(entry));
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return Object.fromEntries(
      Object.entries(record).map(([key, entry]) => [key, normalizeValue(entry)]),
    );
  }
  return value;
}

export function runQueryDb(options: QueryDbOptions): void {
  const db = openDatabase(options.dbPath);

  try {
    const rows = db
      .query<Record<string, unknown>, []>(options.query)
      .all()
      .map((row) => normalizeValue(row) as Record<string, unknown>);

    if (options.json) {
      console.log(JSON.stringify(rows, null, 2));
      return;
    }

    if (rows.length === 0) {
      console.log("No rows returned.");
      return;
    }

    console.table(rows);
    console.log(`rows=${rows.length}`);
  } finally {
    db.close(false);
  }
}
