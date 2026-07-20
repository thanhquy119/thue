import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const URL_VALUE = "https://congbaocdn.chinhphu.vn/180507251028987904/2026/5/14/469455-1778231931_1778720611_signed.docx";

export async function GET() {
  const response = await fetch(URL_VALUE, {
    cache: "no-store",
    headers: { "user-agent": "ThueLegalReader/1.0" },
  });
  const buffer = Buffer.from(await response.arrayBuffer());
  return NextResponse.json({
    status: response.status,
    url: response.url,
    contentType: response.headers.get("content-type"),
    contentLength: response.headers.get("content-length"),
    bytes: buffer.length,
    first64Hex: buffer.subarray(0, 64).toString("hex"),
    first200Text: buffer.subarray(0, 200).toString("latin1"),
    disposition: response.headers.get("content-disposition"),
  }, { headers: { "cache-control": "no-store" } });
}
