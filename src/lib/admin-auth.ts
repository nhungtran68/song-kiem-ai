import "server-only";
import { createHmac, randomBytes, timingSafeEqual, createHash } from "node:crypto";
import { cookies } from "next/headers";

export const ADMIN_COOKIE = "songkiem-admin";
const MAX_AGE = 8 * 60 * 60;
export function adminConfigured() { return (process.env.VOICE_ADMIN_PASSWORD || "").length >= 12; }
function digest(value: string) { return createHash("sha256").update(value).digest(); }
export function correctAdminPassword(value: string) {
  return adminConfigured() && timingSafeEqual(digest(value), digest(process.env.VOICE_ADMIN_PASSWORD!));
}
export function makeAdminToken(now = Date.now()) {
  const payload = `${Math.floor(now / 1000) + MAX_AGE}.${randomBytes(16).toString("hex")}`;
  return `${payload}.${createHmac("sha256", process.env.VOICE_ADMIN_PASSWORD!).update(payload).digest("hex")}`;
}
export function validAdminToken(token: string, now = Date.now()) {
  if (!adminConfigured() || !/^\d+\.[a-f0-9]{32}\.[a-f0-9]{64}$/.test(token)) return false;
  const [expires, nonce, signature] = token.split(".");
  if (Number(expires) <= now / 1000 || Number(expires) > now / 1000 + MAX_AGE + 1) return false;
  const expected = createHmac("sha256", process.env.VOICE_ADMIN_PASSWORD!).update(`${expires}.${nonce}`).digest("hex");
  return timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
}
export async function isAdmin() { return validAdminToken((await cookies()).get(ADMIN_COOKIE)?.value || ""); }
export function sameOrigin(request: Request) { return request.headers.get("origin") === new URL(request.url).origin; }
export const adminCookieOptions = { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "strict" as const, path: "/", maxAge: MAX_AGE };
