import { readVoiceLibrary } from "@/lib/voice-store";
export const runtime = "nodejs";
export async function GET() {
  try { const { voices } = await readVoiceLibrary(); return Response.json({ voices }, { headers: { "Cache-Control": "no-store" } }); }
  catch { return Response.json({ error: "Chưa tải được danh sách giọng. Hãy thử lại." }, { status: 503 }); }
}
