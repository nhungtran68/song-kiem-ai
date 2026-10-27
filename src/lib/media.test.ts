import { afterEach, describe, expect, it, vi } from "vitest";
import { captureFrames, inferMediaType } from "./media";

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.useRealTimers(); });

describe("local media reading", () => {
  it("accepts supported extensions when a browser omits the MIME type", () => {
    expect(inferMediaType({ name: "CLIP.MP4", type: "" })).toBe("video/mp4");
    expect(inferMediaType({ name: "photo.jpeg", type: "application/octet-stream" })).toBe("image/jpeg");
    expect(inferMediaType({ name: "clip.m4v", type: "video/x-m4v" })).toBe("video/mp4");
    expect(inferMediaType({ name: "file.exe", type: "application/octet-stream" })).toBeNull();
  });

  it("cancels a video stuck loading metadata and releases its local URL", async () => {
    const video = Object.assign(new EventTarget(), { load: vi.fn(), pause: vi.fn(), removeAttribute: vi.fn() });
    vi.stubGlobal("document", { createElement: () => video });
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:test");
    const revoke = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    const controller = new AbortController();
    const result = captureFrames(new File(["test"], "clip.mp4"), controller.signal, vi.fn());
    controller.abort();
    await expect(result).rejects.toMatchObject({ name: "AbortError" });
    expect(video.pause).toHaveBeenCalled();
    expect(revoke).toHaveBeenCalledWith("blob:test");
  });

  it("reports an unreadable video instead of waiting forever", async () => {
    vi.useFakeTimers();
    const video = Object.assign(new EventTarget(), { load: vi.fn(), pause: vi.fn(), removeAttribute: vi.fn() });
    vi.stubGlobal("document", { createElement: () => video });
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:test");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    const result = captureFrames(new File(["test"], "clip.mp4"), new AbortController().signal, vi.fn());
    const assertion = expect(result).rejects.toThrow("Đọc tệp quá lâu");
    await vi.advanceTimersByTimeAsync(20_000);
    await assertion;
  });
});
