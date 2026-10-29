import { cookies } from "next/headers";
import { get, put } from "@vercel/blob";
import { ADMIN_COOKIE, adminConfigured, adminCookieOptions, correctAdminPassword, isAdmin, makeAdminToken, sameOrigin } from "@/lib/admin-auth";
import { storageReady } from "@/lib/voice-store";
export const runtime = "nodejs";
export async function GET() { return Response.json({ authenticated: await isAdmin(), configured: adminConfigured(), storageReady: storageReady() }, { headers: { "Cache-Control": "no-store" } }); }
async function reserveAttempt() {
  const path = "settings/admin-login-attempts.json";
  const current = await get(path, { access: "private", useCache: false });
  const raw = current?.statusCode === 200 ? await new Response(current.stream).json() as number[] : [];
  const attempts = raw.filter((at) => at > Date.now() - 300_000);
  if (attempts.length >= 15) return false;
  attempts.push(Date.now());
  try { await put(path, JSON.stringify(attempts), { access: "private", addRandomSuffix: false, ...(current?.statusCode === 200 ? { ifMatch: current.blob.etag } : { allowOverwrite: false }) }); }
  catch { return false; }
  return true;
}
export async function POST(request: Request) {
  if (!sameOrigin(request)) return Response.json({ error: "Yêu cầu không hợp lệ." }, { status: 403 });
  if (!adminConfigured() || !storageReady()) return Response.json({ error: "Quản trị chưa được cấu hình đầy đủ trên máy chủ." }, { status: 503 });
  const raw = await request.text();
  if (raw.length > 2_000) return Response.json({ error: "Thông tin đăng nhập quá dài." }, { status: 413 });
  let password: unknown;
  try { password = JSON.parse(raw).password; } catch { /* Invalid JSON is rejected below. */ }
  if (typeof password !== "string" || password.length > 256) return Response.json({ error: "Mật khẩu không hợp lệ." }, { status: 400 });
  try {
    if (!(await reserveAttempt())) return Response.json({ error: "Đã thử đăng nhập nhiều lần. Vui lòng đợi 5 phút." }, { status: 429, headers: { "Retry-After": "300" } });
    if (!correctAdminPassword(password)) return Response.json({ error: "Mật khẩu quản trị chưa đúng." }, { status: 401 });
    (await cookies()).set(ADMIN_COOKIE, makeAdminToken(), adminCookieOptions);
    return Response.json({ authenticated: true });
  } catch { return Response.json({ error: "Không kết nối được kho quản trị. Hãy thử lại." }, { status: 503 }); }
}
export async function DELETE(request: Request) {
  if (!sameOrigin(request)) return new Response(null, { status: 403 });
  (await cookies()).set(ADMIN_COOKIE, "", { ...adminCookieOptions, maxAge: 0 });
  return Response.json({ authenticated: false });
}
