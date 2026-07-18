/**
 * Subagent registry state persistence bridge.
 *
 * Merges process-local active runs with persisted SQLite state for cross-process readers.
 */
import {
  loadSubagentRunsForChildSessionFromSqlite,
  loadSubagentRunsForControllerFromSqlite,
  loadSubagentRegistryFromSqlite,
  saveSubagentRegistryToSqlite,
} from "./subagent-registry.store.sqlite.js";
import type { SubagentRunRecord } from "./subagent-registry.types.js";

const SUBAGENT_RUNS_READ_CACHE_TTL_MS = 500;
const SUBAGENT_RUNS_SCOPED_READ_CACHE_MAX_ENTRIES = 64;

let persistedSubagentRunsReadCache:
  | {
      loadedAtMs: number;
      runs: Map<string, SubagentRunRecord>;
    }
  | undefined;

const persistedSubagentRunsScopedReadCache = new Map<
  string,
  {
    loadedAtMs: number;
    runs: Map<string, SubagentRunRecord>;
  }
>();

function cloneSubagentRunsSnapshot(
  runs: Map<string, SubagentRunRecord>,
): Map<string, SubagentRunRecord> {
  return new Map([...runs.entries()].map(([runId, entry]) => [runId, structuredClone(entry)]));
}

function rememberPersistedSubagentRunsSnapshot(runs: Map<string, SubagentRunRecord>): void {
  persistedSubagentRunsReadCache = {
    loadedAtMs: Date.now(),
    runs: cloneSubagentRunsSnapshot(runs),
  };
  persistedSubagentRunsScopedReadCache.clear();
}

function shouldReadPersistedSubagentRuns(): boolean {
  return (
    process.env.OPENCLAW_TEST_READ_SUBAGENT_RUNS_FROM_SQLITE === "1" ||
    !(process.env.VITEST || process.env.NODE_ENV === "test")
  );
}

function isFreshSubagentRunsCacheEntry(loadedAtMs: number, nowMs: number): boolean {
  return nowMs >= loadedAtMs && nowMs - loadedAtMs < SUBAGENT_RUNS_READ_CACHE_TTL_MS;
}

function loadPersistedSubagentRunsForRead(): Map<string, SubagentRunRecord> {
  const nowMs = Date.now();
  if (
    persistedSubagentRunsReadCache &&
    isFreshSubagentRunsCacheEntry(persistedSubagentRunsReadCache.loadedAtMs, nowMs)
  ) {
    return persistedSubagentRunsReadCache.runs;
  }

  const runs = loadSubagentRegistryFromSqlite();
  persistedSubagentRunsReadCache = {
    loadedAtMs: nowMs,
    runs,
  };
  return runs;
}

function loadPersistedSubagentRunsForScopedRead(
  cacheKey: string,
  loadRuns: () => SubagentRunRecord[],
): Map<string, SubagentRunRecord> {
  const nowMs = Date.now();
  for (const [key, entry] of persistedSubagentRunsScopedReadCache.entries()) {
    if (!isFreshSubagentRunsCacheEntry(entry.loadedAtMs, nowMs)) {
      persistedSubagentRunsScopedReadCache.delete(key);
    }
  }

  const cached = persistedSubagentRunsScopedReadCache.get(cacheKey);
  if (cached) {
    return cached.runs;
  }

  const runs = new Map(loadRuns().map((entry) => [entry.runId, entry]));
  if (persistedSubagentRunsScopedReadCache.size >= SUBAGENT_RUNS_SCOPED_READ_CACHE_MAX_ENTRIES) {
    const oldestKey = persistedSubagentRunsScopedReadCache.keys().next().value;
    if (oldestKey) {
      persistedSubagentRunsScopedReadCache.delete(oldestKey);
    }
  }
  persistedSubagentRunsScopedReadCache.set(cacheKey, {
    loadedAtMs: nowMs,
    runs: cloneSubagentRunsSnapshot(runs),
  });
  return runs;
}

function resolvesToControllerSessionKey(
  entry: SubagentRunRecord,
  controllerSessionKey: string,
): boolean {
  return (entry.controllerSessionKey?.trim() || entry.requesterSessionKey) === controllerSessionKey;
}

export function clearSubagentRunsReadCacheForTest(): void {
  persistedSubagentRunsReadCache = undefined;
  persistedSubagentRunsScopedReadCache.clear();
}

export function persistSubagentRunsToDisk(runs: Map<string, SubagentRunRecord>) {
  try {
    saveSubagentRegistryToSqlite(runs);
    rememberPersistedSubagentRunsSnapshot(runs);
  } catch {
    // ignore persistence failures
  }
}

export function persistSubagentRunsToDiskOrThrow(runs: Map<string, SubagentRunRecord>) {
  saveSubagentRegistryToSqlite(runs);
  rememberPersistedSubagentRunsSnapshot(runs);
}

export function restoreSubagentRunsFromDisk(params: {
  runs: Map<string, SubagentRunRecord>;
  mergeOnly?: boolean;
}) {
  const restored = loadSubagentRegistryFromSqlite();
  if (restored.size === 0) {
    return 0;
  }
  let added = 0;
  for (const [runId, entry] of restored.entries()) {
    if (!runId || !entry) {
      continue;
    }
    if (params.mergeOnly && params.runs.has(runId)) {
      continue;
    }
    params.runs.set(runId, entry);
    added += 1;
  }
  return added;
}

export function getSubagentRunsSnapshotForRead(
  inMemoryRuns: Map<string, SubagentRunRecord>,
): Map<string, SubagentRunRecord> {
  const merged = new Map<string, SubagentRunRecord>();
  if (shouldReadPersistedSubagentRuns()) {
    try {
      // Persisted state lets other worker processes observe active runs.
      // Cache this hot cross-process snapshot briefly; writes refresh the local
      // cache and the TTL bounds visibility of changes from other processes.
      for (const [runId, entry] of loadPersistedSubagentRunsForRead().entries()) {
        merged.set(runId, entry);
      }
    } catch {
      // Ignore disk read failures and fall back to local memory.
    }
  }
  for (const [runId, entry] of inMemoryRuns.entries()) {
    merged.set(runId, entry);
  }
  return merged;
}

export function getSubagentRunsSnapshotForController(
  inMemoryRuns: Map<string, SubagentRunRecord>,
  controllerSessionKey: string,
): Map<string, SubagentRunRecord> {
  const normalizedControllerSessionKey = controllerSessionKey.trim();
  const merged = new Map<string, SubagentRunRecord>();
  if (!normalizedControllerSessionKey) {
    return merged;
  }

  if (shouldReadPersistedSubagentRuns()) {
    try {
      for (const [runId, entry] of loadPersistedSubagentRunsForScopedRead(
        `controller:${normalizedControllerSessionKey}`,
        () => loadSubagentRunsForControllerFromSqlite(normalizedControllerSessionKey),
      ).entries()) {
        merged.set(runId, structuredClone(entry));
      }
    } catch {
      // Ignore disk read failures and fall back to local memory.
    }
  }
  for (const [runId, entry] of inMemoryRuns.entries()) {
    if (resolvesToControllerSessionKey(entry, normalizedControllerSessionKey)) {
      merged.set(runId, entry);
    }
  }
  return merged;
}

/** Returns one child session's persisted generations plus matching live in-memory runs. */
export function getSubagentRunsSnapshotForChildSession(
  inMemoryRuns: Map<string, SubagentRunRecord>,
  childSessionKey: string,
): Map<string, SubagentRunRecord> {
  const normalizedChildSessionKey = childSessionKey.trim();
  const merged = new Map<string, SubagentRunRecord>();
  if (!normalizedChildSessionKey) {
    return merged;
  }

  if (shouldReadPersistedSubagentRuns()) {
    try {
      // Controller and child keys share the bounded cache, so prefixes keep
      // equal session keys from reusing rows selected by the other index.
      for (const [runId, entry] of loadPersistedSubagentRunsForScopedRead(
        `child:${normalizedChildSessionKey}`,
        () => loadSubagentRunsForChildSessionFromSqlite(normalizedChildSessionKey),
      ).entries()) {
        merged.set(runId, structuredClone(entry));
      }
    } catch {
      // Ignore disk read failures and fall back to local memory.
    }
  }
  for (const [runId, entry] of inMemoryRuns.entries()) {
    if (entry.childSessionKey === normalizedChildSessionKey) {
      merged.set(runId, entry);
    }
  }
  return merged;
}
