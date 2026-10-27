import { afterEach, describe, expect, it, vi } from "vitest";
import { requestSpeechClip } from "./speech-client";

afterEach(() => vi.unstubAllGlobals());

describe("reusing generated speech", () => {
  it("reuses a completed clip and keeps male/female voices separate", async () => {
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      const input = JSON.parse(String(init.body));
      return new Response(new Uint8Array([1, 2, 3]), { headers: {
        "Content-Type": "audio/mpeg", "X-OV-Voice": input.voice, "X-OV-Chars": "9",
      } });
    });
    vi.stubGlobal("fetch", fetchMock);
    const cache = new Map();
    const signal = new AbortController().signal;
    expect((await requestSpeechClip("Xin chào.", "vi-adam", signal, cache)).charsCharged).toBe(9);
    expect((await requestSpeechClip("Xin chào.", "vi-adam", signal, cache)).charsCharged).toBe(0);
    expect((await requestSpeechClip("Xin chào.", "vi-cuppy", signal, cache)).charsCharged).toBe(9);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not cache failed responses or a wrong voice", async () => {
    const cache = new Map();
    const fetchMock = vi.fn().mockResolvedValue(new Response(new Uint8Array([1]), {
      headers: { "Content-Type": "audio/mpeg", "X-OV-Voice": "wrong" },
    }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(requestSpeechClip("Xin chào.", "vi-adam", new AbortController().signal, cache)).rejects.toThrow("không khớp");
    expect(cache.size).toBe(0);
  });
});
