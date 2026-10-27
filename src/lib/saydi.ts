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

async function readError(response: Response): Promise<string> {
  try {
    const payload = (await response.json()) as {
      detail?: unknown;
      error?: { message?: unknown; code?: unknown };
    };
    if (typeof payload.detail === "string") return payload.detail;
    if (payload.error && typeof payload.error.message === "string") return payload.error.message;
  } catch {
    // Upstream error is not JSON. Return a stable message instead of leaking bytes.
  }
  return `SaydiVoice trả về HTTP ${response.status}.`;
}

export async function saydiFetch(
  path: "/samples" | "/v1/audio/speech" | "/v1/voices" | "/tts/clone",
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

    if (response.status !== 429 || attempt === MAX_ATTEMPTS - 1) {
      if (!response.ok) {
        throw new SaydiError(
          await readError(response),
          response.status,
          path === "/v1/audio/speech" ? "SAYDI_OPENAI_ERROR" : "SAYDI_NATIVE_ERROR",
          response.headers.get("Retry-After"),
          response.headers.get("X-OV-Limit"),
        );
      }
      return response;
    }

    await new Promise((resolve) => setTimeout(resolve, retryDelayMs(response.headers.get("Retry-After"), attempt)));
  }

  throw new SaydiError("Không thể kết nối SaydiVoice.", 502, "SAYDI_UNAVAILABLE");
}

export function saydiUsageHeaders(response: Response): HeadersInit {
  const headers: Record<string, string> = {};
  for (const key of ["X-OV-Chars", "X-OV-Limit", "Retry-After"]) {
    const value = response.headers.get(key);
    if (value) headers[key] = value;
  }
  return headers;
}
