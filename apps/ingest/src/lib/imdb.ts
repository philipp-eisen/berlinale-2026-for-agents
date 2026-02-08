type RetryOptions = {
  timeoutMs: number;
  retries: number;
};

export type ImdbCandidate = {
  id: string;
  title: string;
  year: number | null;
  type: string | null;
  rank: number | null;
};

export type ImdbRating = {
  ratingValue: number | null;
  ratingScale: number;
  voteCount: number | null;
};

const BROWSER_HEADERS: Record<string, string> = {
  "user-agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36",
  accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "accept-language": "en-US,en;q=0.9",
  "cache-control": "no-cache",
  pragma: "no-cache",
  "sec-fetch-dest": "document",
  "sec-fetch-mode": "navigate",
  "sec-fetch-site": "none",
  "upgrade-insecure-requests": "1",
};

function normalizeTitle(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenize(value: string): string[] {
  const normalized = normalizeTitle(value);
  if (!normalized) {
    return [];
  }
  return normalized.split(" ").filter((token) => token.length > 0);
}

function jaccardSimilarity(a: string, b: string): number {
  const tokensA = new Set(tokenize(a));
  const tokensB = new Set(tokenize(b));

  if (tokensA.size === 0 || tokensB.size === 0) {
    return 0;
  }

  let intersection = 0;
  for (const token of tokensA) {
    if (tokensB.has(token)) {
      intersection += 1;
    }
  }

  const union = tokensA.size + tokensB.size - intersection;
  return union > 0 ? intersection / union : 0;
}

function titleSimilarityScore(filmTitle: string, originalTitle: string | null, candidateTitle: string): number {
  const normalizedFilm = normalizeTitle(filmTitle);
  const normalizedOriginal = originalTitle ? normalizeTitle(originalTitle) : "";
  const normalizedCandidate = normalizeTitle(candidateTitle);

  if (!normalizedCandidate) {
    return 0;
  }

  const filmSimilarity = jaccardSimilarity(filmTitle, candidateTitle);
  const originalSimilarity = originalTitle ? jaccardSimilarity(originalTitle, candidateTitle) : 0;
  const bestSimilarity = Math.max(filmSimilarity, originalSimilarity);

  let score = bestSimilarity * 65;

  if (normalizedCandidate === normalizedFilm || (normalizedOriginal && normalizedCandidate === normalizedOriginal)) {
    score += 25;
  } else if (
    normalizedCandidate.includes(normalizedFilm) ||
    (normalizedOriginal.length > 0 && normalizedCandidate.includes(normalizedOriginal))
  ) {
    score += 12;
  }

  if (normalizedFilm.length <= 3 && normalizedCandidate !== normalizedFilm) {
    score -= 20;
  }

  return score;
}

export function scoreImdbCandidate(args: {
  filmTitle: string;
  originalTitle: string | null;
  filmYear: number | null;
  candidate: ImdbCandidate;
}): number {
  let score = titleSimilarityScore(args.filmTitle, args.originalTitle, args.candidate.title);

  if (args.filmYear !== null && args.candidate.year !== null) {
    const diff = Math.abs(args.filmYear - args.candidate.year);
    if (diff === 0) {
      score += 22;
    } else if (diff === 1) {
      score += 14;
    } else if (diff === 2) {
      score += 8;
    } else if (diff <= 5) {
      score += 2;
    } else {
      score -= 24;
    }
  }

  if (args.candidate.type === "feature" || args.candidate.type === "movie") {
    score += 8;
  }

  if (args.candidate.rank !== null) {
    score += Math.max(-6, 10 - Math.log10(args.candidate.rank + 1) * 3);
  }

  return Math.round(score * 10) / 10;
}

export function parseImdbSuggestionPayload(payload: unknown): ImdbCandidate[] {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return [];
  }

  const root = payload as { d?: unknown };
  if (!Array.isArray(root.d)) {
    return [];
  }

  return root.d
    .map((entry): ImdbCandidate | null => {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
        return null;
      }

      const record = entry as Record<string, unknown>;
      const id = typeof record.id === "string" ? record.id : null;
      const title = typeof record.l === "string" ? record.l : null;
      if (!id || !id.startsWith("tt") || !title) {
        return null;
      }

      const rawYear = record.y;
      const year = typeof rawYear === "number" && Number.isFinite(rawYear) ? rawYear : null;

      const rawType = record.q;
      const type = typeof rawType === "string" ? rawType.toLowerCase() : null;

      const rawRank = record.rank;
      const rank = typeof rawRank === "number" && Number.isFinite(rawRank) ? rawRank : null;

      return {
        id,
        title,
        year,
        type,
        rank,
      };
    })
    .filter((candidate): candidate is ImdbCandidate => candidate !== null);
}

function firstSuggestionPathChar(query: string): string {
  const first = normalizeTitle(query).charAt(0);
  if (!first || !/[a-z0-9]/.test(first)) {
    return "a";
  }
  return first;
}

async function fetchWithRetry(
  url: string,
  init: RequestInit,
  options: RetryOptions,
): Promise<Response> {
  for (let attempt = 1; attempt <= options.retries + 1; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), options.timeoutMs);

    try {
      const response = await fetch(url, { ...init, signal: controller.signal });
      if ((response.status === 429 || response.status >= 500) && attempt <= options.retries) {
        const backoffMs = Math.min(10_000, 500 * 2 ** (attempt - 1)) + Math.floor(Math.random() * 200);
        await Bun.sleep(backoffMs);
        continue;
      }

      if (!response.ok) {
        throw new Error(`Request failed (${response.status}) for ${url}`);
      }

      return response;
    } catch (error) {
      const lastAttempt = attempt > options.retries;
      if (lastAttempt) {
        throw error;
      }
      const backoffMs = Math.min(10_000, 500 * 2 ** (attempt - 1)) + Math.floor(Math.random() * 200);
      await Bun.sleep(backoffMs);
    } finally {
      clearTimeout(timeout);
    }
  }

  throw new Error(`Failed to fetch after retries: ${url}`);
}

export async function searchImdbCandidates(
  query: string,
  options: RetryOptions,
): Promise<ImdbCandidate[]> {
  const trimmed = query.trim();
  if (!trimmed) {
    return [];
  }

  const encoded = encodeURIComponent(trimmed);
  const firstChar = firstSuggestionPathChar(trimmed);
  const url = `https://v3.sg.media-imdb.com/suggestion/${firstChar}/${encoded}.json`;

  const response = await fetchWithRetry(
    url,
    {
      method: "GET",
      headers: {
        "user-agent": BROWSER_HEADERS["user-agent"],
        accept: "application/json",
        "accept-language": "en-US,en;q=0.9",
      },
    },
    options,
  );

  const payload = await response.json();
  return parseImdbSuggestionPayload(payload);
}

function parseImdbRatingFromObject(value: unknown): ImdbRating | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  const aggregate = record.aggregateRating;
  if (!aggregate || typeof aggregate !== "object" || Array.isArray(aggregate)) {
    return null;
  }

  const agg = aggregate as Record<string, unknown>;
  const ratingValue = Number(agg.ratingValue);
  if (!Number.isFinite(ratingValue)) {
    return null;
  }

  const voteRaw = agg.ratingCount;
  const voteCount =
    typeof voteRaw === "number"
      ? voteRaw
      : typeof voteRaw === "string"
        ? Number(voteRaw.replace(/,/g, ""))
        : NaN;

  const bestRatingRaw = Number(agg.bestRating);
  const ratingScale = Number.isFinite(bestRatingRaw) ? bestRatingRaw : 10;

  return {
    ratingValue,
    ratingScale,
    voteCount: Number.isFinite(voteCount) ? voteCount : null,
  };
}

export function parseImdbRatingFromHtml(html: string): ImdbRating | null {
  const scripts = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)];

  for (const script of scripts) {
    const raw = script[1];
    if (!raw) {
      continue;
    }

    try {
      const payload = JSON.parse(raw) as unknown;
      if (Array.isArray(payload)) {
        for (const entry of payload) {
          const parsed = parseImdbRatingFromObject(entry);
          if (parsed) {
            return parsed;
          }
        }
      } else {
        const parsed = parseImdbRatingFromObject(payload);
        if (parsed) {
          return parsed;
        }
      }
    } catch {
      continue;
    }
  }

  const fallback = html.match(
    /"aggregateRating":\{"@type":"AggregateRating","ratingCount":([0-9,]+),"bestRating":([0-9.]+),"worstRating":[0-9.]+,"ratingValue":([0-9.]+)\}/,
  );
  if (fallback) {
    const voteCount = Number(fallback[1].replace(/,/g, ""));
    const ratingScale = Number(fallback[2]);
    const ratingValue = Number(fallback[3]);

    if (Number.isFinite(ratingValue) && Number.isFinite(ratingScale)) {
      return {
        ratingValue,
        ratingScale,
        voteCount: Number.isFinite(voteCount) ? voteCount : null,
      };
    }
  }

  return null;
}

export async function fetchImdbTitleRating(
  imdbId: string,
  options: RetryOptions,
): Promise<ImdbRating | null> {
  const url = `https://www.imdb.com/title/${imdbId}/`;

  const response = await fetchWithRetry(
    url,
    {
      method: "GET",
      headers: BROWSER_HEADERS,
    },
    options,
  );

  const html = await response.text();
  if (!html) {
    return null;
  }

  return parseImdbRatingFromHtml(html);
}

export function selectBestImdbCandidate(args: {
  filmTitle: string;
  originalTitle: string | null;
  filmYear: number | null;
  candidates: ImdbCandidate[];
}): { candidate: ImdbCandidate; score: number } | null {
  let best: { candidate: ImdbCandidate; score: number } | null = null;

  for (const candidate of args.candidates) {
    const score = scoreImdbCandidate({
      filmTitle: args.filmTitle,
      originalTitle: args.originalTitle,
      filmYear: args.filmYear,
      candidate,
    });
    if (!best || score > best.score) {
      best = { candidate, score };
    }
  }

  return best;
}

export function buildImdbSearchQueries(args: {
  title: string;
  originalTitle: string | null;
  year: number | null;
}): string[] {
  const queries: string[] = [];
  const add = (value: string) => {
    const trimmed = value.trim();
    if (!trimmed) {
      return;
    }
    if (!queries.includes(trimmed)) {
      queries.push(trimmed);
    }
  };

  add(args.title);
  if (args.year !== null) {
    add(`${args.title} ${args.year}`);
  }

  if (args.originalTitle && normalizeTitle(args.originalTitle) !== normalizeTitle(args.title)) {
    add(args.originalTitle);
    if (args.year !== null) {
      add(`${args.originalTitle} ${args.year}`);
    }
  }

  return queries;
}
