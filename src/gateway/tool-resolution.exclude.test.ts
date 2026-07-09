/**
 * Gateway tool-resolution exclusion tests.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { OpenClawConfig } from "../config/types.openclaw.js";

type CreateOpenClawToolsArg = {
  cronCreatorToolAllowlist?: Array<string | { name: string; pluginId?: string }>;
  inheritedToolAllowlist?: string[];
  inheritedToolDenylist?: string[];
  pluginToolAllowlist?: string[];
  pluginToolDenylist?: string[];
};

const hoisted = vi.hoisted(() => {
  function makeTool(name: string) {
    return {
      name,
      description: `${name} tool`,
      parameters: { type: "object", properties: {} },
      execute: vi.fn(),
    };
  }
  return {
    makeTool,
    createOpenClawToolsMock: vi.fn((_args: CreateOpenClawToolsArg) => [
      makeTool("read"),
      makeTool("sessions_spawn"),
      makeTool("cron"),
      makeTool("gateway"),
      makeTool("nodes"),
    ]),
  };
});

vi.mock("../agents/openclaw-tools.js", () => ({
  createOpenClawTools: (args: CreateOpenClawToolsArg) => hoisted.createOpenClawToolsMock(args),
}));

import { resolveGatewayScopedTools } from "./tool-resolution.js";

describe("resolveGatewayScopedTools excludeToolNames", () => {
  beforeEach(() => {
    hoisted.createOpenClawToolsMock.mockClear();
  });

  function readCreateToolsArgs(index = 0): {
    cronCreatorToolAllowlist?: Array<string | { name: string; pluginId?: string }>;
    inheritedToolAllowlist?: string[];
    inheritedToolDenylist?: string[];
    pluginToolAllowlist?: string[];
    pluginToolDenylist?: string[];
  } {
    const args = hoisted.createOpenClawToolsMock.mock.calls[index]?.[0];
    if (!args || typeof args !== "object") {
      throw new Error("expected createOpenClawTools args");
    }
    return args as {
      cronCreatorToolAllowlist?: Array<string | { name: string; pluginId?: string }>;
      inheritedToolAllowlist?: string[];
      inheritedToolDenylist?: string[];
      pluginToolAllowlist?: string[];
      pluginToolDenylist?: string[];
    };
  }

  it("filters loopback dedup exclusions without inheriting policy denies", () => {
    const result = resolveGatewayScopedTools({
      cfg: {} as OpenClawConfig,
      sessionKey: "agent:main:direct:test",
      surface: "loopback",
      excludeToolNames: ["read", "apply_patch"],
    });

    expect(result.tools.map((tool) => tool.name)).toEqual([
      "sessions_spawn",
      "cron",
      "gateway",
      "nodes",
    ]);
    const args = readCreateToolsArgs();
    expect(args.pluginToolDenylist).toEqual([]);
    expect(args.inheritedToolDenylist).toEqual([]);
  });

  it("keeps owner-only core tools visible only for owner loopback callers", () => {
    const ownerResult = resolveGatewayScopedTools({
      cfg: {
        gateway: { tools: { allow: ["gateway"] } },
      } as OpenClawConfig,
      sessionKey: "agent:main:direct:test",
      surface: "loopback",
      senderIsOwner: true,
    });
    const nonOwnerResult = resolveGatewayScopedTools({
      cfg: {
        gateway: { tools: { allow: ["gateway"] } },
      } as OpenClawConfig,
      sessionKey: "agent:main:direct:test",
      surface: "loopback",
      senderIsOwner: false,
    });

    expect(ownerResult.tools.map((tool) => tool.name)).toEqual([
      "read",
      "sessions_spawn",
      "cron",
      "gateway",
      "nodes",
    ]);
    expect(nonOwnerResult.tools.map((tool) => tool.name)).toEqual(["read", "sessions_spawn"]);
    const args = readCreateToolsArgs(1);
    expect(args.pluginToolDenylist).toEqual(["cron", "gateway", "nodes"]);
    expect(args.inheritedToolDenylist).toEqual(["cron", "gateway", "nodes"]);
  });

  it("keeps real gateway deny policy inheritable while excluding native dedup tools", () => {
    resolveGatewayScopedTools({
      cfg: {
        gateway: { tools: { deny: ["exec"] } },
      } as OpenClawConfig,
      sessionKey: "agent:main:direct:test",
      surface: "loopback",
      excludeToolNames: ["read", "apply_patch"],
    });

    const args = readCreateToolsArgs();
    expect(args.pluginToolDenylist).toEqual(["exec"]);
    expect(args.inheritedToolDenylist).toEqual(["exec"]);
  });

  it("passes final filtered tool surface to gateway cron jobs", () => {
    hoisted.createOpenClawToolsMock.mockReturnValueOnce([
      hoisted.makeTool("read"),
      hoisted.makeTool("cron"),
      hoisted.makeTool("exec"),
    ]);

    const result = resolveGatewayScopedTools({
      cfg: {
        tools: { allow: ["read", "cron"] },
      } as OpenClawConfig,
      sessionKey: "agent:main:direct:test",
      surface: "loopback",
    });

    expect(result.tools.map((tool) => tool.name)).toEqual(["read", "cron"]);
    expect(readCreateToolsArgs().cronCreatorToolAllowlist).toEqual([
      { name: "read" },
      { name: "cron" },
    ]);
  });

  it("preserves runtime materialization allow tokens for spawned subagents", () => {
    resolveGatewayScopedTools({
      cfg: {
        tools: {
          subagents: {
            tools: {
              allow: [
                "read",
                "sessions_spawn",
                "bundle-mcp",
                "probe__search",
                "lsp_hover_typescript",
                "custom_plugin_tool",
              ],
            },
          },
        },
      } as OpenClawConfig,
      sessionKey: "agent:main:subagent:worker",
      surface: "loopback",
    });

    const args = readCreateToolsArgs();
    // Deferred selectors (bundle-mcp/probe__search/lsp_*) survive into the child
    // allowlist even though they are not concrete tools; a plain unknown token
    // (custom_plugin_tool) does not.
    expect(args.pluginToolAllowlist).toEqual([
      "read",
      "sessions_spawn",
      "bundle-mcp",
      "probe__search",
      "lsp_hover_typescript",
      "custom_plugin_tool",
    ]);
    expect(args.inheritedToolAllowlist).toEqual([
      "read",
      "sessions_spawn",
      "bundle-mcp",
      "probe__search",
      "lsp_hover_typescript",
    ]);
  });

  it("does not restore broad runtime selectors removed by a narrower subagent policy", () => {
    resolveGatewayScopedTools({
      cfg: {
        tools: {
          profile: "coding",
          subagents: {
            tools: {
              allow: ["read", "sessions_spawn", "probe__search"],
            },
          },
        },
      } as OpenClawConfig,
      sessionKey: "agent:main:subagent:worker",
      surface: "loopback",
    });

    const args = readCreateToolsArgs();
    // bundle-mcp is allowed by the coding profile but denied by the narrower
    // subagent allow, so it must not leak into the child; probe__search does.
    expect(args.pluginToolAllowlist).toContain("bundle-mcp");
    expect(args.pluginToolAllowlist).toContain("probe__search");
    expect(args.inheritedToolAllowlist).toEqual(["read", "sessions_spawn", "probe__search"]);
  });
});
