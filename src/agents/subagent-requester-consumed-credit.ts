import type { SubagentAnnounceDeliveryResult } from "./subagent-announce-dispatch.js";
import {
  buildChildCompletionFindingsWithRuns,
  dedupeLatestChildCompletionRows,
  filterCurrentDirectChildCompletionRows,
} from "./subagent-announce-output.js";
import type { SubagentRunRecord } from "./subagent-registry.types.js";

type MarkRequesterConsumedCompletion = (params: {
  requesterSessionKey: string;
  runStartedAt: number;
  runIds: readonly string[];
  kind: NonNullable<SubagentRunRecord["delivery"]>["requesterConsumedKind"];
  deliveryTextHash?: string;
  consumerRunId?: string;
}) => unknown;

type RequesterConsumedRegistryRuntime = {
  markDescendantCompletionConsumedByRequester?: MarkRequesterConsumedCompletion;
};

export function buildRequesterConsumedChildCompletion(
  directChildren: Parameters<typeof filterCurrentDirectChildCompletionRows>[0],
  options: Parameters<typeof filterCurrentDirectChildCompletionRows>[1],
): { text?: string; consumedRunIds: string[] } {
  const currentDirectChildren = filterCurrentDirectChildCompletionRows(directChildren, options);
  const childCompletion = buildChildCompletionFindingsWithRuns(
    dedupeLatestChildCompletionRows(currentDirectChildren),
  );
  return { text: childCompletion?.text, consumedRunIds: childCompletion?.consumedRunIds ?? [] };
}

function normalizeRunIdList(runIds: readonly string[] | undefined): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const runId of runIds ?? []) {
    const trimmed = runId.trim();
    if (!trimmed || seen.has(trimmed)) {
      continue;
    }
    seen.add(trimmed);
    result.push(trimmed);
  }
  return result;
}

function deliveryHasRequesterConsumptionCredit(delivery: SubagentAnnounceDeliveryResult): boolean {
  if (!delivery.delivered) {
    return false;
  }
  const phases = delivery.phases ?? [];
  if (phases.some((phase) => phase.phase === "direct-primary" && phase.delivered)) {
    return true;
  }
  // Older callers/tests may construct a bare direct result without dispatch phase evidence.
  // Fallback steering is never represented as path="direct", so keep legacy direct-delivery
  // credit while denying transcript-only steer fallback.
  return phases.length === 0 && delivery.path === "direct";
}

export function recordRequesterConsumedDescendantCompletions(params: {
  delivery: SubagentAnnounceDeliveryResult;
  subagentRegistryRuntime?: RequesterConsumedRegistryRuntime;
  childSessionKey: string;
  childRunId: string;
  startedAt?: number;
  childCompletionFindings?: string;
  consumedChildRunIds?: readonly string[];
  pendingRequesterConsumedDescendantRunIds?: readonly string[];
  pendingRequesterConsumedRunStartedAt?: number;
}): void {
  if (!deliveryHasRequesterConsumptionCredit(params.delivery)) {
    return;
  }
  const mark = params.subagentRegistryRuntime?.markDescendantCompletionConsumedByRequester;
  const startedAt = params.startedAt ?? 0;
  const directRunIds = params.childCompletionFindings?.trim()
    ? normalizeRunIdList(params.consumedChildRunIds)
    : [];
  if (directRunIds.length > 0) {
    mark?.({
      requesterSessionKey: params.childSessionKey,
      runStartedAt: startedAt,
      runIds: directRunIds,
      kind: "subagent_descendant_result",
      consumerRunId: params.childRunId,
    });
  }
  const pendingRunIds = normalizeRunIdList(params.pendingRequesterConsumedDescendantRunIds);
  if (pendingRunIds.length > 0) {
    mark?.({
      requesterSessionKey: params.childSessionKey,
      runStartedAt: params.pendingRequesterConsumedRunStartedAt ?? startedAt,
      runIds: pendingRunIds,
      kind: "subagent_descendant_result",
      consumerRunId: params.childRunId,
    });
  }
}
