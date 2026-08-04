import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import test from "node:test";
import {
  DEFAULT_LEGAL_VIDEO_GENERATION_RESUME_AT,
  legalVideoGenerationPaused,
  legalVideoGenerationPauseMessage,
} from "../lib/video/generation-pause.ts";

const startRoute = readFileSync(new URL("../app/api/videos/start/route.ts", import.meta.url), "utf8");
const automaticGeneration = readFileSync(new URL("../lib/video/automatic-generation.ts", import.meta.url), "utf8");

test("tạm dừng tạo storyboard đến đầu tháng 9 theo giờ Việt Nam", () => {
  assert.equal(DEFAULT_LEGAL_VIDEO_GENERATION_RESUME_AT, "2026-08-31T17:00:00.000Z");
  assert.equal(legalVideoGenerationPaused(new Date("2026-08-31T16:59:59.999Z")), true);
  assert.equal(legalVideoGenerationPaused(new Date("2026-08-31T17:00:00.000Z")), false);
  assert.match(legalVideoGenerationPauseMessage(), /01\/09\/2026/u);
});

test("API tạo video chặn trước khi tìm văn bản hoặc khởi động workflow", () => {
  const pauseGuard = startRoute.indexOf("if (legalVideoGenerationPaused())");
  const resolveCall = startRoute.indexOf("response = await resolveDocument(query)");
  const workflowStart = startRoute.indexOf("await start(legalVideoGenerationWorkflow");
  assert.ok(pauseGuard > 0);
  assert.ok(resolveCall > pauseGuard);
  assert.ok(workflowStart > pauseGuard);
  assert.match(startRoute, /VIDEO_GENERATION_PAUSED/u);
});

test("tự động tạo video cũng tôn trọng thời gian tạm dừng", () => {
  assert.match(
    automaticGeneration,
    /if \(legalVideoGenerationPaused\(\) \|\| !automationEnabled\(\)\)/u,
  );
  assert.match(automaticGeneration, /reason: "disabled"/u);
});
