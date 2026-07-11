// Legacy cron config migration for zero-duration sessionRetention values.
import {
  defineLegacyConfigMigration,
  getRecord,
  type LegacyConfigMigrationSpec,
  type LegacyConfigRule,
} from "../../../config/legacy.shared.js";

const ZERO_DURATION_VALUES = new Set(["0h", "0d", "0ms"]);

function isZeroDurationSessionRetention(raw: unknown): boolean {
  const cron = getRecord(raw);
  if (!cron || !Object.hasOwn(cron, "sessionRetention")) return false;
  const val = cron.sessionRetention;
  return typeof val === "string" && ZERO_DURATION_VALUES.has(val.trim());
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
      if (!cron || !Object.hasOwn(cron, "sessionRetention")) return;
      const val = cron.sessionRetention;
      if (typeof val !== "string") return;
      const trimmed = val.trim();
      if (!ZERO_DURATION_VALUES.has(trimmed)) return;
      delete cron.sessionRetention;
      changes.push(
        `Removed cron.sessionRetention "${trimmed}" (zero duration); documented 24h default applies.`,
      );
    },
  }),
];
