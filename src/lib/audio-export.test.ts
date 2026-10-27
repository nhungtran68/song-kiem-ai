import { describe, expect, it } from "vitest";
import { createFullAudio, mergePcmClips, monoPcm16 } from "./audio-export";

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
      lines: [{ id: "1", speaker: "female", text: "Xin chào", emotion: "Vui", start: 0, end: 1 }],
      voiceIds: { male: "vi-adam", female: "" }, mode: "continuous", minimumDuration: 1,
      signal: new AbortController().signal, cache: new Map(), onProgress: () => {},
    })).rejects.toThrow("Thiếu Voice ID");
  });
});
