import { z } from "zod";

export const speakerSchema = z.enum(["a", "b"]);

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
