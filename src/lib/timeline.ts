import type { AnalysisResult, DialogueLine, TimelineScene } from "@/types/studio";

export function secondsLabel(value: number): string {
  const safe = Number.isFinite(value) ? Math.max(0, value) : 0;
  const minutes = Math.floor(safe / 60);
  const seconds = Math.floor(safe % 60);
  const tenths = Math.floor((safe % 1) * 10);
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}.${tenths}`;
}

export function srtTimestamp(value: number): string {
  const totalMs = Math.round(Math.max(0, value) * 1_000);
  const hours = Math.floor(totalMs / 3_600_000);
  const minutes = Math.floor((totalMs % 3_600_000) / 60_000);
  const seconds = Math.floor((totalMs % 60_000) / 1_000);
  const milliseconds = totalMs % 1_000;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")},${String(milliseconds).padStart(3, "0")}`;
}

export function createSrt(lines: Pick<DialogueLine, "speaker" | "text" | "start" | "end">[]): string {
  return lines
    .filter((line) => line.text.trim() && line.end > line.start)
    .sort((a, b) => a.start - b.start)
    .map((line, index) => {
      const speaker = `NHÂN VẬT ${line.speaker.toUpperCase()}`;
      const text = line.text.replace(/\r?\n/g, " ").trim();
      return `${index + 1}\n${srtTimestamp(line.start)} --> ${srtTimestamp(line.end)}\n${speaker}: ${text}\n`;
    })
    .join("\n");
}

export function hydrateAnalysis(result: {
  summary: string;
  scenes: Array<{
    start: number;
    end: number;
    visual: string;
    lines: Array<{
      speaker: "a" | "b";
      text: string;
      emotion: string;
      start: number;
      end: number;
    }>;
  }>;
}): AnalysisResult {
  const scenes: TimelineScene[] = result.scenes.map((scene, sceneIndex) => ({
    ...scene,
    id: `scene-${sceneIndex}-${crypto.randomUUID()}`,
    lines: scene.lines.map((line, lineIndex) => ({
      ...line,
      id: `line-${sceneIndex}-${lineIndex}-${crypto.randomUUID()}`,
    })),
  }));
  return { summary: result.summary, scenes };
}
