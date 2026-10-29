export type Speaker = "a" | "b";
export type VoiceMode = "dual" | "a" | "b";
export type Gender = "male" | "female";
export type Characters = Record<Speaker, { gender: Gender }>;
export type VoiceChoice = { id: string; name: string; gender: Gender; source: "system" | "clone"; language: string };
export type CatalogueVoice = Omit<VoiceChoice, "gender"> & { gender: Gender | "unknown"; ready: boolean; status: string };

export type DialogueLine = {
  id: string;
  speaker: Speaker;
  text: string;
  emotion: string;
  start: number;
  end: number;
};

export type TimelineScene = {
  id: string;
  start: number;
  end: number;
  visual: string;
  lines: DialogueLine[];
};

export type VoicePair = {
  a: string;
  b: string;
};

export type AnalysisResult = {
  summary: string;
  scenes: TimelineScene[];
};

export type StudioDraft = {
  version: 3;
  title: string;
  style: string;
  prompt?: string;
  voiceIds: VoicePair;
  voiceMode?: VoiceMode;
  characters: Characters;
  analysisSource?: "ai" | "script";
  summary: string;
  scenes: TimelineScene[];
};
