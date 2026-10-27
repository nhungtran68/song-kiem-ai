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
}).refine(({ url }) => {
  const hostname = new URL(url).hostname.toLowerCase();
  return hostname.endsWith(".public.blob.vercel-storage.com");
}, { message: "Media phải nằm trong Vercel Blob public store của ứng dụng.", path: ["url"] });

export const analyzeJobSchema = z.object({
  action: z.literal("analyze"),
  media: mediaInputSchema,
  style: z.string().trim().min(1).max(80),
  title: z.string().trim().max(160),
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
});

export const studioJobSchema = z.discriminatedUnion("action", [
  analyzeJobSchema,
  renderJobSchema,
]);

export type AnalyzeJobInput = z.infer<typeof analyzeJobSchema>;
export type RenderJobInput = z.infer<typeof renderJobSchema>;
