import { NextResponse } from "next/server";
import { z } from "zod";
import { analysisOutputSchema } from "../../../lib/schemas";
import { classifyAiError } from "../../../lib/ai-errors";
import { MAX_SCRIPT_CHARS } from "../../../lib/written-script";

export const runtime = "nodejs";
export const maxDuration = 180;

const MAX_BODY_BYTES = 3_800_000;
const frameSchema = z.object({
  time: z.number().min(0).max(7_200),
  image: z.string().max(500_000).regex(/^data:image\/jpeg;base64,[A-Za-z0-9+/]+=*$/),
});

const requestSchema = z.object({
  title: z.string().trim().max(160),
  style: z.string().trim().min(1).max(80),
  prompt: z.string().trim().max(MAX_SCRIPT_CHARS),
  mediaKind: z.enum(["image", "video"]),
  duration: z.number().min(0).max(7_200),
  frames: z.array(frameSchema).min(1).max(8),
}).superRefine((input, context) => {
  if (input.mediaKind === "video" && input.duration <= 0) {
    context.addIssue({ code: "custom", path: ["duration"], message: "Không đọc được thời lượng video." });
  }
  if (input.frames.some((frame) => frame.time > input.duration + 0.1)) {
    context.addIssue({ code: "custom", path: ["frames"], message: "Mốc khung hình vượt thời lượng video." });
  }
});

const scriptSchema = {
  type: "object",
  additionalProperties: false,
  required: ["summary", "scenes"],
  properties: {
    summary: { type: "string" },
    scenes: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["start", "end", "visual", "lines"],
        properties: {
          start: { type: "number" },
          end: { type: "number" },
          visual: { type: "string" },
          lines: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["speaker", "text", "emotion", "start", "end"],
              properties: {
                speaker: { type: "string", enum: ["male", "female"] },
                text: { type: "string" },
                emotion: { type: "string" },
                start: { type: "number" },
                end: { type: "number" },
              },
            },
          },
        },
      },
    },
  },
} as const;

export async function POST(request: Request) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return NextResponse.json({ error: "Chưa cài OPENAI_API_KEY trên Vercel.", code: "AI_NOT_CONFIGURED", fallbackAllowed: true }, { status: 503 });

  const size = Number(request.headers.get("content-length") || 0);
  if (size > MAX_BODY_BYTES) return NextResponse.json({ error: "Các khung hình quá lớn. Hãy thử video ngắn hơn." }, { status: 413 });

  const raw = await request.text();
  if (Buffer.byteLength(raw, "utf8") > MAX_BODY_BYTES) {
    return NextResponse.json({ error: "Dữ liệu khung hình vượt giới hạn." }, { status: 413 });
  }
  let json: unknown;
  try { json = JSON.parse(raw); } catch {
    return NextResponse.json({ error: "Dữ liệu gửi lên không hợp lệ." }, { status: 400 });
  }
  const parsed = requestSchema.safeParse(json);
  if (!parsed.success) return NextResponse.json({ error: "Thông tin ảnh/video hoặc khung hình không hợp lệ." }, { status: 400 });

  const { title, style, prompt, mediaKind, duration, frames } = parsed.data;
  const model = process.env.OPENAI_MODEL || "gpt-5.4-mini";
  const timeline = frames.map((frame, index) => `Ảnh ${index + 1}: ${frame.time.toFixed(1)} giây`).join("; ");
  const instructions = [
    "Bạn là biên kịch tiếng Việt cho hai nhân vật NAM và NỮ.",
    "Phân tích điều THỰC SỰ thấy trong các khung hình theo thứ tự thời gian. Không khẳng định nội dung giữa các khung hình, lời nói hay âm thanh vì bạn không được cung cấp âm thanh và video gốc.",
    "Viết tóm tắt hình ảnh và kịch bản đối thoại sáng tạo, tự nhiên, có cảm xúc. Phân biệt phần quan sát với phần hư cấu trong tóm tắt.",
    "Chỉ dùng speaker male hoặc female. Tạo các cảnh và câu thoại có start/end tính bằng giây, start < end, không vượt quá thời lượng. Giới hạn 24 cảnh, mỗi cảnh tối đa 20 câu, mỗi câu tối đa 800 ký tự.",
    mediaKind === "image" ? "Đây là ảnh tĩnh; tạo timeline ngắn khoảng 15 giây." : `Đây là video dài ${duration.toFixed(1)} giây. Chỉ có ${frames.length} khung hình mẫu.`,
    `Tên dự án: ${title || "Chưa đặt tên"}. Phong cách: ${style}.`,
    prompt ? `Ý tưởng của người dùng: ${prompt}` : "",
    `Các mốc ảnh: ${timeline}.`,
  ].filter(Boolean).join("\n");

  let upstream: Response;
  try {
    upstream = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: instructions },
          { role: "user", content: [
            { type: "text", text: "Hãy phân tích các ảnh theo mốc thời gian và tạo kịch bản JSON." },
            ...frames.map((frame) => ({ type: "image_url", image_url: { url: frame.image, detail: "low" } })),
          ] },
        ],
        response_format: { type: "json_schema", json_schema: { name: "song_kiem_script", strict: true, schema: scriptSchema } },
        max_completion_tokens: 6_000,
      }),
      signal: AbortSignal.timeout(150_000),
    });
  } catch {
    return NextResponse.json({ error: "Không kết nối được OpenAI hoặc yêu cầu đã hết thời gian.", code: "AI_UNAVAILABLE", fallbackAllowed: true }, { status: 502 });
  }

  if (!upstream.ok) {
    const body = await upstream.json().catch(() => null) as { error?: { message?: string; code?: string; type?: string } } | null;
    const retryAfter = upstream.headers.get("retry-after");
    const classification = classifyAiError(upstream.status, body?.error);
    const error = classification.code === "AI_QUOTA_EXHAUSTED"
      ? "OpenAI đã hết credits hoặc đạt hạn mức sử dụng. Có thể tiếp tục bằng kịch bản đã nhập."
      : upstream.status === 401
      ? "OPENAI_API_KEY không hợp lệ hoặc không có quyền truy cập."
      : upstream.status === 429
        ? `OpenAI đang giới hạn yêu cầu${retryAfter ? `; thử lại sau ${retryAfter} giây` : ""}.`
        : upstream.status === 400
          ? `OpenAI từ chối yêu cầu: ${body?.error?.message || "kiểm tra model và quyền truy cập"}.`
          : `OpenAI trả về lỗi ${upstream.status}. ${body?.error?.message || "Hãy thử lại."}`;
    return NextResponse.json({ error, ...classification }, { status: upstream.status === 429 ? 429 : 502, headers: retryAfter ? { "Retry-After": retryAfter } : undefined });
  }

  const body = await upstream.json().catch(() => null) as { choices?: Array<{ message?: { content?: string; refusal?: string } }> } | null;
  if (body?.choices?.[0]?.message?.refusal) return NextResponse.json({ error: "OpenAI không thể tạo kịch bản cho nội dung này." }, { status: 422 });
  const content = body?.choices?.[0]?.message?.content;
  if (!content) return NextResponse.json({ error: "OpenAI không trả về kịch bản. Hãy thử lại." }, { status: 502 });
  let output: unknown;
  try { output = JSON.parse(content); } catch {
    return NextResponse.json({ error: "OpenAI trả về kịch bản không đọc được." }, { status: 502 });
  }
  const result = analysisOutputSchema.safeParse(output);
  if (!result.success) return NextResponse.json({ error: "Kịch bản OpenAI trả về chưa hợp lệ. Hãy thử lại." }, { status: 502 });
  return NextResponse.json({ analysis: result.data, model });
}
