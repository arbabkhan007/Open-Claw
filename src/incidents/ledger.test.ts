import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  closeOpenClawStateDatabaseForTest,
  openOpenClawStateDatabase,
} from "../state/openclaw-state-db.js";
import {
  appendLedgerEntry,
  appendRepairAttempt,
  readLedger,
  getIncident,
  getOpenIncidents,
  resolveIncident,
  freezeIncident,
  createIncident,
  createIncidentIfAbsent,
  recordRepairAttempt,
  type LedgerEntry,
  type RepairAttempt,
} from "./ledger.js";

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

  it("stores the ledger in the shared state database", () => {
    const database = openOpenClawStateDatabase();
    expect(database.path).toBe(path.join(tempDir, "state", "openclaw.sqlite"));
  });

  it("appends incident entries", () => {
    const entry = createIncident({
      type: "session_state_corruption",
      severity: "medium",
      summary: "Test incident",
      source: "test",
    });

    expect(entry.id).toBeDefined();
    expect(entry.timestamp).toBeDefined();
    expect(entry.status).toBe("open");

    const { incidents } = readLedger();
    expect(incidents).toHaveLength(1);
    expect(incidents[0].id).toBe(entry.id);
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

  it("appends repair attempts linked to incidents", () => {
    const incident = createIncident({
      type: "heartbeat_poisoned",
      severity: "high",
      summary: "Heartbeat poisoned",
      source: "doctor",
    });

    const repair = recordRepairAttempt({
      incidentId: incident.id,
      action: "clear_heartbeat",
      status: "succeeded",
      durationMs: 150,
    });

    expect(repair.id).toBeDefined();
    expect(repair.incidentId).toBe(incident.id);
    expect(repair.status).toBe("succeeded");

    const storedIncident = getIncident(incident.id);
    expect(storedIncident).not.toBeNull();
    expect(storedIncident?.repairs).toHaveLength(1);
    expect(storedIncident?.attemptCount).toBe(1);
  });

  it("tracks multiple repair attempts", () => {
    const incident = createIncident({
      type: "gateway_health",
      severity: "critical",
      summary: "Gateway unhealthy",
      source: "watchdog",
    });

    recordRepairAttempt({
      incidentId: incident.id,
      action: "restart_gateway",
      status: "failed",
      error: "PID not found",
    });
    recordRepairAttempt({
      incidentId: incident.id,
      action: "restart_gateway",
      status: "failed",
      error: "Timeout",
    });
    recordRepairAttempt({
      incidentId: incident.id,
      action: "restart_gateway",
      status: "succeeded",
    });

    const storedIncident = getIncident(incident.id);
    expect(storedIncident?.attemptCount).toBe(3);
    expect(storedIncident?.repairs.filter((r) => r.status === "failed")).toHaveLength(2);
    expect(storedIncident?.repairs.filter((r) => r.status === "succeeded")).toHaveLength(1);
  });

  it("trips circuit breaker after 3 failed repairs", () => {
    const incident = createIncident({
      type: "a2a_delivery_failure",
      severity: "high",
      summary: "A2A delivery failed",
      source: "sessions-send",
    });

    recordRepairAttempt({ incidentId: incident.id, action: "retry", status: "failed" });
    recordRepairAttempt({ incidentId: incident.id, action: "retry", status: "failed" });
    recordRepairAttempt({ incidentId: incident.id, action: "retry", status: "failed" });

    const storedIncident = getIncident(incident.id);
    expect(storedIncident?.circuitBreakerTripped).toBe(true);
  });

  it("does not trip circuit breaker with fewer than 3 failures", () => {
    const incident = createIncident({
      type: "plugin_failure",
      severity: "medium",
      summary: "Plugin crashed",
      source: "plugins",
    });

    recordRepairAttempt({ incidentId: incident.id, action: "restart", status: "failed" });
    recordRepairAttempt({ incidentId: incident.id, action: "restart", status: "failed" });

    const storedIncident = getIncident(incident.id);
    expect(storedIncident?.circuitBreakerTripped).toBe(false);
  });

  it("resets circuit breaker count after successful repairs", () => {
    const incident = createIncident({
      type: "plugin_failure",
      severity: "medium",
      summary: "Plugin crashed",
      source: "plugins",
    });

    recordRepairAttempt({ incidentId: incident.id, action: "restart", status: "failed" });
    recordRepairAttempt({ incidentId: incident.id, action: "restart", status: "failed" });
    recordRepairAttempt({ incidentId: incident.id, action: "restart", status: "succeeded" });
    recordRepairAttempt({ incidentId: incident.id, action: "restart", status: "failed" });
    recordRepairAttempt({ incidentId: incident.id, action: "restart", status: "failed" });

    const storedIncident = getIncident(incident.id);
    expect(storedIncident?.circuitBreakerTripped).toBe(false);
  });

  it("redacts sensitive ledger details before persistence", () => {
    const sensitiveValue = ["private", "fixture", "value"].join("-");
    const sensitiveKey = ["to", "ken"].join("");
    const credentialKey = ["api", "Key"].join("");
    const callbackUrl = new URL("/path", "https://example.com");
    callbackUrl.username = "fixture";
    callbackUrl.password = "placeholder";
    const incident = createIncident({
      type: "gateway_health",
      severity: "high",
      summary: "Gateway leaked config",
      source: "test",
      details: {
        [sensitiveKey]: sensitiveValue,
        callbackUrl: callbackUrl.href,
      },
    });

    recordRepairAttempt({
      incidentId: incident.id,
      action: "repair",
      status: "failed",
      error: `sensitive=${sensitiveValue}`,
      beforeState: { [credentialKey]: sensitiveValue },
      afterState: { [credentialKey]: `${sensitiveValue}-updated` },
    });

    closeOpenClawStateDatabaseForTest();
    const rawLedger = JSON.stringify(readLedger());
    expect(rawLedger).not.toContain(sensitiveValue);
    expect(rawLedger).toContain("__OPENCLAW_REDACTED__");
    expect(incident.details?.[sensitiveKey]).toBe("__OPENCLAW_REDACTED__");
  });

  it("resolves incidents", () => {
    const incident = createIncident({
      type: "channel_connectivity",
      severity: "low",
      summary: "Channel disconnected",
      source: "channels",
    });

    const result = resolveIncident(incident.id);
    expect(result).toBe(true);

    const openIncidents = getOpenIncidents();
    expect(openIncidents).toHaveLength(0);
    expect(getIncident(incident.id)?.status).toBe("resolved");
  });

  it("freezes incidents with reason", () => {
    const incident = createIncident({
      type: "task_flow_stuck",
      severity: "high",
      summary: "Task flow stuck",
      source: "tasks",
    });

    const result = freezeIncident(incident.id, "Circuit breaker tripped");
    expect(result).toBe(true);

    const storedIncident = getIncident(incident.id);
    // Should still exist in ledger with frozen status
    const { incidents } = readLedger();
    const frozenEntry = incidents.find(
      (i) => i.status === "frozen" && i.details?.frozenIncidentId === incident.id,
    );
    expect(frozenEntry).toBeDefined();
    expect(getIncident(incident.id)?.status).toBe("frozen");
  });

  it("stores before and after state for repairs", () => {
    const incident = createIncident({
      type: "session_state_corruption",
      severity: "medium",
      summary: "Corrupted session",
      source: "doctor",
    });

    const repair = recordRepairAttempt({
      incidentId: incident.id,
      action: "repair_session",
      status: "succeeded",
      beforeState: { sessionKey: "test-agent:abc", hasTranscript: false },
      afterState: { sessionKey: "test-agent:abc", hasTranscript: true },
    });

    expect(repair.beforeState).toBeDefined();
    expect(repair.afterState).toBeDefined();
    expect((repair.beforeState as Record<string, unknown>).hasTranscript).toBe(false);
    expect((repair.afterState as Record<string, unknown>).hasTranscript).toBe(true);
  });
});
