import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  notifyToolActivity: vi.fn(),
  runToolLifecycle: vi.fn(),
  setActiveEmbeddedRun: vi.fn(),
  subscribeEmbeddedAgentSession: vi.fn(),
}));

vi.mock("../../embedded-agent-subscribe.js", () => ({
  subscribeEmbeddedAgentSession: mocks.subscribeEmbeddedAgentSession,
}));
vi.mock("../runs.js", () => ({
  clearActiveEmbeddedRun: vi.fn(),
  setActiveEmbeddedRun: mocks.setActiveEmbeddedRun,
}));
vi.mock("./tool-activity-heartbeat.js", () => ({
  notifyToolActivity: mocks.notifyToolActivity,
}));

import { prepareEmbeddedAttemptStream } from "./attempt-stream-prepare.js";

describe("prepareEmbeddedAttemptStream", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.runToolLifecycle.mockImplementation(
      async (params: { execute: () => Promise<unknown> }) => await params.execute(),
    );
    mocks.subscribeEmbeddedAgentSession.mockReturnValue({
      isCompacting: () => false,
      runToolLifecycle: mocks.runToolLifecycle,
      toolMetas: [],
    });
  });

  it("preserves yield control for cataloged plugin tools", async () => {
    const prepared = prepareEmbeddedAttemptStream({
      attempt: {
        config: {},
        modelId: "mock-model",
        provider: "mock-provider",
        runId: "run-catalog-yield",
        sessionId: "session-catalog-yield",
      },
      activeSession: {
        agent: {},
        isCompacting: false,
        isStreaming: false,
        messages: [],
      },
      abortRun: vi.fn(),
      builtinToolNames: new Set(),
      clientToolCallSlots: [],
      diagnosticTrace: {},
      getRunState: () => ({
        aborted: false,
        promptError: null,
        timedOut: false,
        yieldDetected: false,
      }),
      hasDeliveredSourceReply: () => false,
      hookAgentId: "main",
      hookRunner: { hasHooks: () => false },
      isReplaySafeTool: () => false,
      markExternalAbort: vi.fn(),
      markSourceReplyDelivered: vi.fn(),
      replaySafeToolNames: new Set(),
      runAbortController: new AbortController(),
      sandboxSessionKey: "agent:main:main",
      toolSearchTargetTranscriptProjections: [],
    } as never);
    const tool = {
      name: "proof_ask_user",
      label: "Proof Ask User",
      description: "Ask a question and yield.",
      parameters: { type: "object", properties: {} },
      execute: vi.fn(async () => ({
        content: [{ type: "text" as const, text: "Question sent." }],
        details: { status: "pending" },
        control: { type: "yield" as const, message: "Waiting for answer" },
      })),
    };

    const result = await prepared.toolSearchCatalogExecutor({
      tool,
      toolName: tool.name,
      source: "openclaw",
      sourceName: "yield-proof",
      toolCallId: "catalog-call-1",
      input: {},
    });

    expect(result.control).toEqual({ type: "yield", message: "Waiting for answer" });
  });
});
