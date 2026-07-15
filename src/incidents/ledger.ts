import { redactSensitiveUrlLikeString } from "@openclaw/net-policy/redact-sensitive-url";
import { REDACTED_SENTINEL, redactConfigObject } from "../config/redact-snapshot.js";
import {
  listControlPlaneDiagnostics,
  writeControlPlaneDiagnostic,
  writeControlPlaneDiagnosticWhen,
} from "../state/control-plane-diagnostic-store.js";

/**
 * Incident Ledger - Persistent audit trail for repairs and incidents.
 *
 * Stores records in the shared state database for each repair attempt, enabling:
 * - Repair audit trails with timestamps and outcomes
 * - Circuit breaker pattern for repeated failures
 * - Delta reports comparing before/after state
 */

const INCIDENT_LEDGER_STORE_SCOPE = "control-plane-incidents";

export type IncidentSeverity = "low" | "medium" | "high" | "critical";
export type IncidentStatus = "open" | "resolved" | "frozen";
export type RepairStatus = "pending" | "in_progress" | "succeeded" | "failed" | "skipped";

export type IncidentType =
  | "session_state_corruption"
  | "gateway_health"
  | "channel_connectivity"
  | "plugin_failure"
  | "task_flow_stuck"
  | "heartbeat_poisoned"
  | "a2a_delivery_failure"
  | "custom";

export type LedgerEntry = {
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

export type RepairAttempt = {
  id: string;
  incidentId: string;
  timestamp: string;
  action: string;
  status: RepairStatus;
  durationMs?: number;
  error?: string;
  beforeState?: Record<string, unknown>;
  afterState?: Record<string, unknown>;
};

export type IncidentWithRepairs = LedgerEntry & {
  repairs: RepairAttempt[];
  attemptCount: number;
  lastAttemptAt?: string;
  circuitBreakerTripped: boolean;
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

function parseLedgerRecord(value: unknown): LedgerEntry | RepairAttempt | null {
  if (value && typeof value === "object" && "id" in value && "timestamp" in value) {
    return value as LedgerEntry | RepairAttempt;
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

export function appendLedgerEntry(
  entry: Omit<LedgerEntry, "id" | "timestamp">,
): LedgerEntry {
  const { entry: fullEntry, timestampMs } = buildLedgerEntry(entry);
  writeControlPlaneDiagnostic(
    INCIDENT_LEDGER_STORE_SCOPE,
    `incident:${fullEntry.id}`,
    fullEntry,
    { createdAt: timestampMs },
  );
  return fullEntry;
}

function listClosedIncidentIds(incidents: LedgerEntry[]): Set<string> {
  return new Set(
    incidents
      .filter((incident) => incident.status === "resolved" || incident.status === "frozen")
      .map((incident) => {
        const details = incident.details ?? {};
        return typeof details.resolvedIncidentId === "string"
          ? details.resolvedIncidentId
          : typeof details.frozenIncidentId === "string"
            ? details.frozenIncidentId
            : undefined;
      })
      .filter((id): id is string => Boolean(id)),
  );
}

function resolveIncidentStatus(incident: LedgerEntry, incidents: LedgerEntry[]): IncidentStatus {
  const marker = incidents.toReversed().find((candidate) => {
    const details = candidate.details ?? {};
    return (
      details.resolvedIncidentId === incident.id || details.frozenIncidentId === incident.id
    );
  });
  return marker?.status ?? incident.status;
}

export function createIncidentIfAbsent(
  params: Omit<LedgerEntry, "id" | "timestamp" | "status">,
): LedgerEntry | null {
  const { entry, timestampMs } = buildLedgerEntry({ ...params, status: "open" });
  const written = writeControlPlaneDiagnosticWhen(
    INCIDENT_LEDGER_STORE_SCOPE,
    `incident:${entry.id}`,
    entry,
    (records) => {
      const incidents = records.flatMap((record) => {
        const parsed = parseLedgerRecord(record.payload);
        return parsed && !("incidentId" in parsed) ? [parsed] : [];
      });
      const closedIncidentIds = listClosedIncidentIds(incidents);
      return !incidents.some(
        (incident) =>
          incident.status === "open" &&
          !closedIncidentIds.has(incident.id) &&
          incident.type === params.type &&
          incident.source === params.source,
      );
    },
    { createdAt: timestampMs },
  );
  return written ? entry : null;
}

export function appendRepairAttempt(
  repair: Omit<RepairAttempt, "id" | "timestamp">,
): RepairAttempt {
  const timestampMs = nextLedgerTimestampMs();
  const fullRepair: RepairAttempt = {
    ...repair,
    error: repair.error ? REDACTED_SENTINEL : undefined,
    beforeState: repair.beforeState ? redactLedgerRecord(repair.beforeState) : undefined,
    afterState: repair.afterState ? redactLedgerRecord(repair.afterState) : undefined,
    id: generateId(timestampMs),
    timestamp: new Date(timestampMs).toISOString(),
  };
  writeControlPlaneDiagnostic(
    INCIDENT_LEDGER_STORE_SCOPE,
    `repair:${fullRepair.id}`,
    fullRepair,
    { createdAt: timestampMs },
  );
  return fullRepair;
}

export function readLedger(): {
  incidents: LedgerEntry[];
  repairs: RepairAttempt[];
} {
  const incidents: LedgerEntry[] = [];
  const repairs: RepairAttempt[] = [];
  for (const record of listControlPlaneDiagnostics<unknown>(INCIDENT_LEDGER_STORE_SCOPE)) {
    const parsed = parseLedgerRecord(record.payload);
    if (!parsed) {
      continue;
    }

    if ("incidentId" in parsed) {
      repairs.push(parsed);
    } else {
      incidents.push(parsed);
    }
  }

  return { incidents, repairs };
}

function buildIncidentWithRepairs(
  incident: LedgerEntry,
  repairs: RepairAttempt[],
): IncidentWithRepairs {
  const incidentRepairs = repairs.filter((repair) => repair.incidentId === incident.id);
  const attemptCount = incidentRepairs.length;
  const lastAttemptAt =
    incidentRepairs.length > 0 ? incidentRepairs[incidentRepairs.length - 1].timestamp : undefined;

  // Circuit breaker: freeze after 3 consecutive failed repairs.
  const consecutiveFailedAttempts = incidentRepairs
    .toReversed()
    .findIndex((repair) => repair.status !== "failed");
  const failedAttemptRun =
    consecutiveFailedAttempts === -1 ? incidentRepairs.length : consecutiveFailedAttempts;
  const circuitBreakerTripped = failedAttemptRun >= 3;

  return {
    ...incident,
    repairs: incidentRepairs,
    attemptCount,
    lastAttemptAt,
    circuitBreakerTripped,
  };
}

export function getIncident(id: string): IncidentWithRepairs | null {
  const { incidents, repairs } = readLedger();
  const incident = incidents.find((entry) => entry.id === id);
  return incident
    ? buildIncidentWithRepairs(
        { ...incident, status: resolveIncidentStatus(incident, incidents) },
        repairs,
      )
    : null;
}

export function getOpenIncidents(): IncidentWithRepairs[] {
  const { incidents, repairs } = readLedger();
  const closedIncidentIds = listClosedIncidentIds(incidents);
  return incidents
    .filter((i) => i.status === "open" && !closedIncidentIds.has(i.id))
    .map((incident) => buildIncidentWithRepairs(incident, repairs));
}

export function resolveIncident(id: string): boolean {
  const incident = getIncident(id);
  if (!incident) {
    return false;
  }

  appendLedgerEntry(
    {
      type: incident.type,
      severity: incident.severity,
      status: "resolved",
      summary: `Resolved: ${incident.summary}`,
      source: "incident-ledger",
      details: { resolvedIncidentId: id },
    },
  );
  return true;
}

export function freezeIncident(id: string, reason: string): boolean {
  const incident = getIncident(id);
  if (!incident) {
    return false;
  }

  appendLedgerEntry(
    {
      type: incident.type,
      severity: incident.severity,
      status: "frozen",
      summary: `Frozen: ${incident.summary}`,
      source: "incident-ledger",
      details: { frozenIncidentId: id, reason },
    },
  );
  return true;
}

export function createIncident(
  params: {
    type: IncidentType;
    severity: IncidentSeverity;
    summary: string;
    details?: Record<string, unknown>;
    agentId?: string;
    sessionId?: string;
    source: string;
  },
): LedgerEntry {
  return appendLedgerEntry(
    {
      ...params,
      status: "open",
    },
  );
}

export function recordRepairAttempt(
  params: {
    incidentId: string;
    action: string;
    status: RepairStatus;
    durationMs?: number;
    error?: string;
    beforeState?: Record<string, unknown>;
    afterState?: Record<string, unknown>;
  },
): RepairAttempt {
  return appendRepairAttempt(params);
}
