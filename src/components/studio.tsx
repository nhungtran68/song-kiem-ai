"use client";
/* eslint-disable @next/next/no-img-element -- Local blob previews cannot use the Next image optimizer. */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createSrt, hydrateAnalysis, secondsLabel } from "@/lib/timeline";
import type { DialogueLine, StudioDraft, TimelineScene, VoicePair } from "@/types/studio";

export type PublicRuntimeConfig = {
  aiReady: boolean;
  saydiReady: boolean;
  saydiSpeechSchemaReady: boolean;
  aiModel: string;
  voiceIds: VoicePair;
};

type LocalMedia = { name: string; size: number; type: string; duration: number };
type Frame = { time: number; image: string };
type Notice = { type: "error" | "info" | "success"; text: string };
const STYLES = ["Điện ảnh", "Hài hước", "Lãng mạn", "Kịch tính", "Đời thường", "Cổ trang"];
const DRAFT_KEY = "song-kiem-ai-draft-v2";
const ACCEPTED_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "video/mp4", "video/quicktime", "video/webm"]);

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

function errorMessage(value: unknown) {
  return value instanceof Error ? value.message : "Đã xảy ra lỗi không xác định.";
}

function makeLine(start = 0, end = 3): DialogueLine {
  return { id: crypto.randomUUID(), speaker: "male", text: "", emotion: "Tự nhiên", start, end };
}

function makeScene(duration: number): TimelineScene {
  const end = Math.max(3, duration || 6);
  return { id: crypto.randomUUID(), start: 0, end, visual: "Cảnh do bạn biên tập thủ công", lines: [makeLine(0, Math.min(3, end))] };
}

function downloadText(name: string, content: string, mime: string) {
  const url = URL.createObjectURL(new Blob([content], { type: mime }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

function safeName(title: string) {
  return title.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "song-kiem-ai";
}

function drawFrame(source: CanvasImageSource, width: number, height: number): string {
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

async function captureFrames(file: File): Promise<{ frames: Frame[]; duration: number; mediaKind: "image" | "video" }> {
  const url = URL.createObjectURL(file);
  try {
    if (file.type.startsWith("image/")) {
      const image = new Image();
      image.src = url;
      await image.decode();
      return { frames: [{ time: 0, image: drawFrame(image, image.naturalWidth, image.naturalHeight) }], duration: 15, mediaKind: "image" };
    }

    const video = document.createElement("video");
    video.preload = "auto";
    video.muted = true;
    video.playsInline = true;
    video.src = url;
    await new Promise<void>((resolve, reject) => {
      video.onloadedmetadata = () => resolve();
      video.onerror = () => reject(new Error("Không đọc được video. Hãy thử MP4 hoặc WEBM với codec trình duyệt hỗ trợ."));
      video.load();
    });
    const duration = video.duration;
    if (!Number.isFinite(duration) || duration <= 0 || duration > 7_200) {
      throw new Error("Video phải có thời lượng hợp lệ, tối đa 2 giờ.");
    }
    const count = Math.min(8, Math.max(2, Math.ceil(duration / 15) + 1));
    const frames: Frame[] = [];
    const inset = Math.min(0.1, duration / 4);
    for (let index = 0; index < count; index++) {
      const time = inset + ((duration - 2 * inset) * index) / (count - 1);
      await new Promise<void>((resolve, reject) => {
        const timeout = window.setTimeout(() => reject(new Error(`Đọc video quá lâu tại ${secondsLabel(time)}.`)), 20_000);
        video.onseeked = () => { window.clearTimeout(timeout); resolve(); };
        video.onerror = () => { window.clearTimeout(timeout); reject(new Error(`Không đọc được khung hình tại ${secondsLabel(time)}.`)); };
        video.currentTime = time;
      });
      frames.push({ time, image: drawFrame(video, video.videoWidth, video.videoHeight) });
    }
    video.removeAttribute("src");
    video.load();
    return { frames, duration, mediaKind: "video" };
  } finally {
    URL.revokeObjectURL(url);
  }
}

export default function Studio({ config }: { config: PublicRuntimeConfig }) {
  const [title, setTitle] = useState("Dự án chưa đặt tên");
  const [style, setStyle] = useState(STYLES[0]);
  const [prompt, setPrompt] = useState("");
  const [voiceIds, setVoiceIds] = useState<VoicePair>(config.voiceIds);
  const [summary, setSummary] = useState("");
  const [scenes, setScenes] = useState<TimelineScene[]>([]);
  const [media, setMedia] = useState<LocalMedia | null>(null);
  const [previewUrl, setPreviewUrl] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<Notice | null>(null);
  const [speechStatus, setSpeechStatus] = useState<{ lineId: string; phase: "loading" | "playing" } | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const analyzeRef = useRef<AbortController | null>(null);
  const speechRequestRef = useRef<AbortController | null>(null);
  const speechAudioRef = useRef<HTMLAudioElement | null>(null);
  const speechUrlRef = useRef<string | null>(null);

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      const raw = localStorage.getItem(DRAFT_KEY) || localStorage.getItem("song-kiem-ai-draft-v1");
      if (raw) {
        try {
          const draft = JSON.parse(raw) as StudioDraft;
          if (draft.version === 1 || draft.version === 2) {
            setTitle(draft.title);
            setStyle(draft.style);
            setPrompt(draft.prompt || "");
            setVoiceIds(draft.voiceIds);
            setSummary(draft.summary);
            setScenes(draft.scenes);
          }
        } catch { localStorage.removeItem(DRAFT_KEY); }
      }
      setHydrated(true);
    });
    return () => cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    const draft: StudioDraft = { version: 2, title, style, prompt, voiceIds, summary, scenes };
    localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
  }, [hydrated, prompt, scenes, style, summary, title, voiceIds]);

  useEffect(() => () => { if (previewUrl) URL.revokeObjectURL(previewUrl); }, [previewUrl]);
  useEffect(() => () => {
    analyzeRef.current?.abort();
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
    setScenes((current) => current.map((scene) => scene.id === sceneId
      ? { ...scene, lines: scene.lines.filter((line) => line.id !== lineId) } : scene).filter((scene) => scene.lines.length));
  }, []);
  const addLine = () => {
    if (!scenes.length) { setScenes([makeScene(media?.duration || 0)]); return; }
    const lastScene = scenes.at(-1)!;
    const lastEnd = lastScene.lines.at(-1)?.end || lastScene.start;
    setScenes((current) => current.map((scene) => scene.id === lastScene.id
      ? { ...scene, end: Math.max(scene.end, lastEnd + 3), lines: [...scene.lines, makeLine(lastEnd, lastEnd + 3)] }
      : scene));
  };

  const selectFile = async (selected: File) => {
    if (!ACCEPTED_TYPES.has(selected.type)) { setMessage({ type: "error", text: "Định dạng ảnh/video chưa được hỗ trợ." }); return; }
    if (selected.size > 2 * 1024 * 1024 * 1024) { setMessage({ type: "error", text: "Tệp vượt quá 2 GB." }); return; }
    setFile(selected);
    setPreviewUrl(URL.createObjectURL(selected));
    setMedia({ name: selected.name, size: selected.size, type: selected.type, duration: 0 });
    setMessage({ type: "info", text: "Tệp chỉ nằm trên thiết bị của bạn. Khi phân tích, trình duyệt gửi tối đa 8 khung hình tới OpenAI; không gửi video gốc hoặc âm thanh." });
  };

  const analyze = async () => {
    if (!file) { setMessage({ type: "error", text: "Hãy chọn ảnh hoặc video trước." }); return; }
    const controller = new AbortController();
    analyzeRef.current = controller;
    setBusy(true);
    setMessage({ type: "info", text: "Đang lấy các khung hình và phân tích..." });
    try {
      const captured = await captureFrames(file);
      if (controller.signal.aborted) return;
      setMedia((current) => current ? { ...current, duration: captured.duration } : current);
      const response = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, style, prompt, ...captured }),
        signal: controller.signal,
      });
      const payload = await response.json().catch(() => null) as { error?: string; analysis?: Parameters<typeof hydrateAnalysis>[0] } | null;
      if (!response.ok || !payload?.analysis) throw new Error(payload?.error || `Phân tích thất bại (HTTP ${response.status}).`);
      const analysis = hydrateAnalysis(payload.analysis);
      setSummary(analysis.summary);
      setScenes(analysis.scenes);
      setMessage({ type: "success", text: `Đã tạo ${analysis.scenes.length} cảnh. Hãy kiểm tra và sửa lời thoại trước khi xuất.` });
    } catch (error) {
      if (!controller.signal.aborted) setMessage({ type: "error", text: errorMessage(error) });
    } finally {
      if (analyzeRef.current === controller) analyzeRef.current = null;
      setBusy(false);
    }
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
    if (speechStatus?.lineId === line.id) { stopSpeech(); return; }
    stopSpeech();
    const voice = voiceIds[line.speaker].trim();
    const input = line.text.trim();
    if (!voice || !input) { setMessage({ type: "error", text: "Cần mã giọng và nội dung câu thoại để nghe thử." }); return; }
    const controller = new AbortController();
    speechRequestRef.current = controller;
    setSpeechStatus({ lineId: line.id, phase: "loading" });
    setMessage(null);
    try {
      const response = await fetch("/api/saydi/speech", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: "tts-1", voice, input }), signal: controller.signal,
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => null) as { error?: { message?: string } | string } | null;
        throw new Error(typeof payload?.error === "string" ? payload.error : payload?.error?.message || `SaydiVoice trả về HTTP ${response.status}.`);
      }
      const blob = await response.blob();
      if (!blob.type.startsWith("audio/") || !blob.size) throw new Error("SaydiVoice chưa trả về âm thanh hợp lệ.");
      if (controller.signal.aborted) return;
      const url = URL.createObjectURL(blob);
      speechUrlRef.current = url;
      const audio = new Audio(url);
      speechAudioRef.current = audio;
      const finish = () => {
        if (speechAudioRef.current !== audio) return;
        speechAudioRef.current = null;
        speechUrlRef.current = null;
        URL.revokeObjectURL(url);
        setSpeechStatus(null);
      };
      audio.onended = finish;
      audio.onerror = () => { finish(); setMessage({ type: "error", text: "Không phát được giọng đọc." }); };
      await audio.play();
      if (speechAudioRef.current !== audio) return;
      setSpeechStatus({ lineId: line.id, phase: "playing" });
      const chars = response.headers.get("X-OV-Chars");
      setMessage({ type: "success", text: chars ? `Đang phát giọng ${voice}. SaydiVoice tính ${chars} ký tự.` : `Đang phát giọng ${voice}.` });
    } catch (error) {
      if (!controller.signal.aborted) { stopSpeech(); setMessage({ type: "error", text: errorMessage(error) }); }
    } finally { if (speechRequestRef.current === controller) speechRequestRef.current = null; }
  };

  const exportScript = () => {
    const text = [title, `Phong cách: ${style}`, `Giọng nam: ${voiceIds.male || "chưa đặt"}`, `Giọng nữ: ${voiceIds.female || "chưa đặt"}`, "", summary, "",
      ...scenes.flatMap((scene, index) => [
        `CẢNH ${index + 1} [${secondsLabel(scene.start)}–${secondsLabel(scene.end)}]: ${scene.visual}`,
        ...scene.lines.map((line) => `[${secondsLabel(line.start)}–${secondsLabel(line.end)}] ${line.speaker === "male" ? "NAM" : "NỮ"} (${line.emotion}): ${line.text}`), "",
      ])].join("\n");
    downloadText(`${safeName(title)}-kich-ban.txt`, text, "text/plain;charset=utf-8");
  };

  return <main className="app-shell">
    <header className="topbar">
      <a className="brand" href="#top" aria-label="Song Kiếm AI"><span className="brand-mark"><b>⚔</b><i /></span><span><strong>Song Kiếm</strong><small>AI STUDIO</small></span></a>
      <div className="runtime-status" aria-label="Trạng thái dịch vụ"><StatusDot ok label="Media" /><StatusDot ok={config.aiReady} label="Vision" /><StatusDot ok={config.saydiReady && config.saydiSpeechSchemaReady} label="Voice" /></div>
    </header>
    <section className="hero" id="top"><div><p className="eyebrow">AI VIDEO DIALOGUE WORKSPACE</p><h1>Một khung hình.<br /><em>Hai giọng kể.</em></h1><p className="hero-copy">Chọn ảnh hoặc video, để OpenAI gợi ý kịch bản hai nhân vật theo thời gian, rồi xuất lời thoại và phụ đề để ghép ở ngoài.</p></div>
      <div className="process-rail" aria-label="Quy trình">{["Chọn tệp", "Phân tích", "Biên tập", "Xuất kịch bản"].map((label, index) => <div className={index === 0 || (index === 1 && scenes.length) || (index === 2 && allLines.length) || (index === 3 && scenes.length) ? "active" : ""} key={label}><span>0{index + 1}</span><b>{label}</b></div>)}</div>
    </section>
    {message && <div className={`notice ${message.type}`} role="status"><span>{message.type === "error" ? "!" : message.type === "success" ? "✓" : "i"}</span>{message.text}</div>}
    <section className="workspace-grid">
      <article className="panel media-panel"><div className="panel-heading"><div><span className="section-number">01</span><h2>Ảnh / video nguồn</h2></div><small>CHỈ XỬ LÝ TẠM THỜI</small></div>
        <div className={`dropzone ${previewUrl ? "has-media" : ""}`}>{previewUrl ? <>{file?.type.startsWith("video/") ? <video src={previewUrl} controls playsInline /> : <img src={previewUrl} alt="Ảnh được chọn" />}<button className="change-media" type="button" onClick={() => inputRef.current?.click()}><Icon name="upload" />Đổi tệp</button></> : <button className="dropzone-empty" type="button" onClick={() => inputRef.current?.click()}><span className="drop-icon"><Icon name="upload" /></span><strong>Chạm để chọn ảnh hoặc video</strong><small>JPG, PNG, WEBP, MP4, MOV hoặc WEBM • tối đa 2 GB</small></button>}</div>
        <input ref={inputRef} hidden type="file" accept="image/jpeg,image/png,image/webp,video/mp4,video/quicktime,video/webm" onChange={(event) => { const selected = event.target.files?.[0]; if (selected) void selectFile(selected); event.currentTarget.value = ""; }} />
        {media && <div className="file-meta"><span>{media.name}</span><small>{(media.size / 1024 / 1024).toFixed(1)} MB{media.duration ? ` • ${secondsLabel(media.duration)}` : ""}</small></div>}
      </article>
      <article className="panel setup-panel"><div className="panel-heading"><div><span className="section-number">02</span><h2>Thiết lập</h2></div><small>{config.aiModel}</small></div>
        <label className="field"><span>Tên dự án</span><input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={160} /></label>
        <label className="field"><span>Phong cách biên kịch</span><select value={style} onChange={(event) => setStyle(event.target.value)}>{STYLES.map((item) => <option key={item}>{item}</option>)}</select></label>
        <label className="field prompt-field"><span>Ý tưởng cho kịch bản (không bắt buộc)</span><textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} maxLength={600} placeholder="Ví dụ: Hai người bạn lâu ngày gặp lại, lời thoại vui và ngắn gọn." /><small>{prompt.length}/600 ký tự • AI dựa vào các khung hình mẫu và ý tưởng này.</small></label>
        <div className="voice-grid"><label className="field voice male"><span><i /> Nhân vật nam</span><input placeholder="voice_id, ví dụ vi-adam" value={voiceIds.male} onChange={(event) => setVoiceIds((current) => ({ ...current, male: event.target.value }))} /></label><label className="field voice female"><span><i /> Nhân vật nữ</span><input placeholder="voice_id hoặc vc_..." value={voiceIds.female} onChange={(event) => setVoiceIds((current) => ({ ...current, female: event.target.value }))} /></label></div>
        <p className="voice-note">Hai Voice ID SaydiVoice được giữ riêng khi xuất kịch bản. Nghe thử sẽ trừ credits theo ký tự. AI chỉ xem khung hình mẫu, không nghe âm thanh.</p>
        <div className="action-row"><button className="button primary" disabled={!file || busy || !config.aiReady} onClick={() => void analyze()}><Icon name="spark" />{busy ? "Đang phân tích..." : "Phân tích bằng OpenAI"}</button>{busy && <button className="button ghost danger" onClick={() => analyzeRef.current?.abort()}><Icon name="stop" />Hủy</button>}</div>
        {!config.aiReady && <p className="voice-note">Để bật phân tích, thêm <code>OPENAI_API_KEY</code> vào Environment Variables trên Vercel rồi triển khai lại.</p>}
      </article>
    </section>
    <section className="panel timeline-panel"><div className="panel-heading timeline-heading"><div><span className="section-number">03</span><h2>Biên tập hội thoại</h2></div><div className="timeline-actions"><span>{allLines.length} câu • {secondsLabel(totalDuration)}</span><button className="button ghost compact" onClick={addLine}><Icon name="plus" />Thêm câu</button></div></div>
      {summary && <div className="summary"><span>TÓM TẮT AI</span><p>{summary}</p></div>}
      {!scenes.length ? <div className="empty-timeline"><span>✧</span><h3>Timeline đang trống</h3><p>Chạy phân tích hoặc thêm câu thủ công để bắt đầu.</p><button className="button ghost" onClick={addLine}><Icon name="plus" />Thêm câu đầu tiên</button></div> : <div className="scene-list">{scenes.map((scene, sceneIndex) => <article className="scene" key={scene.id}><header><span>CẢNH {String(sceneIndex + 1).padStart(2, "0")}</span><p>{scene.visual}</p><time>{secondsLabel(scene.start)} - {secondsLabel(scene.end)}</time></header><div className="lines">{scene.lines.map((line) => <div className={`dialogue ${line.speaker}`} key={line.id}><button className="speaker-toggle" type="button" onClick={() => updateLine(scene.id, line.id, { speaker: line.speaker === "male" ? "female" : "male" })} aria-label="Đổi nhân vật"><i>{line.speaker === "male" ? "N" : "Nữ"}</i><span>{line.speaker === "male" ? "Nam" : "Nữ"}</span></button><div className="dialogue-main"><textarea aria-label="Nội dung thoại" value={line.text} maxLength={800} placeholder="Nhập lời thoại..." onChange={(event) => updateLine(scene.id, line.id, { text: event.target.value })} /><div className="line-meta"><label>Cảm xúc <input value={line.emotion} onChange={(event) => updateLine(scene.id, line.id, { emotion: event.target.value })} /></label><label>Bắt đầu <input type="number" min="0" step="0.1" value={line.start} onChange={(event) => updateLine(scene.id, line.id, { start: Number(event.target.value) })} /></label><label>Kết thúc <input type="number" min="0.1" step="0.1" value={line.end} onChange={(event) => updateLine(scene.id, line.id, { end: Number(event.target.value) })} /></label></div></div><div className="line-tools"><button type="button" className={speechStatus?.lineId === line.id ? `is-${speechStatus.phase}` : ""} disabled={speechStatus?.lineId !== line.id && (!config.saydiReady || !line.text.trim() || !voiceIds[line.speaker].trim() || busy)} title={speechStatus?.lineId === line.id ? "Dừng giọng đọc" : "Nghe thử giọng đọc (SaydiVoice tính phí theo ký tự)"} aria-label={speechStatus?.lineId === line.id ? "Dừng giọng đọc" : `Nghe thử giọng ${line.speaker === "male" ? "nam" : "nữ"}`} onClick={() => void previewSpeech(line)}><Icon name={speechStatus?.lineId === line.id ? "stop" : "play"} /></button><button onClick={() => removeLine(scene.id, line.id)} aria-label="Xóa câu"><Icon name="trash" /></button></div></div>)}</div></article>)}</div>}
    </section>
    <section className="export-card"><div><span className="eyebrow">XUẤT NỘI DUNG</span><h2>Mang kịch bản sang trình ghép của bạn</h2><p>Tải lời thoại có mốc thời gian và hai Voice ID dạng TXT, hoặc tải phụ đề SRT. Ảnh/video gốc không được lưu trên máy chủ.</p></div><div className="export-actions"><button className="button light" disabled={!allLines.some((line) => line.text.trim())} onClick={exportScript}><Icon name="download" />Tải kịch bản TXT</button><button className="button outline-light" disabled={!allLines.some((line) => line.text.trim())} onClick={() => downloadText(`${safeName(title)}-phu-de.srt`, createSrt(allLines), "text/plain;charset=utf-8")}><Icon name="download" />Tải phụ đề SRT</button></div></section>
    <footer><p>SONG KIẾM AI <span>✦</span> Biên kịch từ khung hình</p><p>Chỉ khung hình mẫu được gửi đến OpenAI; nội dung kịch bản lưu trong trình duyệt này.</p></footer>
  </main>;
}
