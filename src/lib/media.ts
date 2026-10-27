export type CapturedFrame = { time: number; image: string };

const MEDIA_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "video/mp4", "video/quicktime", "video/webm"]);
const EXTENSION_TYPES: Record<string, string> = {
  jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp",
  mp4: "video/mp4", m4v: "video/mp4", mov: "video/quicktime", webm: "video/webm",
};

export function inferMediaType(file: Pick<File, "name" | "type">): string | null {
  if (MEDIA_TYPES.has(file.type)) return file.type;
  return EXTENSION_TYPES[file.name.split(".").at(-1)?.toLowerCase() || ""] || null;
}

function waitForMedia(target: EventTarget, event: string, signal: AbortSignal, start?: () => void): Promise<void> {
  return new Promise((resolve, reject) => {
    signal.throwIfAborted();
    const cleanup = () => {
      clearTimeout(timeout);
      target.removeEventListener(event, done);
      target.removeEventListener("error", failed);
      signal.removeEventListener("abort", aborted);
    };
    const done = () => { cleanup(); resolve(); };
    const failed = () => { cleanup(); reject(new Error("Không đọc được ảnh/video. Hãy thử MP4 (H.264), WEBM, JPG hoặc PNG.")); };
    const aborted = () => { cleanup(); reject(signal.reason); };
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error("Đọc tệp quá lâu. Hãy thử một clip ngắn hơn hoặc đổi sang MP4 (H.264)."));
    }, 20_000);
    target.addEventListener(event, done, { once: true });
    target.addEventListener("error", failed, { once: true });
    signal.addEventListener("abort", aborted, { once: true });
    try { start?.(); } catch (error) { cleanup(); reject(error); }
  });
}

function drawFrame(source: CanvasImageSource, width: number, height: number): string {
  if (!width || !height) throw new Error("Khung hình chưa giải mã được. Hãy thử video MP4 (H.264).");
  const scale = Math.min(1, 768 / Math.max(width, height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Trình duyệt không thể đọc khung hình.");
  context.drawImage(source, 0, 0, canvas.width, canvas.height);
  const image = canvas.toDataURL("image/jpeg", 0.65);
  if (image.length > 400_000) throw new Error("Khung hình quá lớn để phân tích. Hãy thử tệp khác.");
  return image;
}

export async function captureFrames(file: File, signal: AbortSignal, onProgress: (text: string) => void) {
  signal.throwIfAborted();
  const mediaType = inferMediaType(file);
  if (!mediaType) throw new Error("Định dạng ảnh/video chưa được hỗ trợ.");
  const url = URL.createObjectURL(file);
  let video: HTMLVideoElement | null = null;
  try {
    if (mediaType.startsWith("image/")) {
      onProgress("Đang đọc ảnh...");
      const image = new Image();
      await waitForMedia(image, "load", signal, () => { image.src = url; });
      return { frames: [{ time: 0, image: drawFrame(image, image.naturalWidth, image.naturalHeight) }], duration: 15, mediaKind: "image" as const };
    }
    onProgress("Đang đọc thông tin video...");
    video = document.createElement("video");
    const source = video;
    source.preload = "auto";
    source.muted = true;
    source.playsInline = true;
    await waitForMedia(source, "loadedmetadata", signal, () => { source.src = url; source.load(); });
    const duration = source.duration;
    if (!Number.isFinite(duration) || duration <= 0 || duration > 7_200) {
      throw new Error("Video phải có thời lượng hợp lệ, tối đa 2 giờ.");
    }
    const count = Math.min(8, Math.max(2, Math.ceil(duration / 15) + 1));
    const frames: CapturedFrame[] = [];
    const inset = Math.min(0.1, duration / 4);
    for (let index = 0; index < count; index++) {
      const time = inset + ((duration - 2 * inset) * index) / (count - 1);
      onProgress(`Đang lấy khung hình ${index + 1}/${count}...`);
      await waitForMedia(source, "seeked", signal, () => { source.currentTime = time; });
      if (source.readyState < 2) await waitForMedia(source, "loadeddata", signal);
      frames.push({ time, image: drawFrame(source, source.videoWidth, source.videoHeight) });
    }
    return { frames, duration, mediaKind: "video" as const };
  } finally {
    video?.pause();
    video?.removeAttribute("src");
    video?.load();
    URL.revokeObjectURL(url);
  }
}
