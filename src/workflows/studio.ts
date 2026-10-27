import type { AnalyzeJobInput, RenderJobInput } from "@/lib/schemas";
import { analyzeMediaStep, renderVideoStep, synthesizeDialogueStep } from "@/workflows/studio-steps";

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
  const tracks = [];
  if (input.includeTts) {
    for (const [index, line] of input.lines.entries()) {
      const voiceId = input.voiceIds[line.speaker];
      if (!voiceId) throw new Error(`Thiếu Voice ID cho nhân vật ${line.speaker === "male" ? "nam" : "nữ"}.`);
      tracks.push(await synthesizeDialogueStep({
        index,
        text: line.text,
        voiceId,
        start: line.start,
        end: line.end,
      }));
    }
  }
  const render = await renderVideoStep(input, tracks);
  console.info("[workflow] renderVideoWorkflow completed", { pathname: render.pathname });
  return { kind: "render" as const, render };
}
