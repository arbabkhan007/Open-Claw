import { describe, expect, it } from "vitest";

function getTestApi() {
  const api = (globalThis as Record<PropertyKey, unknown>)[
    Symbol.for("openclaw.executeNodeClaudeTestApi")
  ] as
    | {
        testing: {
          parseNodeClaudeResultPayload: (result: {
            payload?: unknown;
            payloadJSON?: string | null;
          }) => {
            exitCode: number;
            stderrTail: string;
            truncated: boolean;
            timeoutKind?: "hard" | "idle";
          };
          parseNodeClaudeApprovalRequired: (result: {
            ok: boolean;
            payload?: unknown;
            payloadJSON?: string | null;
          }) => {
            systemRunPlan: { commandText: string; argv: string[]; cwd?: string };
            security: "deny" | "allowlist" | "full";
            ask: "off" | "on-miss" | "always";
          } | null;
        };
      }
    | undefined;
  if (!api) {
    throw new Error("Test API not found — did the module initialize?");
  }
  return api.testing;
}

describe("parseNodeClaudeResultPayload", () => {
  it("parses a valid payloadJSON string", async () => {
    await import("./execute-node-claude.js");
    const { parseNodeClaudeResultPayload } = getTestApi();

    const result = parseNodeClaudeResultPayload({
      payloadJSON: JSON.stringify({
        exitCode: 0,
        stderrTail: "",
        truncated: false,
      }),
    });

    expect(result).toEqual({
      exitCode: 0,
      stderrTail: "",
      truncated: false,
    });
  });

  it("parses a valid payloadJSON with timeoutKind", async () => {
    await import("./execute-node-claude.js");
    const { parseNodeClaudeResultPayload } = getTestApi();

    const result = parseNodeClaudeResultPayload({
      payloadJSON: JSON.stringify({
        exitCode: 0,
        stderrTail: "some error",
        truncated: true,
        timeoutKind: "hard",
      }),
    });

    expect(result).toEqual({
      exitCode: 0,
      stderrTail: "some error",
      truncated: true,
      timeoutKind: "hard",
    });
  });

  it("throws a descriptive error when payloadJSON is malformed", async () => {
    await import("./execute-node-claude.js");
    const { parseNodeClaudeResultPayload } = getTestApi();

    expect(() =>
      parseNodeClaudeResultPayload({
        payloadJSON: "not-valid-json{{{",
      }),
    ).toThrow("paired node returned malformed JSON in Claude CLI result");
  });

  it("throws on invalid shape when payloadJSON parses to non-object", async () => {
    await import("./execute-node-claude.js");
    const { parseNodeClaudeResultPayload } = getTestApi();

    expect(() =>
      parseNodeClaudeResultPayload({
        payloadJSON: JSON.stringify("just a string"),
      }),
    ).toThrow("paired node returned an invalid Claude CLI result");
  });

  it("falls back to result.payload when payloadJSON is absent", async () => {
    await import("./execute-node-claude.js");
    const { parseNodeClaudeResultPayload } = getTestApi();

    const result = parseNodeClaudeResultPayload({
      payload: {
        exitCode: 1,
        stderrTail: "err",
        truncated: false,
      },
    });

    expect(result.exitCode).toBe(1);
    expect(result.stderrTail).toBe("err");
    expect(result.truncated).toBe(false);
  });
});

describe("parseNodeClaudeApprovalRequired", () => {
  it("parses valid approval payloadJSON", async () => {
    await import("./execute-node-claude.js");
    const { parseNodeClaudeApprovalRequired } = getTestApi();

    const result = parseNodeClaudeApprovalRequired({
      ok: true,
      payloadJSON: JSON.stringify({
        approvalRequired: true,
        systemRunPlan: { commandText: "npm test", argv: ["npm", "test"], cwd: "/tmp" },
        security: "full",
        ask: "always",
      }),
    });

    expect(result).not.toBeNull();
    expect(result!.security).toBe("full");
    expect(result!.ask).toBe("always");
    expect(result!.systemRunPlan.commandText).toBe("npm test");
  });

  it("returns null when payloadJSON is malformed", async () => {
    await import("./execute-node-claude.js");
    const { parseNodeClaudeApprovalRequired } = getTestApi();

    const result = parseNodeClaudeApprovalRequired({
      ok: true,
      payloadJSON: "<<<broken-json>>>",
    });

    expect(result).toBeNull();
  });

  it("returns null when result.ok is false regardless of payload", async () => {
    await import("./execute-node-claude.js");
    const { parseNodeClaudeApprovalRequired } = getTestApi();

    const result = parseNodeClaudeApprovalRequired({
      ok: false,
      payloadJSON: JSON.stringify({
        approvalRequired: true,
        systemRunPlan: { commandText: "x", argv: ["x"] },
        security: "full",
        ask: "always",
      }),
    });

    expect(result).toBeNull();
  });

  it("returns null when payloadJSON parses to non-object", async () => {
    await import("./execute-node-claude.js");
    const { parseNodeClaudeApprovalRequired } = getTestApi();

    const result = parseNodeClaudeApprovalRequired({
      ok: true,
      payloadJSON: JSON.stringify(42),
    });

    expect(result).toBeNull();
  });
});
