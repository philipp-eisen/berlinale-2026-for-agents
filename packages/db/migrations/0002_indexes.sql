CREATE INDEX IF NOT EXISTS idx_raw_pages_run_endpoint_page
  ON raw_pages(run_id, endpoint, page_number);

CREATE INDEX IF NOT EXISTS idx_raw_entities_last_seen
  ON raw_entities_current(last_seen_run_id);

CREATE INDEX IF NOT EXISTS idx_raw_versions_entity
  ON raw_entities_versions(entity_type, source_id, locale);

CREATE INDEX IF NOT EXISTS idx_films_last_seen
  ON films(last_seen_run_id);

CREATE INDEX IF NOT EXISTS idx_people_last_seen
  ON people(last_seen_run_id);

CREATE INDEX IF NOT EXISTS idx_film_credits_person
  ON film_credits(person_id);

CREATE INDEX IF NOT EXISTS idx_screenings_film_start
  ON screenings(film_id, starts_at_utc);

CREATE INDEX IF NOT EXISTS idx_screenings_venue_start
  ON screenings(venue_id, starts_at_utc);

CREATE INDEX IF NOT EXISTS idx_screenings_last_seen
  ON screenings(last_seen_run_id);

CREATE INDEX IF NOT EXISTS idx_external_ratings_source_value
  ON film_external_ratings(source_id, rating_value);
