import { GET as smokeGet } from "../route";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL("/api/ingestion/smoke", request.url);
  url.searchParams.set("case", "full-ocr-252");
  return smokeGet(new Request(url, { headers: request.headers }));
}
