import { randomUUID } from "node:crypto";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { afterEach, expect, mock, test } from "bun:test";
import { openDatabase } from "@berlinale/db";
import { applyMigrations } from "@berlinale/db/migrate";
import { runProgramIngestion } from "../src/lib/pipeline";

const cleanupPaths: string[] = [];

afterEach(() => {
  for (const dbPath of cleanupPaths.splice(0, cleanupPaths.length)) {
    rmSync(dbPath, { force: true });
  }
  mock.restore();
});

test("ingest is idempotent for unchanged payloads", async () => {
  const fixture = await Bun.file("test/fixtures/berlinale/page_1.json").json();
  const dbPath = join("/tmp", `berlinale-${randomUUID()}.sqlite`);
  cleanupPaths.push(dbPath);

  const fetchMock = mock(async () =>
    new Response(JSON.stringify(fixture), {
      status: 200,
      headers: { "content-type": "application/json" },
    }),
  );
  globalThis.fetch = fetchMock as unknown as typeof fetch;

  const db = openDatabase(dbPath);
  applyMigrations(db);

  await runProgramIngestion({
    db,
    endpoint: "https://example.org/api",
    locale: "de",
    maxPages: 1,
    timeoutMs: 5_000,
    retries: 0,
    source: "test",
  });

  await runProgramIngestion({
    db,
    endpoint: "https://example.org/api",
    locale: "de",
    maxPages: 1,
    timeoutMs: 5_000,
    retries: 0,
    source: "test",
  });

  const films = db.query<{ count: number }, []>("SELECT COUNT(*) AS count FROM films").get();
  const versions = db
    .query<{ count: number }, []>("SELECT COUNT(*) AS count FROM raw_entities_versions")
    .get();

  expect(Number(films?.count ?? 0)).toBe(1);
  expect(Number(versions?.count ?? 0)).toBe(1);
  expect(fetchMock).toHaveBeenCalledTimes(2);

  db.close(false);
});
