import "server-only";

const DEFAULT_BASE_URL = "https://voice.saydi.ai/api";
const MAX_ATTEMPTS = 3;

export class SaydiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
    readonly retryAfter: string | null = null,
    readonly limit: string | null = null,
  ) {
    super(message);
  }
}

function retryDelayMs(value: string | null, attempt: number): number {
  if (value) {
    const seconds = Number(value);
    if (Number.isFinite(seconds)) return Math.max(0, seconds * 1_000);
    const date = Date.parse(value);
    if (Number.isFinite(date)) return Math.max(0, date - Date.now());
  }
  return Math.min(8_000, 500 * 2 ** attempt);
}

async function readError(response: Response): Promise<{ message: string; code: string | null }> {
  try {
    const payload = (await response.json()) as {
      detail?: unknown;
      error?: { message?: unknown; code?: unknown };
    };
    if (typeof payload.detail === "string") return { message: payload.detail, code: null };
    if (payload.error && typeof payload.error.message === "string") {
      return {
        message: payload.error.message,
        code: typeof payload.error.code === "string" ? payload.error.code : null,
      };
    }
  } catch {
    // Only an error response is parsed as JSON. Audio stays in binary form.
  }
  return { message: `SaydiVoice trả về HTTP ${response.status}.`, code: null };
}

export async function saydiFetch(
  path: "/samples" | "/v1/audio/speech" | "/v1/voices" | "/tts/clone" | `/samples/${string}/audio` | `/v1/voices/${string}/preview`,
  init: RequestInit = {},
): Promise<Response> {
  const key = process.env.SAYDI_API_KEY;
  if (!key) {
    throw new SaydiError("Chưa cấu hình SAYDI_API_KEY trên server.", 503, "SAYDI_NOT_CONFIGURED");
  }

  const baseUrl = (process.env.SAYDI_API_BASE_URL || DEFAULT_BASE_URL).replace(/\/$/, "");
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    const response = await fetch(`${baseUrl}${path}`, {
      ...init,
      headers: {
        ...Object.fromEntries(new Headers(init.headers).entries()),
        Authorization: `Bearer ${key}`,
      },
      cache: "no-store",
    });

    if (response.ok) return response;
    const failure = await readError(response);
    const retryable = response.status === 429 || response.status === 500 || response.status === 503;
    if (!retryable || failure.code === "insufficient_quota" || attempt === MAX_ATTEMPTS - 1) {
      throw new SaydiError(
        failure.message,
        response.status,
        failure.code || (path === "/v1/audio/speech" ? "SAYDI_OPENAI_ERROR" : "SAYDI_NATIVE_ERROR"),
        response.headers.get("Retry-After"),
        response.headers.get("X-OV-Limit"),
      );
    }

    await new Promise((resolve) => setTimeout(resolve, retryDelayMs(response.headers.get("Retry-After"), attempt)));
  }

  throw new SaydiError("Không thể kết nối SaydiVoice.", 502, "SAYDI_UNAVAILABLE");
}

export function saydiUsageHeaders(response: Response): HeadersInit {
  const headers: Record<string, string> = {};
  for (const key of ["X-OV-Chars", "X-OV-Voice", "X-Audio-Duration", "X-OV-Limit", "Retry-After"]) {
    const value = response.headers.get(key);
    if (value) headers[key] = value;
  }
  return headers;
}

export type SaydiSpeech = {
  audio: Uint8Array;
  voiceId: string;
  charsCharged: number | null;
  durationSeconds: number | null;
  contentType: string;
};

/** Generate MP3 with the exact SaydiVoice voice ID selected in the editor. */
export async function synthesizeSaydiSpeech(
  input: string,
  voice: string,
  model: "tts-1" | "tts-1-hd" = "tts-1",
): Promise<SaydiSpeech> {
  const response = await saydiFetch("/v1/audio/speech", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model, voice, input, response_format: "mp3" }),
  });

  const actualVoice = response.headers.get("X-OV-Voice");
  if (!actualVoice || actualVoice !== voice) {
    await response.body?.cancel();
    throw new SaydiError(
      `SaydiVoice đã trả về giọng ${actualVoice || "không xác định"} thay vì ${voice}.`,
      502,
      "SAYDI_VOICE_MISMATCH",
    );
  }

  const contentType = response.headers.get("Content-Type") || "";
  if (!contentType.toLowerCase().startsWith("audio/")) {
    await response.body?.cancel();
    throw new SaydiError("SaydiVoice không trả về audio hợp lệ.", 502, "SAYDI_INVALID_AUDIO");
  }

  const audio = new Uint8Array(await response.arrayBuffer());
  if (audio.byteLength === 0) {
    throw new SaydiError("SaydiVoice trả về audio rỗng.", 502, "SAYDI_EMPTY_AUDIO");
  }

  const chars = Number(response.headers.get("X-OV-Chars"));
  const duration = Number(response.headers.get("X-Audio-Duration"));
  return {
    audio,
    voiceId: actualVoice,
    charsCharged: Number.isFinite(chars) && chars > 0 ? chars : null,
    durationSeconds: Number.isFinite(duration) && duration > 0 ? duration : null,
    contentType,
  };
}
