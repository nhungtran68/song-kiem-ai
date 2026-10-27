import { put } from "@vercel/blob";
import { generateText, Output } from "ai";
import ffmpegPath from "ffmpeg-static";
import { spawn } from "node:child_process";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { extname, join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { FatalError, RetryableError } from "workflow";
import { analysisOutputSchema, type AnalyzeJobInput, type RenderJobInput } from "@/lib/schemas";
import { SaydiError, synthesizeSaydiSpeech } from "@/lib/saydi";
import { createSrt } from "@/lib/timeline";

type Frame = { bytes: Buffer; mediaType: string; label: string };
export type DialogueAudioTrack = {
  index: number;
  url: string;
  start: number;
  end: number;
  voiceId: string;
  charsCharged: number | null;
  durationSeconds: number | null;
};

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
  const count = Math.min(12, Math.max(2, Math.ceil(duration / 6)));
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
    ...(input.prompt ? [`Định hướng kịch bản của người dùng: ${input.prompt}`] : []),
    `Thời lượng tối đa: ${duration.toFixed(1)} giây.`,
    "Viết kịch bản tiếng Việt tự nhiên cho đúng hai nhân vật: male (nam) và female (nữ).",
    "Mỗi câu phải có mốc start/end nằm trong thời lượng, không chồng chéo vô lý, và bám sát diễn biến nhìn thấy.",
    "Không bịa chi tiết không xuất hiện trong hình. Nếu không chắc, mô tả trung tính.",
    "Các ảnh được gửi theo thứ tự thời gian và có nhãn ngay trước từng ảnh. Với video, đây là những khung hình mẫu, không phải toàn bộ chuyển động.",
    "Ưu tiên định hướng của người dùng về giọng kể và câu chuyện, nhưng không khẳng định chi tiết hình ảnh chưa nhìn thấy.",
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

export async function synthesizeDialogueStep({
  index, text, voiceId, start, end,
}: { index: number; text: string; voiceId: string; start: number; end: number }): Promise<DialogueAudioTrack> {
  "use step";
  try {
    const result = await synthesizeSaydiSpeech(text, voiceId);
    const blob = await put(`speech/${crypto.randomUUID()}-${index}.mp3`, Buffer.from(result.audio), {
      access: "public",
      contentType: "audio/mpeg",
      addRandomSuffix: false,
    });
    console.info("[speech] Đã tạo câu thoại", { index, voiceId: result.voiceId, charsCharged: result.charsCharged });
    return {
      index,
      url: blob.url,
      start,
      end,
      voiceId: result.voiceId,
      charsCharged: result.charsCharged,
      durationSeconds: result.durationSeconds,
    };
  } catch (error) {
    if (error instanceof SaydiError && (
      error.code === "insufficient_quota" || ![429, 500, 503].includes(error.status)
    )) throw new FatalError(error.message);
    throw error;
  }
}

async function probeMedia(path: string): Promise<{ duration: number | null; hasAudio: boolean }> {
  const binaryPath = ffmpegPath;
  if (!binaryPath) throw new FatalError("FFmpeg không khả dụng.");
  return new Promise((resolve, reject) => {
    const child = spawn(binaryPath, ["-hide_banner", "-i", path], { windowsHide: true, stdio: ["ignore", "ignore", "pipe"] });
    let output = "";
    child.stderr.on("data", (chunk: Buffer) => { output = `${output}${chunk.toString()}`.slice(-16_000); });
    child.on("error", reject);
    child.on("close", () => {
      const match = output.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
      const duration = match ? Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]) : null;
      resolve({ duration, hasAudio: /Stream #\d+:\d+.*: Audio:/.test(output) });
    });
  });
}

export async function renderVideoStep(input: RenderJobInput, tracks: DialogueAudioTrack[]) {
  "use step";
  console.info("[render] Bắt đầu dựng", { mediaType: input.media.contentType, lines: input.lines.length, tracks: tracks.length });

  const workdir = await mkdtemp(join(tmpdir(), "song-kiem-ai-render-"));
  const extension = extname(new URL(input.media.url).pathname) || (input.media.contentType.startsWith("image/") ? ".jpg" : ".mp4");
  const sourcePath = join(workdir, `source${extension}`);
  const subtitlePath = join(workdir, "subtitles.srt");
  const outputPath = join(workdir, "song-kiem-ai.mp4");

  try {
    await download(input.media.url, sourcePath);
    await writeFile(subtitlePath, createSrt(input.lines), "utf8");
    const subtitleFilter = `subtitles='${ffmpegSubtitlePath(subtitlePath)}':force_style='FontName=DejaVu Sans,FontSize=20,PrimaryColour=&H00FFFFFF,OutlineColour=&H80000000,BorderStyle=1,Outline=2,Shadow=0,MarginV=36'`;
    const isImage = input.media.contentType.startsWith("image/");
    const targetDuration = isImage
      ? Math.max(1, input.media.duration, ...input.lines.map((line) => line.end))
      : input.media.duration;
    const sourceInfo = isImage ? { hasAudio: false } : await probeMedia(sourcePath);

    if (tracks.length > 0) {
      const audioPaths: string[] = [];
      const audioFilters: string[] = [];
      const audioLabels: string[] = [];
      if (sourceInfo.hasAudio) {
        audioFilters.push("[0:a:0]aresample=48000,volume=0.25[original]");
        audioLabels.push("[original]");
      }

      for (const [position, track] of tracks.entries()) {
        const audioPath = join(workdir, `line-${track.index}.mp3`);
        await download(track.url, audioPath);
        audioPaths.push(audioPath);
        const probed = track.durationSeconds ? null : await probeMedia(audioPath);
        const duration = track.durationSeconds || probed?.duration;
        if (!duration || !Number.isFinite(duration)) {
          throw new FatalError(`Không đọc được thời lượng giọng nói ở câu ${track.index + 1}.`);
        }
        const slot = track.end - track.start;
        const rate = duration / slot;
        if (rate > 2) {
          throw new FatalError(`Câu ${track.index + 1} dài ${duration.toFixed(1)} giây, vượt mốc ${slot.toFixed(1)} giây. Hãy kéo dài mốc thoại.`);
        }
        const tempo = rate > 1.01 ? `atempo=${rate.toFixed(4)},` : "";
        const delay = Math.round(track.start * 1000);
        audioFilters.push(`[${position + 1}:a:0]aresample=48000,${tempo}adelay=${delay}|${delay}[line${position}]`);
        audioLabels.push(`[line${position}]`);
      }

      const mix = audioLabels.length > 1
        ? `${audioLabels.join("")}amix=inputs=${audioLabels.length}:duration=longest:dropout_transition=0:normalize=0,alimiter=limit=0.95,apad,atrim=duration=${targetDuration.toFixed(3)}[aout]`
        : `${audioLabels[0]}apad,atrim=duration=${targetDuration.toFixed(3)}[aout]`;
      const videoFilter = `[0:v:0]${subtitleFilter},scale=trunc(iw/2)*2:trunc(ih/2)*2,format=yuv420p[vout]`;
      const args = ["-hide_banner", "-loglevel", "error"];
      if (isImage) args.push("-loop", "1");
      args.push("-i", sourcePath);
      for (const audioPath of audioPaths) args.push("-i", audioPath);
      args.push(
        "-filter_complex", [videoFilter, ...audioFilters, mix].join(";"),
        "-map", "[vout]", "-map", "[aout]",
        "-t", targetDuration.toFixed(3),
        "-c:v", "libx264", "-preset", "veryfast", "-c:a", "aac",
        "-movflags", "+faststart", "-y", outputPath,
      );
      await runFfmpeg(args, workdir);
    } else {
      const args = isImage
        ? [
            "-hide_banner", "-loglevel", "error", "-loop", "1", "-i", sourcePath,
            "-vf", `${subtitleFilter},scale=trunc(iw/2)*2:trunc(ih/2)*2,format=yuv420p`,
            "-t", targetDuration.toFixed(3),
            "-r", "30", "-c:v", "libx264", "-preset", "veryfast", "-movflags", "+faststart", "-y", outputPath,
          ]
        : [
            "-hide_banner", "-loglevel", "error", "-i", sourcePath,
            "-vf", `${subtitleFilter},scale=trunc(iw/2)*2:trunc(ih/2)*2,format=yuv420p`,
            "-map", "0:v:0", "-map", "0:a?", "-c:v", "libx264", "-preset", "veryfast", "-c:a", "aac",
            "-movflags", "+faststart", "-y", outputPath,
          ];
      await runFfmpeg(args, workdir);
    }
    const fileInfo = await stat(outputPath);
    const blob = await put(`renders/${crypto.randomUUID()}-song-kiem-ai.mp4`, createReadStream(outputPath), {
      access: "public",
      contentType: "video/mp4",
      addRandomSuffix: false,
      multipart: fileInfo.size > 15 * 1024 * 1024,
    });

    console.info("[render] Dựng hoàn tất", { size: fileInfo.size, tracks: tracks.length });
    return {
      url: blob.url,
      pathname: blob.pathname,
      size: fileInfo.size,
      originalAudioPreserved: sourceInfo.hasAudio,
      ttsMixed: tracks.length > 0,
      ttsCharsCharged: tracks.reduce((sum, track) => sum + (track.charsCharged || 0), 0),
      voiceIds: input.voiceIds,
    };
  } finally {
    await rm(workdir, { recursive: true, force: true });
  }
}
