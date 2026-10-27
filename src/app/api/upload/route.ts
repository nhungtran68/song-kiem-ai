import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function POST(request: Request) {
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return NextResponse.json(
      { error: "Chưa kết nối Vercel Blob cho dự án.", code: "BLOB_NOT_CONFIGURED" },
      { status: 503 },
    );
  }

  try {
    const body = (await request.json()) as HandleUploadBody;
    const response = await handleUpload({
      request,
      body,
      onBeforeGenerateToken: async (pathname) => {
        if (!pathname.startsWith("uploads/")) throw new Error("Đường dẫn upload không hợp lệ.");
        return {
          allowedContentTypes: ["image/jpeg", "image/png", "image/webp", "video/mp4", "video/quicktime", "video/webm"],
          maximumSizeInBytes: 2 * 1024 * 1024 * 1024,
          addRandomSuffix: true,
        };
      },
      onUploadCompleted: async ({ blob }) => {
        console.info("[upload] Hoàn tất", { pathname: blob.pathname, contentType: blob.contentType });
      },
    });
    return NextResponse.json(response);
  } catch (error) {
    console.error("[upload] Lỗi", error);
    return NextResponse.json({ error: "Không thể cấp quyền tải media lên." }, { status: 400 });
  }
}
