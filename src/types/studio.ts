export type Speaker = "male" | "female";

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
  male: string;
  female: string;
};

export type AnalysisResult = {
  summary: string;
  scenes: TimelineScene[];
};

export type MediaAsset = {
  url: string;
  pathname: string;
  contentType: string;
  name: string;
  size: number;
  duration: number;
};

export type StudioDraft = {
  version: 1;
  title: string;
  style: string;
  prompt?: string;
  voiceIds: VoicePair;
  includeTts?: boolean;
  summary: string;
  scenes: TimelineScene[];
  media: MediaAsset | null;
};
