// Shared SQLite persistence for control-plane diagnostic snapshots and audit records.
import { executeSqliteQuerySync, getNodeSqliteKysely } from "../infra/kysely-sync.js";
import type { DB as OpenClawStateKyselyDatabase } from "./openclaw-state-db.generated.js";
import {
  openOpenClawStateDatabase,
  runOpenClawStateWriteTransaction,
} from "./openclaw-state-db.js";

type DiagnosticStateDatabase = Pick<OpenClawStateKyselyDatabase, "diagnostic_events">;

function stateDatabaseOptions(env: NodeJS.ProcessEnv | undefined) {
  return env ? { env } : {};
}

type ControlPlaneDiagnosticRecord<T> = {
  key: string;
  payload: T;
  createdAt: number;
};

function parsePayload(payloadJson: string): unknown {
  try {
    return JSON.parse(payloadJson) as unknown;
  } catch {
    return undefined;
  }
}

export function readControlPlaneDiagnostic<T>(
  scope: string,
  key: string,
  env: NodeJS.ProcessEnv = process.env,
): ControlPlaneDiagnosticRecord<T> | undefined {
  const database = openOpenClawStateDatabase({ env });
  const db = getNodeSqliteKysely<DiagnosticStateDatabase>(database.db);
  const row = executeSqliteQuerySync(
    database.db,
    db
      .selectFrom("diagnostic_events")
      .select(["event_key", "payload_json", "created_at"])
      .where("scope", "=", scope)
      .where("event_key", "=", key)
      .limit(1),
  ).rows[0];
  if (!row) {
    return undefined;
  }
  const payload = parsePayload(row.payload_json);
  return payload === undefined
    ? undefined
    : { key: row.event_key, payload: payload as T, createdAt: row.created_at };
}

export function listControlPlaneDiagnostics<T>(
  scope: string,
  env: NodeJS.ProcessEnv = process.env,
): Array<ControlPlaneDiagnosticRecord<T>> {
  const database = openOpenClawStateDatabase({ env });
  const db = getNodeSqliteKysely<DiagnosticStateDatabase>(database.db);
  return executeSqliteQuerySync(
    database.db,
    db
      .selectFrom("diagnostic_events")
      .select(["event_key", "payload_json", "created_at"])
      .where("scope", "=", scope)
      .orderBy("created_at", "asc")
      .orderBy("event_key", "asc"),
  ).rows.flatMap((row) => {
    const payload = parsePayload(row.payload_json);
    return payload === undefined
      ? []
      : [{ key: row.event_key, payload: payload as T, createdAt: row.created_at }];
  });
}

export function writeControlPlaneDiagnostic(
  scope: string,
  key: string,
  payload: unknown,
  options: { createdAt?: number; env?: NodeJS.ProcessEnv } = {},
): void {
  const createdAt = options.createdAt ?? Date.now();
  const payloadJson = JSON.stringify(payload);
  if (payloadJson === undefined) {
    throw new Error(`Control-plane diagnostic ${scope}/${key} is not JSON-serializable`);
  }
  runOpenClawStateWriteTransaction(
    ({ db: database }) => {
      const db = getNodeSqliteKysely<DiagnosticStateDatabase>(database);
      executeSqliteQuerySync(
        database,
        db
          .insertInto("diagnostic_events")
          .values({
            scope,
            event_key: key,
            payload_json: payloadJson,
            created_at: createdAt,
          })
          .onConflict((conflict) =>
            conflict.columns(["scope", "event_key"]).doUpdateSet({
              payload_json: (eb) => eb.ref("excluded.payload_json"),
              created_at: (eb) => eb.ref("excluded.created_at"),
            }),
          ),
      );
    },
    stateDatabaseOptions(options.env),
  );
}

/** Atomically appends one record only when the current scope still satisfies the predicate. */
export function writeControlPlaneDiagnosticWhen(
  scope: string,
  key: string,
  payload: unknown,
  shouldWrite: (records: Array<ControlPlaneDiagnosticRecord<unknown>>) => boolean,
  options: { createdAt?: number; env?: NodeJS.ProcessEnv } = {},
): boolean {
  const createdAt = options.createdAt ?? Date.now();
  const payloadJson = JSON.stringify(payload);
  if (payloadJson === undefined) {
    throw new Error(`Control-plane diagnostic ${scope}/${key} is not JSON-serializable`);
  }
  return runOpenClawStateWriteTransaction(
    ({ db: database }) => {
      const db = getNodeSqliteKysely<DiagnosticStateDatabase>(database);
      const records = executeSqliteQuerySync(
        database,
        db
          .selectFrom("diagnostic_events")
          .select(["event_key", "payload_json", "created_at"])
          .where("scope", "=", scope)
          .orderBy("created_at", "asc")
          .orderBy("event_key", "asc"),
      ).rows.flatMap((row) => {
        const currentPayload = parsePayload(row.payload_json);
        return currentPayload === undefined
          ? []
          : [{ key: row.event_key, payload: currentPayload, createdAt: row.created_at }];
      });
      if (!shouldWrite(records)) {
        return false;
      }
      executeSqliteQuerySync(
        database,
        db.insertInto("diagnostic_events").values({
          scope,
          event_key: key,
          payload_json: payloadJson,
          created_at: createdAt,
        }),
      );
      return true;
    },
    stateDatabaseOptions(options.env),
  );
}

export function deleteControlPlaneDiagnostic(
  scope: string,
  key: string,
  options: { createdAt?: number; env?: NodeJS.ProcessEnv } = {},
): void {
  runOpenClawStateWriteTransaction(
    ({ db: database }) => {
      const db = getNodeSqliteKysely<DiagnosticStateDatabase>(database);
      let query = db
        .deleteFrom("diagnostic_events")
        .where("scope", "=", scope)
        .where("event_key", "=", key);
      if (options.createdAt !== undefined) {
        query = query.where("created_at", "=", options.createdAt);
      }
      executeSqliteQuerySync(database, query);
    },
    stateDatabaseOptions(options.env),
  );
}
