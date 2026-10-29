import { isAdmin } from "@/lib/admin-auth";
import { readVoiceLibrary } from "@/lib/voice-store";
import { voiceIdSchema } from "@/lib/voice-library";
import { loadCatalogue } from "@/lib/saydi-catalogue";
import { saydiFetch } from "@/lib/saydi";
export const runtime = "nodejs";
export const maxDuration = 90;
export async function GET(request: Request) {
  const id = new URL(request.url).searchParams.get("id");
  if (!voiceIdSchema.safeParse(id).success) return new Response(null, { status: 400 });
  try {
    let voice = (await readVoiceLibrary()).voices.find((v) => v.id === id);
    if (!voice && await isAdmin()) voice = (await loadCatalogue()).voices.filter((v) => v.ready).find((v) => v.id === id) as typeof voice;
    if (!voice) return new Response(null, { status: 404 });
    const audio = await saydiFetch(voice.source === "clone" ? `/v1/voices/${voice.id}/preview` : `/samples/${voice.id}/audio`, { signal: AbortSignal.timeout(60_000) });
    if (!audio.headers.get("content-type")?.startsWith("audio/")) return new Response(null, { status: 502 });
    return new Response(audio.body, { headers: { "Content-Type": audio.headers.get("content-type")!, "Cache-Control": "private, no-store" } });
  } catch { return Response.json({ error: "Chưa tải được mẫu giọng Saydi." }, { status: 502 }); }
}
