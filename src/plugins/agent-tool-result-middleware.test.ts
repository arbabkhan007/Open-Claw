// Covers plugin middleware that can transform agent tool results.
import { afterEach, describe, expect, it } from "vitest";
import type { AgentToolResultMiddleware } from "./agent-tool-result-middleware-types.js";
import {
  getAgentToolResultMiddlewareMatcherScope,
  normalizeAgentToolResultMiddlewareRuntimes,
} from "./agent-tool-result-middleware.js";
import { createEmptyPluginRegistry } from "./registry-empty.js";
import type { PluginAgentToolResultMiddlewareRegistration } from "./registry-types.js";
import { setActivePluginRegistry } from "./runtime.js";

describe("normalizeAgentToolResultMiddlewareRuntimes", () => {
  it("defaults omitted runtimes to every supported runtime", () => {
    expect(normalizeAgentToolResultMiddlewareRuntimes()).toEqual(["openclaw", "codex"]);
  });

  it("preserves an explicit empty runtime list", () => {
    expect(normalizeAgentToolResultMiddlewareRuntimes({ runtimes: [] })).toEqual([]);
  });

  it("normalizes legacy harness names", () => {
    expect(
      normalizeAgentToolResultMiddlewareRuntimes({ harnesses: ["codex-app-server", "openclaw"] }),
    ).toEqual(["codex", "openclaw"]);
  });

  it("falls back to legacy harnesses when runtimes is undefined", () => {
    expect(
      normalizeAgentToolResultMiddlewareRuntimes({
        runtimes: undefined,
        harnesses: ["codex-app-server"],
      }),
    ).toEqual(["codex"]);
  });
});

describe("getAgentToolResultMiddlewareMatcherScope", () => {
  afterEach(() => {
    setActivePluginRegistry(createEmptyPluginRegistry());
  });

  function middlewareEntry(
    overrides: Partial<PluginAgentToolResultMiddlewareRegistration>,
  ): PluginAgentToolResultMiddlewareRegistration {
    const handler: AgentToolResultMiddleware = () => undefined;
    return {
      pluginId: "test-plugin",
      rawHandler: handler,
      handler,
      runtimes: ["codex"],
      source: "test",
      ...overrides,
    };
  }

  it("unions scoped middleware matchers for the requested runtime", () => {
    const registry = createEmptyPluginRegistry();
    registry.agentToolResultMiddlewares.push(
      middlewareEntry({ matcher: ["message"] }),
      middlewareEntry({ matcher: ["Bash"] }),
      middlewareEntry({ runtimes: ["openclaw"], matcher: undefined }),
    );
    setActivePluginRegistry(registry);
    expect(getAgentToolResultMiddlewareMatcherScope("codex")).toEqual({
      matchAll: false,
      toolNames: ["Bash", "exec", "message"],
    });
  });

  it("forces match-all when any middleware for the runtime is unscoped", () => {
    const registry = createEmptyPluginRegistry();
    registry.agentToolResultMiddlewares.push(
      middlewareEntry({ matcher: ["message"] }),
      middlewareEntry({}),
    );
    setActivePluginRegistry(registry);
    expect(getAgentToolResultMiddlewareMatcherScope("codex")).toEqual({ matchAll: true });
  });

  it("returns an empty scope with no active registry", () => {
    expect(getAgentToolResultMiddlewareMatcherScope("codex")).toEqual({
      matchAll: false,
      toolNames: [],
    });
  });
});
