import { formatErrorMessage } from "../infra/errors.js";
import {
  clearControlPlaneDiagnostics,
  deleteControlPlaneDiagnostic,
  listControlPlaneDiagnostics,
  readControlPlaneDiagnostic,
  writeControlPlaneDiagnostic,
} from "../state/control-plane-diagnostic-store.js";

/**
 * Probe Cache - Isolated storage for channel/health probe results.
 *
 * This cache keeps probe snapshots separate from gateway readiness state.
 * Slow channel probes (like Telegram) do not block core gateway readiness.
 *
 * Key features:
 * - Separate from gateway readiness checks
 * - TTL-based expiration
 * - Non-blocking: cached results returned immediately if available
 * - Stale-entry reporting for callers that choose to refresh
 */

export const PROBE_CACHE_TTL_MS = 60_000; // 1 minute default TTL
export const PROBE_CACHE_STALE_MS = 30_000; // Consider stale after 30s
const PROBE_CACHE_STORE_SCOPE = "control-plane-probes";

export type ProbeCacheEntry<T = unknown> = {
  id: string;
  type: "channel" | "gateway" | "plugin" | "task" | "lock";
  timestamp: string;
  ttlMs: number;
  result: T;
  error?: string;
  durationMs?: number;
};

export type ProbeCacheOptions = {
  ttlMs?: number;
  env?: NodeJS.ProcessEnv;
};

function probeCacheKey(type: ProbeCacheEntry["type"], id: string): string {
  return `${type}:${id}`;
}

function readProbeCacheEntry<T>(
  type: ProbeCacheEntry["type"],
  id: string,
  env?: NodeJS.ProcessEnv,
): ProbeCacheEntry<T> | null {
  const record = readControlPlaneDiagnostic<ProbeCacheEntry<T>>(
    PROBE_CACHE_STORE_SCOPE,
    probeCacheKey(type, id),
    env,
  );
  if (!record) {
    return null;
  }
  const timestamp = Date.parse(record.payload.timestamp);
  if (!Number.isFinite(timestamp) || Date.now() - timestamp > record.payload.ttlMs) {
    deleteControlPlaneDiagnostic(PROBE_CACHE_STORE_SCOPE, record.key, {
      createdAt: record.createdAt,
      ...(env ? { env } : {}),
    });
    return null;
  }
  return record.payload;
}

function writeProbeCacheEntry<T>(entry: ProbeCacheEntry<T>, env?: NodeJS.ProcessEnv): void {
  writeControlPlaneDiagnostic(
    PROBE_CACHE_STORE_SCOPE,
    probeCacheKey(entry.type, entry.id),
    entry,
    { createdAt: Date.parse(entry.timestamp), ...(env ? { env } : {}) },
  );
}

export function getCachedProbe<T>(
  type: ProbeCacheEntry["type"],
  id: string,
  env?: NodeJS.ProcessEnv,
): {
  entry: ProbeCacheEntry<T> | null;
  isStale: boolean;
} {
  const entry = readProbeCacheEntry<T>(type, id, env);
  if (!entry) {
    return { entry: null, isStale: false };
  }
  const timestamp = new Date(entry.timestamp).getTime();
  const age = Date.now() - timestamp;
  const isStale = age > PROBE_CACHE_STALE_MS;
  return { entry, isStale };
}

export function setCachedProbe<T>(
  type: ProbeCacheEntry["type"],
  id: string,
  result: T,
  options?: ProbeCacheOptions & { error?: string; durationMs?: number },
): ProbeCacheEntry<T> {
  const entry: ProbeCacheEntry<T> = {
    id,
    type,
    timestamp: new Date().toISOString(),
    ttlMs: options?.ttlMs ?? PROBE_CACHE_TTL_MS,
    result,
    error: options?.error,
    durationMs: options?.durationMs,
  };
  writeProbeCacheEntry(entry, options?.env);
  return entry;
}

export function clearCachedProbe(
  type: ProbeCacheEntry["type"],
  id: string,
  env?: NodeJS.ProcessEnv,
): void {
  deleteControlPlaneDiagnostic(PROBE_CACHE_STORE_SCOPE, probeCacheKey(type, id), {
    ...(env ? { env } : {}),
  });
}

export function clearAllCachedProbes(
  type?: ProbeCacheEntry["type"],
  env?: NodeJS.ProcessEnv,
): void {
  clearControlPlaneDiagnostics(PROBE_CACHE_STORE_SCOPE, {
    ...(type ? { keyPrefix: `${type}:` } : {}),
    ...(env ? { env } : {}),
  });
}

export function listCachedProbes(
  env?: NodeJS.ProcessEnv,
): Array<{ type: string; id: string; timestamp: string; stale: boolean }> {
  return listControlPlaneDiagnostics<ProbeCacheEntry>(PROBE_CACHE_STORE_SCOPE, env).flatMap(
    (record) => {
      const entry = record.payload;
      const timestamp = Date.parse(entry.timestamp);
      if (!Number.isFinite(timestamp) || Date.now() - timestamp > entry.ttlMs) {
        deleteControlPlaneDiagnostic(PROBE_CACHE_STORE_SCOPE, record.key, {
          createdAt: record.createdAt,
          ...(env ? { env } : {}),
        });
        return [];
      }
      return [
        {
          type: entry.type,
          id: entry.id,
          timestamp: entry.timestamp,
          stale: Date.now() - timestamp > PROBE_CACHE_STALE_MS,
        },
      ];
    },
  );
}

/**
 * Staggered execution with jitter and backoff.
 * Used to prevent thundering herd on channel probes.
 */

export type StaggerOptions = {
  baseDelayMs?: number;
  maxDelayMs?: number;
  jitterMs?: number;
  backoffFactor?: number;
  maxAttempts?: number;
};

const DEFAULT_BASE_DELAY_MS = 100;
const DEFAULT_MAX_DELAY_MS = 10_000;
const DEFAULT_JITTER_MS = 50;
const DEFAULT_BACKOFF_FACTOR = 2;

export function calculateStaggerDelay(attempt: number, options?: StaggerOptions): number {
  const baseDelayMs = options?.baseDelayMs ?? DEFAULT_BASE_DELAY_MS;
  const maxDelayMs = options?.maxDelayMs ?? DEFAULT_MAX_DELAY_MS;
  const jitterMs = options?.jitterMs ?? DEFAULT_JITTER_MS;
  const backoffFactor = options?.backoffFactor ?? DEFAULT_BACKOFF_FACTOR;

  const exponentialDelay = Math.min(maxDelayMs, baseDelayMs * backoffFactor ** (attempt - 1));
  const jitter = Math.random() * jitterMs;
  return Math.floor(exponentialDelay + jitter);
}

export async function staggerDelay(attempt: number, options?: StaggerOptions): Promise<number> {
  const delayMs = calculateStaggerDelay(attempt, options);
  await new Promise((resolve) => setTimeout(resolve, delayMs));
  return delayMs;
}

export type ProbeExecutor<T> = () => Promise<T>;

export interface ProbeResult<T> {
  result: T;
  cached: boolean;
  stale: boolean;
  durationMs: number;
}

export async function executeWithCacheAndStagger<T>(
  type: ProbeCacheEntry["type"],
  id: string,
  executor: ProbeExecutor<T>,
  options?: ProbeCacheOptions & StaggerOptions & { forceRefresh?: boolean },
): Promise<ProbeResult<T>> {
  // Check cache first (unless force refresh)
  if (!options?.forceRefresh) {
    const { entry, isStale } = getCachedProbe<T>(type, id, options?.env);
    if (entry) {
      if (entry.error) {
        throw new Error(`Cached ${type} probe ${id} failed: ${entry.error}`);
      }
      // Return cached result, but mark if stale (caller may choose to background refresh)
      return {
        result: entry.result,
        cached: true,
        stale: isStale,
        durationMs: entry.durationMs ?? 0,
      };
    }
  }

  const maxAttempts = options?.maxAttempts ?? 1;
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1) {
    throw new RangeError("Probe maxAttempts must be a positive integer");
  }

  const startTime = Date.now();
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const delayMs = calculateStaggerDelay(attempt, options);
    if (delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }

    try {
      const result = await executor();
      const durationMs = Date.now() - startTime;

      setCachedProbe(type, id, result, {
        ...options,
        durationMs,
      });

      return {
        result,
        cached: false,
        stale: false,
        durationMs,
      };
    } catch (err) {
      if (attempt < maxAttempts) {
        continue;
      }
      const durationMs = Date.now() - startTime;
      const error = formatErrorMessage(err);

      setCachedProbe(type, id, null as T, {
        ...options,
        ttlMs: Math.min(5000, options?.ttlMs ?? PROBE_CACHE_TTL_MS),
        error,
        durationMs,
      });
      throw err;
    }
  }

  throw new Error("Probe execution exhausted without a result");
}

/**
 * Batch probe executor with concurrency and stagger.
 * Runs probes in parallel batches with stagger between batches.
 */

export async function executeProbesWithStagger<T>(
  items: Array<{ type: ProbeCacheEntry["type"]; id: string; executor: ProbeExecutor<T> }>,
  options?: {
    concurrency?: number;
    staggerMs?: number;
    cacheEnv?: NodeJS.ProcessEnv;
    skipCache?: boolean;
  },
): Promise<Map<string, ProbeResult<T>>> {
  const concurrency = options?.concurrency ?? 5;
  const staggerMs = options?.staggerMs ?? 100;
  if (!Number.isInteger(concurrency) || concurrency < 1) {
    throw new RangeError("Probe concurrency must be a positive integer");
  }

  const results = new Map<string, ProbeResult<T>>();

  for (let i = 0; i < items.length; i += concurrency) {
    const batch = items.slice(i, i + concurrency);

    // Execute batch in parallel
    const batchResults = await Promise.all(
      batch.map(async (item) => {
        const result = await executeWithCacheAndStagger(item.type, item.id, item.executor, {
          env: options?.cacheEnv,
          forceRefresh: options?.skipCache,
        });
        return { key: probeCacheKey(item.type, item.id), result };
      }),
    );

    for (const item of batchResults) {
      results.set(item.key, item.result);
    }

    // Stagger between batches (but not after last batch)
    if (i + concurrency < items.length && staggerMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, staggerMs));
    }
  }

  return results;
}
