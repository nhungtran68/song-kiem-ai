import type { DialogueLine, VoiceMode, VoicePair } from "../types/studio";
import { requestSpeechClip, type SpeechCache } from "./speech-client";
import { readerForSpeaker } from "./voices";

export type AudioJoinMode = "continuous" | "timeline";
export type PcmClip = { pcm: ArrayBuffer; start: number };
export const MAX_AUDIO_SECONDS = 1_800;

export function monoPcm16(channels: readonly Float32Array[]): ArrayBuffer {
  if (!channels.length || channels.some((channel) => channel.length !== channels[0].length)) throw new Error("Dữ liệu âm thanh không hợp lệ.");
  const result = new ArrayBuffer(channels[0].length * 2);
  const view = new DataView(result);
  for (let index = 0; index < channels[0].length; index++) {
    const value = Math.max(-1, Math.min(1, channels.reduce((sum, channel) => sum + channel[index], 0) / channels.length));
    view.setInt16(index * 2, Math.round(value < 0 ? value * 32_768 : value * 32_767), true);
  }
  return result;
}

export function mergePcmClips(clips: PcmClip[], sampleRate: number, mode: AudioJoinMode, minimumDuration = 0) {
  if (!clips.length || !Number.isInteger(sampleRate) || sampleRate <= 0 || !Number.isFinite(minimumDuration) || minimumDuration < 0) throw new Error("Chưa có đoạn âm thanh để ghép.");
  const parts: BlobPart[] = [];
  const silence = new ArrayBuffer(sampleRate * 2);
  let cursor = 0;
  let shiftedLines = 0;
  const addSilence = (samples: number) => {
    while (samples > 0) {
      const count = Math.min(samples, sampleRate);
      parts.push(count === sampleRate ? silence : silence.slice(0, count * 2));
      samples -= count;
    }
  };
  const limit = Math.round(MAX_AUDIO_SECONDS * sampleRate);
  for (const [index, clip] of clips.entries()) {
    if (!Number.isFinite(clip.start) || clip.start < 0 || clip.pcm.byteLength % 2 || !clip.pcm.byteLength) throw new Error("Đoạn âm thanh hoặc mốc thời gian không hợp lệ.");
    const requested = mode === "timeline" ? Math.round(clip.start * sampleRate) : cursor + (index ? Math.round(0.15 * sampleRate) : 0);
    const start = Math.max(cursor, requested);
    if (mode === "timeline" && cursor > requested + sampleRate * 0.05) shiftedLines++;
    const end = start + clip.pcm.byteLength / 2;
    if (end > limit) throw new Error("File âm thanh vượt 30 phút. Hãy chia kịch bản thành các phần ngắn hơn.");
    addSilence(start - cursor);
    parts.push(clip.pcm);
    cursor = end;
  }
  const finalSamples = Math.max(cursor, mode === "timeline" ? Math.round(minimumDuration * sampleRate) : 0);
  if (finalSamples > limit) throw new Error("File âm thanh vượt 30 phút. Hãy chia kịch bản thành các phần ngắn hơn.");
  addSilence(finalSamples - cursor);
  const bytes = finalSamples * 2;
  const header = new ArrayBuffer(44);
  const view = new DataView(header);
  const text = (offset: number, value: string) => { for (let i = 0; i < value.length; i++) view.setUint8(offset + i, value.charCodeAt(i)); };
  text(0, "RIFF"); view.setUint32(4, 36 + bytes, true); text(8, "WAVE"); text(12, "fmt ");
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true); view.setUint16(34, 16, true); text(36, "data"); view.setUint32(40, bytes, true);
  return { blob: new Blob([header, ...parts], { type: "audio/wav" }), duration: finalSamples / sampleRate, shiftedLines };
}

export async function createFullAudio(options: {
  lines: DialogueLine[]; voiceIds: VoicePair; voiceMode?: VoiceMode; mode: AudioJoinMode; minimumDuration: number;
  signal: AbortSignal; cache: SpeechCache;
  onProgress: (completed: number, total: number, text: string) => void;
}) {
  const { lines, voiceIds, voiceMode = "dual", mode, minimumDuration, signal, cache, onProgress } = options;
  const ordered = lines.filter((line) => line.text.trim()).sort((a, b) => a.start - b.start);
  if (!ordered.length) throw new Error("Chưa có lời thoại. Hãy phân tích hoặc thêm câu trước khi tạo âm thanh.");
  if (ordered.length > 500) throw new Error("Hãy chia kịch bản thành các phần tối đa 500 câu.");
  if (mode === "timeline" && minimumDuration > MAX_AUDIO_SECONDS) throw new Error("Xuất theo timeline hỗ trợ tối đa 30 phút. Hãy chia kịch bản hoặc chọn Nối liên tục.");
  for (const [index, line] of ordered.entries()) {
    const reader = readerForSpeaker(line.speaker, voiceMode);
    if (!voiceIds[reader]?.trim()) throw new Error(`Thiếu Voice ID nhân vật ${reader.toUpperCase()}.`);
    if (!Number.isFinite(line.start) || !Number.isFinite(line.end) || line.start < 0 || line.end <= line.start) throw new Error(`Mốc thời gian câu ${index + 1} chưa hợp lệ.`);
  }
  signal.throwIfAborted();
  if (typeof AudioContext === "undefined") throw new Error("Trình duyệt chưa hỗ trợ ghép âm thanh. Hãy dùng Chrome, Edge hoặc Safari mới.");
  const context = new AudioContext({ sampleRate: 24_000 });
  const clips: PcmClip[] = [];
  let charsCharged = 0;
  let usageKnown = true;
  let speechSeconds = 0;
  try {
    for (const [index, line] of ordered.entries()) {
      signal.throwIfAborted();
      const reader = readerForSpeaker(line.speaker, voiceMode);
      onProgress(index, ordered.length, `Đang tạo câu ${index + 1}/${ordered.length} · nhân vật ${reader.toUpperCase()}`);
      const speech = await requestSpeechClip(line.text, voiceIds[reader], signal, cache);
      if (speech.charsCharged === null) usageKnown = false;
      else charsCharged += speech.charsCharged;
      const decoded = await context.decodeAudioData(await speech.blob.arrayBuffer());
      signal.throwIfAborted();
      speechSeconds += decoded.duration + 0.15;
      if (speechSeconds > MAX_AUDIO_SECONDS) throw new Error("File âm thanh vượt 30 phút. Các đoạn đã tạo được giữ trong tab này.");
      clips.push({ start: line.start, pcm: monoPcm16(Array.from({ length: decoded.numberOfChannels }, (_, channel) => decoded.getChannelData(channel))) });
      onProgress(index + 1, ordered.length, `Đã tạo ${index + 1}/${ordered.length} câu`);
    }
    signal.throwIfAborted();
    onProgress(ordered.length, ordered.length, "Đang ghép thành một file hoàn chỉnh...");
    return { ...mergePcmClips(clips, context.sampleRate, mode, minimumDuration), charsCharged: usageKnown ? charsCharged : null };
  } finally { await context.close(); }
}
