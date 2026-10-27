import type { AnalyzeJobInput, RenderJobInput } from "@/lib/schemas";
import { analyzeMediaStep, renderVideoStep } from "@/workflows/studio-steps";

export async function analyzeMediaWorkflow(input: AnalyzeJobInput) {
  "use workflow";
  console.info("[workflow] analyzeMediaWorkflow started", { title: input.title });
  const analysis = await analyzeMediaStep(input);
  console.info("[workflow] analyzeMediaWorkflow completed", { scenes: analysis.scenes.length });
  return { kind: "analysis" as const, analysis, voiceIds: input.voiceIds };
}

export async function renderVideoWorkflow(input: RenderJobInput) {
  "use workflow";
  console.info("[workflow] renderVideoWorkflow started", { title: input.title });
  const render = await renderVideoStep(input);
  console.info("[workflow] renderVideoWorkflow completed", { pathname: render.pathname });
  return { kind: "render" as const, render };
}
