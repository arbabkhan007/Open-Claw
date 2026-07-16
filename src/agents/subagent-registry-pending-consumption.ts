import type { SubagentRunRecord } from "./subagent-registry.types.js";

export function applyPendingRequesterConsumedDescendantRuns(
  run: SubagentRunRecord,
  params: {
    pendingRequesterConsumedDescendantRunIds?: readonly string[];
    pendingRequesterConsumedRunStartedAt?: number;
  },
): void {
  const pendingRequesterConsumedDescendantRunIds = Array.from(
    new Set(
      (params.pendingRequesterConsumedDescendantRunIds ?? [])
        .map((runId) => runId.trim())
        .filter(Boolean),
    ),
  );
  if (pendingRequesterConsumedDescendantRunIds.length === 0) {
    return;
  }
  run.delivery = {
    ...(run.delivery ?? { status: "pending" }),
    pendingRequesterConsumedDescendantRunIds,
    ...(typeof params.pendingRequesterConsumedRunStartedAt === "number"
      ? { pendingRequesterConsumedRunStartedAt: params.pendingRequesterConsumedRunStartedAt }
      : {}),
  };
}
