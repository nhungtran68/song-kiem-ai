const QUOTA_CODES = new Set([
  "insufficient_quota", "credit_balance_exhausted", "billing_hard_limit_reached",
  "organization_spend_limit_exceeded", "project_spend_limit_exceeded", "organization_usage_limit_exceeded",
]);

export function classifyAiError(status: number, error?: { code?: string; type?: string }) {
  if (QUOTA_CODES.has(error?.code || "") || error?.type === "insufficient_quota") return { code: "AI_QUOTA_EXHAUSTED", fallbackAllowed: true };
  if (status === 429) return { code: "AI_RATE_LIMITED", fallbackAllowed: true };
  if (status === 401 || status === 403) return { code: "AI_ACCESS_UNAVAILABLE", fallbackAllowed: true };
  if (status >= 500) return { code: "AI_UNAVAILABLE", fallbackAllowed: true };
  return { code: "AI_REQUEST_REJECTED", fallbackAllowed: false };
}
