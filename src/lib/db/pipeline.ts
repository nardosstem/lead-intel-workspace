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
