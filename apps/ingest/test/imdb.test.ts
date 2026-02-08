import { expect, test } from "bun:test";
import {
  buildImdbSearchQueries,
  parseImdbRatingFromHtml,
  parseImdbSuggestionPayload,
  scoreImdbCandidate,
  selectBestImdbCandidate,
} from "../src/lib/imdb";

test("parseImdbSuggestionPayload extracts title candidates", () => {
  const payload = {
    d: [
      { id: "tt1341338", l: "Good Luck, Have Fun, Don't Die", y: 2025, q: "feature", rank: 161 },
      { id: "nm123", l: "Person", q: "actor", rank: 5 },
    ],
  };

  const candidates = parseImdbSuggestionPayload(payload);
  expect(candidates.length).toBe(1);
  expect(candidates[0]?.id).toBe("tt1341338");
});

test("scoreImdbCandidate prefers title and year match", () => {
  const strong = scoreImdbCandidate({
    filmTitle: "Good Luck, Have Fun, Don't Die",
    originalTitle: null,
    filmYear: 2025,
    candidate: {
      id: "tt1341338",
      title: "Good Luck, Have Fun, Don't Die",
      year: 2025,
      type: "feature",
      rank: 160,
    },
  });

  const weak = scoreImdbCandidate({
    filmTitle: "Good Luck, Have Fun, Don't Die",
    originalTitle: null,
    filmYear: 2025,
    candidate: {
      id: "tt0974661",
      title: "17 Again",
      year: 2009,
      type: "feature",
      rank: 3600,
    },
  });

  expect(strong).toBeGreaterThan(weak);
  expect(strong).toBeGreaterThan(80);
});

test("selectBestImdbCandidate picks highest score candidate", () => {
  const best = selectBestImdbCandidate({
    filmTitle: "Good Luck, Have Fun, Don't Die",
    originalTitle: null,
    filmYear: 2025,
    candidates: [
      { id: "tt0974661", title: "17 Again", year: 2009, type: "feature", rank: 3600 },
      {
        id: "tt1341338",
        title: "Good Luck, Have Fun, Don't Die",
        year: 2025,
        type: "feature",
        rank: 161,
      },
    ],
  });

  expect(best?.candidate.id).toBe("tt1341338");
});

test("parseImdbRatingFromHtml reads rating from ld+json", () => {
  const html = `
    <html>
      <head>
        <script type="application/ld+json">{"@context":"https://schema.org","@type":"Movie","name":"Test","aggregateRating":{"@type":"AggregateRating","ratingCount":658,"bestRating":10,"worstRating":1,"ratingValue":7.4}}</script>
      </head>
    </html>
  `;

  const rating = parseImdbRatingFromHtml(html);
  expect(rating?.ratingValue).toBe(7.4);
  expect(rating?.voteCount).toBe(658);
  expect(rating?.ratingScale).toBe(10);
});

test("buildImdbSearchQueries includes title and original title variants", () => {
  const queries = buildImdbSearchQueries({
    title: "Good Luck, Have Fun, Don't Die",
    originalTitle: "Bonne chance",
    year: 2025,
  });

  expect(queries).toContain("Good Luck, Have Fun, Don't Die");
  expect(queries).toContain("Good Luck, Have Fun, Don't Die 2025");
  expect(queries).toContain("Bonne chance");
  expect(queries).toContain("Bonne chance 2025");
});
