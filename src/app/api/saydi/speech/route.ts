import { NextResponse } from "next/server";
import { z } from "zod";
import { SaydiError, synthesizeSaydiSpeech } from "@/lib/saydi";

export const runtime = "nodejs";
export const maxDuration = 180;

const speechRequestSchema = z.object({
  input: z.string().trim().min(1).max(4096),
  voice: z.string().trim().min(1).max(120),
  model: z.enum(["tts-1", "tts-1-hd"]).optional(),
});

export async function POST(request: Request) {
  const parsed = speechRequestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: "INVALID_SPEECH_REQUEST", message: "Cần nội dung và SaydiVoice voice ID hợp lệ." } },
      { status: 400 },
    );
  }

  try {
    const speech = await synthesizeSaydiSpeech(parsed.data.input, parsed.data.voice, parsed.data.model);
    return new Response(new Uint8Array(speech.audio), {
      status: 200,
      headers: {
        "Content-Type": speech.contentType,
        "Cache-Control": "no-store",
        "X-OV-Voice": speech.voiceId,
        ...(speech.charsCharged === null ? {} : { "X-OV-Chars": String(speech.charsCharged) }),
        ...(speech.durationSeconds === null ? {} : { "X-Audio-Duration": String(speech.durationSeconds) }),
      },
    });
  } catch (error) {
    if (error instanceof SaydiError) {
      return NextResponse.json(
        { error: { code: error.code, message: error.message, limit: error.limit } },
        {
          status: error.status,
          headers: {
            ...(error.retryAfter ? { "Retry-After": error.retryAfter } : {}),
            ...(error.limit ? { "X-OV-Limit": error.limit } : {}),
          },
        },
      );
    }
    return NextResponse.json(
      { error: { code: "SAYDI_UNAVAILABLE", message: "Không thể kết nối SaydiVoice." } },
      { status: 502 },
    );
  }
}
