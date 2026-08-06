/** Runtime kill switches are server-only environment controls. */
export function isLeadIngestionEnabled(): boolean {
  return process.env.LEAD_INGESTION_ENABLED !== "0";
}

export function isAiActionsEnabled(): boolean {
  return process.env.AI_ACTIONS_ENABLED !== "0";
}

export function isNewsScanEnabled(): boolean {
  return process.env.NEWS_SCAN_ENABLED === "1";
}
