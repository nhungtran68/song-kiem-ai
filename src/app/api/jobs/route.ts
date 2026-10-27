import { NextResponse } from "next/server";
import { getRun, start } from "workflow/api";
import { studioJobSchema } from "@/lib/schemas";
import { analyzeMediaWorkflow, renderVideoWorkflow } from "@/workflows/studio";

export const runtime = "nodejs";
export const maxDuration = 300;

function readiness(action: "analyze" | "render"): string[] {
  const missing: string[] = [];
  if (!process.env.BLOB_READ_WRITE_TOKEN) missing.push("BLOB_READ_WRITE_TOKEN");
  if (action === "analyze" && !process.env.AI_GATEWAY_API_KEY && !process.env.VERCEL_OIDC_TOKEN) {
    missing.push("AI_GATEWAY_API_KEY hoặc Vercel OIDC");
  }
  return missing;
}

export async function POST(request: Request) {
  const parsed = studioJobSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Dữ liệu job không hợp lệ.", issues: parsed.error.issues }, { status: 400 });
  }

  const missing = readiness(parsed.data.action);
  if (missing.length) {
    return NextResponse.json(
      { error: `Thiếu cấu hình server: ${missing.join(", ")}.`, code: "SERVER_NOT_READY", missing },
      { status: 503 },
    );
  }

  const run = parsed.data.action === "analyze"
    ? await start(analyzeMediaWorkflow, [parsed.data], { attributes: { kind: "analysis" } })
    : await start(renderVideoWorkflow, [parsed.data], { attributes: { kind: "render" } });

  return NextResponse.json({ runId: run.runId, action: parsed.data.action }, { status: 202 });
}

export async function GET(request: Request) {
  const runId = new URL(request.url).searchParams.get("runId");
  if (!runId) return NextResponse.json({ error: "Thiếu runId." }, { status: 400 });

  const run = getRun(runId);
  if (!(await run.exists)) return NextResponse.json({ error: "Không tìm thấy job." }, { status: 404 });

  const status = await run.status;
  if (status === "completed") {
    return NextResponse.json({ runId, status, result: await run.returnValue });
  }
  if (status === "failed" || status === "cancelled") {
    return NextResponse.json({ runId, status, error: status === "cancelled" ? "Job đã bị hủy." : "Job xử lý thất bại. Kiểm tra log Workflow để biết chi tiết." });
  }
  return NextResponse.json({ runId, status });
}

export async function DELETE(request: Request) {
  const runId = new URL(request.url).searchParams.get("runId");
  if (!runId) return NextResponse.json({ error: "Thiếu runId." }, { status: 400 });
  const run = getRun(runId);
  if (!(await run.exists)) return NextResponse.json({ error: "Không tìm thấy job." }, { status: 404 });
  await run.cancel({ cancelReason: "Người dùng hủy từ giao diện Song Kiếm AI" });
  return NextResponse.json({ runId, status: "cancelled" });
}
