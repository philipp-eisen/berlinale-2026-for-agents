import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { Database } from "bun:sqlite";

export type SqliteDb = Database;

export function openDatabase(dbPath: string): SqliteDb {
  mkdirSync(dirname(dbPath), { recursive: true });

  const db = new Database(dbPath, {
    create: true,
    strict: true,
    safeIntegers: true,
  });

  db.exec("PRAGMA foreign_keys = ON;");
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA synchronous = NORMAL;");
  return db;
}
