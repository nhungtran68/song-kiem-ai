import { put } from "@vercel/blob";
import { generateText, Output } from "ai";
import ffmpegPath from "ffmpeg-static";
import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { extname, join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { FatalError, RetryableError } from "workflow";
import { analysisOutputSchema, type AnalyzeJobInput, type RenderJobInput } from "@/lib/schemas";
import { createSrt } from "@/lib/timeline";

type Frame = { bytes: Buffer; mediaType: string; label: string };

async function runFfmpeg(args: string[], cwd: string): Promise<void> {
  const binaryPath = ffmpegPath;
  if (!binaryPath) throw new FatalError("FFmpeg binary không khả dụng trên môi trường hiện tại.");

  await new Promise<void>((resolve, reject) => {
    const child = spawn(binaryPath, args, { cwd, windowsHide: true, stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (chunk: Buffer) => {
      stderr = `${stderr}${chunk.toString()}`.slice(-8_000);
    });
    child.on("error", reject);
    child.on("close", (code: number | null) => {
      if (code === 0) resolve();
      else reject(new Error(`FFmpeg dừng với mã ${code}: ${stderr}`));
    });
  });
}

async function download(url: string, destination: string): Promise<void> {
  const response = await fetch(url);
  if (!response.ok) {
    const message = `Không tải được media nguồn (HTTP ${response.status}).`;
    if (response.status >= 500 || response.status === 429) throw new RetryableError(message);
    throw new FatalError(message);
  }
  if (!response.body) throw new RetryableError("Media nguồn không có nội dung để xử lý.");
  await pipeline(
    Readable.from(response.body as unknown as AsyncIterable<Uint8Array>),
    createWriteStream(destination),
  );
}

function sampleTimes(duration: number): number[] {
  if (!duration || duration <= 0) return [0];
  const count = Math.min(6, Math.max(2, Math.ceil(duration / 12)));
  return Array.from({ length: count }, (_, index) => {
    const fraction = count === 1 ? 0 : index / (count - 1);
    return Math.max(0, Math.min(duration - 0.1, fraction * duration));
  });
}

async function prepareFrames(input: AnalyzeJobInput): Promise<Frame[]> {
  const workdir = await mkdtemp(join(tmpdir(), "song-kiem-ai-vision-"));
  const extension = extname(new URL(input.media.url).pathname) || (input.media.contentType.startsWith("image/") ? ".jpg" : ".mp4");
  const sourcePath = join(workdir, `source${extension}`);

  try {
    await download(input.media.url, sourcePath);
    if (input.media.contentType.startsWith("image/")) {
      return [{
        bytes: await readFile(sourcePath),
        mediaType: input.media.contentType,
        label: "Ảnh nguồn",
      }];
    }

    const frames: Frame[] = [];
    for (const [index, timestamp] of sampleTimes(input.media.duration).entries()) {
      const framePath = join(workdir, `frame-${index}.jpg`);
      await runFfmpeg([
        "-hide_banner",
        "-loglevel",
        "error",
        "-ss",
        timestamp.toFixed(3),
        "-i",
        sourcePath,
        "-frames:v",
        "1",
        "-vf",
        "scale='min(1280,iw)':-2",
        "-q:v",
        "3",
        "-y",
        framePath,
      ], workdir);
      frames.push({
        bytes: await readFile(framePath),
        mediaType: "image/jpeg",
        label: `Khung hình tại ${timestamp.toFixed(1)} giây`,
      });
    }
    return frames;
  } finally {
    await rm(workdir, { recursive: true, force: true });
  }
}

export async function analyzeMediaStep(input: AnalyzeJobInput) {
  "use step";
  console.info("[vision] Chuẩn bị khung hình", { mediaType: input.media.contentType, duration: input.media.duration });

  const frames = await prepareFrames(input);
  const model = process.env.AI_GATEWAY_MODEL || "openai/gpt-5.4-mini";
  const duration = Math.max(input.media.duration, input.media.contentType.startsWith("image/") ? 12 : 1);
  const prompt = [
    `Hãy phân tích media cho dự án có tiêu đề: ${input.title || "Chưa đặt tên"}.`,
    `Phong cách hội thoại: ${input.style}.`,
    `Thời lượng tối đa: ${duration.toFixed(1)} giây.`,
    "Viết kịch bản tiếng Việt tự nhiên cho đúng hai nhân vật: male (nam) và female (nữ).",
    "Mỗi câu phải có mốc start/end nằm trong thời lượng, không chồng chéo vô lý, và bám sát diễn biến nhìn thấy.",
    "Không bịa chi tiết không xuất hiện trong hình. Nếu không chắc, mô tả trung tính.",
    "Các ảnh được gửi theo thứ tự thời gian và có nhãn ngay trước từng ảnh.",
  ].join("\n");

  const content: Array<
    | { type: "text"; text: string }
    | { type: "file"; data: Buffer; mediaType: string; filename: string }
  > = [{ type: "text", text: prompt }];
  for (const [index, frame] of frames.entries()) {
    content.push({ type: "text", text: frame.label });
    content.push({ type: "file", data: frame.bytes, mediaType: frame.mediaType, filename: `frame-${index}.jpg` });
  }

  const result = await generateText({
    model,
    instructions: "Bạn là biên kịch video ngắn. Chỉ trả dữ liệu đúng schema, nội dung bằng tiếng Việt.",
    output: Output.object({ schema: analysisOutputSchema }),
    messages: [{ role: "user", content }],
  });

  const clampRange = (start: number, end: number) => {
    const safeStart = Math.min(Math.max(0, start), Math.max(0, duration - 0.1));
    return {
      start: safeStart,
      end: Math.min(duration, Math.max(safeStart + 0.1, end)),
    };
  };

  const normalized = {
    summary: result.output.summary,
    scenes: result.output.scenes.map((scene) => {
      const sceneRange = clampRange(scene.start, scene.end);
      return {
        ...scene,
        ...sceneRange,
        lines: scene.lines.map((line) => ({ ...line, ...clampRange(line.start, line.end) })),
      };
    }),
  };

  console.info("[vision] Phân tích hoàn tất", { scenes: normalized.scenes.length, model });
  return normalized;
}

function ffmpegSubtitlePath(path: string): string {
  return path.replace(/\\/g, "/").replace(/^([A-Za-z]):/, "$1\\:").replace(/'/g, "\\'");
}

export async function renderVideoStep(input: RenderJobInput) {
  "use step";
  console.info("[render] Bắt đầu dựng", { mediaType: input.media.contentType, lines: input.lines.length });

  const workdir = await mkdtemp(join(tmpdir(), "song-kiem-ai-render-"));
  const extension = extname(new URL(input.media.url).pathname) || (input.media.contentType.startsWith("image/") ? ".jpg" : ".mp4");
  const sourcePath = join(workdir, `source${extension}`);
  const subtitlePath = join(workdir, "subtitles.srt");
  const outputPath = join(workdir, "song-kiem-ai.mp4");

  try {
    await download(input.media.url, sourcePath);
    await writeFile(subtitlePath, createSrt(input.lines), "utf8");
    const subtitleFilter = `subtitles='${ffmpegSubtitlePath(subtitlePath)}':force_style='FontName=DejaVu Sans,FontSize=20,PrimaryColour=&H00FFFFFF,OutlineColour=&H80000000,BorderStyle=1,Outline=2,Shadow=0,MarginV=36'`;

    const args = input.media.contentType.startsWith("image/")
      ? [
          "-hide_banner", "-loglevel", "error", "-loop", "1", "-i", sourcePath,
          "-vf", `${subtitleFilter},scale=trunc(iw/2)*2:trunc(ih/2)*2,format=yuv420p`,
          "-t", Math.max(1, input.media.duration, ...input.lines.map((line) => line.end)).toFixed(3),
          "-r", "30", "-c:v", "libx264", "-preset", "veryfast", "-movflags", "+faststart", "-y", outputPath,
        ]
      : [
          "-hide_banner", "-loglevel", "error", "-i", sourcePath,
          "-vf", subtitleFilter,
          "-map", "0:v:0", "-map", "0:a?", "-c:v", "libx264", "-preset", "veryfast", "-c:a", "aac",
          "-movflags", "+faststart", "-y", outputPath,
        ];

    await runFfmpeg(args, workdir);
    const bytes = await readFile(outputPath);
    const blob = await put(`renders/${crypto.randomUUID()}-song-kiem-ai.mp4`, bytes, {
      access: "public",
      contentType: "video/mp4",
      addRandomSuffix: false,
    });

    console.info("[render] Dựng hoàn tất", { size: bytes.length });
    return {
      url: blob.url,
      pathname: blob.pathname,
      size: bytes.length,
      originalAudioPreserved: input.media.contentType.startsWith("video/"),
      ttsMixed: false,
      voiceIds: input.voiceIds,
    };
  } finally {
    await rm(workdir, { recursive: true, force: true });
  }
}
