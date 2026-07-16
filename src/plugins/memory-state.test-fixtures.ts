/** Test-only compatibility fixtures for plugin memory state. */
import {
  registerMemoryFlushPlanResolverForPlugin,
  registerMemoryPromptSectionForPlugin,
  registerMemoryRuntimeForPlugin,
  type MemoryFlushPlanResolver,
  type MemoryPluginRuntime,
  type MemoryPromptSectionBuilder,
} from "./memory-state.js";

export * from "./memory-state.js";

const TEST_MEMORY_PLUGIN_ID = "memory-core";

export function registerMemoryPromptSection(builder: MemoryPromptSectionBuilder): void {
  registerMemoryPromptSectionForPlugin(TEST_MEMORY_PLUGIN_ID, builder);
}

export function registerMemoryFlushPlanResolver(resolver: MemoryFlushPlanResolver): void {
  registerMemoryFlushPlanResolverForPlugin(TEST_MEMORY_PLUGIN_ID, resolver);
}

export function registerMemoryRuntime(runtime: MemoryPluginRuntime): void {
  registerMemoryRuntimeForPlugin(TEST_MEMORY_PLUGIN_ID, runtime);
}
