import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ cookies: vi.fn() }));
import { adminConfigured, correctAdminPassword, makeAdminToken, sameOrigin, validAdminToken } from "./admin-auth";
afterEach(() => vi.unstubAllEnvs());
describe("voice admin authentication", () => {
  it("fails closed without a strong configured password", () => {
    vi.stubEnv("VOICE_ADMIN_PASSWORD", "short");
    expect(adminConfigured()).toBe(false);
    expect(correctAdminPassword("short")).toBe(false);
    expect(validAdminToken("anything")).toBe(false);
  });
  it("rejects wrong passwords, forged tokens and expired sessions", () => {
    vi.stubEnv("VOICE_ADMIN_PASSWORD", "test-only-strong-password");
    expect(correctAdminPassword("test-only-strong-password")).toBe(true);
    expect(correctAdminPassword("wrong")).toBe(false);
    const now = 1_700_000_000_000;
    const token = makeAdminToken(now);
    expect(validAdminToken(token, now)).toBe(true);
    expect(validAdminToken(token.slice(0,-1) + (token.endsWith("a") ? "b" : "a"), now)).toBe(false);
    expect(validAdminToken(token, now + 8*60*60*1000)).toBe(false);
    vi.stubEnv("VOICE_ADMIN_PASSWORD", "changed-strong-password");
    expect(validAdminToken(token, now)).toBe(false);
  });
  it("requires an exact same-origin header for mutations", () => {
    expect(sameOrigin(new Request("https://vui.example.com/api/admin/voices", { headers: { Origin: "https://vui.example.com" } }))).toBe(true);
    expect(sameOrigin(new Request("https://vui.example.com/api/admin/voices", { headers: { Origin: "https://evil.example.com" } }))).toBe(false);
    expect(sameOrigin(new Request("https://vui.example.com/api/admin/voices"))).toBe(false);
  });
});
