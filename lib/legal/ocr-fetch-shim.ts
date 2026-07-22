import { request as httpsRequest } from "node:https";

const GDT_HOSTS = new Set(["gdt.gov.vn", "www.gdt.gov.vn"]);
const MAX_SOURCE_BYTES = 18_000_000;
const FETCH_SHIM_MARK = Symbol.for("thue.ocrFetchShimInstalled");

type MarkedGlobal = typeof globalThis & { [FETCH_SHIM_MARK]?: boolean };

function browserHeaders(init?: RequestInit) {
  const headers = new Headers(init?.headers);
  if (!headers.has("user-agent")) {
    headers.set(
      "user-agent",
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36",
    );
  }
  if (!headers.has("accept")) headers.set("accept", "application/pdf,application/octet-stream;q=0.9,*/*;q=0.8");
  if (!headers.has("accept-language")) headers.set("accept-language", "vi-VN,vi;q=0.9,en-US;q=0.7,en;q=0.6");
  if (!headers.has("referer")) headers.set("referer", "https://www.gdt.gov.vn/");
  headers.set("cache-control", "no-cache");
  headers.set("pragma", "no-cache");
  return headers;
}

function alternateGdtUrl(url: URL) {
  const alternate = new URL(url.toString());
  alternate.hostname = url.hostname === "www.gdt.gov.vn" ? "gdt.gov.vn" : "www.gdt.gov.vn";
  return alternate;
}

function errorCode(error: unknown) {
  if (!error || typeof error !== "object") return "";
  const direct = "code" in error && typeof error.code === "string" ? error.code : "";
  if (direct) return direct;
  const cause = "cause" in error ? error.cause : null;
  return cause && typeof cause === "object" && "code" in cause && typeof cause.code === "string" ? cause.code : "";
}

function fetchGdtViaHttps(url: URL, init?: RequestInit): Promise<Response> {
  return new Promise((resolve, reject) => {
    const headers = browserHeaders(init);
    const request = httpsRequest(
      {
        protocol: "https:",
        hostname: url.hostname,
        servername: url.hostname,
        port: url.port ? Number(url.port) : 443,
        path: `${url.pathname}${url.search}`,
        method: init?.method || "GET",
        headers: Object.fromEntries(headers.entries()),
        family: 4,
        rejectUnauthorized: false,
      },
      (incoming) => {
        const chunks: Buffer[] = [];
        let bytes = 0;
        let stopped = false;

        incoming.on("data", (chunk: Buffer) => {
          if (stopped) return;
          bytes += chunk.length;
          if (bytes > MAX_SOURCE_BYTES) {
            stopped = true;
            request.destroy(new Error("Tệp PDF vượt giới hạn 18 MB."));
            return;
          }
          chunks.push(Buffer.from(chunk));
        });

        incoming.on("end", () => {
          if (stopped) return;
          const responseHeaders = new Headers();
          for (let index = 0; index < incoming.rawHeaders.length; index += 2) {
            const name = incoming.rawHeaders[index];
            const value = incoming.rawHeaders[index + 1];
            if (name && value) responseHeaders.append(name, value);
          }
          const response = new Response(Buffer.concat(chunks), {
            status: incoming.statusCode || 500,
            statusText: incoming.statusMessage || "",
            headers: responseHeaders,
          });
          Object.defineProperty(response, "url", { value: url.toString() });
          resolve(response);
        });
        incoming.on("error", reject);
      },
    );

    request.setTimeout(30_000, () => request.destroy(new Error("Máy chủ Cục Thuế phản hồi quá thời gian.")));
    request.on("error", reject);
    if (init?.body && typeof init.body === "string") request.write(init.body);
    request.end();
  });
}

export async function fetchGdtPdfWithFallback(
  originalFetch: typeof fetch,
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  const requestedUrl = new URL(input instanceof Request ? input.url : input.toString());
  const enrichedInit: RequestInit = { ...init, headers: browserHeaders(init), redirect: init?.redirect ?? "manual" };
  const attempts = [requestedUrl, alternateGdtUrl(requestedUrl)];
  const failures: string[] = [];

  for (const candidate of attempts) {
    try {
      return await originalFetch(candidate, enrichedInit);
    } catch (error) {
      failures.push(`fetch ${candidate.hostname}: ${errorCode(error) || (error instanceof Error ? error.message : "unknown")}`);
    }

    try {
      return await fetchGdtViaHttps(candidate, enrichedInit);
    } catch (error) {
      failures.push(`https ${candidate.hostname}: ${errorCode(error) || (error instanceof Error ? error.message : "unknown")}`);
    }
  }

  throw new Error(`Không tải được PDF từ máy chủ Cục Thuế. ${failures.join("; ").slice(0, 420)}`);
}

export function installOcrFetchShim() {
  const marked = globalThis as MarkedGlobal;
  if (marked[FETCH_SHIM_MARK]) return;

  const originalFetch = globalThis.fetch.bind(globalThis);
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    let url: URL;
    try {
      url = new URL(input instanceof Request ? input.url : input.toString());
    } catch {
      return originalFetch(input, init);
    }

    if (url.protocol === "https:" && GDT_HOSTS.has(url.hostname.toLocaleLowerCase("en"))) {
      return fetchGdtPdfWithFallback(originalFetch, input, init);
    }
    return originalFetch(input, init);
  }) as typeof fetch;

  marked[FETCH_SHIM_MARK] = true;
}
