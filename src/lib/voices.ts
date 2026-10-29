import type { Characters, Speaker, StudioDraft, VoiceMode } from "../types/studio";

export const DEFAULT_CHARACTERS: Characters = { a: { gender: "male" }, b: { gender: "female" } };
export const CHARACTER_LABELS = { a: "Nhân vật A", b: "Nhân vật B" } as const;

export const VOICE_MODE_LABELS: Record<VoiceMode, string> = {
  dual: "Theo từng nhân vật A / B",
  a: "Chỉ dùng giọng nhân vật A",
  b: "Chỉ dùng giọng nhân vật B",
};

export function readerForSpeaker(speaker: Speaker, mode: VoiceMode = "dual"): Speaker {
  return mode === "dual" ? speaker : mode;
}

/** Preserve old male/female role slots and their exact voice IDs as A/B. */
export function migrateDraft(value: unknown): StudioDraft | null {
  if (!value || typeof value !== "object") return null;
  const draft = value as Record<string, unknown>;
  if (![1, 2, 3].includes(Number(draft.version)) || !Array.isArray(draft.scenes) || !draft.voiceIds) return null;
  const legacy = draft.version !== 3;
  const ids = draft.voiceIds as Record<string, string>;
  const mode = draft.voiceMode;
  const rawCharacters = draft.characters as Characters | undefined;
  const characters = rawCharacters && [rawCharacters.a?.gender, rawCharacters.b?.gender].every((gender) => gender === "male" || gender === "female") ? rawCharacters : DEFAULT_CHARACTERS;
  const role = (speaker: unknown): Speaker => speaker === "b" || speaker === "female" ? "b" : "a";
  return {
    ...draft,
    version: 3,
    voiceIds: legacy ? { a: ids.male || "", b: ids.female || "" } : { a: ids.a || "", b: ids.b || "" },
    voiceMode: mode === "dual" || !mode ? "dual" : role(mode),
    characters: legacy ? DEFAULT_CHARACTERS : characters,
    scenes: draft.scenes.map((scene) => ({ ...scene, lines: scene.lines.map((line: Record<string, unknown>) => ({ ...line, speaker: role(line.speaker) })) })),
  } as StudioDraft;
}
