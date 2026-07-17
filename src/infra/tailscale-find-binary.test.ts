// Covers findTailscaleBinary bounded subprocess calls.
import { afterEach, describe, expect, it, vi } from "vitest";

const { runExecMock } = vi.hoisted(() => ({
  runExecMock: vi.fn(),
}));

vi.mock("../process/exec.js", () => ({ runExec: runExecMock }));

import { findTailscaleBinary } from "./tailscale.js";

afterEach(() => {
  vi.clearAllMocks();
});

describe("findTailscaleBinary probes", () => {
  it("bounds which and locate discovery calls with 5s timeout", async () => {
    runExecMock.mockRejectedValue(new Error("not found"));

    await findTailscaleBinary();

    const whichCall = runExecMock.mock.calls.find((c) => c[0] === "which");
    expect(whichCall).toBeDefined();
    expect(whichCall![2]).toMatchObject({ timeoutMs: 5000 });

    const locateCall = runExecMock.mock.calls.find((c) => c[0] === "locate");
    expect(locateCall).toBeDefined();
    expect(locateCall![2]).toMatchObject({ timeoutMs: 5000 });
  });
});
