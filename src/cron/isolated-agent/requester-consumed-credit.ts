import type { SubagentRunRecord } from "../../agents/subagent-registry.types.js";
import { createCronExecutionId } from "../run-id.js";

export type CronRequesterConsumedCredit = {
  requesterSessionKey: string;
  runStartedAt: number;
  runIds: string[];
  kind: "cron_descendant_fallback";
  deliveryTextHash: string;
  consumerRunId: string;
};

type RegistryRuntime = {
  markDescendantCompletionConsumedByRequester(params: {
    requesterSessionKey: string;
    runStartedAt: number;
    runIds: readonly string[];
    kind: NonNullable<SubagentRunRecord["delivery"]>["requesterConsumedKind"];
    deliveryTextHash?: string;
    consumerRunId?: string;
  }): unknown;
};

function hashDeliveredText(text: string): string {
  let hash = 5381;
  for (let index = 0; index < text.length; index += 1) {
    hash = (hash * 33) ^ text.charCodeAt(index);
  }
  return (hash >>> 0).toString(16);
}

export function buildCronRequesterConsumedCredit(params: {
  requesterSessionKey: string;
  runStartedAt: number;
  runIds: string[];
  text: string;
  jobId: string;
}): CronRequesterConsumedCredit {
  return {
    requesterSessionKey: params.requesterSessionKey,
    runStartedAt: params.runStartedAt,
    runIds: params.runIds,
    kind: "cron_descendant_fallback",
    deliveryTextHash: hashDeliveredText(params.text),
    consumerRunId: createCronExecutionId(params.jobId, params.runStartedAt),
  };
}

export async function creditCronRequesterConsumedDescendants(params: {
  credit: CronRequesterConsumedCredit;
  loadRuntime: () => Promise<RegistryRuntime>;
  logWarn: (message: string) => Promise<void>;
  jobId: string;
  formatErrorMessage: (err: unknown) => string;
}): Promise<void> {
  try {
    const subagentRegistryRuntime = await params.loadRuntime();
    subagentRegistryRuntime.markDescendantCompletionConsumedByRequester(params.credit);
  } catch (err) {
    await params.logWarn(
      `[cron:${params.jobId}] failed to credit requester-consumed descendant completions (bestEffort): ${params.formatErrorMessage(err)}`,
    );
  }
}
