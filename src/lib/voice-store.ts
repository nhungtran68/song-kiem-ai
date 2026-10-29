import "server-only";
import { get, put } from "@vercel/blob";
import { defaultVoiceLibrary, librarySchema } from "./voice-library";
import type { VoiceChoice } from "../types/studio";

const PATH = "settings/voice-library.json";
export function storageReady() { return Boolean(process.env.BLOB_STORE_ID || process.env.BLOB_READ_WRITE_TOKEN); }
export async function readVoiceLibrary() {
  if (!storageReady()) return { voices: defaults(), revision: "", configured: false };
  const blob = await get(PATH, { access: "private", useCache: false });
  if (!blob || blob.statusCode !== 200) return { voices: defaults(), revision: "", configured: true };
  const data = librarySchema.parse(await new Response(blob.stream).json());
  return { voices: data.voices, revision: blob.blob.etag, configured: true };
}
function defaults() { return defaultVoiceLibrary({ a: process.env.SAYDI_MALE_VOICE_ID || "", b: process.env.SAYDI_FEMALE_VOICE_ID || "" }); }
export async function saveVoiceLibrary(voices: VoiceChoice[], revision: string) {
  if (!storageReady()) throw new Error("Chưa kết nối kho danh sách giọng.");
  const data = librarySchema.parse({ voices });
  const saved = await put(PATH, JSON.stringify(data), {
    access: "private", contentType: "application/json", addRandomSuffix: false,
    ...(revision ? { ifMatch: revision } : { allowOverwrite: false }),
  });
  return { ...data, revision: saved.etag, configured: true };
}
