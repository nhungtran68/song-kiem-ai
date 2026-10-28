import { afterEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";

const input = {
  title: "Song Kiếm",
  style: "Điện ảnh",
  prompt: "Hai người gặp lại",
  mediaKind: "video",
  duration: 12,
  frames: [
    { time: 0, image: "data:image/jpeg;base64,AAAA" },
    { time: 12, image: "data:image/jpeg;base64,BBBB" },
  ],
};

function request(body: unknown) {
  return new Request("http://localhost/api/analyze", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("direct OpenAI analysis", () => {
  it("requires a server-side OpenAI key", async () => {
    vi.stubEnv("OPENAI_API_KEY", "");
    const response = await POST(request(input));
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ error: expect.stringContaining("OPENAI_API_KEY"), code: "AI_NOT_CONFIGURED", fallbackAllowed: true });
  });

  it("sends only sampled frames and accepts a valid timeline", async () => {
    vi.stubEnv("OPENAI_API_KEY", "test-secret");
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      expect(init.headers).toMatchObject({ Authorization: "Bearer test-secret" });
      const body = JSON.parse(String(init.body));
      expect(body.model).toBe("gpt-5.4-mini");
      expect(body.messages[1].content.filter((item: { type: string }) => item.type === "image_url")).toHaveLength(2);
      expect(body.response_format.json_schema.strict).toBe(true);
      return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({
        summary: "Quan sát hai người; cuộc hội thoại là hư cấu.",
        scenes: [{ start: 0, end: 6, visual: "Hai người đối diện", lines: [{ speaker: "female", text: "Chào anh!", emotion: "Vui", start: 1, end: 3 }] }],
      }) } }] }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);
    const response = await POST(request(input));
    expect(response.status).toBe(200);
    expect((await response.json()).analysis.scenes[0].lines[0].speaker).toBe("female");
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("rejects an invalid time before calling OpenAI", async () => {
    vi.stubEnv("OPENAI_API_KEY", "test-secret");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const response = await POST(request({ ...input, frames: [{ time: 20, image: "data:image/jpeg;base64,AAAA" }] }));
    expect(response.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each(["insufficient_quota", "credit_balance_exhausted", "project_spend_limit_exceeded", "organization_spend_limit_exceeded", "organization_usage_limit_exceeded"])("permits local script fallback for %s without retrying OpenAI", async (code) => {
    vi.stubEnv("OPENAI_API_KEY", "test-secret");
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: { code, type: "insufficient_quota", message: "Limit reached" } }), {
      status: 429, headers: { "Content-Type": "application/json", "Retry-After": "60" },
    }));
    vi.stubGlobal("fetch", fetchMock);
    const response = await POST(request(input));
    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("60");
    expect(await response.json()).toMatchObject({ code: "AI_QUOTA_EXHAUSTED", fallbackAllowed: true });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("distinguishes temporary throttling from exhausted credits", async () => {
    vi.stubEnv("OPENAI_API_KEY", "test-secret");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: { code: "rate_limit_exceeded", message: "Slow down" } }), { status: 429 })));
    const response = await POST(request(input));
    expect(await response.json()).toMatchObject({ code: "AI_RATE_LIMITED", fallbackAllowed: true });
  });
});
