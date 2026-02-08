---
name: berlinale-program
description: Query the Berlinale SQLite dataset and answer screening or ticket-availability questions using the official booking rules and exceptions.
---

# Berlinale Program Skill

Use this skill whenever a user asks about:

- screening times, venues, or film lookups
- "what can I buy today/tomorrow" ticket questions
- 3-day advance booking windows
- special exceptions (Publikumstag, Uber Eats Music Hall, JVA Ploetzensee, Geheimnisse einer Seele)

## Source of truth

- Primary DB: `data/berlinale.sqlite`
- Do not guess schedules. Run SQL and report results from the DB.
- Key tables: `films`, `screenings`, `venues`
- Film detail page pattern: `https://www.berlinale.de/de/2026/programm/{source_film_id}.html`
- `source_film_id` comes from `films.source_film_id` (example: `202609628` -> `https://www.berlinale.de/de/2026/programm/202609628.html`)
- Preferred terminal command for ad-hoc SQL: `bun run db:query --db data/berlinale.sqlite --query "..."`
- For schema/table checks: `bun run db:inspect --db data/berlinale.sqlite`

Time handling:

- `screenings.starts_at_utc` is UTC text.
- For Feb 2026 festival dates in this dataset, use Berlin local as `datetime(starts_at_utc, '+1 hour')`.

## Authoritative booking rules

Apply these rules exactly when answering ticket questions:

1. Standard rule: tickets are sold online from 10:00, exactly 3 days before the screening date (Berlin time).
2. Tickets can be booked (subject to availability) until screening start time.
3. Special exception: all screenings on Publikumstag (22 Feb) are available from sales start on 9 Feb.
4. Special exception: all screenings at Uber Eats Music Hall are available from sales start on 9 Feb.
5. Special exception: Berlinale Goes Kiez screening in JVA Ploetzensee is orderable from 9 Feb by phone only: `+49 30 259 20-259`.
6. Special exception: `Geheimnisse einer Seele (Secrets of a Soul)` in Berlinale Classics is available from 9 Feb at 10:00.
7. No entry after screening start.

Interpretation for availability checks:

- A screening is potentially buyable at `query_ts_berlin` if:
  - `query_ts_berlin >= sales_open_ts_berlin`, and
  - `query_ts_berlin < starts_at_berlin`.
- JVA Ploetzensee is phone-only channel, not normal online checkout.

## SQL templates

### 1) Basic screenings list (film + venue + Berlin time)

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

### 2) "What can I buy at a given Berlin timestamp?"

```sql
WITH params AS (
  SELECT datetime('2026-02-09 10:00:00') AS query_ts_berlin
), base AS (
  SELECT
    f.title,
    v.name AS venue,
    datetime(s.starts_at_utc, '+1 hour') AS starts_at_berlin
  FROM screenings s
  JOIN films f ON f.film_id = s.film_id
  LEFT JOIN venues v ON v.venue_id = s.venue_id
), rule_eval AS (
  SELECT
    b.*,
    CASE
      WHEN date(b.starts_at_berlin) = '2026-02-22' THEN datetime('2026-02-09 10:00:00')
      WHEN b.venue = 'Uber Eats Music Hall' THEN datetime('2026-02-09 10:00:00')
      WHEN lower(b.title) IN ('geheimnisse einer seele', 'secrets of a soul') THEN datetime('2026-02-09 10:00:00')
      WHEN b.venue LIKE '%Ploetzensee%' OR b.venue LIKE '%Plotzensee%' OR b.venue LIKE '%Pl%tzensee%' THEN datetime('2026-02-09 10:00:00')
      ELSE datetime(date(b.starts_at_berlin, '-3 day') || ' 10:00:00')
    END AS sales_open_ts_berlin,
    CASE
      WHEN b.venue LIKE '%Ploetzensee%' OR b.venue LIKE '%Plotzensee%' OR b.venue LIKE '%Pl%tzensee%'
      THEN 'phone +49 30 259 20-259'
      ELSE 'online'
    END AS channel
  FROM base b
)
SELECT
  venue,
  time(starts_at_berlin) AS time_berlin,
  title,
  channel,
  starts_at_berlin
FROM rule_eval, params
WHERE params.query_ts_berlin >= rule_eval.sales_open_ts_berlin
  AND params.query_ts_berlin < rule_eval.starts_at_berlin
ORDER BY venue, starts_at_berlin;
```

## Output conventions

- Prefer clean, readable output.
- If user asks "by venue", format:
  - `Venue Name:`
  - `  HH:MM Film Title`
- If user asks "by film", group by title and list date/time + venue.
- If user asks for links/details, include `film_detail_url` built from `source_film_id`.
- When relevant, include channel notes (`online` vs `phone`) and the JVA phone number.

## Matching guidance

- Use case-insensitive title matching.
- Be resilient to apostrophe variants (`Don't` vs curly apostrophe).
- If exact match is ambiguous, show top candidate matches and state which one was used.
