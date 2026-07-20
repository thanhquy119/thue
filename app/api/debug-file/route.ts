import { NextResponse } from "next/server";
import JSZip from "jszip";

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
  let entries: Array<{ name: string; dir: boolean; bytes: number; first16Hex?: string }> = [];
  let zipError = "";
  try {
    const zip = await JSZip.loadAsync(buffer, { checkCRC32: false, createFolders: true });
    entries = await Promise.all(
      Object.values(zip.files).slice(0, 100).map(async (entry) => {
        if (entry.dir) return { name: entry.name, dir: true, bytes: 0 };
        const data = await entry.async("nodebuffer");
        return { name: entry.name, dir: false, bytes: data.length, first16Hex: data.subarray(0, 16).toString("hex") };
      }),
    );
  } catch (error) {
    zipError = error instanceof Error ? error.message : String(error);
  }

  return NextResponse.json({
    status: response.status,
    url: response.url,
    contentType: response.headers.get("content-type"),
    contentLength: response.headers.get("content-length"),
    bytes: buffer.length,
    first64Hex: buffer.subarray(0, 64).toString("hex"),
    entries,
    zipError,
    disposition: response.headers.get("content-disposition"),
  }, { headers: { "cache-control": "no-store" } });
}
