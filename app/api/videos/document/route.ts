import {NextResponse} from "next/server";
import {findLegalVideoJobForDocument, publicLegalVideoJob} from "@/lib/video/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const number = new URL(request.url).searchParams.get("number")?.trim() ?? "";
  if (number.length < 2 || number.length > 160) {
    return NextResponse.json({error: "Số hiệu văn bản không hợp lệ."}, {status: 400});
  }

  const job = await findLegalVideoJobForDocument(number, "detailed", "female");
  return NextResponse.json(
    {ok: true, job: job ? publicLegalVideoJob(job) : null},
    {headers: {"cache-control": "no-store"}},
  );
}
