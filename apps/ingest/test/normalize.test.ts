import { expect, test } from "bun:test";
import { extractPage, normalizeProgramItem } from "../src/lib/normalize";

test("extractPage reads items and metadata", async () => {
  const fixture = await Bun.file("test/fixtures/berlinale/page_1.json").json();
  const page = extractPage(fixture);
  expect(page.items.length).toBe(1);
  expect(page.hasNext).toBe(true);
  expect(page.totalPages).toBe(2);
});

test("normalizeProgramItem maps film and screenings", async () => {
  const fixture = await Bun.file("test/fixtures/berlinale/page_1.json").json();
  const item = (fixture as { items: unknown[] }).items[0];
  const normalized = normalizeProgramItem(item);

  expect(normalized.film.sourceFilmId).toBe("film-1");
  expect(normalized.film.title).toBe("Opening Night");
  expect(normalized.people.length).toBe(1);
  expect(normalized.venues.length).toBe(1);
  expect(normalized.screenings.length).toBe(1);
});

test("normalizeProgramItem handles Berlinale event/person structure", () => {
  const item = {
    id: 202615475,
    title: "17",
    section: { name: "Perspectives" },
    meta: ["105'", "Nordmazedonien, Serbien, Slowenien 2026"],
    person: [{ name: "Kosara Mitic" }],
    castMembers: [{ name: "Eva Kostic", role: null }],
    reducedCrewMembers: [{ name: "Kosara Mitic" }],
    events: [
      {
        extIdScreening: "572-20260218-1900",
        id: 33178,
        time: { unixtime: 1771437600, durationInMinutes: 136 },
        venueHall: "Bluemax Theater",
        type: "event",
      },
    ],
  };

  const normalized = normalizeProgramItem(item);

  expect(normalized.film.sourceFilmId).toBe("202615475");
  expect(normalized.film.runtimeMinutes).toBe(105);
  expect(normalized.film.section).toBe("Perspectives");
  expect(normalized.people.length).toBeGreaterThan(0);
  expect(normalized.credits.length).toBeGreaterThan(0);
  expect(normalized.venues.length).toBe(1);
  expect(normalized.screenings.length).toBe(1);
  expect(normalized.screenings[0]?.sourceScreeningId).toBe("572-20260218-1900");
});
