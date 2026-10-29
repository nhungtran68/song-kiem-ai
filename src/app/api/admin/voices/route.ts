import { isAdmin, sameOrigin } from "@/lib/admin-auth";
import { readVoiceLibrary, saveVoiceLibrary } from "@/lib/voice-store";
import { librarySchema } from "@/lib/voice-library";
import { loadCatalogue } from "@/lib/saydi-catalogue";
export const runtime = "nodejs";
export const maxDuration = 90;
export async function GET() {
  if (!(await isAdmin())) return Response.json({ error: "Vui lòng đăng nhập quản trị." }, { status: 401 });
  try {
    const [library, catalogue] = await Promise.all([readVoiceLibrary(), loadCatalogue()]);
    const voices = library.voices.map((voice) => {
      const current = catalogue.voices.find((row) => row.id === voice.id);
      return current ? { ...voice, name: current.name, language: current.language } : voice;
    });
    return Response.json({ ...library, voices, catalogue: catalogue.voices, warnings: catalogue.warnings }, { headers: { "Cache-Control": "no-store" } });
  } catch { return Response.json({ error: "Không tải được thư viện giọng. Danh sách đã lưu vẫn được giữ." }, { status: 503 }); }
}
export async function PUT(request: Request) {
  if (!sameOrigin(request) || !(await isAdmin())) return Response.json({ error: "Vui lòng đăng nhập quản trị." }, { status: 401 });
  const raw = await request.text();
  if (Buffer.byteLength(raw) > 200_000) return Response.json({ error: "Danh sách quá lớn." }, { status: 413 });
  let body: { voices?: unknown; revision?: unknown };
  try { body = JSON.parse(raw); } catch { return Response.json({ error: "Dữ liệu không hợp lệ." }, { status: 400 }); }
  const parsed = librarySchema.safeParse(body);
  if (!parsed.success || typeof body.revision !== "string") return Response.json({ error: "Chọn giới tính nam/nữ cho mỗi giọng, không để mã trùng." }, { status: 400 });
  try {
    const current = await readVoiceLibrary();
    if (current.revision !== body.revision) return Response.json({ error: "Danh sách đã được cập nhật ở nơi khác. Bấm Tải lại trước khi lưu." }, { status: 409 });
    const catalogue = await loadCatalogue();
    const allowed = new Set([...current.voices.map((v) => v.id), ...catalogue.voices.filter((v) => v.ready).map((v) => v.id)]);
    if (parsed.data.voices.some((v) => !allowed.has(v.id))) return Response.json({ error: "Có giọng chưa sẵn sàng hoặc chưa tải được từ Saydi. Hãy tải lại thư viện." }, { status: 400 });
    return Response.json(await saveVoiceLibrary(parsed.data.voices, body.revision));
  } catch { return Response.json({ error: "Chưa lưu được thay đổi. Hãy tải lại danh sách rồi thử lại." }, { status: 503 }); }
}
