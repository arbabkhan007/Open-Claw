import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { listBaselines } from "../baseline/capture.js";
import { resetConfigRuntimeState } from "../config/config.js";
import { listCachedProbes } from "../probes/cache.js";
import type { OutputRuntimeEnv } from "../runtime.js";
import { closeOpenClawStateDatabaseForTest } from "../state/openclaw-state-db.js";
import { diagnoseCommand } from "./diagnose.js";

vi.mock("../baseline/capture.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../baseline/capture.js")>();
  return {
    ...actual,
    captureBaseline: vi.fn(actual.captureBaseline),
  };
});

import { captureBaseline } from "../baseline/capture.js";

type DiagnoseTestPayload = {
  schemaVersion: string;
  ok: boolean;
  redaction: {
    secretsIncluded: boolean;
    rawConfigIncluded: boolean;
    rawEnvIncluded: boolean;
  };
  persistence: {
    writesBaseline: boolean;
    writesProbeCache: boolean;
    writesIncidentLedger: boolean;
  };
  status: {
    gateway: Record<string, unknown>;
    configuredAgents: number;
  };
  baselines: {
    latest: string;
    current: { timestamp: string };
  };
  actions: { unsafe: string[] };
  incidents: {
    open: number;
    recent: Array<{ type: string; source: string }>;
  };
};

async function runDiagnoseJson(timeoutMs: number): Promise<DiagnoseTestPayload> {
  let output: unknown;
  const runtime: OutputRuntimeEnv = {
    log: vi.fn(),
    error: vi.fn(),
    exit: (code) => {
      throw new Error(`unexpected exit ${code}`);
    },
    writeStdout: vi.fn(),
    writeJson: (value) => {
      output = value;
    },
  };
  await diagnoseCommand({ json: true, timeoutMs }, runtime);
  if (!output || typeof output !== "object") {
    throw new Error("diagnose did not write a JSON payload");
  }
  return output as DiagnoseTestPayload;
}

describe("diagnose command", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-diagnose-test-"));
    process.env.OPENCLAW_STATE_DIR = tempDir;
    resetConfigRuntimeState();
  });

  afterEach(() => {
    closeOpenClawStateDatabaseForTest();
    fs.rmSync(tempDir, { recursive: true, force: true });
    delete process.env.OPENCLAW_STATE_DIR;
    resetConfigRuntimeState();
    vi.mocked(captureBaseline).mockClear();
  });

  it("captures real baseline and probe evidence for the diagnose payload", async () => {
    const payload = await runDiagnoseJson(0);

    expect(payload.schemaVersion).toBe("openclaw-diagnose/v1");
    expect(payload.redaction).toEqual({
      secretsIncluded: false,
      rawConfigIncluded: false,
      rawEnvIncluded: false,
    });
    expect(payload.persistence).toEqual({
      writesBaseline: true,
      writesProbeCache: true,
      writesIncidentLedger: true,
    });
    expect(payload.baselines.latest).toBe("diagnose-latest");
    expect(payload.baselines.current.timestamp).toEqual(expect.any(String));
    expect(listBaselines()).toContain("diagnose-latest");
    expect(
      listCachedProbes().some((probe) => probe.type === "plugin" && probe.id === "contracts"),
    ).toBe(true);
  });

  it("keeps gateway auth and raw secret material out of the operator JSON contract", async () => {
    const payload = await runDiagnoseJson(0);
    const serializedGateway = JSON.stringify(payload.status.gateway);

    expect(payload.status.gateway).not.toHaveProperty("auth");
    expect(serializedGateway).not.toMatch(/token|password|api[_-]?key/i);
    expect(payload.actions.unsafe).toEqual(
      expect.arrayContaining([
        "openclaw doctor --fix",
        "openclaw gateway restart",
        "openclaw plugins update --all",
      ]),
    );
  });

  it("omits remote gateway URL userinfo and sensitive query params from diagnose JSON", async () => {
    const userInfo = ["fixture-user", "fixture-value"].join(":");
    const sensitiveParam = ["to", "ken"].join("");
    const sensitiveValue = "private-fixture-value";
    fs.writeFileSync(
      path.join(tempDir, "openclaw.json"),
      JSON.stringify({
        gateway: {
          mode: "remote",
          remote: {
            url: `ws://${userInfo}@example.test/ws?${sensitiveParam}=${sensitiveValue}&safe=visible`,
          },
        },
      }),
      "utf-8",
    );

    const payload = await runDiagnoseJson(0);
    const serialized = JSON.stringify(payload);

    expect(payload.status.gateway).toEqual({
      mode: "remote",
      remoteConfigured: true,
    });
    expect(serialized).not.toContain(userInfo);
    expect(serialized).not.toContain(`${sensitiveParam}=${sensitiveValue}`);
    expect(serialized).not.toContain(sensitiveValue);
  });

  it("threads diagnose timeout into baseline gateway probes", async () => {
    await runDiagnoseJson(1234);

    expect(captureBaseline).toHaveBeenCalledWith(
      expect.objectContaining({
        gatewayTimeoutMs: 1234,
      }),
    );
  });

  it("counts configured agents from agents.list instead of config sections", async () => {
    fs.writeFileSync(
      path.join(tempDir, "openclaw.json"),
      JSON.stringify({
        agents: {
          defaults: {},
          list: [{ id: "main" }],
        },
      }),
      "utf-8",
    );
    resetConfigRuntimeState();

    const payload = await runDiagnoseJson(0);

    expect(payload.status.configuredAgents).toBe(1);
  });

  it("reports baseline failures and clears their incidents after recovery", async () => {
    const template = await captureBaseline({ config: {}, skipGateway: true, skipPlugins: true });
    const failedBaseline = {
      ...template,
      components: {
        ...template.components,
        gateway: { status: "fail" as const, message: "gateway unavailable" },
      },
    };
    vi.mocked(captureBaseline).mockResolvedValueOnce(failedBaseline);

    const failed = await runDiagnoseJson(1000);
    expect(failed.ok).toBe(false);
    expect(failed.incidents.recent).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "gateway_health", source: "diagnose:baseline:gateway" }),
      ]),
    );

    vi.mocked(captureBaseline).mockResolvedValueOnce({
      ...template,
      components: {
        gateway: { status: "pass" },
        channels: { status: "pass" },
        agents: { status: "pass" },
        tasks: { status: "pass" },
        locks: { status: "pass" },
        plugins: { status: "pass" },
      },
    });
    const recovered = await runDiagnoseJson(1000);
    expect(recovered.ok).toBe(true);
    expect(recovered.incidents.open).toBe(0);
  });
});
