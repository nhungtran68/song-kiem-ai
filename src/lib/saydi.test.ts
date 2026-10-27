import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { SaydiError, synthesizeSaydiSpeech } from "./saydi";

const originalKey = process.env.SAYDI_API_KEY;
const originalBase = process.env.SAYDI_API_BASE_URL;

beforeEach(() => {
  process.env.SAYDI_API_KEY = "sv_live_test_only";
  process.env.SAYDI_API_BASE_URL = "https://voice.saydi.ai/api";
});

afterEach(() => {
  if (originalKey === undefined) delete process.env.SAYDI_API_KEY;
  else process.env.SAYDI_API_KEY = originalKey;
  if (originalBase === undefined) delete process.env.SAYDI_API_BASE_URL;
  else process.env.SAYDI_API_BASE_URL = originalBase;
  vi.unstubAllGlobals();
});

describe("SaydiVoice speech", () => {
  it("sends documented JSON and returns audio bytes with verified voice and usage", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(new Uint8Array([0x49, 0x44, 0x33, 0x04]), {
      status: 200,
      headers: {
        "Content-Type": "audio/mpeg",
        "X-OV-Voice": "vc_custom",
        "X-OV-Chars": "12",
        "X-Audio-Duration": "1.4",
      },
    }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await synthesizeSaydiSpeech("Xin chào nhé", "vc_custom");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, request] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://voice.saydi.ai/api/v1/audio/speech");
    expect(request.method).toBe("POST");
    expect(new Headers(request.headers).get("Authorization")).toBe("Bearer sv_live_test_only");
    expect(JSON.parse(String(request.body))).toEqual({
      model: "tts-1",
      voice: "vc_custom",
      input: "Xin chào nhé",
      response_format: "mp3",
    });
    expect(Array.from(result.audio)).toEqual([0x49, 0x44, 0x33, 0x04]);
    expect(result).toMatchObject({ voiceId: "vc_custom", charsCharged: 12, durationSeconds: 1.4, contentType: "audio/mpeg" });
  });

  it("rejects an upstream fallback to a different voice", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(new Uint8Array([1]), {
      status: 200,
      headers: { "Content-Type": "audio/mpeg", "X-OV-Voice": "vi-adam" },
    })));

    await expect(synthesizeSaydiSpeech("Xin chào", "vc_custom")).rejects.toMatchObject({
      code: "SAYDI_VOICE_MISMATCH",
      status: 502,
    } satisfies Partial<SaydiError>);
  });

  it("does not retry when SaydiVoice reports exhausted quota", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      error: { code: "insufficient_quota", message: "Credits exhausted" },
    }), {
      status: 429,
      headers: { "Content-Type": "application/json", "Retry-After": "5", "X-OV-Limit": "credits" },
    }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(synthesizeSaydiSpeech("Xin chào", "vi-adam")).rejects.toMatchObject({
      code: "insufficient_quota",
      status: 429,
      retryAfter: "5",
      limit: "credits",
    } satisfies Partial<SaydiError>);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("retries a rate limit response according to Retry-After", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        error: { code: "rate_limit_exceeded", message: "Slow down" },
      }), { status: 429, headers: { "Content-Type": "application/json", "Retry-After": "0" } }))
      .mockResolvedValueOnce(new Response(new Uint8Array([1, 2, 3]), {
        status: 200,
        headers: { "Content-Type": "audio/mpeg", "X-OV-Voice": "vi-adam" },
      }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await synthesizeSaydiSpeech("Xin chào", "vi-adam");
    expect(result.audio.byteLength).toBe(3);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("retries a temporary upstream server error", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { message: "Temporary failure" } }), {
        status: 503,
        headers: { "Content-Type": "application/json", "Retry-After": "0" },
      }))
      .mockResolvedValueOnce(new Response(new Uint8Array([1]), {
        status: 200,
        headers: { "Content-Type": "audio/mpeg", "X-OV-Voice": "vi-adam" },
      }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(synthesizeSaydiSpeech("Xin chào", "vi-adam")).resolves.toMatchObject({ voiceId: "vi-adam" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
