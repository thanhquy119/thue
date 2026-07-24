import { get as httpsGet } from "node:https";
import { isAllowedLegalSource } from "./ingestion.ts";

const DEFAULT_MAX_SOURCE_BYTES = 100_000_000;
const OFFICIAL_CDN_TLS_FALLBACK = new Set([
  "g7.cdnchinhphu.vn",
  "congbaocdn.chinhphu.vn",
]);
const RETRYABLE_HTTP_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);
const COMMON_HEADERS = {
  "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131 Safari/537.36 ThueRoDurableIngestion/1.2",
  accept: "application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/msword,application/pdf,text/html,*/*",
  "accept-language": "vi-VN,vi;q=0.9,en;q=0.5",
  referer: "https://congbao.chinhphu.vn/",
};

function maximumSourceBytes() {
  const configured = Number(process.env.LEGAL_MAX_SOURCE_BYTES ?? 0);
  return Number.isFinite(configured) && configured >= 1_000_000
    ? Math.floor(configured)
    : DEFAULT_MAX_SOURCE_BYTES;
}

function sleep(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function responseHeaders(rawHeaders: string[]) {
  const headers = new Headers();
  for (let index = 0; index < rawHeaders.length; index += 2) {
    const name = rawHeaders[index];
    const value = rawHeaders[index + 1];
    if (name && value) headers.append(name, value);
  }
  return headers;
}

function officialCdnHost(value: string) {
  try {
    return OFFICIAL_CDN_TLS_FALLBACK.has(new URL(value).hostname.toLocaleLowerCase("en"));
  } catch {
    return false;
  }
}

async function fetchOfficialCdnOnce(
  urlValue: string,
  redirects: number,
): Promise<{ response: Response; buffer: Buffer; url: string }> {
  return new Promise((resolve, reject) => {
    const maximum = maximumSourceBytes();
    const request = httpsGet(
      urlValue,
      {
        headers: {
          ...COMMON_HEADERS,
          connection: "close",
        },
        rejectUnauthorized: false,
      },
      (incoming) => {
        const status = incoming.statusCode ?? 500;
        if (status >= 300 && status < 400) {
          const location = incoming.headers.location;
          incoming.resume();
          if (!location) {
            reject(new Error("Nguồn chuyển hướng không hợp lệ."));
            return;
          }
          fetchDurableLegalBuffer(new URL(location, urlValue).toString(), redirects + 1).then(resolve, reject);
          return;
        }
        if (status < 200 || status >= 300) {
          incoming.resume();
          reject(new Error(`Nguồn trả lỗi ${status}.`));
          return;
        }
        const announcedLength = Number(incoming.headers["content-length"] ?? 0);
        if (announcedLength > maximum) {
          incoming.resume();
          reject(new Error(`Tệp nguồn vượt giới hạn nền ${Math.round(maximum / 1_000_000)} MB.`));
          return;
        }

        const chunks: Buffer[] = [];
        let bytes = 0;
        incoming.on("data", (chunk: Buffer) => {
          bytes += chunk.length;
          if (bytes > maximum) {
            request.destroy(new Error(`Tệp nguồn vượt giới hạn nền ${Math.round(maximum / 1_000_000)} MB.`));
            return;
          }
          chunks.push(chunk);
        });
        incoming.on("end", () => {
          const buffer = Buffer.concat(chunks);
          if (buffer.byteLength < 100) {
            reject(new Error("Tệp nguồn quá nhỏ hoặc không hợp lệ."));
            return;
          }
          const response = new Response(null, {
            status,
            headers: responseHeaders(incoming.rawHeaders),
          });
          Object.defineProperty(response, "url", { value: urlValue });
          resolve({ response, buffer, url: urlValue });
        });
        incoming.on("error", reject);
      },
    );
    request.setTimeout(60_000, () => request.destroy(new Error("Nguồn phản hồi quá thời gian.")));
    request.on("error", reject);
  });
}

async function fetchOfficialCdn(
  urlValue: string,
  redirects: number,
): Promise<{ response: Response; buffer: Buffer; url: string }> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      return await fetchOfficialCdnOnce(urlValue, redirects);
    } catch (error) {
      lastError = error;
      if (attempt < 2) await sleep(800);
    }
  }
  throw lastError;
}

export async function fetchDurableLegalBuffer(
  urlValue: string,
  redirects = 0,
): Promise<{ response: Response; buffer: Buffer; url: string }> {
  if (!isAllowedLegalSource(urlValue)) {
    throw new Error("URL không thuộc danh sách nguồn pháp luật được phép.");
  }
  if (redirects > 4) throw new Error("Nguồn chuyển hướng quá nhiều lần.");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 45_000);
  try {
    let response: Response;
    try {
      response = await fetch(urlValue, {
        redirect: "manual",
        signal: controller.signal,
        cache: "no-store",
        headers: COMMON_HEADERS,
      });
    } catch (error) {
      if (officialCdnHost(urlValue)) {
        return fetchOfficialCdn(urlValue, redirects);
      }
      throw error;
    }

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) throw new Error("Nguồn chuyển hướng không hợp lệ.");
      return fetchDurableLegalBuffer(new URL(location, urlValue).toString(), redirects + 1);
    }

    if (!response.ok) {
      if (officialCdnHost(urlValue) && RETRYABLE_HTTP_STATUS.has(response.status)) {
        return fetchOfficialCdn(urlValue, redirects);
      }
      throw new Error(`Nguồn trả lỗi ${response.status}.`);
    }

    const maximum = maximumSourceBytes();
    const announcedLength = Number(response.headers.get("content-length") ?? 0);
    if (announcedLength > maximum) {
      throw new Error(`Tệp nguồn vượt giới hạn nền ${Math.round(maximum / 1_000_000)} MB.`);
    }
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.byteLength < 100) throw new Error("Tệp nguồn quá nhỏ hoặc không hợp lệ.");
    if (buffer.byteLength > maximum) {
      throw new Error(`Tệp nguồn vượt giới hạn nền ${Math.round(maximum / 1_000_000)} MB.`);
    }
    return { response, buffer, url: response.url || urlValue };
  } finally {
    clearTimeout(timer);
  }
}
