import { describe, expect, it } from "vitest";
import { studioJobSchema } from "./schemas";

const media = {
  url: "https://store.public.blob.vercel-storage.com/uploads/video.mp4",
  pathname: "uploads/video.mp4",
  contentType: "video/mp4",
  duration: 12,
};

describe("studio job schema", () => {
  it("preserves both SaydiVoice IDs in analysis jobs", () => {
    const parsed = studioJobSchema.parse({
      action: "analyze",
      media,
      style: "Điện ảnh",
      title: "Song Kiếm",
      voiceIds: { male: "vi-adam", female: "vc_custom" },
    });
    expect(parsed.voiceIds).toEqual({ male: "vi-adam", female: "vc_custom" });
  });

  it("rejects render jobs without dialogue", () => {
    expect(studioJobSchema.safeParse({
      action: "render",
      media,
      title: "Song Kiếm",
      voiceIds: { male: "", female: "" },
      lines: [],
    }).success).toBe(false);
  });

  it("rejects media URLs outside Vercel Blob", () => {
    expect(studioJobSchema.safeParse({
      action: "analyze",
      media: { ...media, url: "https://example.com/private/video.mp4" },
      style: "Điện ảnh",
      title: "Song Kiếm",
      voiceIds: { male: "vi-adam", female: "vc_custom" },
    }).success).toBe(false);
  });

  it("rejects a dialogue line with a reversed time range", () => {
    expect(studioJobSchema.safeParse({
      action: "render",
      media,
      title: "Song Kiếm",
      voiceIds: { male: "vi-adam", female: "vc_custom" },
      lines: [{ speaker: "male", text: "Bắt đầu thôi.", start: 4, end: 2 }],
    }).success).toBe(false);
  });

  it("requires the voice for each speaker when TTS is selected", () => {
    const job = {
      action: "render" as const,
      media,
      title: "Song Kiếm",
      voiceIds: { male: "vi-adam", female: "" },
      lines: [{ speaker: "female" as const, text: "Xin chào.", start: 1, end: 3 }],
    };
    expect(studioJobSchema.safeParse(job).success).toBe(false);
    expect(studioJobSchema.safeParse({ ...job, includeTts: false }).success).toBe(true);
  });

  it("accepts a bounded creative brief and rejects a video without duration", () => {
    const input = {
      action: "analyze" as const,
      media,
      title: "Song Kiếm",
      style: "Điện ảnh",
      prompt: "Hai nhân vật tranh luận rồi hòa giải.",
      voiceIds: { male: "vi-adam", female: "vi-cuppy" },
    };
    expect(studioJobSchema.safeParse(input).success).toBe(true);
    expect(studioJobSchema.safeParse({ ...input, prompt: "a".repeat(601) }).success).toBe(false);
    expect(studioJobSchema.safeParse({ ...input, media: { ...media, duration: 0 } }).success).toBe(false);
  });
});
