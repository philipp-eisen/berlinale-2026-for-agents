CREATE TABLE IF NOT EXISTS ingest_runs (
  run_id TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  status TEXT NOT NULL,
  locale TEXT NOT NULL,
  started_at TEXT NOT NULL DEFAULT (datetime('now')),
  ended_at TEXT,
  params_json TEXT NOT NULL,
  stats_json TEXT,
  error_text TEXT
);

CREATE TABLE IF NOT EXISTS raw_pages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id TEXT NOT NULL REFERENCES ingest_runs(run_id) ON DELETE CASCADE,
  endpoint TEXT NOT NULL,
  page_number INTEGER NOT NULL,
  page_cursor TEXT,
  request_json TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  status_code INTEGER NOT NULL,
  fetched_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(run_id, endpoint, page_number)
);

CREATE TABLE IF NOT EXISTS raw_entities_current (
  entity_type TEXT NOT NULL,
  source_id TEXT NOT NULL,
  locale TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  first_seen_run_id TEXT NOT NULL REFERENCES ingest_runs(run_id),
  last_seen_run_id TEXT NOT NULL REFERENCES ingest_runs(run_id),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY(entity_type, source_id, locale)
);

CREATE TABLE IF NOT EXISTS raw_entities_versions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entity_type TEXT NOT NULL,
  source_id TEXT NOT NULL,
  locale TEXT NOT NULL,
  run_id TEXT NOT NULL REFERENCES ingest_runs(run_id),
  payload_json TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  seen_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(entity_type, source_id, locale, payload_hash)
);

CREATE TABLE IF NOT EXISTS films (
  film_id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_film_id TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  original_title TEXT,
  synopsis TEXT,
  runtime_minutes INTEGER,
  year INTEGER,
  country TEXT,
  section TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  last_seen_run_id TEXT NOT NULL REFERENCES ingest_runs(run_id),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS people (
  person_id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_person_id TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  last_seen_run_id TEXT NOT NULL REFERENCES ingest_runs(run_id),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS film_credits (
  film_id INTEGER NOT NULL REFERENCES films(film_id) ON DELETE CASCADE,
  person_id INTEGER NOT NULL REFERENCES people(person_id) ON DELETE CASCADE,
  role_type TEXT NOT NULL,
  role_name TEXT NOT NULL,
  billing_order INTEGER,
  PRIMARY KEY(film_id, person_id, role_type, role_name)
);

CREATE TABLE IF NOT EXISTS venues (
  venue_id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_venue_id TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  address TEXT,
  lat REAL,
  lng REAL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS screenings (
  screening_id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_screening_id TEXT NOT NULL UNIQUE,
  film_id INTEGER NOT NULL REFERENCES films(film_id) ON DELETE CASCADE,
  venue_id INTEGER REFERENCES venues(venue_id),
  starts_at_utc TEXT NOT NULL,
  local_tz TEXT,
  format TEXT,
  ticket_url TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  last_seen_run_id TEXT NOT NULL REFERENCES ingest_runs(run_id),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS external_sources (
  source_id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS film_external_ids (
  film_id INTEGER NOT NULL REFERENCES films(film_id) ON DELETE CASCADE,
  source_id INTEGER NOT NULL REFERENCES external_sources(source_id) ON DELETE CASCADE,
  external_id TEXT NOT NULL,
  url TEXT,
  raw_json TEXT,
  fetched_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY(film_id, source_id),
  UNIQUE(source_id, external_id)
);

CREATE TABLE IF NOT EXISTS film_external_ratings (
  film_id INTEGER NOT NULL REFERENCES films(film_id) ON DELETE CASCADE,
  source_id INTEGER NOT NULL REFERENCES external_sources(source_id) ON DELETE CASCADE,
  fetched_at TEXT NOT NULL DEFAULT (datetime('now')),
  rating_value REAL,
  rating_scale REAL,
  vote_count INTEGER,
  raw_json TEXT,
  PRIMARY KEY(film_id, source_id, fetched_at)
);

INSERT OR IGNORE INTO external_sources (code, display_name)
VALUES
  ('imdb', 'IMDb'),
  ('rotten_tomatoes', 'Rotten Tomatoes');
