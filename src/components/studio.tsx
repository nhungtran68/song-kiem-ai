"use client";

import { upload } from "@vercel/blob/client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { hydrateAnalysis, secondsLabel } from "@/lib/timeline";
import type { DialogueLine, MediaAsset, StudioDraft, TimelineScene, VoicePair } from "@/types/studio";

export type PublicRuntimeConfig = {
  blobReady: boolean;
  aiReady: boolean;
  saydiReady: boolean;
  saydiSpeechSchemaReady: boolean;
  aiModel: string;
  voiceIds: VoicePair;
};

type JobState = {
  runId: string;
  action: "analyze" | "render";
  status: string;
} | null;

const STYLES = ["Điện ảnh", "Hài hước", "Lãng mạn", "Kịch tính", "Đời thường", "Cổ trang"];
const DRAFT_KEY = "song-kiem-ai-draft-v1";
const MAX_UPLOAD_BYTES = 2 * 1024 * 1024 * 1024;
const ACCEPTED_MEDIA_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "video/mp4", "video/quicktime", "video/webm"]);

function Icon({ name }: { name: "upload" | "spark" | "plus" | "trash" | "play" | "download" | "stop" }) {
  const paths = {
    upload: <><path d="M12 3v12"/><path d="m7 8 5-5 5 5"/><path d="M5 15v4h14v-4"/></>,
    spark: <><path d="m12 3 1.4 4.6L18 9l-4.6 1.4L12 15l-1.4-4.6L6 9l4.6-1.4L12 3Z"/><path d="m18.5 15 .7 2.3 2.3.7-2.3.7-.7 2.3-.7-2.3-2.3-.7 2.3-.7.7-2.3Z"/></>,
    plus: <><path d="M12 5v14"/><path d="M5 12h14"/></>,
    trash: <><path d="M4 7h16"/><path d="m9 7 1-3h4l1 3"/><path d="m7 7 1 13h8l1-13"/></>,
    play: <path d="m8 5 11 7-11 7V5Z"/>,
    download: <><path d="M12 3v12"/><path d="m7 11 5 5 5-5"/><path d="M5 20h14"/></>,
    stop: <rect x="6" y="6" width="12" height="12" rx="1"/>,
  };
  return <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{paths[name]}</svg>;
}

function StatusDot({ ok, label }: { ok: boolean; label: string }) {
  return <span className={`status-pill ${ok ? "is-ready" : "is-missing"}`}><i />{label}</span>;
}

function errorMessage(value: unknown): string {
  if (value instanceof Error) return value.message;
  return "Đã xảy ra lỗi không xác định.";
}

async function parseResponse(response: Response) {
  const payload = await response.json().catch(() => null) as { error?: string; message?: string } | null;
  if (!response.ok) throw new Error(payload?.error || payload?.message || `HTTP ${response.status}`);
  return payload;
}

function safeFileName(name: string): string {
  const normalized = name.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  return normalized.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(-100) || "media";
}

function makeLine(start = 0, end = 3): DialogueLine {
  return { id: crypto.randomUUID(), speaker: "male", text: "", emotion: "Tự nhiên", start, end };
}

function makeScene(duration: number): TimelineScene {
  const end = Math.max(3, duration || 6);
  return { id: crypto.randomUUID(), start: 0, end, visual: "Cảnh do bạn biên tập thủ công", lines: [makeLine(0, Math.min(3, end))] };
}

export default function Studio({ config }: { config: PublicRuntimeConfig }) {
  const [title, setTitle] = useState("Dự án chưa đặt tên");
  const [style, setStyle] = useState(STYLES[0]);
  const [prompt, setPrompt] = useState("");
  const [voiceIds, setVoiceIds] = useState<VoicePair>(config.voiceIds);
  const [includeTts, setIncludeTts] = useState(true);
  const [summary, setSummary] = useState("");
  const [scenes, setScenes] = useState<TimelineScene[]>([]);
  const [media, setMedia] = useState<MediaAsset | null>(null);
  const [previewUrl, setPreviewUrl] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [busy, setBusy] = useState<"upload" | "analyze" | "render" | null>(null);
  const [job, setJob] = useState<JobState>(null);
  const [message, setMessage] = useState<{ type: "error" | "info" | "success"; text: string } | null>(null);
  const [renderUrl, setRenderUrl] = useState("");
  const [speechStatus, setSpeechStatus] = useState<{ lineId: string; phase: "loading" | "playing" } | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const cancelledRef = useRef(false);
  const speechRequestRef = useRef<AbortController | null>(null);
  const speechAudioRef = useRef<HTMLAudioElement | null>(null);
  const speechUrlRef = useRef<string | null>(null);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      const raw = localStorage.getItem(DRAFT_KEY);
      if (raw) {
        try {
          const draft = JSON.parse(raw) as StudioDraft;
          if (draft.version === 1) {
            setTitle(draft.title);
            setStyle(draft.style);
            setPrompt(draft.prompt ?? "");
            setVoiceIds(draft.voiceIds);
            setIncludeTts(draft.includeTts ?? true);
            setSummary(draft.summary);
            setScenes(draft.scenes);
            setMedia(draft.media);
          }
        } catch {
          localStorage.removeItem(DRAFT_KEY);
        }
      }
      setHydrated(true);
    });
    return () => window.cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    const draft: StudioDraft = { version: 1, title, style, prompt, voiceIds, includeTts, summary, scenes, media };
    localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
  }, [hydrated, includeTts, media, prompt, scenes, style, summary, title, voiceIds]);

  useEffect(() => () => {
    if (previewUrl.startsWith("blob:")) URL.revokeObjectURL(previewUrl);
  }, [previewUrl]);

  useEffect(() => () => {
    speechRequestRef.current?.abort();
    speechAudioRef.current?.pause();
    if (speechUrlRef.current) URL.revokeObjectURL(speechUrlRef.current);
  }, []);

  const allLines = useMemo(() => scenes.flatMap((scene) => scene.lines), [scenes]);
  const totalDuration = useMemo(() => Math.max(media?.duration || 0, ...allLines.map((line) => line.end), 0), [allLines, media]);

  const updateLine = useCallback((sceneId: string, lineId: string, patch: Partial<DialogueLine>) => {
    setScenes((current) => current.map((scene) => scene.id === sceneId
      ? { ...scene, lines: scene.lines.map((line) => line.id === lineId ? { ...line, ...patch } : line) }
      : scene));
  }, []);

  const removeLine = useCallback((sceneId: string, lineId: string) => {
    setScenes((current) => current
      .map((scene) => scene.id === sceneId ? { ...scene, lines: scene.lines.filter((line) => line.id !== lineId) } : scene)
      .filter((scene) => scene.lines.length > 0));
  }, []);

  const addLine = () => {
    if (!scenes.length) {
      setScenes([makeScene(media?.duration || 0)]);
      return;
    }
    const lastScene = scenes.at(-1)!;
    const lastEnd = lastScene.lines.at(-1)?.end || lastScene.start;
    setScenes((current) => current.map((scene) => scene.id === lastScene.id
      ? { ...scene, end: Math.max(scene.end, lastEnd + 3), lines: [...scene.lines, makeLine(lastEnd, lastEnd + 3)] }
      : scene));
  };

  const stopSpeech = () => {
    speechRequestRef.current?.abort();
    speechRequestRef.current = null;
    speechAudioRef.current?.pause();
    speechAudioRef.current = null;
    if (speechUrlRef.current) URL.revokeObjectURL(speechUrlRef.current);
    speechUrlRef.current = null;
    setSpeechStatus(null);
  };

  const previewSpeech = async (line: DialogueLine) => {
    if (speechStatus?.lineId === line.id) {
      stopSpeech();
      return;
    }
    stopSpeech();
    const voice = voiceIds[line.speaker].trim();
    const input = line.text.trim();
    if (!voice || !input) {
      setMessage({ type: "error", text: "Cần mã giọng và nội dung câu thoại để nghe thử." });
      return;
    }

    const controller = new AbortController();
    speechRequestRef.current = controller;
    setSpeechStatus({ lineId: line.id, phase: "loading" });
    setMessage(null);
    try {
      const response = await fetch("/api/saydi/speech", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: "tts-1", voice, input }),
        signal: controller.signal,
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => null) as { error?: { message?: string } | string } | null;
        const message = typeof payload?.error === "string" ? payload.error : payload?.error?.message;
        throw new Error(message || `SaydiVoice trả về HTTP ${response.status}.`);
      }
      const audioBlob = await response.blob();
      if (!audioBlob.type.startsWith("audio/") || !audioBlob.size) {
        throw new Error("SaydiVoice chưa trả về dữ liệu âm thanh hợp lệ.");
      }
      if (controller.signal.aborted) return;

      const url = URL.createObjectURL(audioBlob);
      speechUrlRef.current = url;
      const audio = new Audio(url);
      speechAudioRef.current = audio;
      const finishPlayback = () => {
        if (speechAudioRef.current !== audio) return;
        speechAudioRef.current = null;
        if (speechUrlRef.current === url) speechUrlRef.current = null;
        URL.revokeObjectURL(url);
        setSpeechStatus(null);
      };
      audio.onended = finishPlayback;
      audio.onerror = () => {
        finishPlayback();
        setMessage({ type: "error", text: "Không phát được file giọng đọc vừa tạo." });
      };
      await audio.play();
      if (speechAudioRef.current !== audio) return;
      setSpeechStatus({ lineId: line.id, phase: "playing" });
      const chars = response.headers.get("X-OV-Chars");
      setMessage({
        type: "success",
        text: chars ? `Đang phát giọng ${voice}. SaydiVoice tính ${chars} ký tự cho lượt này.` : `Đang phát giọng ${voice}.`,
      });
    } catch (error) {
      if (!controller.signal.aborted) {
        stopSpeech();
        setMessage({ type: "error", text: errorMessage(error) });
      }
    } finally {
      if (speechRequestRef.current === controller) speechRequestRef.current = null;
    }
  };

  const readDuration = (selected: File): Promise<number> => new Promise((resolve) => {
    if (!selected.type.startsWith("video/")) return resolve(0);
    const url = URL.createObjectURL(selected);
    const video = document.createElement("video");
    video.preload = "metadata";
    video.onloadedmetadata = () => {
      const value = Number.isFinite(video.duration) ? video.duration : 0;
      URL.revokeObjectURL(url);
      resolve(value);
    };
    video.onerror = () => { URL.revokeObjectURL(url); resolve(0); };
    video.src = url;
  });

  const selectFile = async (selected: File) => {
    if (!ACCEPTED_MEDIA_TYPES.has(selected.type)) {
      setMessage({ type: "error", text: "Định dạng media chưa được hỗ trợ." });
      return;
    }
    if (selected.size > MAX_UPLOAD_BYTES) {
      setMessage({ type: "error", text: "Media vượt quá giới hạn 2 GB." });
      return;
    }
    if (previewUrl.startsWith("blob:")) URL.revokeObjectURL(previewUrl);
    const localUrl = URL.createObjectURL(selected);
    setPreviewUrl(localUrl);
    setFile(selected);
    setRenderUrl("");
    const duration = await readDuration(selected);

    if (!config.blobReady) {
      setMedia(null);
      setMessage({ type: "info", text: "Bạn có thể xem và soạn timeline cục bộ. Hãy kết nối Vercel Blob để chạy AI và dựng video." });
      return;
    }

    setBusy("upload");
    setUploadProgress(0);
    setMessage(null);
    try {
      const blob = await upload(`uploads/${crypto.randomUUID()}-${safeFileName(selected.name)}`, selected, {
        access: "public",
        handleUploadUrl: "/api/upload",
        multipart: selected.size > 15 * 1024 * 1024,
        contentType: selected.type,
        onUploadProgress: ({ percentage }) => setUploadProgress(Math.round(percentage)),
      });
      setMedia({
        url: blob.url,
        pathname: blob.pathname,
        contentType: selected.type,
        name: selected.name,
        size: selected.size,
        duration,
      });
      setMessage({ type: "success", text: "Media đã tải lên và sẵn sàng xử lý." });
    } catch (error) {
      setMedia(null);
      setMessage({ type: "error", text: errorMessage(error) });
    } finally {
      setBusy(null);
    }
  };

  const pollJob = async (runId: string, action: "analyze" | "render") => {
    cancelledRef.current = false;
    for (;;) {
      if (cancelledRef.current) return;
      const response = await fetch(`/api/jobs?runId=${encodeURIComponent(runId)}`, { cache: "no-store" });
      const payload = await response.json() as {
        status?: string;
        error?: string;
        result?: {
          kind: "analysis" | "render";
          analysis?: Parameters<typeof hydrateAnalysis>[0];
          render?: { url: string; originalAudioPreserved: boolean; ttsMixed: boolean };
        };
      };
      if (!response.ok) throw new Error(payload.error || "Không đọc được trạng thái job.");
      setJob({ runId, action, status: payload.status || "running" });
      if (payload.status === "completed") {
        if (payload.result?.kind === "analysis" && payload.result.analysis) {
          const analysis = hydrateAnalysis(payload.result.analysis);
          setSummary(analysis.summary);
          setScenes(analysis.scenes);
          setMessage({ type: "success", text: `AI đã tạo ${analysis.scenes.length} cảnh để bạn biên tập.` });
        }
        if (payload.result?.kind === "render" && payload.result.render) {
          setRenderUrl(payload.result.render.url);
          setMessage({
            type: "success",
            text: payload.result.render.ttsMixed
              ? "MP4 đã dựng xong với giọng đọc SaydiVoice, phụ đề và âm thanh gốc (nếu có)."
              : "MP4 đã dựng xong với phụ đề và âm thanh gốc (nếu có).",
          });
        }
        setBusy(null);
        return;
      }
      if (payload.status === "failed" || payload.status === "cancelled") {
        throw new Error(payload.error || "Job không hoàn tất.");
      }
      await new Promise((resolve) => window.setTimeout(resolve, 2_000));
    }
  };

  const startJob = async (action: "analyze" | "render") => {
    if (!media) {
      setMessage({ type: "error", text: "Hãy tải media lên trước." });
      return;
    }
    const filledLines = allLines.filter((line) => line.text.trim());
    if (action === "render" && !filledLines.length) {
      setMessage({ type: "error", text: "Cần ít nhất một câu thoại để tạo phụ đề." });
      return;
    }
    if (action === "render" && includeTts) {
      if (!config.saydiReady) {
        setMessage({ type: "error", text: "Chưa cấu hình SAYDI_API_KEY trên server để tạo giọng đọc." });
        return;
      }
      const missing = (["male", "female"] as const).filter((speaker) =>
        filledLines.some((line) => line.speaker === speaker) && !voiceIds[speaker].trim());
      if (missing.length) {
        setMessage({ type: "error", text: `Thiếu Voice ID cho nhân vật ${missing.map((speaker) => speaker === "male" ? "nam" : "nữ").join(" và ")}.` });
        return;
      }
    }
    setBusy(action);
    setMessage(null);
    try {
      const body = action === "analyze"
        ? { action, media, style, title, prompt, voiceIds }
        : { action, media, title, voiceIds, includeTts, lines: filledLines.map(({ speaker, text, start, end }) => ({ speaker, text, start, end })) };
      const response = await fetch("/api/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload = await parseResponse(response) as { runId: string; action: "analyze" | "render" };
      setJob({ runId: payload.runId, action, status: "pending" });
      await pollJob(payload.runId, action);
    } catch (error) {
      setBusy(null);
      setMessage({ type: "error", text: errorMessage(error) });
    }
  };

  const cancelJob = async () => {
    if (!job) return;
    cancelledRef.current = true;
    await fetch(`/api/jobs?runId=${encodeURIComponent(job.runId)}`, { method: "DELETE" }).catch(() => null);
    setBusy(null);
    setJob({ ...job, status: "cancelled" });
    setMessage({ type: "info", text: "Đã gửi yêu cầu hủy job." });
  };

  const mediaPreview = previewUrl || media?.url || "";
  const mediaType = file?.type || media?.contentType || "";

  return (
    <main className="app-shell">
      <header className="topbar">
        <a className="brand" href="#top" aria-label="Song Kiếm AI">
          <span className="brand-mark"><b>双</b><i /></span>
          <span><strong>Song Kiếm</strong><small>AI STUDIO</small></span>
        </a>
        <div className="runtime-status" aria-label="Trạng thái dịch vụ">
          <StatusDot ok={config.blobReady} label="Media" />
          <StatusDot ok={config.aiReady} label="Vision" />
          <StatusDot ok={config.saydiReady && config.saydiSpeechSchemaReady} label="Voice" />
        </div>
      </header>

      <section className="hero" id="top">
        <div>
          <p className="eyebrow">AI VIDEO DIALOGUE WORKSPACE</p>
          <h1>Một khung hình.<br /><em>Hai giọng kể.</em></h1>
          <p className="hero-copy">Từ ảnh hoặc video thành kịch bản đối thoại có mốc thời gian, sẵn sàng dựng thành MP4.</p>
        </div>
        <div className="process-rail" aria-label="Quy trình">
          {["Media", "Vision", "Đối thoại", "Xuất bản"].map((label, index) => (
            <div className={index === 0 || (index === 1 && scenes.length) || (index === 2 && allLines.length) || (index === 3 && renderUrl) ? "active" : ""} key={label}>
              <span>0{index + 1}</span><b>{label}</b>
            </div>
          ))}
        </div>
      </section>

      {message && <div className={`notice ${message.type}`} role="status"><span>{message.type === "error" ? "!" : message.type === "success" ? "✓" : "i"}</span>{message.text}</div>}

      <section className="workspace-grid">
        <article className="panel media-panel">
          <div className="panel-heading"><div><span className="section-number">01</span><h2>Media nguồn</h2></div><small>ẢNH / VIDEO</small></div>
          <div className={`dropzone ${mediaPreview ? "has-media" : ""}`}>
            {mediaPreview ? (
              <>
                {mediaType.startsWith("video/")
                  ? <video src={mediaPreview} controls playsInline />
                  // eslint-disable-next-line @next/next/no-img-element
                  : <img src={mediaPreview} alt="Media được chọn" />}
                <button className="change-media" type="button" onClick={() => inputRef.current?.click()}><Icon name="upload" />Đổi media</button>
              </>
            ) : (
              <button className="dropzone-empty" type="button" onClick={() => inputRef.current?.click()}>
                <span className="drop-icon"><Icon name="upload" /></span>
                <strong>Chạm để chọn media</strong>
                <small>JPG, PNG, WEBP, MP4, MOV hoặc WEBM · tối đa 2 GB</small>
              </button>
            )}
          </div>
          <input ref={inputRef} hidden type="file" accept="image/jpeg,image/png,image/webp,video/mp4,video/quicktime,video/webm" onChange={(event) => {
            const selected = event.target.files?.[0];
            if (selected) void selectFile(selected);
            event.currentTarget.value = "";
          }} />
          {busy === "upload" && <div className="progress"><i style={{ width: `${uploadProgress}%` }} /><span>{uploadProgress}%</span></div>}
          {media && <div className="file-meta"><span>{media.name}</span><small>{(media.size / 1024 / 1024).toFixed(1)} MB{media.duration ? ` · ${secondsLabel(media.duration)}` : ""}</small></div>}
        </article>

        <article className="panel setup-panel">
          <div className="panel-heading"><div><span className="section-number">02</span><h2>Thiết lập</h2></div><small>{config.aiModel}</small></div>
          <label className="field"><span>Tên dự án</span><input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={160} /></label>
          <label className="field"><span>Phong cách biên kịch</span><select value={style} onChange={(event) => setStyle(event.target.value)}>{STYLES.map((item) => <option key={item}>{item}</option>)}</select></label>
          <label className="field prompt-field"><span>Ý tưởng cho kịch bản (không bắt buộc)</span><textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} maxLength={600} placeholder="Ví dụ: Hai người bạn lâu ngày gặp lại, lời thoại vui và ngắn gọn…" /><small>{prompt.length}/600 ký tự · OpenAI sẽ dựa vào ảnh/video và ý tưởng này để soạn hội thoại.</small></label>
          <div className="voice-grid">
            <label className="field voice male"><span><i /> Nhân vật nam</span><input placeholder="voice_id, ví dụ vi-adam" value={voiceIds.male} onChange={(event) => setVoiceIds((current) => ({ ...current, male: event.target.value }))} /></label>
            <label className="field voice female"><span><i /> Nhân vật nữ</span><input placeholder="voice_id hoặc vc_..." value={voiceIds.female} onChange={(event) => setVoiceIds((current) => ({ ...current, female: event.target.value }))} /></label>
          </div>
          <p className="voice-note">Nhập Voice ID SaydiVoice cho mỗi nhân vật sẽ xuất hiện. Nút nghe thử và xuất MP4 có giọng đọc dùng credits theo số ký tự.</p>
          <div className="action-row">
            <button className="button primary" disabled={!media || busy !== null || !config.aiReady} onClick={() => void startJob("analyze")}><Icon name="spark" />{busy === "analyze" ? "Đang phân tích…" : "Phân tích bằng AI"}</button>
            {busy && busy !== "upload" && <button className="button ghost danger" onClick={() => void cancelJob()}><Icon name="stop" />Hủy</button>}
          </div>
          {job && <div className="job-chip"><i className={job.status} /> Job {job.action === "analyze" ? "Vision" : "Render"}: <b>{job.status}</b><small>{job.runId.slice(0, 12)}…</small></div>}
        </article>
      </section>

      <section className="panel timeline-panel">
        <div className="panel-heading timeline-heading">
          <div><span className="section-number">03</span><h2>Biên tập hội thoại</h2></div>
          <div className="timeline-actions"><span>{allLines.length} câu · {secondsLabel(totalDuration)}</span><button className="button ghost compact" onClick={addLine}><Icon name="plus" />Thêm câu</button></div>
        </div>
        {summary && <div className="summary"><span>TÓM TẮT AI</span><p>{summary}</p></div>}
        {!scenes.length ? (
          <div className="empty-timeline"><span>「</span><h3>Timeline đang trống</h3><p>Chạy AI Vision hoặc thêm câu thủ công để bắt đầu.</p><button className="button ghost" onClick={addLine}><Icon name="plus" />Thêm câu đầu tiên</button></div>
        ) : (
          <div className="scene-list">
            {scenes.map((scene, sceneIndex) => (
              <article className="scene" key={scene.id}>
                <header><span>CẢNH {String(sceneIndex + 1).padStart(2, "0")}</span><p>{scene.visual}</p><time>{secondsLabel(scene.start)} — {secondsLabel(scene.end)}</time></header>
                <div className="lines">
                  {scene.lines.map((line) => (
                    <div className={`dialogue ${line.speaker}`} key={line.id}>
                      <button className="speaker-toggle" type="button" onClick={() => updateLine(scene.id, line.id, { speaker: line.speaker === "male" ? "female" : "male" })} aria-label="Đổi nhân vật">
                        <i>{line.speaker === "male" ? "N" : "Nữ"}</i><span>{line.speaker === "male" ? "Nam" : "Nữ"}</span>
                      </button>
                      <div className="dialogue-main">
                        <textarea aria-label="Nội dung thoại" value={line.text} maxLength={800} placeholder="Nhập lời thoại…" onChange={(event) => updateLine(scene.id, line.id, { text: event.target.value })} />
                        <div className="line-meta">
                          <label>Cảm xúc <input value={line.emotion} onChange={(event) => updateLine(scene.id, line.id, { emotion: event.target.value })} /></label>
                          <label>Bắt đầu <input type="number" min="0" step="0.1" value={line.start} onChange={(event) => updateLine(scene.id, line.id, { start: Number(event.target.value) })} /></label>
                          <label>Kết thúc <input type="number" min="0.1" step="0.1" value={line.end} onChange={(event) => updateLine(scene.id, line.id, { end: Number(event.target.value) })} /></label>
                        </div>
                      </div>
                      <div className="line-tools">
                        <button
                          type="button"
                          className={speechStatus?.lineId === line.id ? `is-${speechStatus.phase}` : ""}
                          disabled={speechStatus?.lineId !== line.id && (!config.saydiReady || !line.text.trim() || !voiceIds[line.speaker].trim() || busy !== null)}
                          title={speechStatus?.lineId === line.id ? "Dừng giọng đọc" : "Nghe thử giọng đọc (SaydiVoice tính phí theo số ký tự)"}
                          aria-label={speechStatus?.lineId === line.id ? "Dừng giọng đọc" : `Nghe thử giọng ${line.speaker === "male" ? "nam" : "nữ"}`}
                          onClick={() => void previewSpeech(line)}
                        ><Icon name={speechStatus?.lineId === line.id ? "stop" : "play"} /></button>
                        <button onClick={() => removeLine(scene.id, line.id)} aria-label="Xóa câu"><Icon name="trash" /></button>
                      </div>
                    </div>
                  ))}
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      <section className="export-card">
        <div><span className="eyebrow">FINAL CUT</span><h2>Sẵn sàng dựng bản xem trước?</h2><p>FFmpeg sẽ burn-in phụ đề và giữ âm thanh gốc nếu media là video. Khi bật giọng đọc, SaydiVoice tạo audio theo từng câu và trộn vào đúng mốc thời gian.</p><label className="export-option"><input type="checkbox" checked={includeTts} onChange={(event) => setIncludeTts(event.target.checked)} /><span>Thêm giọng đọc SaydiVoice vào MP4 <small>Tính phí theo tổng ký tự của các câu thoại có nội dung</small></span></label></div>
        <div className="export-actions">
          <button className="button light" disabled={!media || !allLines.some((line) => line.text.trim()) || busy !== null || !config.blobReady} onClick={() => void startJob("render")}><Icon name="play" />{busy === "render" ? "Đang dựng…" : "Dựng MP4"}</button>
          {renderUrl && <a className="button outline-light" href={renderUrl} download><Icon name="download" />Tải MP4</a>}
        </div>
      </section>

      <footer><p>SONG KIẾM AI <span>·</span> MVP minh bạch trạng thái tích hợp</p><p>Media Blob hiện dùng quyền truy cập public; chỉ tải nội dung bạn có quyền xử lý.</p></footer>
    </main>
  );
}
