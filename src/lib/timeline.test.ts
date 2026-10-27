import { describe, expect, it } from "vitest";
import { createSrt, hydrateAnalysis, secondsLabel, srtTimestamp } from "./timeline";

describe("timeline helpers", () => {
  it("formats labels and SRT timestamps", () => {
    expect(secondsLabel(65.9)).toBe("01:05.9");
    expect(srtTimestamp(65.125)).toBe("00:01:05,125");
  });

  it("sorts dialogue and removes newlines in SRT", () => {
    const output = createSrt([
      { speaker: "female", text: "Câu\nhai", start: 2, end: 4 },
      { speaker: "male", text: "Câu một", start: 0, end: 2 },
    ]);
    expect(output).toContain("NAM: Câu một");
    expect(output).toContain("NỮ: Câu hai");
    expect(output.indexOf("NAM")).toBeLessThan(output.indexOf("NỮ"));
  });

  it("hydrates stable editor IDs without changing content", () => {
    const result = hydrateAnalysis({
      summary: "Một cảnh",
      scenes: [{
        start: 0,
        end: 3,
        visual: "Hai người gặp nhau",
        lines: [{ speaker: "male", text: "Xin chào", emotion: "Vui", start: 0, end: 2 }],
      }],
    });
    expect(result.scenes[0].id).toMatch(/^scene-/);
    expect(result.scenes[0].lines[0].id).toMatch(/^line-/);
    expect(result.scenes[0].lines[0].text).toBe("Xin chào");
  });
});
