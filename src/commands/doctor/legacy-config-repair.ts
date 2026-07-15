// Update-channel config repair for legacy config files before normal command startup.
import { readConfigFileSnapshot, replaceConfigFile } from "../../config/config.js";
import { validateConfigObjectWithPlugins } from "../../config/validation.js";
import {
  containsAuthoredInclude,
  isSingleTopLevelIncludeMigration,
} from "./shared/include-migration-ownership.js";
import { migrateLegacyConfig } from "./shared/legacy-config-migrate.js";

type ConfigSnapshot = Awaited<ReturnType<typeof readConfigFileSnapshot>>;

/** Migrate a legacy config snapshot during update, unless validation blocks it. */
export async function repairLegacyConfigForUpdateChannel(params: {
  configSnapshot: ConfigSnapshot;
  jsonMode: boolean;
}): Promise<{ snapshot: ConfigSnapshot; repaired: boolean }> {
  const migrated = migrateLegacyConfig(params.configSnapshot.sourceConfig);
  if (!migrated.config) {
    return { snapshot: params.configSnapshot, repaired: false };
  }

  const validated = validateConfigObjectWithPlugins(migrated.config);
  if (!validated.ok) {
    return { snapshot: params.configSnapshot, repaired: false };
  }

  const nextConfig = migrated.sourceConfig ?? validated.config;
  if (
    containsAuthoredInclude(params.configSnapshot.parsed) &&
    !isSingleTopLevelIncludeMigration({
      parsed: params.configSnapshot.parsed,
      sourceConfig: params.configSnapshot.sourceConfig,
      candidate: nextConfig,
    })
  ) {
    return { snapshot: params.configSnapshot, repaired: false };
  }

  await replaceConfigFile({
    nextConfig,
    baseHash: params.configSnapshot.hash,
    writeOptions: {
      allowConfigSizeDrop: true,
      skipOutputLogs: params.jsonMode,
    },
  });

  const snapshot = await readConfigFileSnapshot();
  return { snapshot, repaired: snapshot.valid };
}
