export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

export type ProgramPage = {
  items: unknown[];
  hasNext?: boolean;
  page?: number;
  totalPages?: number;
};

export type NormalizedFilm = {
  sourceFilmId: string;
  title: string;
  originalTitle: string | null;
  synopsis: string | null;
  runtimeMinutes: number | null;
  year: number | null;
  country: string | null;
  section: string | null;
};

export type NormalizedPerson = {
  sourcePersonId: string;
  name: string;
};

export type NormalizedCredit = {
  sourcePersonId: string;
  roleType: string;
  roleName: string;
  billingOrder: number | null;
};

export type NormalizedVenue = {
  sourceVenueId: string;
  name: string;
  address: string | null;
  lat: number | null;
  lng: number | null;
};

export type NormalizedScreening = {
  sourceScreeningId: string;
  startsAtUtc: string;
  localTz: string | null;
  format: string | null;
  ticketUrl: string | null;
  sourceVenueId: string | null;
};

export type NormalizedEntity = {
  film: NormalizedFilm;
  people: NormalizedPerson[];
  credits: NormalizedCredit[];
  venues: NormalizedVenue[];
  screenings: NormalizedScreening[];
};
