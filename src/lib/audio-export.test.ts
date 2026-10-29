import { afterEach, describe, expect, it, vi } from "vitest";
import { createFullAudio, mergePcmClips, monoPcm16 } from "./audio-export";

afterEach(() => vi.unstubAllGlobals());

describe("full dialogue WAV", () => {
  it("writes a valid mono WAV and keeps leading/trailing timeline silence", async () => {
    const positive = monoPcm16([new Float32Array([1, 0.5])]);
    const negative = monoPcm16([new Float32Array([-1, -0.5])]);
    const output = mergePcmClips([{ pcm: positive, start: 1 }, { pcm: negative, start: 2 }], 10, "timeline", 3);
    const bytes = await output.blob.arrayBuffer();
    const view = new DataView(bytes);
    expect(new TextDecoder().decode(bytes.slice(0, 4))).toBe("RIFF");
    expect(new TextDecoder().decode(bytes.slice(8, 12))).toBe("WAVE");
    expect(view.getUint32(24, true)).toBe(10);
    expect(view.getUint16(22, true)).toBe(1);
    expect(view.getUint16(34, true)).toBe(16);
    expect(view.getUint32(40, true)).toBe(60);
    expect(view.getInt16(44, true)).toBe(0);
    expect(view.getInt16(44 + 10 * 2, true)).toBe(32767);
    expect(view.getInt16(44 + 20 * 2, true)).toBe(-32768);
    expect(output.duration).toBe(3);
  });

  it("keeps all samples when speech runs past the next timeline marker", async () => {
    const output = mergePcmClips([
      { pcm: monoPcm16([new Float32Array(20).fill(1)]), start: 0 },
      { pcm: monoPcm16([new Float32Array(2).fill(-1)]), start: 1 },
    ], 10, "timeline", 1.5);
    expect(output.shiftedLines).toBe(1);
    expect(output.duration).toBe(2.2);
    const view = new DataView(await output.blob.arrayBuffer());
    expect(view.getInt16(44 + 20 * 2, true)).toBe(-32768);
  });

  it("joins continuously with a short pause instead of copying timeline gaps", () => {
    const pcm = monoPcm16([new Float32Array(10).fill(0.5)]);
    const output = mergePcmClips([{ pcm, start: 30 }, { pcm, start: 60 }], 100, "continuous", 90);
    expect(output.duration).toBe(0.35);
    expect(output.blob.size).toBe(44 + 70);
  });

  it("downmixes channels and clamps samples safely", () => {
    const pcm = monoPcm16([new Float32Array([2, -2, 0.5]), new Float32Array([2, -2, -0.5])]);
    const view = new DataView(pcm);
    expect([view.getInt16(0, true), view.getInt16(2, true), view.getInt16(4, true)]).toEqual([32767, -32768, 0]);
  });

  it("rejects missing voices before creating audio or spending credits", async () => {
    await expect(createFullAudio({
      lines: [{ id: "1", speaker: "b", text: "Xin chào", emotion: "Vui", start: 0, end: 1 }],
      voiceIds: { a: "vi-adam", b: "" }, mode: "continuous", minimumDuration: 1,
      signal: new AbortController().signal, cache: new Map(), onProgress: () => {},
    })).rejects.toThrow("Thiếu Voice ID");
  });

  it.each([
    { mode: "dual" as const, voices: { a: "vi-adam", b: "vi-cuppy" }, expected: ["vi-adam", "vi-cuppy"] },
    { mode: "a" as const, voices: { a: "vi-adam", b: "" }, expected: ["vi-adam", "vi-adam"] },
    { mode: "b" as const, voices: { a: "", b: "vi-cuppy" }, expected: ["vi-cuppy", "vi-cuppy"] },
  ])("keeps both dialogue lines and uses the selected $mode voice mode", async ({ mode, voices, expected }) => {
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      return new Response(new Uint8Array([1, 2, 3]), { headers: { "Content-Type": "audio/mpeg", "X-OV-Voice": body.voice, "X-OV-Chars": "9" } });
    });
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("AudioContext", class {
      sampleRate = 100;
      async decodeAudioData() { return { duration: 1, numberOfChannels: 1, getChannelData: () => new Float32Array(100).fill(0.5) }; }
      async close() {}
    });
    const result = await createFullAudio({
      lines: [
        { id: "1", speaker: "a", text: "Câu thứ nhất", emotion: "Vui", start: 0, end: 1 },
        { id: "2", speaker: "b", text: "Câu thứ hai", emotion: "Vui", start: 1, end: 2 },
      ],
      voiceIds: voices, voiceMode: mode, mode: "continuous", minimumDuration: 2,
      signal: new AbortController().signal, cache: new Map(), onProgress: () => {},
    });
    const requests = fetchMock.mock.calls.map(([, init]) => JSON.parse(String(init.body)));
    expect(requests.map((request) => request.voice)).toEqual(expected);
    expect(requests.map((request) => request.input)).toEqual(["Câu thứ nhất", "Câu thứ hai"]);
    expect(result.duration).toBe(2.15);
  });
});
