import { describe, expect, it } from "vitest";
import { migrateDraft, readerForSpeaker } from "./voices";
import { librarySchema, normalizeCatalogue } from "./voice-library";
describe("character and voice library compatibility", () => {
  it("migrates legacy role IDs and single voice mode without losing saved content", () => {
    const draft = migrateDraft({ version: 2, title: "Kịch bản", style: "Hài", prompt: "NAM: Chào", summary: "Giữ nguyên", voiceMode: "female", voiceIds: { male: "vc_male", female: "vc_female" }, scenes: [{ id: "s", lines: [{ id: "l1", speaker: "male", text: "Chào" }, { id: "l2", speaker: "female", text: "Đáp" }] }] });
    expect(draft).toMatchObject({ version: 3, voiceMode: "b", voiceIds: { a: "vc_male", b: "vc_female" }, prompt: "NAM: Chào" });
    expect(draft?.scenes[0].lines.map((line) => line.speaker)).toEqual(["a", "b"]);
    expect(readerForSpeaker("a", draft?.voiceMode)).toBe("b");
  });
  it("keeps two same-gender characters and distinct voice IDs after reload", () => {
    const draft = migrateDraft({ version: 3, characters: { a: { gender: "female" }, b: { gender: "female" } }, voiceIds: { a: "vc_one", b: "vc_two" }, voiceMode: "dual", scenes: [] });
    expect(draft?.voiceIds).toEqual({ a: "vc_one", b: "vc_two" });
    expect(draft?.characters.b.gender).toBe("female");
  });
  it("normalizes system and clone voices without exposing reference transcripts", () => {
    const rows = normalizeCatalogue({ voices: [{ id: "vc_1", name: "Giọng 1", status: "ready", ref_text: "private" }, { id: "vc_2", name: "Giọng 2", status: "processing" }] }, "clone");
    expect(rows[0]).toMatchObject({ id: "vc_1", source: "clone", gender: "unknown", ready: true });
    expect(rows[1].ready).toBe(false);
    expect(JSON.stringify(rows)).not.toContain("private");
    expect(normalizeCatalogue([{ voice_id: "vi-adam", display_name: "Adam", gender: "male" }], "system")[0].gender).toBe("male");
    expect(() => normalizeCatalogue({ unknown: [] }, "clone")).toThrow("chưa được hỗ trợ");
  });
  it("rejects duplicate IDs, missing gender and unsafe ID paths", () => {
    const voice = { id: "vc_1", name: "Một", source: "clone", gender: "male", language: "vi" };
    expect(librarySchema.safeParse({ voices: [voice, voice] }).success).toBe(false);
    expect(librarySchema.safeParse({ voices: [{ ...voice, gender: "unknown" }] }).success).toBe(false);
    expect(librarySchema.safeParse({ voices: [{ ...voice, id: "../private" }] }).success).toBe(false);
  });
});
