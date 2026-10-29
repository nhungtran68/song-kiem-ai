import "server-only";
import { saydiFetch } from "./saydi";
import { normalizeCatalogue } from "./voice-library";

export async function loadCatalogue() {
  const results = await Promise.allSettled([
    saydiFetch("/samples", { signal: AbortSignal.timeout(30_000) }).then(async (r) => normalizeCatalogue(await r.json(), "system")),
    saydiFetch("/v1/voices", { signal: AbortSignal.timeout(30_000) }).then(async (r) => normalizeCatalogue(await r.json(), "clone")),
  ]);
  return { voices: results.flatMap((result) => result.status === "fulfilled" ? result.value : []),
    warnings: results.flatMap((result, index) => result.status === "rejected" ? [`Không tải được giọng ${index ? "clone" : "hệ thống"}: ${result.reason instanceof Error ? result.reason.message : "Lỗi kết nối Saydi"}`] : []) };
}
