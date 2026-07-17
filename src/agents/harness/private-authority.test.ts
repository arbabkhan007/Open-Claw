// Coverage for private lifecycle reset authority boundaries.
import { afterEach, describe, expect, it, vi } from "vitest";
import { createOpenClawAgentHarness } from "./builtin-openclaw.js";
import { harnessOwnsPrivateLifecycleResetAuthority } from "./private-authority.js";
import {
  clearAgentHarnesses,
  getRegisteredAgentHarness,
  registerAgentHarness,
} from "./registry.js";
import type { AgentHarness } from "./types.js";

function makeHarness(id: string): AgentHarness {
  return {
    id,
    label: id,
    supports: () => ({ supported: true }),
    runAttempt: vi.fn(),
  };
}

describe("harnessOwnsPrivateLifecycleResetAuthority", () => {
  afterEach(() => {
    clearAgentHarnesses();
  });

  it("accepts the branded built-in OpenClaw harness", () => {
    expect(harnessOwnsPrivateLifecycleResetAuthority(createOpenClawAgentHarness())).toBe(true);
  });

  it("rejects plugin harnesses that spoof the OpenClaw id", () => {
    const harness = makeHarness("openclaw");
    registerAgentHarness(harness, { ownerPluginId: "workspace-runtime" });

    expect(harnessOwnsPrivateLifecycleResetAuthority(harness)).toBe(false);
  });

  it("accepts only the bundled Copilot-owned registered harness object", () => {
    const harness = makeHarness("copilot");
    registerAgentHarness(harness, { ownerPluginId: "copilot" });
    const registeredHarness = getRegisteredAgentHarness("copilot")?.harness;

    expect(registeredHarness).toBeDefined();
    expect(harnessOwnsPrivateLifecycleResetAuthority(registeredHarness as AgentHarness)).toBe(true);
    expect(harnessOwnsPrivateLifecycleResetAuthority(harness)).toBe(false);
    expect(harnessOwnsPrivateLifecycleResetAuthority(makeHarness("copilot"))).toBe(false);
  });
});
