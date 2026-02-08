# Berlinale Program Data for (and by) AI Agents

This repository contains a queryable SQLite snapshot of the Berlinale program and an ingest pipeline to refresh it.

Primary artifact for Q&A:

- `data/berlinale.sqlite`

If your goal is to answer questions like "where is film X screening?" or "what can I buy today under the 3-day rule?", query that DB directly.

## Data snapshot in repo

Current committed snapshot:

- `films`: 339
- `people`: 1242
- `film_credits`: 1565
- `venues`: 35
- `screenings`: 945
- `raw_pages`: 15
- `film_external_ids` (IMDb IDs): 234
- `film_external_ratings`: 44
- Date range (Berlin time): 2026-02-12 to 2026-02-22

## Fast start (for agents)

Use these first:

```bash
bun install
bun run db:inspect --db data/berlinale.sqlite
```

Run ad-hoc SQL without `sqlite3`:

```bash
bun run db:query --db data/berlinale.sqlite --query "SELECT COUNT(*) AS screenings FROM screenings;"
```

Core join:

```sql
SELECT
  f.title,
  f.source_film_id,
  'https://www.berlinale.de/de/2026/programm/' || f.source_film_id || '.html' AS film_detail_url,
  datetime(s.starts_at_utc, '+1 hour') AS starts_at_berlin,
  v.name AS venue,
  s.source_screening_id
FROM screenings s
JOIN films f ON f.film_id = s.film_id
LEFT JOIN venues v ON v.venue_id = s.venue_id
ORDER BY s.starts_at_utc;
```

Notes:

- `starts_at_utc` is UTC ISO text.
- In this dataset window (Feb 2026), Berlin time is UTC+1, so `'+1 hour'` is correct.
- `local_tz` is `Europe/Berlin` for screenings.
- Film detail URL pattern: `https://www.berlinale.de/de/2026/programm/{source_film_id}.html`
- `source_film_id` comes from `films.source_film_id` (example: `202609628` -> `https://www.berlinale.de/de/2026/programm/202609628.html`).

## Booking rules for ticket answers

Any agent answering ticket availability must apply these rules:

1. Standard: tickets are sold online from 10:00, 3 days before screening date (Berlin time).
2. Tickets can be booked until screening start (subject to availability).
3. Publikumstag (22 Feb): available from 9 Feb sales start.
4. Uber Eats Music Hall: available from 9 Feb sales start.
5. Berlinale Goes Kiez at JVA Ploetzensee: available from 9 Feb by phone `+49 30 259 20-259`.
6. Geheimnisse einer Seele (Secrets of a Soul), Berlinale Classics: available from 9 Feb at 10:00.
7. No entry after screening start.

These rules are also encoded in `.claude/skills/berlinale-program/SKILL.md` and `AGENTS.md`.

## SQL recipes for common questions

Screenings for one film title (case-insensitive):

```sql
SELECT
  date(datetime(s.starts_at_utc, '+1 hour')) AS date_berlin,
  time(datetime(s.starts_at_utc, '+1 hour')) AS time_berlin,
  v.name AS venue,
  f.title
FROM screenings s
JOIN films f ON f.film_id = s.film_id
LEFT JOIN venues v ON v.venue_id = s.venue_id
WHERE lower(f.title) = lower('No Good Men')
ORDER BY s.starts_at_utc;
```

All screenings at a venue:

```sql
SELECT
  date(datetime(s.starts_at_utc, '+1 hour')) AS date_berlin,
  time(datetime(s.starts_at_utc, '+1 hour')) AS time_berlin,
  f.title
FROM screenings s
JOIN films f ON f.film_id = s.film_id
JOIN venues v ON v.venue_id = s.venue_id
WHERE v.name = 'Berlinale Palast'
ORDER BY s.starts_at_utc;
```

What is buyable under the "3 days in advance" rule:

```sql
WITH target AS (
  SELECT date('2026-02-09', '+3 day') AS screening_date
)
SELECT
  v.name AS venue,
  time(datetime(s.starts_at_utc, '+1 hour')) AS time_berlin,
  f.title
FROM screenings s
JOIN films f ON f.film_id = s.film_id
LEFT JOIN venues v ON v.venue_id = s.venue_id
WHERE date(datetime(s.starts_at_utc, '+1 hour')) = (SELECT screening_date FROM target)
ORDER BY v.name, s.starts_at_utc;
```

JVA Ploetzensee screening lookup:

```sql
SELECT
  f.title,
  datetime(s.starts_at_utc, '+1 hour') AS starts_at_berlin,
  v.name AS venue
FROM screenings s
JOIN films f ON f.film_id = s.film_id
JOIN venues v ON v.venue_id = s.venue_id
WHERE v.name LIKE '%Ploetzensee%'
   OR v.name LIKE '%Plotzensee%'
   OR v.name LIKE '%Pl%tzensee%';
```

## Agent setup and usage

### Claude Code

- Project skill exists at `.claude/skills/berlinale-program/SKILL.md`.
- Invoke directly with `/berlinale-program` or ask naturally; Claude can auto-load the skill by description.
- Memory/rules can be added with `CLAUDE.md` if you want stricter team policies.
- If terminal SQL is needed, use `bun run db:query ...` so no system `sqlite3` install is required.

### OpenCode

- OpenCode supports the same skill format and discovers `.claude/skills/*/SKILL.md`.
- Start in this repo and ask questions about screenings; the agent can load `berlinale-program`.
- Optional: copy the same skill to `.opencode/skills/` if you prefer OpenCode-native location.
- For terminal SQL, use `bun run db:query ...`.

### Codex

- Use this repo root as working directory so `data/berlinale.sqlite` is in context.
- Ask Codex to query SQLite directly (not infer from memory), then summarize in readable lists.
- Prefer `bun run db:inspect` and `bun run db:query --query "..."` over external sqlite shell usage.
- `AGENTS.md` contains repo-specific operating rules for schedule/ticket queries.

### Cursor (optional)

- Open the project and ask Cursor to query `data/berlinale.sqlite` via terminal.
- Paste one of the SQL recipes above, then request formatting (by venue or by film).
- Use `bun run db:query --query "..."` to avoid requiring system `sqlite3`.

## Workspace and pipeline

Workspaces:

- `apps/ingest`: CLI for migrations, ingestion, and DB verification
- `apps/web`: placeholder for future website
- `packages/db`: SQLite connection and migrations
- `packages/domain`: shared domain types

Commands:

- `bun run db:migrate`
- `bun run db:inspect --db data/berlinale.sqlite`
- `bun run db:query --db data/berlinale.sqlite --query "SELECT ..." [--json]`
- `bun run ingest:program --db data/berlinale.sqlite --locale de [--max-pages 500] [--retries 4] [--timeout-ms 20000]`
- `bun run enrich:imdb --db data/berlinale.sqlite [--min-score 66] [--retries 3] [--timeout-ms 20000] [--delay-ms 120] [--limit 0] [--force]`
- `bun run db:verify --db data/berlinale.sqlite`
- `bun test`

Quick refresh:

```bash
bun install
bun run db:migrate
bun run ingest:program --db data/berlinale.sqlite --locale de
bun run enrich:imdb --db data/berlinale.sqlite
bun run db:verify --db data/berlinale.sqlite
```

## Data model

Hybrid model:

- Raw fidelity: `raw_pages`, `raw_entities_current`, `raw_entities_versions`
- Normalized: `films`, `people`, `film_credits`, `venues`, `screenings`
- Enrichment: `film_external_ids`, `film_external_ratings`, `external_sources`

This keeps source traceability while supporting fast SQL answers.
