export type SpeechClip = { blob: Blob; charsCharged: number | null };
export type SpeechCache = Map<string, SpeechClip>;

export async function requestSpeechClip(text: string, voice: string, signal: AbortSignal, cache: SpeechCache) {
  const input = text.trim();
  const selectedVoice = voice.trim();
  if (!input || !selectedVoice) throw new Error("Cần nội dung và mã giọng SaydiVoice.");
  signal.throwIfAborted();
  const key = JSON.stringify([selectedVoice, input]);
  const existing = cache.get(key);
  if (existing) return { ...existing, charsCharged: 0 };
  const response = await fetch("/api/saydi/speech", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: "tts-1", voice: selectedVoice, input }),
    signal: AbortSignal.any([signal, AbortSignal.timeout(150_000)]),
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => null) as { error?: { message?: string } | string } | null;
    const message = typeof payload?.error === "string" ? payload.error : payload?.error?.message;
    throw new Error(message || `SaydiVoice trả về HTTP ${response.status}.`);
  }
  if (response.headers.get("X-OV-Voice") !== selectedVoice) throw new Error("Giọng trả về không khớp Voice ID đã chọn.");
  const blob = await response.blob();
  if (!blob.type.startsWith("audio/") || !blob.size) throw new Error("SaydiVoice chưa trả về âm thanh hợp lệ.");
  signal.throwIfAborted();
  const charged = Number(response.headers.get("X-OV-Chars"));
  const clip = { blob, charsCharged: Number.isFinite(charged) && charged > 0 ? charged : null };
  cache.set(key, clip);
  return clip;
}
