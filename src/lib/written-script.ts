import type { DialogueLine, Speaker, VoiceMode } from "../types/studio";

export const MAX_SCRIPT_CHARS = 20_000;
type ScriptLine = Omit<DialogueLine, "id">;
type TimeRange = { start: number; end: number };
type Turn = { speaker: Speaker; emotion: string; text: string; range?: TimeRange };

const roleWithSeparator = /^(?:[-*•]\s*)?(?:(?:giọng|nhân vật)\s+)?(nam|nữ|nu)\s*(?:\(([^)\n]{1,80})\)|\[([^\]\n]{1,80})\])?\s*[:：–—-]\s*/iu;
const bracketedRole = /^(?:[-*•]\s*)?\[\s*(nam|nữ|nu)\s*\]\s*(?:\(([^)\n]{1,80})\))?\s*(?:[:：–—-]\s*)?/iu;
const roleHeading = /^(?:[-*•]\s*)?(?:(?:giọng|nhân vật)\s+)?(nam|nữ|nu)\s*(?:\(([^)\n]{1,80})\))?\s*$/iu;
const rangePrefix = /^\[\s*(\d{1,2}(?::\d{1,2}){0,2}(?:[.,]\d{1,3})?)\s*(?:-->|[–—-])\s*(\d{1,2}(?::\d{1,2}){0,2}(?:[.,]\d{1,3})?)\s*\]\s*(?:\|\s*)?/u;

function extractRole(content: string) {
  let candidate = content.replace(/^(?:[-*•]\s+|\d+[.)]\s+)/u, "");
  const bold = /^\*\*((?:(?:giọng|nhân vật)\s+)?(?:nam|nữ|nu)(?:\s*\([^*)\n]{1,80}\))?\s*[:：–—-]?)\*\*\s*([:：–—-]?)\s*/iu.exec(candidate);
  if (bold) {
    const label = bold[1].trim();
    const separator = bold[2] || (/[:：–—-]$/u.test(label) ? "" : ":");
    candidate = `${label}${separator} ${candidate.slice(bold[0].length)}`;
  }
  const label = roleWithSeparator.exec(candidate) || bracketedRole.exec(candidate) || roleHeading.exec(candidate);
  if (!label) return null;
  return { speaker: label[1].toLocaleLowerCase("vi") === "nam" ? "male" as const : "female" as const, emotion: (label[2] || label[3] || "Tự nhiên").trim(), text: candidate.slice(label[0].length).trim() };
}

function timeInSeconds(text: string): number {
  const parts = text.replace(",", ".").split(":").map(Number);
  if ((parts.length > 1 && parts.at(-1)! >= 60) || (parts.length === 3 && parts[1] >= 60)) throw new Error("Mốc thời gian chưa hợp lệ. Ví dụ: [00:00 - 00:05] NAM: Xin chào.");
  return parts.reduce((value, part) => value * 60 + part, 0);
}

function splitLongTurn(text: string): string[] {
  const chunks: string[] = [];
  let remaining = text.trim();
  while (remaining.length > 800) {
    const window = remaining.slice(0, 800);
    const sentenceEnds = [...window.matchAll(/[.!?…](?=\s|$)/gu)];
    const sentenceEnd = sentenceEnds.at(-1)?.index;
    const space = window.lastIndexOf(" ");
    const cut = sentenceEnd !== undefined && sentenceEnd >= 200 ? sentenceEnd + 1 : space >= 200 ? space : 800;
    chunks.push(remaining.slice(0, cut).trim());
    remaining = remaining.slice(cut).trim();
  }
  if (remaining) chunks.push(remaining);
  return chunks;
}

export function parseWrittenScript(input: string, defaultSpeaker: Speaker = "male") {
  const source = input.trim();
  if (!source) throw new Error("Hãy dán kịch bản vào ô Ý tưởng hoặc kịch bản có sẵn.");
  if (source.length > MAX_SCRIPT_CHARS) throw new Error("Kịch bản vượt 20.000 ký tự. Hãy chia thành các phần ngắn hơn.");
  // Only role labels with a separator or a separate heading change the speaker.
  // Ordinary phrases such as “Việt Nam” and “nam nữ” stay in the dialogue.
  const normalizedSource = source.replace(/\r\n?/g, "\n").replace(/\uFEFF/g, "");
  const normalized = normalizedSource
    .replace(/([.!?…;])\s+(?=(?:(?:giọng|nhân vật)\s+)?(?:\[\s*)?(?:nam|nữ|nu)(?:\s*\])?\s*(?:\([^)]*\)\s*)?[:：–—-])/giu, (match: string, punctuation: string, offset: number) => {
      const prefix = normalizedSource.slice(normalizedSource.lastIndexOf("\n", offset) + 1, offset);
      return /^\s*\d+$/u.test(prefix) ? match : `${punctuation}\n`;
    })
    .replace(/\s*\|\s*(?=(?:(?:giọng|nhân vật)\s+)?(?:nam|nữ|nu)\s*[:：–—-])/giu, "\n");
  const turns: Turn[] = [];
  let activeSpeaker = defaultSpeaker;
  let activeEmotion = "Tự nhiên";
  let current: Turn | null = null;
  let pendingRange: TimeRange | undefined;
  let recognizedLabels = 0;
  const flush = () => {
    if (current?.text.trim()) turns.push({ ...current, text: current.text.trim() });
    current = null;
  };
  for (const physicalLine of normalized.split("\n")) {
    let content = physicalLine.trim();
    if (!content) { flush(); continue; }
    const time = rangePrefix.exec(content);
    let range: TimeRange | undefined;
    if (time) {
      range = { start: timeInSeconds(time[1]), end: timeInSeconds(time[2]) };
      if (range.end <= range.start || range.end > 7_200) throw new Error("Mốc kết thúc phải lớn hơn mốc bắt đầu và không vượt 2 giờ.");
      content = content.slice(time[0].length).trim();
    }
    const label = extractRole(content);
    if (label) {
      flush();
      activeSpeaker = label.speaker;
      activeEmotion = label.emotion;
      content = label.text;
      recognizedLabels++;
    } else if (range) flush();
    if (!content) { pendingRange = range || pendingRange; continue; }
    if (!current) {
      current = { speaker: activeSpeaker, emotion: activeEmotion, text: content, range: range || pendingRange };
      pendingRange = undefined;
    } else current.text += `\n${content}`;
  }
  flush();
  if (!turns.length) throw new Error("Chưa có lời thoại sau nhãn NAM/NỮ. Hãy thêm nội dung cần đọc.");

  const lines: ScriptLine[] = [];
  let cursor = 0;
  let estimatedTiming = false;
  for (const turn of turns) {
    const chunks = splitLongTurn(turn.text);
    const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
    let offset = 0;
    for (const text of chunks) {
      let start: number;
      let end: number;
      if (turn.range) {
        const duration = turn.range.end - turn.range.start;
        start = turn.range.start + duration * offset / totalLength;
        offset += text.length;
        end = turn.range.start + duration * offset / totalLength;
      } else {
        estimatedTiming = true;
        start = cursor;
        const words = text.trim().split(/\s+/u).length;
        end = Math.round((start + Math.max(1.5, words / 3 + 0.4)) * 10) / 10;
      }
      lines.push({ speaker: turn.speaker, emotion: turn.emotion, text, start, end });
      cursor = Math.max(cursor, end);
    }
  }
  if (lines.length > 500) throw new Error("Kịch bản có hơn 500 đoạn. Hãy chia thành các phần nhỏ hơn.");
  const speakers = new Set(lines.map((line) => line.speaker));
  const inferredVoiceMode: VoiceMode | null = recognizedLabels ? speakers.size > 1 ? "dual" : lines[0].speaker : null;
  const scenes = Array.from({ length: Math.ceil(lines.length / 20) }, (_, index) => {
    const sceneLines = lines.slice(index * 20, (index + 1) * 20);
    return { start: Math.min(...sceneLines.map((line) => line.start)), end: Math.max(...sceneLines.map((line) => line.end)), visual: "Nội dung từ kịch bản đã nhập; chưa phân tích hình ảnh.", lines: sceneLines };
  });
  return {
    analysis: {
      summary: `Đã tách ${lines.length} đoạn từ kịch bản đã nhập, giữ nguyên lời thoại.${recognizedLabels ? " Giọng đọc được nhận diện theo nhãn NAM/NỮ." : ` Chưa có nhãn NAM/NỮ; các đoạn đang gán cho nhân vật ${defaultSpeaker === "male" ? "nam" : "nữ"}.`}${estimatedTiming ? " Mốc thời gian là ước tính theo độ dài lời thoại, bạn có thể chỉnh lại." : " Giữ mốc thời gian đã nhập."}`,
      scenes,
    },
    inferredVoiceMode,
    estimatedTiming,
    recognizedLabels,
    lineCount: lines.length,
  };
}
