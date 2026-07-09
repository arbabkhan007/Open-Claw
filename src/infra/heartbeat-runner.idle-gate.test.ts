import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { OpenClawConfig } from "../config/config.js";
import { resolveMainSessionKey } from "../config/sessions/main-session.js";
import { runHeartbeatOnce } from "./heartbeat-runner.js";

const MS_7_DAYS = 7 * 24 * 60 * 60 * 1000;

function testConfig(storePath: string, workspaceDir: string): OpenClawConfig {
  return {
    agents: {
      defaults: {
        workspace: workspaceDir,
        heartbeat: { every: "30m", target: "none" },
      },
      list: [{ id: "main" }],
    },
    session: { store: storePath },
  };
}

async function writeHeartbeatFile(workspaceDir: string) {
  await fs.mkdir(workspaceDir, { recursive: true });
  await fs.writeFile(path.join(workspaceDir, "HEARTBEAT.md"), "# Heartbeat\nActive content.");
}

async function writeSessionStore(
  storePath: string,
  sessionKey: string,
  overrides: { lastInteractionAt?: number; sessionStartedAt?: number },
) {
  await fs.writeFile(
    storePath,
    JSON.stringify({
      [sessionKey]: {
        sessionId: "test-sid",
        updatedAt: Date.now(),
        ...overrides,
      },
    }),
  );
}

describe("heartbeat idle gate", () => {
  let tmpDir: string;
  const now = 1_000_000_000_000;

  beforeAll(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "heartbeat-idle-gate-"));
  });

  afterAll(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("allows scheduled heartbeat when session is active", async () => {
    const storePath = path.join(tmpDir, "active-session.json");
    const workspaceDir = path.join(tmpDir, "ws-active");
    const cfg = testConfig(storePath, workspaceDir);
    const sessionKey = resolveMainSessionKey(cfg);
    await writeHeartbeatFile(workspaceDir);
    await writeSessionStore(storePath, sessionKey, { lastInteractionAt: now - 60_000 });

    const res = await runHeartbeatOnce({
      cfg,
      intent: "scheduled",
      deps: { nowMs: () => now },
    });

    // Active session: heartbeat should NOT be skipped by idle gate
    expect(res).not.toEqual({ status: "skipped", reason: "session-idle" });
  });

  it("skips scheduled heartbeat when session idle > 7 days", async () => {
    const storePath = path.join(tmpDir, "idle-session.json");
    const workspaceDir = path.join(tmpDir, "ws-idle");
    const cfg = testConfig(storePath, workspaceDir);
    const sessionKey = resolveMainSessionKey(cfg);
    await writeHeartbeatFile(workspaceDir);
    await writeSessionStore(storePath, sessionKey, {
      lastInteractionAt: now - MS_7_DAYS - 60_000, // 7 days + 1 minute ago
    });

    const res = await runHeartbeatOnce({
      cfg,
      intent: "scheduled",
    });

    expect(res.status).toBe("skipped");
    if (res.status === "skipped") {
      expect(res.reason).toBe("session-idle");
    }
  });

  it("does not skip event-wake heartbeat on idle session", async () => {
    const storePath = path.join(tmpDir, "idle-event.json");
    const workspaceDir = path.join(tmpDir, "ws-event");
    const cfg = testConfig(storePath, workspaceDir);
    const sessionKey = resolveMainSessionKey(cfg);
    await writeHeartbeatFile(workspaceDir);
    await writeSessionStore(storePath, sessionKey, {
      lastInteractionAt: now - MS_7_DAYS - 60_000,
    });

    const res = await runHeartbeatOnce({
      cfg,
      intent: "event",
    });

    // Event wakes are not gated — should NOT be session-idle
    expect(res).not.toEqual({ status: "skipped", reason: "session-idle" });
  });

  it("does not skip immediate wake on idle session", async () => {
    const storePath = path.join(tmpDir, "idle-immediate.json");
    const workspaceDir = path.join(tmpDir, "ws-immediate");
    const cfg = testConfig(storePath, workspaceDir);
    const sessionKey = resolveMainSessionKey(cfg);
    await writeHeartbeatFile(workspaceDir);
    await writeSessionStore(storePath, sessionKey, {
      lastInteractionAt: now - MS_7_DAYS - 60_000,
    });

    const res = await runHeartbeatOnce({
      cfg,
      intent: "immediate",
    });

    expect(res).not.toEqual({ status: "skipped", reason: "session-idle" });
  });

  it("does not skip manual wake on idle session", async () => {
    const storePath = path.join(tmpDir, "idle-manual.json");
    const workspaceDir = path.join(tmpDir, "ws-manual");
    const cfg = testConfig(storePath, workspaceDir);
    const sessionKey = resolveMainSessionKey(cfg);
    await writeHeartbeatFile(workspaceDir);
    await writeSessionStore(storePath, sessionKey, {
      lastInteractionAt: now - MS_7_DAYS - 60_000,
    });

    const res = await runHeartbeatOnce({
      cfg,
      intent: "manual",
    });

    expect(res).not.toEqual({ status: "skipped", reason: "session-idle" });
  });

  it("falls back to sessionStartedAt when lastInteractionAt is missing", async () => {
    const storePath = path.join(tmpDir, "fallback-started.json");
    const workspaceDir = path.join(tmpDir, "ws-fallback");
    const cfg = testConfig(storePath, workspaceDir);
    const sessionKey = resolveMainSessionKey(cfg);
    await writeHeartbeatFile(workspaceDir);
    await writeSessionStore(storePath, sessionKey, {
      sessionStartedAt: now - MS_7_DAYS - 60_000,
    });

    const res = await runHeartbeatOnce({
      cfg,
      intent: "scheduled",
    });

    expect(res.status).toBe("skipped");
    if (res.status === "skipped") {
      expect(res.reason).toBe("session-idle");
    }
  });

  it("allows scheduled heartbeat when no session entry exists", async () => {
    const storePath = path.join(tmpDir, "no-entry.json");
    const workspaceDir = path.join(tmpDir, "ws-noentry");
    const cfg = testConfig(storePath, workspaceDir);
    await writeHeartbeatFile(workspaceDir);

    const res = await runHeartbeatOnce({
      cfg,
      intent: "scheduled",
    });

    // Without a session entry we cannot determine staleness
    expect(res).not.toEqual({ status: "skipped", reason: "session-idle" });
  });

  it("allows scheduled heartbeat exactly at threshold boundary", async () => {
    const storePath = path.join(tmpDir, "boundary.json");
    const workspaceDir = path.join(tmpDir, "ws-boundary");
    const cfg = testConfig(storePath, workspaceDir);
    const sessionKey = resolveMainSessionKey(cfg);
    await writeHeartbeatFile(workspaceDir);
    // Exactly 7 days ago — should NOT be skipped (> threshold, not >=)
    await writeSessionStore(storePath, sessionKey, {
      lastInteractionAt: now - MS_7_DAYS,
    });

    const res = await runHeartbeatOnce({
      cfg,
      intent: "scheduled",
      deps: { nowMs: () => now },
    });

    // Exactly 7 days ago — should NOT be skipped (> threshold, not >=)
    expect(res).not.toEqual({ status: "skipped", reason: "session-idle" });
  });
});
