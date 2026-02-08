import { createHash } from "node:crypto";
import type {
  NormalizedCredit,
  NormalizedEntity,
  NormalizedFilm,
  NormalizedPerson,
  NormalizedScreening,
  NormalizedVenue,
  ProgramPage,
} from "@berlinale/domain";

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return null;
}

function asBoolean(value: unknown): boolean | undefined {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    return value > 0;
  }
  if (typeof value === "string") {
    const lower = value.toLowerCase();
    if (["true", "1", "yes"].includes(lower)) {
      return true;
    }
    if (["false", "0", "no"].includes(lower)) {
      return false;
    }
  }
  return undefined;
}

function pickString(record: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string") {
      const trimmed = value.trim();
      if (trimmed.length > 0) {
        return trimmed;
      }
    }
  }
  return null;
}

function pickNumber(record: Record<string, unknown>, keys: string[]): number | null {
  for (const key of keys) {
    const parsed = asNumber(record[key]);
    if (parsed !== null) {
      return parsed;
    }
  }
  return null;
}

function pickIdString(record: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string") {
      const trimmed = value.trim();
      if (trimmed.length > 0) {
        return trimmed;
      }
    }
    if (typeof value === "number" && Number.isFinite(value)) {
      return String(value);
    }
    if (typeof value === "bigint") {
      return value.toString();
    }
  }
  return null;
}

function pickAny(record: Record<string, unknown>, keys: string[]): unknown {
  for (const key of keys) {
    if (key in record) {
      return record[key];
    }
  }
  return undefined;
}

function stableHash(input: unknown): string {
  return createHash("sha256").update(JSON.stringify(input)).digest("hex");
}

function parseMetaInfo(metaNode: unknown): {
  runtimeMinutes: number | null;
  year: number | null;
  country: string | null;
} {
  const lines = asArray(metaNode)
    .filter((entry): entry is string => typeof entry === "string")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);

  let runtimeMinutes: number | null = null;
  let year: number | null = null;
  let country: string | null = null;

  for (const line of lines) {
    if (runtimeMinutes === null) {
      const runtimeMatch = line.match(/(\d{1,3})\s*'/);
      if (runtimeMatch) {
        runtimeMinutes = Number(runtimeMatch[1]);
      }
    }

    const yearMatch = line.match(/\b(19|20)\d{2}\b/);
    if (year === null && yearMatch) {
      year = Number(yearMatch[0]);
    }

    if (country === null && yearMatch) {
      const candidate = line
        .replace(yearMatch[0], "")
        .replace(/[\s,]+$/g, "")
        .trim();
      if (candidate.length > 0) {
        country = candidate;
      }
    }
  }

  return { runtimeMinutes, year, country };
}

export function extractPage(pagePayload: unknown): ProgramPage {
  const root = asRecord(pagePayload);
  if (!root) {
    return { items: [] };
  }

  const candidateArrays = [
    pickAny(root, ["items", "Items", "results", "Results", "entries", "Entries", "data", "Data"]),
    pickAny(asRecord(root.data) ?? {}, ["items", "results", "entries"]),
  ];

  let items: unknown[] = [];
  for (const candidate of candidateArrays) {
    if (Array.isArray(candidate)) {
      items = candidate;
      break;
    }
  }

  const hasNextRaw = pickAny(root, ["hasNext", "HasNext", "has_next", "nextPage", "NextPage"]);
  const totalPagesRaw = pickAny(root, ["totalPages", "TotalPages", "pageCount", "PageCount"]);
  const pageRaw = pickAny(root, ["page", "Page", "currentPage", "CurrentPage"]);

  return {
    items,
    hasNext: asBoolean(hasNextRaw),
    page: asNumber(pageRaw) ?? undefined,
    totalPages: asNumber(totalPagesRaw) ?? undefined,
  };
}

export function extractSourceId(item: unknown): string {
  const record = asRecord(item);
  if (!record) {
    return `hash:${stableHash(item)}`;
  }

  const direct = pickIdString(record, [
    "id",
    "Id",
    "uuid",
    "UUID",
    "slug",
    "Slug",
    "code",
    "Code",
  ]);
  if (direct) {
    return direct;
  }

  const nested = asRecord(record.film) ?? asRecord(record.movie);
  if (nested) {
    const nestedId = pickIdString(nested, ["id", "Id", "uuid", "slug"]);
    if (nestedId) {
      return nestedId;
    }
  }

  return `hash:${stableHash(item)}`;
}

function normalizeFilm(item: Record<string, unknown>, sourceFilmId: string): NormalizedFilm {
  const filmNode = asRecord(item.film) ?? asRecord(item.movie) ?? item;
  const sectionNode = asRecord(item.section);
  const sectionName = sectionNode
    ? pickString(sectionNode, ["name", "Name"])
    : pickString(item, ["section", "Section", "category", "Category"]);
  const metaInfo = parseMetaInfo(
    pickAny(item, ["meta", "metaCompact", "metaTile", "Meta", "MetaCompact", "MetaTile"]),
  );

  const title = pickString(filmNode, ["title", "Title", "name", "Name"]) ?? sourceFilmId;
  return {
    sourceFilmId,
    title,
    originalTitle: pickString(filmNode, ["originalTitle", "OriginalTitle", "original_title"]),
    synopsis:
      pickString(filmNode, ["synopsis", "description", "Description", "logline"]) ??
      pickString(item, ["synopsis", "shortSynopsis"]),
    runtimeMinutes:
      pickNumber(filmNode, ["runtime", "runtimeMinutes", "duration", "Duration"]) ??
      metaInfo.runtimeMinutes,
    year: pickNumber(filmNode, ["year", "Year", "productionYear", "ProductionYear"]) ?? metaInfo.year,
    country: pickString(filmNode, ["country", "Country", "countries", "Countries"]) ?? metaInfo.country,
    section: sectionName,
  };
}

function normalizePeople(item: Record<string, unknown>): {
  people: NormalizedPerson[];
  credits: NormalizedCredit[];
} {
  const sources: Array<{
    nodes: unknown[];
    roleType: string;
    defaultRoleName: string;
  }> = [
    {
      nodes: asArray(pickAny(item, ["credits", "Credits", "persons", "Persons", "contributors", "Contributors"])),
      roleType: "credit",
      defaultRoleName: "credit",
    },
    {
      nodes: asArray(item.person),
      roleType: "person",
      defaultRoleName: "person",
    },
    {
      nodes: asArray(item.castMembers),
      roleType: "cast",
      defaultRoleName: "cast",
    },
    {
      nodes: asArray(item.reducedCastMembers),
      roleType: "cast",
      defaultRoleName: "cast",
    },
    {
      nodes: asArray(item.crewMembers),
      roleType: "crew",
      defaultRoleName: "crew",
    },
    {
      nodes: asArray(item.reducedCrewMembers),
      roleType: "crew",
      defaultRoleName: "crew",
    },
  ];

  const people = new Map<string, NormalizedPerson>();
  const creditKeys = new Set<string>();
  const credits: NormalizedCredit[] = [];

  for (const source of sources) {
    source.nodes.forEach((node, index) => {
      const record = asRecord(node);

      let name: string | null = null;
      let sourcePersonId: string | null = null;
      if (record) {
        name = pickString(record, ["name", "Name", "person", "Person"]);
        sourcePersonId = pickIdString(record, ["personId", "person_id", "id", "Id", "uuid", "slug"]);
      } else if (typeof node === "string") {
        const trimmed = node.trim();
        if (trimmed.length > 0) {
          name = trimmed;
        }
      }

      if (!name) {
        return;
      }

      const personId = sourcePersonId ?? `person:${stableHash(name.toLowerCase())}`;
      if (!people.has(personId)) {
        people.set(personId, { sourcePersonId: personId, name });
      }

      const roleName = record
        ? pickString(record, ["roleName", "job", "Job", "credit", "role", "Role"]) ?? source.defaultRoleName
        : source.defaultRoleName;
      const roleType = record
        ? pickString(record, ["roleType", "department", "group"]) ?? source.roleType
        : source.roleType;
      const billingOrder = record
        ? pickNumber(record, ["order", "billingOrder", "position", "sort"])
        : index;

      const creditKey = `${personId}::${roleType}::${roleName}`;
      if (creditKeys.has(creditKey)) {
        return;
      }
      creditKeys.add(creditKey);

      credits.push({
        sourcePersonId: personId,
        roleType,
        roleName,
        billingOrder,
      });
    });
  }

  return {
    people: [...people.values()],
    credits,
  };
}

function normalizeVenuesAndScreenings(item: Record<string, unknown>): {
  venues: NormalizedVenue[];
  screenings: NormalizedScreening[];
} {
  const screeningsNode = asArray(
    pickAny(item, ["screenings", "Screenings", "events", "Events", "dates", "Dates"]),
  );

  const venues = new Map<string, NormalizedVenue>();
  const screenings: NormalizedScreening[] = [];

  screeningsNode.forEach((screeningNode, index) => {
    const screening = asRecord(screeningNode);
    if (!screening) {
      return;
    }

    const timeNode = asRecord(screening.time);
    const unixTime = timeNode ? pickNumber(timeNode, ["unixtime", "unixTime", "timestamp", "unix"]) : null;

    let startsAtDate: Date | null = null;
    if (unixTime !== null) {
      const candidate = new Date(Math.trunc(unixTime) * 1000);
      if (!Number.isNaN(candidate.getTime())) {
        startsAtDate = candidate;
      }
    }

    if (!startsAtDate) {
      const startsAt = pickString(screening, ["startsAt", "start", "dateTime", "date", "Date"]);
      if (startsAt) {
        const candidate = new Date(startsAt);
        if (!Number.isNaN(candidate.getTime())) {
          startsAtDate = candidate;
        }
      }
    }

    if (!startsAtDate) {
      return;
    }

    const sourceScreeningId =
      pickIdString(screening, ["extIdScreening", "id", "Id", "uuid", "slug"]) ??
      `screening-${index}-${stableHash(screening)}`;

    const venueNode = asRecord(screening.venue) ?? asRecord(screening.location) ?? null;
    let sourceVenueId: string | null = null;
    let venue: NormalizedVenue | null = null;

    if (venueNode) {
      const venueName = pickString(venueNode, ["name", "Name"]);
      sourceVenueId =
        pickIdString(venueNode, ["id", "Id", "uuid", "slug"]) ??
        (venueName ? `venue:${stableHash(venueName.toLowerCase())}` : `venue:${stableHash(venueNode)}`);
      venue = {
        sourceVenueId,
        name: venueName ?? sourceVenueId,
        address: pickString(venueNode, ["address", "Address"]),
        lat: pickNumber(venueNode, ["lat", "latitude"]),
        lng: pickNumber(venueNode, ["lng", "lon", "longitude"]),
      };
    } else {
      const venueName =
        pickString(screening, ["venueHall", "venueName", "locationName"]) ??
        (typeof screening.venue === "string" ? screening.venue.trim() : null);
      if (venueName) {
        sourceVenueId = `venue:${stableHash(venueName.toLowerCase())}`;
        venue = {
          sourceVenueId,
          name: venueName,
          address: null,
          lat: null,
          lng: null,
        };
      }
    }

    if (venue && sourceVenueId) {
      venues.set(sourceVenueId, venue);
    }

    const ticketRaw = pickAny(screening, ["ticketUrl", "ticket", "bookingUrl"]);
    let ticketUrl: string | null = null;
    if (typeof ticketRaw === "string") {
      const trimmed = ticketRaw.trim();
      ticketUrl = trimmed.length > 0 ? trimmed : null;
    } else {
      const ticketNode = asRecord(ticketRaw);
      if (ticketNode) {
        ticketUrl = pickString(ticketNode, ["url", "link", "href"]);
      }
    }

    screenings.push({
      sourceScreeningId,
      startsAtUtc: startsAtDate.toISOString(),
      localTz:
        pickString(screening, ["timezone", "timeZone", "tz"]) ??
        (unixTime !== null ? "Europe/Berlin" : null),
      format: pickString(screening, ["format", "Format", "medium", "type"]),
      ticketUrl,
      sourceVenueId,
    });
  });

  return {
    venues: [...venues.values()],
    screenings,
  };
}

export function normalizeProgramItem(item: unknown): NormalizedEntity {
  const root = asRecord(item) ?? {};
  const sourceFilmId = extractSourceId(root);
  const film = normalizeFilm(root, sourceFilmId);
  const { people, credits } = normalizePeople(root);
  const { venues, screenings } = normalizeVenuesAndScreenings(root);

  return {
    film,
    people,
    credits,
    venues,
    screenings,
  };
}
