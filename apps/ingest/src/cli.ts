import { runIngestProgram } from "./commands/ingest-program";
import { runInitDb } from "./commands/init-db";
import { runVerifyDb } from "./commands/verify-db";
import { runEnrichImdb } from "./commands/enrich-imdb";
import { runInspectDb } from "./commands/inspect-db";
import { runQueryDb } from "./commands/query-db";
import { isAbsolute, join, resolve } from "node:path";

type Args = {
  command: string;
  flags: Record<string, string | boolean>;
};

function parseArgs(argv: string[]): Args {
  const [command = "", ...rest] = argv;
  const flags: Record<string, string | boolean> = {};

  for (let i = 0; i < rest.length; i += 1) {
    const token = rest[i];
    if (!token.startsWith("--")) {
      continue;
    }
    const key = token.slice(2);
    const next = rest[i + 1];
    if (!next || next.startsWith("--")) {
      flags[key] = true;
      continue;
    }
    flags[key] = next;
    i += 1;
  }

  return { command, flags };
}

function flagString(
  flags: Record<string, string | boolean>,
  key: string,
  fallback: string,
): string {
  const value = flags[key];
  return typeof value === "string" ? value : fallback;
}

function flagNumber(
  flags: Record<string, string | boolean>,
  key: string,
  fallback: number,
): number {
  const value = flags[key];
  if (typeof value !== "string") {
    return fallback;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function flagBoolean(flags: Record<string, string | boolean>, key: string): boolean {
  const value = flags[key];
  if (value === true) {
    return true;
  }
  if (typeof value === "string") {
    return ["1", "true", "yes", "on"].includes(value.toLowerCase());
  }
  return false;
}

function printUsage(): void {
  console.log("Usage:");
  console.log("  bun src/cli.ts init-db --db data/berlinale.sqlite");
  console.log("  bun src/cli.ts inspect-db --db data/berlinale.sqlite");
  console.log("  bun src/cli.ts query-db --db data/berlinale.sqlite --query \"SELECT COUNT(*) AS count FROM films;\" [--json]");
  console.log(
    "  bun src/cli.ts ingest-program --db data/berlinale.sqlite --locale de [--max-pages 500] [--retries 4] [--timeout-ms 20000]",
  );
  console.log(
    "  bun src/cli.ts enrich-imdb --db data/berlinale.sqlite [--min-score 66] [--retries 3] [--timeout-ms 20000] [--delay-ms 120] [--limit 0] [--force]",
  );
  console.log("  bun src/cli.ts verify-db --db data/berlinale.sqlite");
}

async function main(): Promise<void> {
  const args = parseArgs(Bun.argv.slice(2));
  const rawDbPath = flagString(args.flags, "db", "data/berlinale.sqlite");
  const workspaceRoot = resolve(import.meta.dir, "..", "..", "..");
  const dbPath = isAbsolute(rawDbPath)
    ? rawDbPath
    : join(workspaceRoot, rawDbPath);

  switch (args.command) {
    case "init-db": {
      runInitDb(dbPath);
      break;
    }
    case "ingest-program": {
      await runIngestProgram({
        dbPath,
        locale: flagString(args.flags, "locale", "de"),
        maxPages: flagNumber(args.flags, "max-pages", 500),
        retries: flagNumber(args.flags, "retries", 4),
        timeoutMs: flagNumber(args.flags, "timeout-ms", 20_000),
      });
      break;
    }
    case "inspect-db": {
      runInspectDb(dbPath);
      break;
    }
    case "query-db": {
      const query = flagString(args.flags, "query", "").trim();
      if (!query) {
        console.error("Missing required --query flag.");
        printUsage();
        process.exitCode = 1;
        break;
      }

      runQueryDb({
        dbPath,
        query,
        json: flagBoolean(args.flags, "json"),
      });
      break;
    }
    case "verify-db": {
      runVerifyDb(dbPath);
      break;
    }
    case "enrich-imdb": {
      await runEnrichImdb({
        dbPath,
        retries: flagNumber(args.flags, "retries", 3),
        timeoutMs: flagNumber(args.flags, "timeout-ms", 20_000),
        minScore: flagNumber(args.flags, "min-score", 66),
        limit: flagNumber(args.flags, "limit", 0),
        delayMs: flagNumber(args.flags, "delay-ms", 120),
        force: flagBoolean(args.flags, "force"),
      });
      break;
    }
    default: {
      printUsage();
      process.exitCode = 1;
    }
  }
}

await main();
