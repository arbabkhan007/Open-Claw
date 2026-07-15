import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  closeOpenClawStateDatabaseForTest,
  openOpenClawStateDatabase,
} from "../state/openclaw-state-db.js";
import { createIncidentIfAbsent, getOpenIncidents, readLedger } from "./ledger.js";

describe("incident ledger", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-ledger-test-"));
    process.env.OPENCLAW_STATE_DIR = tempDir;
  });

  afterEach(() => {
    closeOpenClawStateDatabaseForTest();
    fs.rmSync(tempDir, { recursive: true, force: true });
    delete process.env.OPENCLAW_STATE_DIR;
  });

  it("stores incidents in the shared state database", () => {
    const database = openOpenClawStateDatabase();
    expect(database.path).toBe(path.join(tempDir, "state", "openclaw.sqlite"));

    const entry = createIncidentIfAbsent({
      type: "session_state_corruption",
      severity: "medium",
      summary: "Test incident",
      source: "test",
    });
    expect(entry).not.toBeNull();
    expect(readLedger().incidents[0]?.id).toBe(entry?.id);
  });

  it("atomically avoids duplicate open incidents for one source", () => {
    const params = {
      type: "gateway_health" as const,
      severity: "high" as const,
      summary: "Gateway unhealthy",
      source: "diagnose",
    };
    expect(createIncidentIfAbsent(params)).not.toBeNull();
    expect(createIncidentIfAbsent(params)).toBeNull();
    expect(getOpenIncidents()).toHaveLength(1);
  });

  it("redacts sensitive incident details before persistence", () => {
    const sensitiveValue = ["private", "fixture", "value"].join("-");
    const sensitiveKey = ["to", "ken"].join("");
    const callbackUrl = new URL("/path", "https://example.com");
    callbackUrl.username = "fixture";
    callbackUrl.password = "placeholder";
    createIncidentIfAbsent({
      type: "gateway_health",
      severity: "high",
      summary: "Gateway leaked config",
      source: "test",
      details: {
        [sensitiveKey]: sensitiveValue,
        callbackUrl: callbackUrl.href,
      },
    });

    closeOpenClawStateDatabaseForTest();
    const rawLedger = JSON.stringify(readLedger());
    expect(rawLedger).not.toContain(sensitiveValue);
    expect(rawLedger).toContain("__OPENCLAW_REDACTED__");
  });
});
