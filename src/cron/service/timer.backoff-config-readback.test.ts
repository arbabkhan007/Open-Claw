// Verifies the configured retry.backoffMs floor for a recurring job survives a
// real scheduled cron tick and is persisted to the SQLite-backed store, not just
// computed in memory by applyJobResult.
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { resetTaskRegistryForTests } from "../../tasks/task-runtime.test-helpers.js";
import { withEnvAsync } from "../../test-utils/env.js";
import { setupCronServiceSuite, writeCronStoreSnapshot } from "../service.test-harness.js";
import { loadCronStore } from "../store.js";
import type { CronJob } from "../types.js";
import { run as runManualCronJob } from "./ops.js";
import { createCronServiceState } from "./state.js";
import { onTimer } from "./timer.test-support.js";

const { logger, makeStorePath } = setupCronServiceSuite({
  prefix: "cron-backoff-config-readback",
});

function createDueRecurringJob(now: number): CronJob {
  return {
    id: "recurring-backoff-readback",
    name: "recurring backoff readback",
    enabled: true,
    createdAtMs: now - 60_000,
    updatedAtMs: now - 60_000,
    schedule: { kind: "every", everyMs: 1_000, anchorMs: now - 60_000 },
    sessionTarget: "isolated",
    wakeMode: "next-heartbeat",
    payload: { kind: "agentTurn", message: "ping" },
    sessionKey: "agent:main:main",
    // Past-due nextRunAtMs makes the job eligible for the scheduled timer tick.
    state: { nextRunAtMs: now - 1 },
  };
}

describe("recurring error backoff floor persistence", () => {
  it("persists the configured retry.backoffMs floor across a real run and SQLite readback", async () => {
    const now = Date.parse("2026-03-02T12:00:00.000Z");
    const { storePath } = await makeStorePath();
    const stateRoot = path.dirname(path.dirname(storePath));
    const job = createDueRecurringJob(now);

    let persistedJob: CronJob | undefined;
    resetTaskRegistryForTests();
    try {
      await withEnvAsync({ OPENCLAW_STATE_DIR: stateRoot }, async () => {
        await writeCronStoreSnapshot({ storePath, jobs: [job] });

        const state = createCronServiceState({
          storePath,
          cronEnabled: true,
          log: logger,
          nowMs: () => now,
          enqueueSystemEvent: vi.fn(),
          requestHeartbeat: vi.fn(),
          // Permanent (non-retryable) error -> recurring safety-net backoff
          // floor, the branch that must honor the configured backoffMs.
          runIsolatedAgentJob: vi.fn(async () => {
            throw new Error("permanent: bad request");
          }),
          cronConfig: { retry: { backoffMs: [300_000] } },
        });

        // Drive the scheduled timer path (not a manual run): only scheduled
        // ticks participate in recurring error backoff, so this is where the
        // safety-net floor is computed rather than the recurring anchor.
        await onTimer(state);

        const persisted = (await loadCronStore(storePath)) as { jobs: CronJob[] };
        persistedJob = persisted.jobs.find((entry) => entry.id === job.id);
      });
    } finally {
      resetTaskRegistryForTests();
    }

    // The floor read back from the SQLite-backed store must be endedAt(=now) +
    // the configured backoffMs[0], not the hardcoded 30000 default.
    expect(persistedJob?.state.nextRunAtMs).toBe(now + 300_000);
    expect(persistedJob?.state.lastStatus).toBe("error");
    expect(persistedJob?.state.consecutiveErrors).toBe(1);
  });
});

describe("manual-run lastRunWasManual persistence and readback", () => {
  it("persists lastRunWasManual across SQLite readback and keeps the scheduled fire on a fresh state", async () => {
    const now = Date.parse("2026-03-02T12:00:00.000Z");
    const { storePath } = await makeStorePath();
    const stateRoot = path.dirname(path.dirname(storePath));
    const job = createDueRecurringJob(now);

    let persistedJob: CronJob | undefined;
    let scheduledRunnerCalls = 0;
    resetTaskRegistryForTests();
    try {
      await withEnvAsync({ OPENCLAW_STATE_DIR: stateRoot }, async () => {
        await writeCronStoreSnapshot({ storePath, jobs: [job] });

        // Manual/operator run records an error outcome but must not touch
        // scheduler-owned counters/backoff/nextRunAtMs (#83538).
        const manualState = createCronServiceState({
          storePath,
          cronEnabled: true,
          log: logger,
          nowMs: () => now,
          enqueueSystemEvent: vi.fn(),
          requestHeartbeat: vi.fn(),
          runIsolatedAgentJob: vi.fn(async () => {
            throw new Error("permanent: bad request");
          }),
          // A 5-minute floor: had the manual error opened a backoff window, the
          // next fire would slip to now + 300000 instead of the natural slot.
          cronConfig: { retry: { backoffMs: [300_000] } },
        });
        await runManualCronJob(manualState, job.id, "force");

        const persisted = (await loadCronStore(storePath)) as { jobs: CronJob[] };
        persistedJob = persisted.jobs.find((entry) => entry.id === job.id);

        // A fresh service state must reload the persisted lastRunWasManual and
        // still fire the scheduled slot: the manual error opened no backoff
        // window that would suppress the next scheduled run.
        const scheduledRunner = vi.fn(async () => ({ status: "ok" as const, summary: "ok" }));
        const scheduledState = createCronServiceState({
          storePath,
          cronEnabled: true,
          log: logger,
          nowMs: () => now + 1_000,
          enqueueSystemEvent: vi.fn(),
          requestHeartbeat: vi.fn(),
          runIsolatedAgentJob: scheduledRunner,
          cronConfig: { retry: { backoffMs: [300_000] } },
        });
        await onTimer(scheduledState);
        scheduledRunnerCalls = scheduledRunner.mock.calls.length;
      });
    } finally {
      resetTaskRegistryForTests();
    }

    // Manual run flagged as manual and left scheduler timing untouched: the
    // next fire is the natural every-1s slot, not the 5-minute backoff floor,
    // and the error counter was not incremented.
    expect(persistedJob?.state.lastRunWasManual).toBe(true);
    expect(persistedJob?.state.lastRunStatus).toBe("error");
    expect(persistedJob?.state.nextRunAtMs).toBe(now + 1_000);
    expect(persistedJob?.state.consecutiveErrors).toBeUndefined();
    // The scheduled runner fired on the fresh state at the natural slot.
    expect(scheduledRunnerCalls).toBe(1);
  });

  it("treats an upgraded store with no lastRunWasManual field as scheduled and applies backoff", async () => {
    const now = Date.parse("2026-03-02T12:00:00.000Z");
    const { storePath } = await makeStorePath();
    const stateRoot = path.dirname(path.dirname(storePath));
    // Pre-field on-disk shape: a recurring job that errored, with a past-due
    // nextRunAtMs but NO lastRunWasManual field at all.
    const legacyJob: CronJob = {
      ...createDueRecurringJob(now),
      state: {
        nextRunAtMs: now - 1,
        lastRunAtMs: now - 1_000,
        lastRunStatus: "error",
        lastDurationMs: 0,
        consecutiveErrors: 1,
      },
    };

    let scheduledRunnerCalls = 0;
    resetTaskRegistryForTests();
    try {
      await withEnvAsync({ OPENCLAW_STATE_DIR: stateRoot }, async () => {
        await writeCronStoreSnapshot({ storePath, jobs: [legacyJob] });

        // Confirm the seeded on-disk shape really lacks the field, so the
        // absent-field default path is what we are exercising.
        const seeded = (await loadCronStore(storePath)) as { jobs: CronJob[] };
        const seededJob = seeded.jobs.find((entry) => entry.id === legacyJob.id);
        expect(seededJob?.state.lastRunWasManual).toBeUndefined();

        const scheduledRunner = vi.fn(async () => ({ status: "ok" as const, summary: "ok" }));
        const scheduledState = createCronServiceState({
          storePath,
          cronEnabled: true,
          log: logger,
          nowMs: () => now,
          enqueueSystemEvent: vi.fn(),
          requestHeartbeat: vi.fn(),
          runIsolatedAgentJob: scheduledRunner,
          // Backoff window = lastRunAtMs + 300000 = now + 299000, still open at now.
          cronConfig: { retry: { backoffMs: [300_000] } },
        });
        await onTimer(scheduledState);
        scheduledRunnerCalls = scheduledRunner.mock.calls.length;
      });
    } finally {
      resetTaskRegistryForTests();
    }

    // An absent lastRunWasManual field defaults to scheduled (pre-fix
    // behavior): the error backoff window suppresses the past-due slot, so the
    // scheduled runner does not fire before the window elapses.
    expect(scheduledRunnerCalls).toBe(0);
  });
});
