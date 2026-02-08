import { createHash, randomUUID } from "node:crypto";
import type { SqliteDb } from "@berlinale/db";
import { fetchProgramPage } from "./http";
import { extractPage, extractSourceId, normalizeProgramItem } from "./normalize";

export type IngestOptions = {
  db: SqliteDb;
  endpoint: string;
  locale: string;
  maxPages: number;
  timeoutMs: number;
  retries: number;
  source: string;
};

export type IngestResult = {
  runId: string;
  pagesFetched: number;
  itemsSeen: number;
  finishedAt: string;
};

export function shouldStopPagination(args: {
  currentPage: number;
  itemsCount: number;
  hasNext?: boolean;
  totalPages?: number;
  maxPages: number;
}): boolean {
  if (args.currentPage >= args.maxPages) {
    return true;
  }
  if (args.totalPages && args.currentPage >= args.totalPages) {
    return true;
  }
  if (typeof args.hasNext === "boolean") {
    return !args.hasNext;
  }
  return args.itemsCount === 0;
}

function jsonHash(payload: unknown): string {
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

function upsertRawEntity(args: {
  db: SqliteDb;
  runId: string;
  locale: string;
  entityType: string;
  sourceId: string;
  payload: unknown;
  payloadHash: string;
}): void {
  const payloadJson = JSON.stringify(args.payload);

  const existing = args.db
    .query<{ payload_hash: string }, [string, string, string]>(
      "SELECT payload_hash FROM raw_entities_current WHERE entity_type = ? AND source_id = ? AND locale = ?",
    )
    .get(args.entityType, args.sourceId, args.locale);

  args.db
    .query(
      `
      INSERT INTO raw_entities_current (
        entity_type,
        source_id,
        locale,
        payload_json,
        payload_hash,
        first_seen_run_id,
        last_seen_run_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(entity_type, source_id, locale)
      DO UPDATE SET
        payload_json = excluded.payload_json,
        payload_hash = excluded.payload_hash,
        last_seen_run_id = excluded.last_seen_run_id,
        updated_at = datetime('now')
    `,
    )
    .run(
      args.entityType,
      args.sourceId,
      args.locale,
      payloadJson,
      args.payloadHash,
      args.runId,
      args.runId,
    );

  if (!existing || existing.payload_hash !== args.payloadHash) {
    args.db
      .query(
        `
        INSERT OR IGNORE INTO raw_entities_versions (
          entity_type,
          source_id,
          locale,
          run_id,
          payload_json,
          payload_hash
        ) VALUES (?, ?, ?, ?, ?, ?)
      `,
      )
      .run(
        args.entityType,
        args.sourceId,
        args.locale,
        args.runId,
        payloadJson,
        args.payloadHash,
      );
  }
}

function upsertNormalizedFilm(args: {
  db: SqliteDb;
  runId: string;
  film: ReturnType<typeof normalizeProgramItem>["film"];
}): number {
  args.db
    .query(
      `
      INSERT INTO films (
        source_film_id,
        title,
        original_title,
        synopsis,
        runtime_minutes,
        year,
        country,
        section,
        last_seen_run_id,
        is_active
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
      ON CONFLICT(source_film_id)
      DO UPDATE SET
        title = excluded.title,
        original_title = excluded.original_title,
        synopsis = excluded.synopsis,
        runtime_minutes = excluded.runtime_minutes,
        year = excluded.year,
        country = excluded.country,
        section = excluded.section,
        last_seen_run_id = excluded.last_seen_run_id,
        is_active = 1,
        updated_at = datetime('now')
    `,
    )
    .run(
      args.film.sourceFilmId,
      args.film.title,
      args.film.originalTitle,
      args.film.synopsis,
      args.film.runtimeMinutes,
      args.film.year,
      args.film.country,
      args.film.section,
      args.runId,
    );

  const row = args.db
    .query<{ film_id: number }, [string]>(
      "SELECT film_id FROM films WHERE source_film_id = ?",
    )
    .get(args.film.sourceFilmId);

  if (!row) {
    throw new Error(`Failed to resolve film_id for ${args.film.sourceFilmId}`);
  }
  return row.film_id;
}

function upsertPeopleAndCredits(args: {
  db: SqliteDb;
  runId: string;
  filmId: number;
  people: ReturnType<typeof normalizeProgramItem>["people"];
  credits: ReturnType<typeof normalizeProgramItem>["credits"];
}): void {
  for (const person of args.people) {
    args.db
      .query(
        `
        INSERT INTO people (source_person_id, name, last_seen_run_id)
        VALUES (?, ?, ?)
        ON CONFLICT(source_person_id)
        DO UPDATE SET
          name = excluded.name,
          last_seen_run_id = excluded.last_seen_run_id,
          updated_at = datetime('now')
      `,
      )
      .run(person.sourcePersonId, person.name, args.runId);
  }

  for (const credit of args.credits) {
    const person = args.db
      .query<{ person_id: number }, [string]>(
        "SELECT person_id FROM people WHERE source_person_id = ?",
      )
      .get(credit.sourcePersonId);
    if (!person) {
      continue;
    }
    args.db
      .query(
        `
        INSERT INTO film_credits (film_id, person_id, role_type, role_name, billing_order)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(film_id, person_id, role_type, role_name)
        DO UPDATE SET
          billing_order = excluded.billing_order
      `,
      )
      .run(args.filmId, person.person_id, credit.roleType, credit.roleName, credit.billingOrder);
  }
}

function upsertVenuesAndScreenings(args: {
  db: SqliteDb;
  runId: string;
  filmId: number;
  venues: ReturnType<typeof normalizeProgramItem>["venues"];
  screenings: ReturnType<typeof normalizeProgramItem>["screenings"];
}): void {
  for (const venue of args.venues) {
    args.db
      .query(
        `
        INSERT INTO venues (source_venue_id, name, address, lat, lng)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(source_venue_id)
        DO UPDATE SET
          name = excluded.name,
          address = excluded.address,
          lat = excluded.lat,
          lng = excluded.lng,
          updated_at = datetime('now')
      `,
      )
      .run(venue.sourceVenueId, venue.name, venue.address, venue.lat, venue.lng);
  }

  for (const screening of args.screenings) {
    const venueRow = screening.sourceVenueId
      ? args.db
          .query<{ venue_id: number }, [string]>(
            "SELECT venue_id FROM venues WHERE source_venue_id = ?",
          )
          .get(screening.sourceVenueId)
      : null;

    args.db
      .query(
        `
        INSERT INTO screenings (
          source_screening_id,
          film_id,
          venue_id,
          starts_at_utc,
          local_tz,
          format,
          ticket_url,
          last_seen_run_id,
          is_active
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)
        ON CONFLICT(source_screening_id)
        DO UPDATE SET
          film_id = excluded.film_id,
          venue_id = excluded.venue_id,
          starts_at_utc = excluded.starts_at_utc,
          local_tz = excluded.local_tz,
          format = excluded.format,
          ticket_url = excluded.ticket_url,
          last_seen_run_id = excluded.last_seen_run_id,
          is_active = 1,
          updated_at = datetime('now')
      `,
      )
      .run(
        screening.sourceScreeningId,
        args.filmId,
        venueRow?.venue_id ?? null,
        screening.startsAtUtc,
        screening.localTz,
        screening.format,
        screening.ticketUrl,
        args.runId,
      );
  }
}

function persistPage(args: {
  db: SqliteDb;
  runId: string;
  endpoint: string;
  pageNumber: number;
  payload: unknown;
  statusCode: number;
}): void {
  const payloadJson = JSON.stringify(args.payload);
  const payloadHash = jsonHash(args.payload);
  args.db
    .query(
      `
      INSERT OR REPLACE INTO raw_pages (
        run_id,
        endpoint,
        page_number,
        request_json,
        payload_json,
        payload_hash,
        status_code
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `,
    )
    .run(
      args.runId,
      args.endpoint,
      args.pageNumber,
      JSON.stringify({ Page: args.pageNumber }),
      payloadJson,
      payloadHash,
      args.statusCode,
    );
}

export async function runProgramIngestion(options: IngestOptions): Promise<IngestResult> {
  const runId = randomUUID();

  options.db
    .query(
      `
      INSERT INTO ingest_runs (run_id, source, status, locale, params_json)
      VALUES (?, ?, 'running', ?, ?)
    `,
    )
    .run(
      runId,
      options.source,
      options.locale,
      JSON.stringify({
        endpoint: options.endpoint,
        maxPages: options.maxPages,
        timeoutMs: options.timeoutMs,
        retries: options.retries,
      }),
    );

  let page = 1;
  let pagesFetched = 0;
  let itemsSeen = 0;

  try {
    while (true) {
      const pageResponse = await fetchProgramPage({
        endpoint: options.endpoint,
        locale: options.locale,
        page,
        timeoutMs: options.timeoutMs,
        retries: options.retries,
      });

      const parsed = extractPage(pageResponse.payload);
      const transaction = options.db.transaction(() => {
        persistPage({
          db: options.db,
          runId,
          endpoint: options.endpoint,
          pageNumber: page,
          payload: pageResponse.payload,
          statusCode: pageResponse.statusCode,
        });

        for (const item of parsed.items) {
          const sourceId = extractSourceId(item);
          const hash = jsonHash(item);

          upsertRawEntity({
            db: options.db,
            runId,
            locale: options.locale,
            entityType: "program_item",
            sourceId,
            payload: item,
            payloadHash: hash,
          });

          const normalized = normalizeProgramItem(item);
          const filmId = upsertNormalizedFilm({
            db: options.db,
            runId,
            film: normalized.film,
          });

          upsertPeopleAndCredits({
            db: options.db,
            runId,
            filmId,
            people: normalized.people,
            credits: normalized.credits,
          });

          upsertVenuesAndScreenings({
            db: options.db,
            runId,
            filmId,
            venues: normalized.venues,
            screenings: normalized.screenings,
          });
        }
      });

      transaction();

      pagesFetched += 1;
      itemsSeen += parsed.items.length;
      console.log(`page=${page} items=${parsed.items.length}`);

      if (
        shouldStopPagination({
          currentPage: page,
          itemsCount: parsed.items.length,
          hasNext: parsed.hasNext,
          totalPages: parsed.totalPages,
          maxPages: options.maxPages,
        })
      ) {
        break;
      }

      page += 1;
    }

    options.db
      .query(
        `
        UPDATE films
        SET is_active = 0
        WHERE last_seen_run_id <> ?
      `,
      )
      .run(runId);

    options.db
      .query(
        `
        UPDATE screenings
        SET is_active = 0
        WHERE last_seen_run_id <> ?
      `,
      )
      .run(runId);

    const finishedAt = new Date().toISOString();
    options.db
      .query(
        `
      UPDATE ingest_runs
      SET status = 'success', ended_at = ?, stats_json = ?
      WHERE run_id = ?
    `,
      )
      .run(
        finishedAt,
        JSON.stringify({ pagesFetched, itemsSeen }),
        runId,
      );

    return {
      runId,
      pagesFetched,
      itemsSeen,
      finishedAt,
    };
  } catch (error) {
    options.db
      .query(
        `
      UPDATE ingest_runs
      SET status = 'failed', ended_at = ?, error_text = ?
      WHERE run_id = ?
    `,
      )
      .run(
        new Date().toISOString(),
        error instanceof Error ? error.message : String(error),
        runId,
      );
    throw error;
  }
}
