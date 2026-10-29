import { z } from "zod";
import type { CatalogueVoice, VoiceChoice } from "../types/studio";

export const voiceIdSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,159}$/);
export const voiceChoiceSchema = z.object({
  id: voiceIdSchema, name: z.string().trim().min(1).max(160), gender: z.enum(["male", "female"]),
  source: z.enum(["system", "clone"]), language: z.string().max(30),
});
export const librarySchema = z.object({ voices: z.array(voiceChoiceSchema).max(500) }).refine(
  ({ voices }) => new Set(voices.map((voice) => voice.id)).size === voices.length,
  { message: "Danh sách có mã giọng trùng nhau." },
);

export function normalizeCatalogue(payload: unknown, source: "system" | "clone"): CatalogueVoice[] {
  const envelope = payload && typeof payload === "object" ? payload as Record<string, unknown> : {};
  const rows = Array.isArray(payload) ? payload : Array.isArray(envelope.voices) ? envelope.voices : envelope.data;
  if (!Array.isArray(rows)) throw new Error(`Saydi trả về danh sách giọng ${source === "clone" ? "clone" : "hệ thống"} chưa được hỗ trợ.`);
  return rows.flatMap((row) => {
    const id = source === "system" ? row.voice_id : row.id;
    if (!voiceIdSchema.safeParse(id).success) return [];
    const gender = row.gender === "male" || row.gender === "female" ? row.gender : "unknown";
    return [{ id, name: String(source === "system" ? row.display_name || id : row.name || id).slice(0,160),
      gender, language: String(row.language || "").slice(0,30), source,
      status: source === "system" ? "ready" : String(row.status || "unknown"),
      ready: source === "system" || row.status === "ready" }];
  });
}

export function defaultVoiceLibrary(ids: { a: string; b: string }): VoiceChoice[] {
  return (["a", "b"] as const).flatMap((role) => voiceIdSchema.safeParse(ids[role]).success
    ? [{ id: ids[role], name: role === "a" ? "Giọng nam đang dùng" : "Giọng nữ đang dùng", gender: role === "a" ? "male" as const : "female" as const,
      source: ids[role].startsWith("vc_") ? "clone" as const : "system" as const, language: "vi" }] : [])
    .filter((voice, index, all) => all.findIndex((other) => other.id === voice.id) === index);
}
