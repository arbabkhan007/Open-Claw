type PendingApprovalTarget = {
  sessionKey: string;
  toolCalls?: ReadonlyMap<string, { kind?: string }>;
};

export function findUniquePendingApprovalTarget<T extends PendingApprovalTarget>(
  pendingTargets: Iterable<T>,
  sessionKey: string,
  toolCallId?: string,
): T | undefined {
  let match: T | undefined;
  for (const pending of pendingTargets) {
    if (
      pending.sessionKey !== sessionKey ||
      (toolCallId && pending.toolCalls?.get(toolCallId)?.kind !== "execute")
    ) {
      continue;
    }
    if (match) {
      return undefined;
    }
    match = pending;
  }
  return match;
}
