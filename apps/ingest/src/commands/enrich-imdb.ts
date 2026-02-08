import { openDatabase } from "@berlinale/db";
import { applyMigrations } from "@berlinale/db/migrate";
import {
  buildImdbSearchQueries,
  fetchImdbTitleRating,
  searchImdbCandidates,
  selectBestImdbCandidate,
  type ImdbCandidate,
} from "../lib/imdb";

type FilmRow = {
  film_id: number | bigint;
  title: string;
  original_title: string | null;
  year: number | bigint | null;
};

type EnrichImdbOptions = {
  dbPath: string;
  retries: number;
  timeoutMs: number;
  minScore: number;
  limit: number;
  delayMs: number;
  force: boolean;
};

function asSqliteNumber(value: number | bigint): number {
  return typeof value === "bigint" ? Number(value) : value;
}

function sameSqliteId(a: number | bigint, b: number | bigint): boolean {
  return String(a) === String(b);
}

type ScoredCandidate = {
  candidate: ImdbCandidate;
  score: number;
};

export async function runEnrichImdb(options: EnrichImdbOptions): Promise<void> {
  const db = openDatabase(options.dbPath);

  try {
    applyMigrations(db);

    const imdbSource = db
      .query<{ source_id: number | bigint }, []>(
        "SELECT source_id FROM external_sources WHERE code = 'imdb'",
      )
      .get();
    if (!imdbSource) {
      throw new Error("IMDb source row missing in external_sources");
    }

    const imdbSourceId = imdbSource.source_id;

    const limitClause = options.limit > 0 ? `LIMIT ${options.limit}` : "";
    const films = options.force
      ? db
          .query<FilmRow, []>(
            `
            SELECT f.film_id, f.title, f.original_title, f.year
            FROM films f
            WHERE f.is_active = 1
            ORDER BY f.film_id
            ${limitClause}
          `,
          )
          .all()
      : db
          .query<FilmRow, [number | bigint]>(
            `
            SELECT f.film_id, f.title, f.original_title, f.year
            FROM films f
            LEFT JOIN film_external_ids fei
              ON fei.film_id = f.film_id
              AND fei.source_id = ?
            WHERE f.is_active = 1
              AND fei.external_id IS NULL
            ORDER BY f.film_id
            ${limitClause}
          `,
          )
          .all(imdbSourceId);

    const upsertExternalId = db.query(
      `
      INSERT INTO film_external_ids (
        film_id,
        source_id,
        external_id,
        url,
        raw_json,
        fetched_at
      ) VALUES (?, ?, ?, ?, ?, datetime('now'))
      ON CONFLICT(film_id, source_id)
      DO UPDATE SET
        external_id = excluded.external_id,
        url = excluded.url,
        raw_json = excluded.raw_json,
        fetched_at = datetime('now')
    `,
    );

    const insertRating = db.query(
      `
      INSERT INTO film_external_ratings (
        film_id,
        source_id,
        fetched_at,
        rating_value,
        rating_scale,
        vote_count,
        raw_json
      ) VALUES (?, ?, datetime('now'), ?, ?, ?, ?)
    `,
    );

    let processed = 0;
    let matched = 0;
    let rated = 0;
    let unmatched = 0;
    let collisions = 0;
    let errors = 0;

    console.log(`imdb-enrich target=${films.length} min_score=${options.minScore}`);

    for (const film of films) {
      processed += 1;

      try {
        const filmYear = film.year === null ? null : asSqliteNumber(film.year);

        const queries = buildImdbSearchQueries({
          title: film.title,
          originalTitle: film.original_title,
          year: filmYear,
        });

        const candidatesById = new Map<string, ScoredCandidate>();
        for (const query of queries) {
          const candidates = await searchImdbCandidates(query, {
            timeoutMs: options.timeoutMs,
            retries: options.retries,
          });

          const best = selectBestImdbCandidate({
            filmTitle: film.title,
            originalTitle: film.original_title,
            filmYear,
            candidates,
          });

          if (!best) {
            continue;
          }

          const current = candidatesById.get(best.candidate.id);
          if (!current || best.score > current.score) {
            candidatesById.set(best.candidate.id, best);
          }
        }

        const bestCandidate = [...candidatesById.values()].sort((a, b) => b.score - a.score)[0] ?? null;
        if (!bestCandidate || bestCandidate.score < options.minScore) {
          unmatched += 1;
          if (processed <= 10 || processed % 25 === 0) {
            console.log(
              `imdb-unmatched film_id=${film.film_id} title=${JSON.stringify(film.title)} score=${bestCandidate?.score ?? "n/a"}`,
            );
          }
          await Bun.sleep(options.delayMs);
          continue;
        }

        const takenByOther = db
          .query<{ film_id: number | bigint }, [number | bigint, string]>(
            "SELECT film_id FROM film_external_ids WHERE source_id = ? AND external_id = ?",
          )
          .get(imdbSourceId, bestCandidate.candidate.id);

        if (takenByOther && !sameSqliteId(takenByOther.film_id, film.film_id)) {
          collisions += 1;
          console.log(
            `imdb-collision imdb_id=${bestCandidate.candidate.id} film_id=${film.film_id} existing_film_id=${takenByOther.film_id}`,
          );
          await Bun.sleep(options.delayMs);
          continue;
        }

        const imdbUrl = `https://www.imdb.com/title/${bestCandidate.candidate.id}/`;
        const rating = await fetchImdbTitleRating(bestCandidate.candidate.id, {
          timeoutMs: options.timeoutMs,
          retries: options.retries,
        });

        upsertExternalId.run(
          asSqliteNumber(film.film_id),
          asSqliteNumber(imdbSourceId),
          bestCandidate.candidate.id,
          imdbUrl,
          JSON.stringify({
            matchedAt: new Date().toISOString(),
            score: bestCandidate.score,
            candidate: bestCandidate.candidate,
            queries,
          }),
        );
        matched += 1;

        if (rating) {
          insertRating.run(
            asSqliteNumber(film.film_id),
            asSqliteNumber(imdbSourceId),
            rating.ratingValue,
            rating.ratingScale,
            rating.voteCount,
            JSON.stringify({
              imdbId: bestCandidate.candidate.id,
              fetchedAt: new Date().toISOString(),
              rating,
            }),
          );
          rated += 1;
        }

        if (processed <= 10 || processed % 25 === 0) {
          console.log(
            `imdb-match film_id=${film.film_id} imdb_id=${bestCandidate.candidate.id} score=${bestCandidate.score} rating=${rating?.ratingValue ?? "n/a"}`,
          );
        }
      } catch (error) {
        errors += 1;
        console.log(
          `imdb-error film_id=${film.film_id} title=${JSON.stringify(film.title)} message=${error instanceof Error ? error.message : String(error)}`,
        );
      }

      await Bun.sleep(options.delayMs);
    }

    console.log(
      `imdb-enrich done processed=${processed} matched=${matched} rated=${rated} unmatched=${unmatched} collisions=${collisions} errors=${errors}`,
    );
  } finally {
    db.close(false);
  }
}
