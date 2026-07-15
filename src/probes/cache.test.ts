import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { closeOpenClawStateDatabaseForTest } from "../state/openclaw-state-db.js";
import {
  executeProbesWithStagger,
  executeWithCacheAndStagger,
  listCachedProbes,
  setCachedProbe,
} from "./cache.js";

describe("probe cache", () => {
  let tempDir: string;
  let previousStateDir: string | undefined;

  beforeEach(() => {
    previousStateDir = process.env.OPENCLAW_STATE_DIR;
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-probe-cache-test-"));
    process.env.OPENCLAW_STATE_DIR = tempDir;
  });

  afterEach(() => {
    vi.useRealTimers();
    closeOpenClawStateDatabaseForTest();
    fs.rmSync(tempDir, { recursive: true, force: true });
    if (previousStateDir === undefined) {
      delete process.env.OPENCLAW_STATE_DIR;
    } else {
      process.env.OPENCLAW_STATE_DIR = previousStateDir;
    }
  });

  it("replays cached probe failures as failures instead of null successes", async () => {
    const failingExecutor = vi.fn(async () => {
      throw new Error("gateway unavailable");
    });

    await expect(
      executeWithCacheAndStagger("gateway", "status", failingExecutor, {
        baseDelayMs: 0,
        jitterMs: 0,
      }),
    ).rejects.toThrow("gateway unavailable");
    expect(failingExecutor).toHaveBeenCalledTimes(1);

    const successExecutor = vi.fn(async () => ({ ok: true }));

    await expect(
      executeWithCacheAndStagger("gateway", "status", successExecutor, {
        baseDelayMs: 0,
        jitterMs: 0,
      }),
    ).rejects.toThrow("Cached gateway probe status failed: gateway unavailable");
    expect(successExecutor).not.toHaveBeenCalled();
  });

  it("redacts persisted probe failures", async () => {
    const sensitiveValue = ["private", "fixture", "value"].join("-");
    const failingExecutor = vi.fn(async () => {
      throw new Error(`Authorization: Bearer ${sensitiveValue}`);
    });

    await expect(
      executeWithCacheAndStagger("gateway", "redaction", failingExecutor, {
        baseDelayMs: 0,
        jitterMs: 0,
      }),
    ).rejects.toThrow(sensitiveValue);
    let cachedError: unknown;
    try {
      await executeWithCacheAndStagger(
        "gateway",
        "redaction",
        vi.fn(async () => ({ ok: true })),
        {
          baseDelayMs: 0,
          jitterMs: 0,
        },
      );
    } catch (err) {
      cachedError = err;
    }
    expect(cachedError).toBeInstanceOf(Error);
    expect((cachedError as Error).message).toContain("Authorization: Bearer");
    expect((cachedError as Error).message).not.toContain(sensitiveValue);
  });

  it("omits expired entries from cache listings", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
    setCachedProbe("gateway", "expired", { ok: true }, { ttlMs: 1000 });
    vi.setSystemTime(new Date("2026-01-01T00:00:02.000Z"));
    expect(listCachedProbes()).toEqual([]);
  });

  it("keys batch results by probe type and propagates failures", async () => {
    const results = await executeProbesWithStagger(
      [
        { type: "gateway", id: "status", executor: async () => ({ ok: true }) },
        { type: "channel", id: "status", executor: async () => ({ ok: true }) },
      ],
      { staggerMs: 0, skipCache: true },
    );
    expect([...results.keys()]).toEqual(["gateway:status", "channel:status"]);

    await expect(
      executeProbesWithStagger(
        [{ type: "gateway", id: "failure", executor: async () => Promise.reject(new Error("no")) }],
        { staggerMs: 0, skipCache: true },
      ),
    ).rejects.toThrow("no");
  });

  it("retries with backoff and rejects invalid batch concurrency", async () => {
    const executor = vi
      .fn<() => Promise<{ ok: boolean }>>()
      .mockRejectedValueOnce(new Error("retry"))
      .mockResolvedValue({ ok: true });
    await expect(
      executeWithCacheAndStagger("gateway", "retry", executor, {
        baseDelayMs: 0,
        jitterMs: 0,
        maxAttempts: 2,
      }),
    ).resolves.toMatchObject({ result: { ok: true } });
    expect(executor).toHaveBeenCalledTimes(2);

    await expect(executeProbesWithStagger([], { concurrency: 0 })).rejects.toThrow(
      "Probe concurrency must be a positive integer",
    );
  });
});
