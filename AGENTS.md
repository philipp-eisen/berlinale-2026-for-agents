# Berlinale Agent Guide

This repository is optimized for AI agents answering Berlinale schedule and ticket questions.

## Primary data source

- SQLite DB: `data/berlinale.sqlite`
- Query the DB directly. Do not infer schedules from memory.
- Film detail URL pattern: `https://www.berlinale.de/de/2026/programm/{source_film_id}.html`
- `source_film_id` comes from `films.source_film_id` (example: `202609628` -> `https://www.berlinale.de/de/2026/programm/202609628.html`)

## Recommended startup checks

```bash
bun run db:inspect --db data/berlinale.sqlite
```

Run ad-hoc SQL with Bun (no system `sqlite3` required):

```bash
bun run db:query --db data/berlinale.sqlite --query "SELECT COUNT(*) AS count FROM screenings;"
```

## Booking rules (must apply)

1. Standard: tickets are sold online from 10:00, 3 days before screening date (Berlin time).
2. Tickets can be booked until screening start (subject to availability).
3. Publikumstag (22 Feb): available from 9 Feb sales start.
4. Uber Eats Music Hall: available from 9 Feb sales start.
5. Berlinale Goes Kiez at JVA Ploetzensee: available from 9 Feb by phone `+49 30 259 20-259`.
6. Geheimnisse einer Seele (Secrets of a Soul), Berlinale Classics: available from 9 Feb at 10:00.
7. No entry after screening start.

## Timezone rule

- `screenings.starts_at_utc` is UTC.
- For Feb 2026 festival dates in this DB, Berlin local time is `datetime(starts_at_utc, '+1 hour')`.

## Agent-specific notes

- Claude Code: use `/berlinale-program` (skill at `.claude/skills/berlinale-program/SKILL.md`).
- OpenCode: auto-discovers the same skill path and can load it via the `skill` tool.
- Codex: read this file + `README.md`, then use `bun run db:query --query "..."` and summarize clearly.
- Cursor: optional, but can run the same SQL queries in terminal.

## Preferred response formatting

- Default: concise and readable.
- If user asks by venue:
  - `Venue Name:`
  - `  HH:MM Film Title`
- If user asks by film:
  - `Film Title:`
  - `  YYYY-MM-DD HH:MM - Venue`
