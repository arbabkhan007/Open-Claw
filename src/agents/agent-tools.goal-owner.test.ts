// Production-boundary coverage for durable goal ownership through agent tool assembly.
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { resolveStorePath } from "../config/sessions/paths.js";
import { loadSessionEntry, upsertSessionEntry } from "../config/sessions/session-accessor.js";
import type { SessionGoal } from "../config/sessions/types.js";
import type { OpenClawConfig } from "../config/types.openclaw.js";
import "./test-helpers/fast-bash-tools.js";
import "./test-helpers/fast-coding-tools.js";
import { createOpenClawCodingTools } from "./agent-tools.js";

const createLazyExecToolMock = vi.hoisted(() => vi.fn());

vi.mock("./lazy-exec-tool.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./lazy-exec-tool.js")>();
  return {
    ...actual,
    createLazyExecTool: (defaults: unknown) => {
      createLazyExecToolMock(defaults);
      return {
        name: "exec",
        description: "exec stub",
        parameters: { type: "object", properties: {} },
        execute: vi.fn(),
      };
    },
  };
});

function requireTool(tools: ReturnType<typeof createOpenClawCodingTools>, name: string) {
  const tool = tools.find((candidate) => candidate.name === name);
  if (!tool) {
    throw new Error(`expected ${name} tool`);
  }
  return tool;
}

describe("createOpenClawCodingTools goal ownership", () => {
  it("routes detached exec wakes to the durable owner without changing process scope", () => {
    const ownerSessionKey = "agent:main:channel:group:example:thread:25";
    const policySessionKey = "agent:main:runtime-policy";

    createOpenClawCodingTools({
      sessionKey: policySessionKey,
      goalOwnerSessionKey: ownerSessionKey,
      toolConstructionPlan: {
        includeBaseCodingTools: false,
        includeShellTools: true,
        includeChannelTools: false,
        includeOpenClawTools: false,
        includePluginTools: false,
      },
    });

    expect(createLazyExecToolMock).toHaveBeenCalledWith(
      expect.objectContaining({
        scopeKey: policySessionKey,
        sessionKey: policySessionKey,
        notifySessionKey: ownerSessionKey,
      }),
    );
  });

  it("reads and updates the durable owner goal across transient and policy sessions", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-agent-goal-owner-"));
    const storeTemplate = path.join(dir, "{agentId}", "sessions.json");
    const config = { session: { store: storeTemplate } } as OpenClawConfig;
    const ownerSessionKey = "agent:main:channel:group:example:thread:25";
    const policySessionKey = "agent:main:runtime-policy";
    const transientRunKey = "agent:main:main";
    const storePath = resolveStorePath(storeTemplate, { agentId: "main" });
    const goal: SessionGoal = {
      schemaVersion: 1,
      id: "goal-durable-owner",
      objective: "finish every phase",
      status: "active",
      createdAt: 1,
      updatedAt: 1,
      tokenStart: 0,
      tokenStartFresh: true,
      tokensUsed: 0,
      continuationTurns: 0,
    };
    await upsertSessionEntry(
      { storePath, sessionKey: ownerSessionKey },
      { sessionId: "owner-session", updatedAt: 1, goal },
    );
    await upsertSessionEntry(
      { storePath, sessionKey: policySessionKey },
      { sessionId: "policy-session", updatedAt: 2 },
    );
    await upsertSessionEntry(
      { storePath, sessionKey: transientRunKey },
      { sessionId: "wake-session", updatedAt: 3 },
    );

    const tools = createOpenClawCodingTools({
      config,
      sessionKey: policySessionKey,
      runSessionKey: transientRunKey,
      goalOwnerSessionKey: ownerSessionKey,
      toolConstructionPlan: {
        includeBaseCodingTools: false,
        includeShellTools: false,
        includeChannelTools: false,
        includeOpenClawTools: true,
        includePluginTools: false,
      },
    });

    const getResult = await requireTool(tools, "get_goal").execute("get-goal", {});
    expect((getResult.details as { goal?: SessionGoal }).goal?.id).toBe(goal.id);

    await requireTool(tools, "update_goal").execute("update-goal", { status: "complete" });
    expect(loadSessionEntry({ storePath, sessionKey: ownerSessionKey })?.goal?.status).toBe(
      "complete",
    );
    expect(loadSessionEntry({ storePath, sessionKey: policySessionKey })?.goal).toBeUndefined();
    expect(loadSessionEntry({ storePath, sessionKey: transientRunKey })?.goal).toBeUndefined();
  });
});
