import { describe, expect, it } from "vitest";
import { createHookRunner } from "./hooks.js";
import { TEST_PLUGIN_AGENT_CTX } from "./hooks.test-fixtures.js";
import { createEmptyPluginRegistry, type PluginRegistry } from "./registry.js";
import { createPluginRecord } from "./status.test-helpers.js";
import type { PluginHookRegistration } from "./types.js";

function addMemoryPlugin(
  registry: PluginRegistry,
  pluginId: string,
  selections: NonNullable<ReturnType<typeof createPluginRecord>["memoryRoleSelections"]>,
) {
  registry.plugins.push(
    createPluginRecord({
      id: pluginId,
      kind: "memory",
      memoryRoleSelections: selections,
      memoryRolesSelected: Array.from(
        new Set(
          selections.filter((selection) => !selection.disabled).map((selection) => selection.role),
        ),
      ),
    }),
  );
}

function addHook(params: {
  registry: PluginRegistry;
  pluginId: string;
  hookName: PluginHookRegistration["hookName"];
  handler: PluginHookRegistration["handler"];
  memoryRole: NonNullable<PluginHookRegistration["memoryRole"]>;
}) {
  params.registry.typedHooks.push({
    pluginId: params.pluginId,
    hookName: params.hookName,
    handler: params.handler,
    memoryRole: params.memoryRole,
    source: "test",
  } as PluginHookRegistration);
}

describe("memory-role hook enforcement", () => {
  it("does not run recall hooks for a plugin selected only for capture", async () => {
    const registry = createEmptyPluginRegistry();
    addMemoryPlugin(registry, "memory-capture", [
      { role: "capture", slotKey: "memory.capture", pluginId: "memory-capture" },
    ]);
    const calls: string[] = [];
    addHook({
      registry,
      pluginId: "memory-capture",
      hookName: "before_prompt_build",
      memoryRole: "recall",
      handler: () => {
        calls.push("recall");
        return { prependContext: "memory" };
      },
    });

    const result = await createHookRunner(registry).runBeforePromptBuild(
      { prompt: "remember this", messages: [] },
      TEST_PLUGIN_AGENT_CTX,
    );

    expect(calls).toEqual([]);
    expect(result).toBeUndefined();
  });

  it("runs agent-scoped capture hooks only for the selected owner scope", async () => {
    const registry = createEmptyPluginRegistry();
    addMemoryPlugin(registry, "global-capture", [
      { role: "capture", slotKey: "memory.capture", pluginId: "global-capture" },
    ]);
    addMemoryPlugin(registry, "agent-capture", [
      {
        role: "capture",
        slotKey: "memory.capture",
        pluginId: "agent-capture",
        agentId: "agent-a",
      },
    ]);
    const calls: string[] = [];
    for (const pluginId of ["global-capture", "agent-capture"]) {
      addHook({
        registry,
        pluginId,
        hookName: "agent_end",
        memoryRole: "capture",
        handler: () => {
          calls.push(pluginId);
        },
      });
    }

    const runner = createHookRunner(registry);
    await runner.runAgentEnd(
      { messages: [], success: true },
      { ...TEST_PLUGIN_AGENT_CTX, agentId: "agent-a" },
    );
    await runner.runAgentEnd(
      { messages: [], success: true },
      { ...TEST_PLUGIN_AGENT_CTX, agentId: "agent-b" },
    );

    expect(calls).toEqual(["agent-capture", "global-capture"]);
  });

  it("honors an explicit per-agent none for modifying recall hooks while preserving global fallback", async () => {
    const registry = createEmptyPluginRegistry();
    addMemoryPlugin(registry, "memory-core", [
      { role: "recall", slotKey: "memory.recall", pluginId: "memory-core" },
      {
        role: "recall",
        slotKey: "memory.recall",
        pluginId: "none",
        agentId: "agent-a",
        disabled: true,
      },
    ]);
    const calls: string[] = [];
    addHook({
      registry,
      pluginId: "memory-core",
      hookName: "before_prompt_build",
      memoryRole: "recall",
      handler: () => {
        calls.push("recall");
        return { prependContext: "memory" };
      },
    });

    const runner = createHookRunner(registry);
    const disabledResult = await runner.runBeforePromptBuild(
      { prompt: "remember this", messages: [] },
      { ...TEST_PLUGIN_AGENT_CTX, agentId: "agent-a" },
    );
    const globalResult = await runner.runBeforePromptBuild(
      { prompt: "remember this", messages: [] },
      { ...TEST_PLUGIN_AGENT_CTX, agentId: "agent-b" },
    );

    expect(disabledResult).toBeUndefined();
    expect(globalResult).toEqual({ prependContext: "memory" });
    expect(calls).toEqual(["recall"]);
  });

  it("honors an explicit per-agent none for void capture hooks while preserving global fallback", async () => {
    const registry = createEmptyPluginRegistry();
    addMemoryPlugin(registry, "memory-core", [
      { role: "capture", slotKey: "memory.capture", pluginId: "memory-core" },
      {
        role: "capture",
        slotKey: "memory.capture",
        pluginId: "none",
        agentId: "agent-a",
        disabled: true,
      },
    ]);
    const calls: string[] = [];
    addHook({
      registry,
      pluginId: "memory-core",
      hookName: "agent_end",
      memoryRole: "capture",
      handler: () => {
        calls.push("capture");
      },
    });

    const runner = createHookRunner(registry);
    await runner.runAgentEnd(
      { messages: [], success: true },
      { ...TEST_PLUGIN_AGENT_CTX, agentId: "agent-a" },
    );
    await runner.runAgentEnd(
      { messages: [], success: true },
      { ...TEST_PLUGIN_AGENT_CTX, agentId: "agent-b" },
    );

    expect(calls).toEqual(["capture"]);
  });
});
