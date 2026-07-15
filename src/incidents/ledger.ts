import { redactSensitiveUrlLikeString } from "@openclaw/net-policy/redact-sensitive-url";
import { redactConfigObject } from "../config/redact-snapshot.js";
import {
  listControlPlaneDiagnostics,
  writeControlPlaneDiagnosticWhen,
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

function generateId(timestampMs: number): string {
  const timestamp = timestampMs.toString(36);
  const random = Math.random().toString(36).slice(2, 10);
  return `${timestamp}-${random}`;
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

function buildLedgerEntry(entry: Omit<LedgerEntry, "id" | "timestamp">): {
  entry: LedgerEntry;
  timestampMs: number;
} {
  const timestampMs = nextLedgerTimestampMs();
  return {
    entry: {
      ...entry,
      details: entry.details ? redactLedgerRecord(entry.details) : undefined,
      id: generateId(timestampMs),
      timestamp: new Date(timestampMs).toISOString(),
    },
    timestampMs,
  };
}

export function createIncidentIfAbsent(
  params: Omit<LedgerEntry, "id" | "timestamp" | "status">,
): LedgerEntry | null {
  const { entry, timestampMs } = buildLedgerEntry({ ...params, status: "open" });
  const written = writeControlPlaneDiagnosticWhen(
    INCIDENT_LEDGER_STORE_SCOPE,
    `incident:${entry.id}`,
    entry,
    (records) =>
      !records.some((record) => {
        const incident = parseLedgerRecord(record.payload);
        return (
          incident?.status === "open" &&
          incident.type === params.type &&
          incident.source === params.source
        );
      }),
    { createdAt: timestampMs },
  );
  return written ? entry : null;
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
