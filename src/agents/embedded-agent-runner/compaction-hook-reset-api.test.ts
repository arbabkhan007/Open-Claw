// Verifies deferred after-compaction reset queue behavior.
import { describe, expect, it, vi } from "vitest";
import { createEmbeddedHookSessionResetQueue } from "./compaction-hook-reset-api.js";

const resetMocks = vi.hoisted(() => ({
  performGatewaySessionReset: vi.fn(async () => ({ ok: true })),
}));

vi.mock("../../gateway/session-reset-service.js", () => ({
  performGatewaySessionReset: resetMocks.performGatewaySessionReset,
}));

describe("createEmbeddedHookSessionResetQueue", () => {
  it("passes current-lifecycle assertions through deferred reset flushes", async () => {
    const assertCurrent = vi.fn();
    const onCommitted = vi.fn();
    const queue = createEmbeddedHookSessionResetQueue();

    queue.deferResetSession({
      key: "agent:main:session-1",
      agentId: "main",
      reason: "new",
      commandSource: "embedded-agent:hook",
      assertCurrent,
      onCommitted,
    });

    await queue.flush();

    expect(resetMocks.performGatewaySessionReset).toHaveBeenCalledWith({
      key: "agent:main:session-1",
      agentId: "main",
      reason: "new",
      commandSource: "embedded-agent:hook",
      assertCurrent,
      onCommitted,
    });
  });
});
