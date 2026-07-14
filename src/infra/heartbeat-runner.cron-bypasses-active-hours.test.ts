// Regression test for #105413: explicit cron wakes must bypass the heartbeat
// active-hours gate so that main/systemEvent cron jobs scheduled outside
// activeHours still run their payload (they were previously silently skipped
// as "quiet-hours"). Ordinary scheduled heartbeats keep the active-hours gate.
import { describe, expect, it } from "vitest";
import type { OpenClawConfig } from "../config/config.js";
import { runHeartbeatOnce } from "./heartbeat-runner.js";
import { resetSystemEventsForTest } from "./system-events.js";

function makeCfg(): OpenClawConfig {
  return {
    agents: {
      defaults: {
        userTimezone: "UTC",
        heartbeat: {
          every: "30m",
          activeHours: { start: "08:00", end: "24:00", timezone: "user" },
        },
      },
    },
  };
}

// 07:00 UTC — outside the 08:00–24:00 activeHours window.
const OUTSIDE_HOURS_MS = Date.UTC(2025, 0, 1, 7, 0, 0);

describe("heartbeat-runner active-hours gate for cron wakes (#105413)", () => {
  it("ordinary scheduled heartbeats are still skipped outside active hours", async () => {
    resetSystemEventsForTest();
    const res = await runHeartbeatOnce({
      cfg: makeCfg(),
      deps: { nowMs: () => OUTSIDE_HOURS_MS },
    });
    expect(res.status).toBe("skipped");
    if (res.status === "skipped") {
      expect(res.reason).toBe("quiet-hours");
    }
  });

  it("explicit cron wake bypasses quiet-hours (source=cron)", async () => {
    resetSystemEventsForTest();
    const res = await runHeartbeatOnce({
      cfg: makeCfg(),
      source: "cron",
      intent: "immediate",
      reason: "cron:test-job",
      heartbeat: { target: "last" },
      deps: { nowMs: () => OUTSIDE_HOURS_MS },
    });
    // The run may still be skipped for reasons unrelated to the active-hours
    // gate (e.g. no session store, no delivery target), but the reason MUST
    // NOT be "quiet-hours" — that's the regression we're guarding against.
    if (res.status === "skipped") {
      expect(res.reason).not.toBe("quiet-hours");
    }
  });

  it("explicit cron wake bypasses quiet-hours when only reason is set (inferred source)", async () => {
    resetSystemEventsForTest();
    const res = await runHeartbeatOnce({
      cfg: makeCfg(),
      reason: "cron:test-job-inferred",
      heartbeat: { target: "last" },
      deps: { nowMs: () => OUTSIDE_HOURS_MS },
    });
    if (res.status === "skipped") {
      expect(res.reason).not.toBe("quiet-hours");
    }
  });
});
