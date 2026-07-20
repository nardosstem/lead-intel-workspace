/** Shared pipeline vocabulary safe to import from Server and Client Components. */
export const pipelineStages = [
  "new",
  "researching",
  "qualified",
  "contacted",
  "replied",
  "meeting",
  "won",
  "lost",
] as const;

export type PipelineStage = (typeof pipelineStages)[number];

export function isPipelineStage(value: unknown): value is PipelineStage {
  return typeof value === "string" && pipelineStages.some((stage) => stage === value);
}
