import type { Speaker, VoiceMode } from "../types/studio";

export const VOICE_MODE_LABELS: Record<VoiceMode, string> = {
  dual: "Hai giọng nam và nữ",
  male: "Chỉ giọng nam",
  female: "Chỉ giọng nữ",
};

export function readerForSpeaker(speaker: Speaker, mode: VoiceMode = "dual"): Speaker {
  return mode === "dual" ? speaker : mode;
}
