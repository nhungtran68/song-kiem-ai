import { NextResponse } from "next/server";
import { SaydiError, saydiFetch } from "@/lib/saydi";

export const runtime = "nodejs";

export async function GET() {
  try {
    const response = await saydiFetch("/samples");
    return new Response(response.body, {
      status: response.status,
      headers: { "Content-Type": response.headers.get("Content-Type") || "application/json" },
    });
  } catch (error) {
    if (error instanceof SaydiError) {
      return NextResponse.json({ detail: error.message, code: error.code, limit: error.limit }, { status: error.status });
    }
    return NextResponse.json({ detail: "Không thể kết nối SaydiVoice." }, { status: 502 });
  }
}
