// Legacy cron config migration for zero-duration sessionRetention values.
import { parseDurationMs } from "../../../cli/parse-duration.js";
import {
  defineLegacyConfigMigration,
  getRecord,
  type LegacyConfigMigrationSpec,
  type LegacyConfigRule,
} from "../../../config/legacy.shared.js";

/**
 * Returns `true` when `sessionRetention` is a non-false string that
 * `parseDurationMs` evaluates to ≤ 0 with the same options the schema
 * uses, so the matching doctor migration can remove it before the
 * stricter schema rejects it on upgrade.
 *
 * Invalid (unparseable) strings return `false` — they are already caught
 * by the base schema diagnostic and should not be silently removed.
 */
function isZeroDurationSessionRetention(raw: unknown): boolean {
  const cron = getRecord(raw);
  if (!cron || !Object.hasOwn(cron, "sessionRetention")) {
    return false;
  }
  const val = cron.sessionRetention;
  if (typeof val !== "string") {
    return false;
  }
  try {
    const ms = parseDurationMs(val, { defaultUnit: "h" });
    return ms <= 0;
  } catch {
    return false;
  }
}

const CRON_RUN_LOG_RULE: LegacyConfigRule = {
  path: ["cron", "runLog"],
  message:
    'cron.runLog is retired; run history now has fixed per-job retention. Run "openclaw doctor --fix".',
};

const CRON_SESSION_RETENTION_ZERO_RULE: LegacyConfigRule = {
  path: ["cron"],
  message:
    'cron.sessionRetention is a zero duration — this causes immediate deletion of all cron run sessions. Run "openclaw doctor --fix" to remove it so the documented 24h default applies.',
  match: isZeroDurationSessionRetention,
};

/** Legacy config migration specs for cron runtime config compatibility. */
export const LEGACY_CONFIG_MIGRATIONS_RUNTIME_CRON: LegacyConfigMigrationSpec[] = [
  defineLegacyConfigMigration({
    id: "cron.runLog-remove",
    describe: "Remove retired cron run-log retention config",
    legacyRules: [CRON_RUN_LOG_RULE],
    apply: (raw, changes) => {
      const cron = getRecord(raw.cron);
      if (!cron || !Object.hasOwn(cron, "runLog")) {
        return;
      }
      delete cron.runLog;
      if (Object.keys(cron).length > 0) {
        raw.cron = cron;
      } else {
        delete raw.cron;
      }
      changes.push("Removed retired cron.runLog config; cron history now keeps 2000 runs per job.");
    },
  }),
  defineLegacyConfigMigration({
    id: "cron.sessionRetention-zero",
    describe: "Remove zero-duration cron.sessionRetention so the documented 24h default applies",
    legacyRules: [CRON_SESSION_RETENTION_ZERO_RULE],
    apply: (raw, changes) => {
      const cron = getRecord(raw.cron);
      if (!cron || !Object.hasOwn(cron, "sessionRetention")) {
        return;
      }
      const val = cron.sessionRetention;
      if (typeof val !== "string") {
        return;
      }
      let ms: number;
      try {
        ms = parseDurationMs(val, { defaultUnit: "h" });
      } catch {
        return; // unparseable — leave for schema diagnostic
      }
      if (ms > 0) {
        return;
      }
      delete cron.sessionRetention;
      changes.push(
        `Removed cron.sessionRetention "${val}" (zero duration); documented 24h default applies.`,
      );
    },
  }),
];
