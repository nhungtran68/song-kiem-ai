import { z } from "zod";

export const speakerSchema = z.enum(["male", "female"]);

export const dialogueLineSchema = z.object({
  speaker: speakerSchema,
  text: z.string().trim().min(1).max(800),
  emotion: z.string().trim().min(1).max(80),
  start: z.number().min(0),
  end: z.number().positive(),
}).refine(({ start, end }) => end > start, {
  message: "Mốc kết thúc phải lớn hơn mốc bắt đầu.",
  path: ["end"],
});

export const sceneSchema = z.object({
  start: z.number().min(0),
  end: z.number().positive(),
  visual: z.string().trim().min(1).max(1_200),
  lines: z.array(dialogueLineSchema).max(20),
}).refine(({ start, end }) => end > start, {
  message: "Mốc kết thúc cảnh phải lớn hơn mốc bắt đầu.",
  path: ["end"],
});

export const analysisOutputSchema = z.object({
  summary: z.string().trim().min(1).max(2_000),
  scenes: z.array(sceneSchema).min(1).max(24),
});

export const voicePairSchema = z.object({
  male: z.string().trim().max(120),
  female: z.string().trim().max(120),
});

const mediaInputSchema = z.object({
  url: z.url(),
  pathname: z.string().startsWith("uploads/").min(9),
  contentType: z.string().regex(/^(image|video)\//),
  duration: z.number().min(0).max(7_200),
}).superRefine(({ url, contentType, duration }, context) => {
  const hostname = new URL(url).hostname.toLowerCase();
  if (!hostname.endsWith(".public.blob.vercel-storage.com")) {
    context.addIssue({ code: "custom", message: "Media phải nằm trong Vercel Blob public store của ứng dụng.", path: ["url"] });
  }
  if (contentType.startsWith("video/") && duration <= 0) {
    context.addIssue({ code: "custom", message: "Không đọc được thời lượng video. Hãy chọn một video hợp lệ.", path: ["duration"] });
  }
});

export const analyzeJobSchema = z.object({
  action: z.literal("analyze"),
  media: mediaInputSchema,
  style: z.string().trim().min(1).max(80),
  title: z.string().trim().max(160),
  prompt: z.string().trim().max(600).optional(),
  voiceIds: voicePairSchema,
});

export const renderLineSchema = z.object({
  speaker: speakerSchema,
  text: z.string().trim().min(1).max(800),
  start: z.number().min(0),
  end: z.number().positive(),
}).refine(({ start, end }) => end > start, {
  message: "Mốc kết thúc phải lớn hơn mốc bắt đầu.",
  path: ["end"],
});

export const renderJobSchema = z.object({
  action: z.literal("render"),
  media: mediaInputSchema,
  title: z.string().trim().max(160),
  lines: z.array(renderLineSchema).min(1).max(200),
  voiceIds: voicePairSchema,
  includeTts: z.boolean().default(true),
}).superRefine(({ includeTts, lines, voiceIds, media }, context) => {
  if (includeTts) {
    for (const speaker of ["male", "female"] as const) {
      if (lines.some((line) => line.speaker === speaker) && !voiceIds[speaker]) {
        context.addIssue({
          code: "custom",
          message: `Thiếu Voice ID cho nhân vật ${speaker === "male" ? "nam" : "nữ"}.`,
          path: ["voiceIds", speaker],
        });
      }
    }
  }
  if (media.contentType.startsWith("video/") && media.duration > 0) {
    for (const [index, line] of lines.entries()) {
      if (line.end > media.duration + 0.1) {
        context.addIssue({
          code: "custom",
          message: "Mốc thoại vượt quá thời lượng video.",
          path: ["lines", index, "end"],
        });
      }
    }
  }
});

export const studioJobSchema = z.discriminatedUnion("action", [
  analyzeJobSchema,
  renderJobSchema,
]);

export type AnalyzeJobInput = z.infer<typeof analyzeJobSchema>;
export type RenderJobInput = z.infer<typeof renderJobSchema>;
