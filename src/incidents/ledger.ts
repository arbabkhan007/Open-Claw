import { redactSensitiveUrlLikeString } from "@openclaw/net-policy/redact-sensitive-url";
import { redactConfigObject } from "../config/redact-snapshot.js";
import {
  deleteControlPlaneDiagnostic,
  listControlPlaneDiagnostics,
  writeControlPlaneDiagnostic,
} from "../state/control-plane-diagnostic-store.js";

/** Persistent incident summaries used by the read-only diagnose report. */
const INCIDENT_LEDGER_STORE_SCOPE = "control-plane-incidents";

type IncidentSeverity = "low" | "medium" | "high" | "critical";
type IncidentStatus = "open" | "resolved" | "frozen";
type IncidentType =
  | "session_state_corruption"
  | "gateway_health"
  | "channel_connectivity"
  | "plugin_failure"
  | "task_flow_stuck"
  | "heartbeat_poisoned"
  | "a2a_delivery_failure"
  | "custom";

type LedgerEntry = {
  id: string;
  timestamp: string;
  type: IncidentType;
  severity: IncidentSeverity;
  status: IncidentStatus;
  summary: string;
  details?: Record<string, unknown>;
  agentId?: string;
  sessionId?: string;
  source: string;
};

let lastLedgerTimestampMs = 0;

function nextLedgerTimestampMs(): number {
  lastLedgerTimestampMs = Math.max(Date.now(), lastLedgerTimestampMs + 1);
  return lastLedgerTimestampMs;
}

function parseLedgerRecord(value: unknown): LedgerEntry | null {
  if (value && typeof value === "object" && "id" in value && "timestamp" in value) {
    return value as LedgerEntry;
  }
  return null;
}

function redactLedgerValue(value: unknown): unknown {
  if (typeof value === "string") {
    return redactSensitiveUrlLikeString(value);
  }
  if (Array.isArray(value)) {
    return value.map(redactLedgerValue);
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, item]) => [
        key,
        redactLedgerValue(item),
      ]),
    );
  }
  return value;
}

function redactLedgerRecord<T extends Record<string, unknown>>(record: T): T {
  return redactLedgerValue(redactConfigObject(record)) as T;
}

function buildLedgerEntry(
  id: string,
  entry: Omit<LedgerEntry, "id" | "timestamp">,
): {
  entry: LedgerEntry;
  timestampMs: number;
} {
  const timestampMs = nextLedgerTimestampMs();
  return {
    entry: {
      ...entry,
      details: entry.details ? redactLedgerRecord(entry.details) : undefined,
      id,
      timestamp: new Date(timestampMs).toISOString(),
    },
    timestampMs,
  };
}

function incidentKey(type: IncidentType, source: string): string {
  return `incident:${encodeURIComponent(source)}:${type}`;
}

export function setIncident(params: Omit<LedgerEntry, "id" | "timestamp" | "status">): LedgerEntry {
  const key = incidentKey(params.type, params.source);
  const { entry, timestampMs } = buildLedgerEntry(key, { ...params, status: "open" });
  writeControlPlaneDiagnostic(INCIDENT_LEDGER_STORE_SCOPE, key, entry, { createdAt: timestampMs });
  return entry;
}

export function clearIncident(type: IncidentType, source: string): void {
  deleteControlPlaneDiagnostic(INCIDENT_LEDGER_STORE_SCOPE, incidentKey(type, source));
}

export function readLedger(): { incidents: LedgerEntry[] } {
  const incidents = listControlPlaneDiagnostics<unknown>(INCIDENT_LEDGER_STORE_SCOPE).flatMap(
    (record) => {
      const incident = parseLedgerRecord(record.payload);
      return incident ? [incident] : [];
    },
  );
  return { incidents };
}

export function getOpenIncidents(): LedgerEntry[] {
  return readLedger().incidents.filter((incident) => incident.status === "open");
}
