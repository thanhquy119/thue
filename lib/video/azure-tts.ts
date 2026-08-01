import type {LegalVideoVoice} from "./types";

export class AzureTtsError extends Error {
  status: number;
  retryAfterMs: number;
  retryable: boolean;

  constructor(message: string, options: {status: number; retryAfterMs?: number; retryable?: boolean}) {
    super(message);
    this.name = "AzureTtsError";
    this.status = options.status;
    this.retryAfterMs = options.retryAfterMs ?? 0;
    this.retryable = options.retryable ?? false;
  }
}

function speechKey() {
  return process.env.AZURE_SPEECH_KEY?.trim() || "";
}

function speechRegion() {
  return process.env.AZURE_SPEECH_REGION?.trim() || "";
}

export function azureTtsConfigured() {
  return Boolean(speechKey() && speechRegion());
}

export function azureVoiceName(voice: LegalVideoVoice) {
  const configured = voice === "male"
    ? process.env.VIDEO_TTS_MALE_VOICE?.trim()
    : process.env.VIDEO_TTS_FEMALE_VOICE?.trim();
  return configured || (voice === "male" ? "vi-VN-NamMinhNeural" : "vi-VN-HoaiMyNeural");
}

function escapeXml(value: string) {
  return value
    .replace(/&/gu, "&amp;")
    .replace(/</gu, "&lt;")
    .replace(/>/gu, "&gt;")
    .replace(/"/gu, "&quot;")
    .replace(/'/gu, "&apos;");
}

export function buildAzureSsml(input: {
  text: string;
  voice: string;
  rate?: string;
  pitch?: string;
}) {
  const rate = input.rate || process.env.VIDEO_TTS_RATE?.trim() || "-4%";
  const pitch = input.pitch || process.env.VIDEO_TTS_PITCH?.trim() || "+0Hz";
  return [
    '<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="vi-VN">',
    `<voice name="${escapeXml(input.voice)}">`,
    `<prosody rate="${escapeXml(rate)}" pitch="${escapeXml(pitch)}">`,
    escapeXml(input.text),
    "</prosody>",
    "</voice>",
    "</speak>",
  ].join("");
}

function readAscii(bytes: Uint8Array, offset: number, length: number) {
  return new TextDecoder("ascii").decode(bytes.slice(offset, offset + length));
}

function readUint16(bytes: Uint8Array, offset: number) {
  return new DataView(bytes.buffer, bytes.byteOffset + offset, 2).getUint16(0, true);
}

function readUint32(bytes: Uint8Array, offset: number) {
  return new DataView(bytes.buffer, bytes.byteOffset + offset, 4).getUint32(0, true);
}

export function wavDurationSeconds(bytes: Uint8Array) {
  if (bytes.byteLength < 44 || readAscii(bytes, 0, 4) !== "RIFF" || readAscii(bytes, 8, 4) !== "WAVE") {
    throw new Error("Azure TTS không trả về tệp WAV hợp lệ.");
  }
  let offset = 12;
  let byteRate = 0;
  let dataSize = 0;
  while (offset + 8 <= bytes.byteLength) {
    const id = readAscii(bytes, offset, 4);
    const size = readUint32(bytes, offset + 4);
    const dataOffset = offset + 8;
    if (id === "fmt " && size >= 16 && dataOffset + 16 <= bytes.byteLength) {
      const channels = readUint16(bytes, dataOffset + 2);
      const sampleRate = readUint32(bytes, dataOffset + 4);
      const bitsPerSample = readUint16(bytes, dataOffset + 14);
      byteRate = sampleRate * channels * Math.max(1, bitsPerSample / 8);
    }
    if (id === "data") dataSize = Math.min(size, Math.max(0, bytes.byteLength - dataOffset));
    const nextOffset = dataOffset + size + (size % 2);
    if (nextOffset <= offset) break;
    offset = nextOffset;
  }
  if (!byteRate || !dataSize) throw new Error("Không đọc được thời lượng WAV từ Azure TTS.");
  return Number((dataSize / byteRate).toFixed(3));
}

function retryAfterMs(response: Response) {
  const header = response.headers.get("retry-after")?.trim();
  if (!header) return 5_000;
  const seconds = Number(header);
  if (Number.isFinite(seconds)) return Math.max(1_000, Math.ceil(seconds * 1_000));
  const date = Date.parse(header);
  return Number.isFinite(date) ? Math.max(1_000, date - Date.now()) : 5_000;
}

export async function synthesizeAzureVietnamese(input: {
  text: string;
  voice: LegalVideoVoice;
}) {
  if (!azureTtsConfigured()) {
    throw new AzureTtsError("Azure Speech chưa được cấu hình.", {status: 503});
  }
  const voice = azureVoiceName(input.voice);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 55_000);
  try {
    const response = await fetch(
      `https://${encodeURIComponent(speechRegion())}.tts.speech.microsoft.com/cognitiveservices/v1`,
      {
        method: "POST",
        signal: controller.signal,
        headers: {
          "Ocp-Apim-Subscription-Key": speechKey(),
          "Content-Type": "application/ssml+xml",
          "X-Microsoft-OutputFormat": "riff-24khz-16bit-mono-pcm",
          "User-Agent": "ThueRoLegalVideo/1.0",
        },
        body: buildAzureSsml({text: input.text, voice}),
      },
    );
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      const retryable = response.status === 429 || response.status >= 500;
      throw new AzureTtsError(
        `Azure TTS trả lỗi ${response.status}${detail ? `: ${detail.slice(0, 180)}` : ""}`,
        {status: response.status, retryAfterMs: retryable ? retryAfterMs(response) : 0, retryable},
      );
    }
    const bytes = new Uint8Array(await response.arrayBuffer());
    return {bytes, durationSeconds: wavDurationSeconds(bytes), voice};
  } catch (error) {
    if (error instanceof AzureTtsError) throw error;
    if (error instanceof Error && error.name === "AbortError") {
      throw new AzureTtsError("Azure TTS phản hồi quá chậm.", {
        status: 504,
        retryAfterMs: 5_000,
        retryable: true,
      });
    }
    throw new AzureTtsError(error instanceof Error ? error.message : "Không kết nối được Azure TTS.", {
      status: 502,
      retryAfterMs: 5_000,
      retryable: true,
    });
  } finally {
    clearTimeout(timer);
  }
}
