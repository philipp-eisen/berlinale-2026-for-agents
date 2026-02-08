type FetchProgramPageOptions = {
  endpoint: string;
  locale: string;
  page: number;
  timeoutMs: number;
  retries: number;
};

export type ProgramPageResponse = {
  statusCode: number;
  payload: unknown;
};

function isRetryableStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

function readRetryAfterMs(value: string | null): number | null {
  if (!value) {
    return null;
  }

  const seconds = Number(value);
  if (Number.isFinite(seconds)) {
    return Math.max(0, Math.floor(seconds * 1000));
  }

  const parsedDate = Date.parse(value);
  if (Number.isFinite(parsedDate)) {
    return Math.max(0, parsedDate - Date.now());
  }

  return null;
}

function nextBackoffMs(attempt: number): number {
  const base = 500;
  const cap = 10_000;
  const exp = Math.min(cap, base * 2 ** (attempt - 1));
  const jitter = Math.floor(Math.random() * 250);
  return exp + jitter;
}

export async function fetchProgramPage(
  options: FetchProgramPageOptions,
): Promise<ProgramPageResponse> {
  for (let attempt = 1; attempt <= options.retries + 1; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), options.timeoutMs);

    try {
      const response = await fetch(options.endpoint, {
        method: "POST",
        headers: {
          accept: "application/json, text/plain, */*",
          "content-type": "application/json",
          origin: "https://www.berlinale.de",
          referer: "https://www.berlinale.de/",
          "user-agent": "berlinale-ingest/0.1",
        },
        body: JSON.stringify({ Page: options.page }),
        signal: controller.signal,
      });

      const statusCode = response.status;
      const payload = await response.json();

      if (!response.ok && isRetryableStatus(statusCode) && attempt <= options.retries) {
        const retryAfter = readRetryAfterMs(response.headers.get("retry-after"));
        await Bun.sleep(retryAfter ?? nextBackoffMs(attempt));
        continue;
      }

      if (!response.ok) {
        throw new Error(`Request failed with status ${statusCode}`);
      }

      return { statusCode, payload };
    } catch (error) {
      const isLastAttempt = attempt > options.retries;
      if (isLastAttempt) {
        throw error;
      }
      await Bun.sleep(nextBackoffMs(attempt));
    } finally {
      clearTimeout(timeout);
    }
  }

  throw new Error("Unreachable retry state");
}
