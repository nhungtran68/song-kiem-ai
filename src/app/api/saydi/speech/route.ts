import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function POST() {
  return NextResponse.json(
    {
      error: {
        code: "SAYDI_SPEECH_SCHEMA_REQUIRED",
        message: "Chưa bật tạo giọng: tài liệu hiện có chưa nêu payload của POST /v1/audio/speech. Ứng dụng không tự đoán tên trường.",
      },
    },
    { status: 501 },
  );
}
