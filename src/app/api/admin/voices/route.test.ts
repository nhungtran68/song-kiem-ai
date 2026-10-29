import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ admin: true, read: vi.fn(), save: vi.fn(), catalogue: vi.fn() }));
vi.mock("@/lib/admin-auth", () => ({ isAdmin: async () => mocks.admin, sameOrigin: (r: Request) => r.headers.get("origin") === new URL(r.url).origin }));
vi.mock("@/lib/voice-store", () => ({ readVoiceLibrary: mocks.read, saveVoiceLibrary: mocks.save }));
vi.mock("@/lib/saydi-catalogue", () => ({ loadCatalogue: mocks.catalogue }));
import { GET, PUT } from "./route";
const voice = { id: "vc_one", name: "Giọng đang dùng", gender: "female", source: "clone", language: "vi" };
const request = (body: unknown, origin = "https://test.local") => new Request("https://test.local/api/admin/voices", { method: "PUT", headers: { origin, "content-type": "application/json" }, body: JSON.stringify(body) });
beforeEach(() => {
  vi.clearAllMocks(); mocks.admin = true;
  mocks.read.mockResolvedValue({ voices: [voice], revision: "revision1", configured: true });
  mocks.catalogue.mockResolvedValue({ voices: [], warnings: [] });
  mocks.save.mockImplementation(async (voices) => ({ voices, revision: "revision2", configured: true }));
});
describe("private voice library routes", () => {
  it("does not expose the account catalogue or write anything without admin login", async () => {
    mocks.admin = false;
    expect((await GET()).status).toBe(401);
    expect((await PUT(request({ voices: [], revision: "revision1" }))).status).toBe(401);
    expect(mocks.read).not.toHaveBeenCalled(); expect(mocks.catalogue).not.toHaveBeenCalled(); expect(mocks.save).not.toHaveBeenCalled();
  });
  it("rejects a cross-origin write even with an admin session", async () => {
    expect((await PUT(request({ voices: [], revision: "revision1" }, "https://other.local"))).status).toBe(401);
    expect(mocks.save).not.toHaveBeenCalled();
  });
  it("rejects stale edits instead of overwriting another saved selection", async () => {
    expect((await PUT(request({ voices: [], revision: "older" }))).status).toBe(409);
    expect(mocks.save).not.toHaveBeenCalled();
  });
  it("persists authenticated selection and retains saved voices during partial upstream failure", async () => {
    mocks.catalogue.mockResolvedValue({ voices: [], warnings: ["Saydi temporarily unavailable"] });
    const response = await PUT(request({ voices: [voice], revision: "revision1" }));
    expect(response.status).toBe(200);
    expect(mocks.save).toHaveBeenCalledWith([voice], "revision1");
  });
  it("rejects new unavailable clones and duplicate IDs", async () => {
    mocks.catalogue.mockResolvedValue({ voices: [{ ...voice, id: "vc_waiting", ready: false }], warnings: [] });
    expect((await PUT(request({ voices: [{ ...voice, id: "vc_waiting" }], revision: "revision1" }))).status).toBe(400);
    expect((await PUT(request({ voices: [voice, voice], revision: "revision1" }))).status).toBe(400);
    expect(mocks.save).not.toHaveBeenCalled();
  });
});
