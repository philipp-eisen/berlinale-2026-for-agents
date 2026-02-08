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

test("ingests multiple pages into raw and normalized tables", async () => {
  const page1 = await Bun.file("test/fixtures/berlinale/page_1.json").json();
  const page2 = await Bun.file("test/fixtures/berlinale/page_2.json").json();
  const dbPath = join("/tmp", `berlinale-${randomUUID()}.sqlite`);
  cleanupPaths.push(dbPath);

  const fetchMock = mock(async (input: RequestInfo | URL, init?: RequestInit) => {
    if (!init?.body || typeof init.body !== "string") {
      throw new Error("Missing request body");
    }
    const body = JSON.parse(init.body) as { Page?: number };
    const payload = body.Page === 1 ? page1 : page2;

    return new Response(JSON.stringify(payload), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  });
  globalThis.fetch = fetchMock as unknown as typeof fetch;

  const db = openDatabase(dbPath);
  applyMigrations(db);

  const result = await runProgramIngestion({
    db,
    endpoint: "https://example.org/api",
    locale: "de",
    maxPages: 500,
    timeoutMs: 5_000,
    retries: 0,
    source: "test",
  });

  expect(result.pagesFetched).toBe(2);
  expect(result.itemsSeen).toBe(2);

  const rawPages = db
    .query<{ count: number }, []>("SELECT COUNT(*) AS count FROM raw_pages")
    .get();
  const films = db.query<{ count: number }, []>("SELECT COUNT(*) AS count FROM films").get();
  const screenings = db
    .query<{ count: number }, []>("SELECT COUNT(*) AS count FROM screenings")
    .get();

  expect(Number(rawPages?.count ?? 0)).toBe(2);
  expect(Number(films?.count ?? 0)).toBe(2);
  expect(Number(screenings?.count ?? 0)).toBe(2);

  db.close(false);
});
