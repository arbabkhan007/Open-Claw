import { beforeEach, describe, expect, it, vi } from "vitest";
import { createGatewayTool } from "./gateway-tool.js";

const { callGatewayToolMock } = vi.hoisted(() => ({
  callGatewayToolMock: vi.fn(async () => ({ ok: true })),
}));

vi.mock("./gateway.js", () => ({
  callGatewayTool: callGatewayToolMock,
  readGatewayCallOptions: vi.fn(() => ({})),
}));

describe("gateway tool", () => {
  beforeEach(() => {
    callGatewayToolMock.mockClear();
  });

  it("exposes only read actions", () => {
    const tool = createGatewayTool();
    const parameters = tool.parameters as {
      properties?: { action?: { enum?: string[] } };
    };

    expect(parameters.properties?.action?.enum).toEqual(["config.get", "config.schema.lookup"]);
    expect(tool.description).toBe(
      "Read gateway config + schema. Writes/restart: use openclaw tool.",
    );
  });

  it.each(["restart", "config.apply", "config.patch", "update.run"])(
    "rejects removed action %s",
    async (action) => {
      const tool = createGatewayTool();

      await expect(tool.execute?.("tool-call", { action })).rejects.toThrow(
        `Unknown action: ${action}`,
      );
      expect(callGatewayToolMock).not.toHaveBeenCalled();
    },
  );

  it("forwards the abort signal to callGatewayTool for config.get", async () => {
    const tool = createGatewayTool();
    const controller = new AbortController();

    await tool.execute?.("tool-call", { action: "config.get" }, controller.signal);

    expect(callGatewayToolMock).toHaveBeenCalledWith(
      "config.get",
      expect.anything(),
      expect.anything(),
      { signal: controller.signal },
    );
  });

  it("forwards the abort signal to callGatewayTool for config.schema.lookup", async () => {
    const tool = createGatewayTool();
    const controller = new AbortController();

    await tool.execute?.(
      "tool-call",
      { action: "config.schema.lookup", path: "channels" },
      controller.signal,
    );

    expect(callGatewayToolMock).toHaveBeenCalledWith(
      "config.schema.lookup",
      expect.anything(),
      expect.anything(),
      { signal: controller.signal },
    );
  });
});
