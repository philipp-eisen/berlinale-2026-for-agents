import { openDatabase } from "@berlinale/db";
import { applyMigrations } from "@berlinale/db/migrate";
import { runProgramIngestion } from "../lib/pipeline";

export type IngestProgramCommandOptions = {
  dbPath: string;
  locale: string;
  maxPages: number;
  retries: number;
  timeoutMs: number;
};

export async function runIngestProgram(
  options: IngestProgramCommandOptions,
): Promise<void> {
  const endpoint = `https://www.berlinale.de/api/v1/${options.locale}/festival-program`;
  const db = openDatabase(options.dbPath);

  try {
    applyMigrations(db);
    const result = await runProgramIngestion({
      db,
      endpoint,
      locale: options.locale,
      maxPages: options.maxPages,
      timeoutMs: options.timeoutMs,
      retries: options.retries,
      source: "berlinale festival-program",
    });

    console.log(
      `run_id=${result.runId} pages=${result.pagesFetched} items=${result.itemsSeen}`,
    );
  } finally {
    db.close(false);
  }
}
