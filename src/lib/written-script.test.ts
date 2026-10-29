import { describe, expect, it } from "vitest";
import { MAX_SCRIPT_CHARS, parseWrittenScript } from "./written-script";

const linesOf = (text: string) => parseWrittenScript(text).analysis.scenes.flatMap((scene) => scene.lines);

describe("prewritten Vietnamese dialogue", () => {
  it("keeps A and B independent when both characters have the same gender", () => {
    const result = parseWrittenScript("Nhân vật A (trầm): Xin chào.\nB: Chào bạn. A: Hẹn gặp lại.", "a", { a: { gender: "female" }, b: { gender: "female" } });
    expect(result.analysis.scenes.flatMap((scene) => scene.lines).map((line) => line.speaker)).toEqual(["a", "b", "a"]);
    expect(result.inferredVoiceMode).toBe("dual");
  });
  it("maps NAM and NỮ labels to configured genders when they are swapped", () => {
    const result = parseWrittenScript("NAM: Câu nam.\nNỮ: Câu nữ.", "a", { a: { gender: "female" }, b: { gender: "male" } });
    expect(result.analysis.scenes[0].lines.map((line) => line.speaker)).toEqual(["b", "a"]);
  });
  it("detects male/female labels and emotion without changing dialogue", () => {
    const result = parseWrittenScript("NAM (trầm): Xin chào.\nNữ (vui): Chào anh!");
    expect(result.analysis.scenes[0].lines.map(({ speaker, text, emotion }) => ({ speaker, text, emotion }))).toEqual([
      { speaker: "a", text: "Xin chào.", emotion: "trầm" },
      { speaker: "b", text: "Chào anh!", emotion: "vui" },
    ]);
    expect(result.inferredVoiceMode).toBe("dual");
    expect(result.estimatedTiming).toBe(true);
  });

  it("accepts headings, brackets, accentless nu and multiline turns", () => {
    const result = parseWrittenScript("Giọng Nam\nCâu đầu.\nDòng tiếp theo.\n\n[NỮ] Câu hai.\nnu - Câu ba.");
    const lines = result.analysis.scenes.flatMap((scene) => scene.lines);
    expect(lines.map((line) => line.speaker)).toEqual(["a", "b", "b"]);
    expect(lines[0].text).toBe("Câu đầu.\nDòng tiếp theo.");
    expect(lines[2].text).toBe("Câu ba.");
  });

  it("recognizes inline roles after punctuation", () => {
    expect(linesOf("Nam: Xin chào. Nữ: Chào anh.").map((line) => line.speaker)).toEqual(["a", "b"]);
  });

  it("accepts numbered and bold role labels copied from a written script", () => {
    const lines = linesOf("1. **NAM:** Xin chào.\n2) **Nữ (vui)**: Chào anh.\n- **NAM**\nHẹn gặp lại.");
    expect(lines.map(({ speaker, text }) => ({ speaker, text }))).toEqual([
      { speaker: "a", text: "Xin chào." },
      { speaker: "b", text: "Chào anh." },
      { speaker: "a", text: "Hẹn gặp lại." },
    ]);
  });

  it("does not read list numbers as separate dialogue", () => {
    const lines = linesOf("1. NAM: Xin chào.\n2. NỮ: Chào anh.");
    expect(lines.map((line) => line.text)).toEqual(["Xin chào.", "Chào anh."]);
    expect(lines.map((line) => line.speaker)).toEqual(["a", "b"]);
  });

  it("does not treat ordinary words nam/nu or Việt Nam as role labels", () => {
    const text = "Việt Nam: đất nước tươi đẹp. Cả nam nữ cùng tham gia.";
    const result = parseWrittenScript(text, "b");
    expect(result.recognizedLabels).toBe(0);
    expect(result.inferredVoiceMode).toBeNull();
    expect(result.analysis.scenes[0].lines[0]).toMatchObject({ speaker: "b", text });
  });

  it("keeps explicitly supplied time ranges", () => {
    const result = parseWrittenScript("[00:01 - 00:03] NAM: Xin chào.\n[00:04.5 - 00:06] NỮ: Chào anh.");
    expect(result.estimatedTiming).toBe(false);
    expect(result.analysis.scenes[0].lines.map(({ start, end }) => ({ start, end }))).toEqual([{ start: 1, end: 3 }, { start: 4.5, end: 6 }]);
  });

  it("estimates sequential timings for untimed text and infers a single voice", () => {
    const result = parseWrittenScript("NỮ: Câu đầu.\nNỮ: Câu thứ hai.");
    const [first, second] = result.analysis.scenes[0].lines;
    expect(first.end).toBeGreaterThan(first.start);
    expect(second.start).toBe(first.end);
    expect(result.inferredVoiceMode).toBe("b");
  });

  it("splits long turns into editable chunks without dropping words", () => {
    const text = Array.from({ length: 800 }, (_, index) => `chữ${index}`).join(" ");
    const result = linesOf(`NAM: ${text}`);
    expect(result.length).toBeGreaterThan(1);
    expect(result.every((line) => line.text.length <= 800)).toBe(true);
    expect(result.map((line) => line.text).join(" ")).toBe(text);
  });

  it("rejects empty text, labels without dialogue and invalid times", () => {
    expect(() => parseWrittenScript(" ")).toThrow("Hãy dán kịch bản");
    expect(() => parseWrittenScript("NAM:\nNỮ:")).toThrow("Chưa có lời thoại");
    expect(() => parseWrittenScript("[00:05 - 00:03] NAM: Xin chào.")).toThrow("Mốc kết thúc");
    expect(() => parseWrittenScript("[00:70 - 01:20] NAM: Xin chào.")).toThrow("Mốc thời gian");
  });

  it("rejects oversized scripts instead of silently truncating", () => {
    expect(() => parseWrittenScript("a".repeat(MAX_SCRIPT_CHARS + 1))).toThrow("20.000");
    expect(() => parseWrittenScript(Array.from({ length: 501 }, () => "NAM: Chào.").join("\n"))).toThrow("500 đoạn");
  });
});
