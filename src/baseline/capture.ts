import fs from "node:fs";
import path from "node:path";
import { listAgentEntries } from "../agents/agent-scope.js";
import { getRuntimeConfig } from "../config/config.js";
import { resolveStateDir } from "../config/paths.js";
import type { OpenClawConfig } from "../config/types.openclaw.js";
import { callGateway } from "../gateway/call.js";
import { formatErrorMessage } from "../infra/errors.js";
import { listConfiguredChannelIdsForReadOnlyScope } from "../plugins/channel-plugin-ids.js";
import { loadPluginManifestRegistry } from "../plugins/manifest-registry.js";
import {
  listControlPlaneDiagnostics,
  writeControlPlaneDiagnostic,
} from "../state/control-plane-diagnostic-store.js";

/**
 * Baseline Capture
 *
 * Captures system state snapshots for regression detection.
 * Used after repairs, upgrades, or configuration changes.
 *
 */

const BASELINE_STORE_SCOPE = "control-plane-baselines";

type BaselineSeverity = "pass" | "warn" | "fail";

type ComponentStatus = {
  status: BaselineSeverity;
  message?: string;
  details?: Record<string, unknown>;
};

type BaselineCapture = {
  version: string;
  timestamp: string;
  openClawVersion: string;
  components: {
    gateway: ComponentStatus;
    channels: ComponentStatus;
    agents: ComponentStatus;
    tasks: ComponentStatus;
    locks: ComponentStatus;
    plugins: ComponentStatus;
  };
  metrics: {
    sessionCount: number;
    agentCount: number;
    channelCount: number;
    activeTaskCount: number;
    gatewayPid?: number;
    gatewayUptimeMs?: number;
  };
  config?: {
    agentBindings: number;
    configuredChannels: number;
    enabledPlugins: number;
  };
};

export async function captureBaseline(options?: {
  name?: string;
  config?: OpenClawConfig;
  skipGateway?: boolean;
  skipPlugins?: boolean;
  gatewayTimeoutMs?: number;
}): Promise<BaselineCapture> {
  const config = options?.config ?? getRuntimeConfig();
  const gatewayTimeoutMs = options?.gatewayTimeoutMs ?? 5000;
  const version = "1.0.0";

  const gateway: ComponentStatus = await checkGatewayStatus(options?.skipGateway, gatewayTimeoutMs);
  const channels: ComponentStatus = await checkChannelsStatus(config, gatewayTimeoutMs);
  const agents: ComponentStatus = await checkAgentsStatus(config);
  const tasks: ComponentStatus = await checkTasksStatus(gatewayTimeoutMs);
  const locks: ComponentStatus = await checkLocksStatus();
  const plugins: ComponentStatus = await checkPluginsStatus(options?.skipPlugins, config);

  const agentCount = readComponentCount(agents, "count");
  const channelCount = readComponentCount(channels, "total");
  const pluginCount = readComponentCount(plugins, "count");
  const taskCount = readComponentCount(tasks, "count");

  const sessionCount = await countSessions(gatewayTimeoutMs);

  const baseline: BaselineCapture = {
    version,
    timestamp: new Date().toISOString(),
    openClawVersion: process.env.npm_package_version ?? "unknown",
    components: {
      gateway,
      channels,
      agents,
      tasks,
      locks,
      plugins,
    },
    metrics: {
      sessionCount,
      agentCount,
      channelCount,
      activeTaskCount: taskCount,
      gatewayPid: gateway.details?.pid as number | undefined,
      gatewayUptimeMs: gateway.details?.uptimeMs as number | undefined,
    },
  };

  const configBindings = config.bindings;
  baseline.config = {
    agentBindings: Array.isArray(configBindings) ? configBindings.length : 0,
    configuredChannels: channelCount,
    enabledPlugins: pluginCount,
  };

  return baseline;
}

export async function saveBaseline(
  baseline: BaselineCapture,
  name: string,
): Promise<string> {
  writeControlPlaneDiagnostic(BASELINE_STORE_SCOPE, name, baseline, {
    createdAt: Date.parse(baseline.timestamp),
  });
  return name;
}

export function listBaselines(): string[] {
  return listControlPlaneDiagnostics<BaselineCapture>(BASELINE_STORE_SCOPE).map(
    (record) => record.key,
  );
}

function readComponentCount(component: ComponentStatus, field: string): number {
  const value = component.details?.[field];
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : 0;
}

async function checkGatewayStatus(skip?: boolean, timeoutMs = 5000): Promise<ComponentStatus> {
  if (skip) {
    return { status: "pass", message: "Skipped" };
  }

  try {
    const result = await callGateway({
      method: "status",
      params: {},
      timeoutMs,
    });

    return {
      status: "pass",
      message: "Gateway responded",
      details: {
        eventLoop: result.eventLoop,
        runtimeVersion: result.runtimeVersion,
      },
    };
  } catch (err) {
    return { status: "fail", message: formatErrorMessage(err) };
  }
}

async function countSessions(timeoutMs = 5000): Promise<number> {
  try {
    const result = await callGateway<{ sessions?: unknown[]; totalCount?: number }>({
      method: "sessions.list",
      params: { limit: 1 },
      timeoutMs,
    });
    if (typeof result?.totalCount === "number" && Number.isFinite(result.totalCount)) {
      return Math.max(0, Math.trunc(result.totalCount));
    }
    return Array.isArray(result?.sessions) ? result.sessions.length : 0;
  } catch {
    return 0;
  }
}

async function countActiveTasks(timeoutMs = 5000): Promise<number> {
  let cursor: string | undefined;
  const seenCursors = new Set<string>();
  let count = 0;

  do {
    const result = await callGateway<{ tasks?: unknown[]; nextCursor?: string }>({
      method: "tasks.list",
      params: {
        status: ["queued", "running"],
        limit: 500,
        ...(cursor ? { cursor } : {}),
      },
      timeoutMs,
    });
    count += Array.isArray(result?.tasks) ? result.tasks.length : 0;

    const nextCursor = typeof result?.nextCursor === "string" ? result.nextCursor : undefined;
    if (!nextCursor || seenCursors.has(nextCursor)) {
      break;
    }
    seenCursors.add(nextCursor);
    cursor = nextCursor;
  } while (cursor);

  return count;
}

type ChannelStatusSummary = {
  configured?: boolean;
  connected?: boolean;
  linked?: boolean;
};

type ChannelAccountStatusSummary = ChannelStatusSummary & {
  running?: boolean;
  accountId?: string;
};

function listChannelStatusSummaries(
  channels: Record<string, ChannelStatusSummary> | ChannelStatusSummary[] | undefined,
): ChannelStatusSummary[] {
  if (Array.isArray(channels)) {
    return channels;
  }
  if (channels && typeof channels === "object") {
    return Object.values(channels);
  }
  return [];
}

function listChannelAccountStatusSummaries(
  accounts: Record<string, ChannelAccountStatusSummary> | ChannelAccountStatusSummary[] | undefined,
): ChannelAccountStatusSummary[] {
  if (Array.isArray(accounts)) {
    return accounts;
  }
  if (accounts && typeof accounts === "object") {
    return Object.values(accounts);
  }
  return [];
}

function isChannelConnected(channel: ChannelStatusSummary): boolean {
  return channel.connected === true || channel.linked === true;
}

function isChannelAccountConnected(account: ChannelAccountStatusSummary): boolean {
  return account.connected === true || (account.running === true && account.connected !== false);
}

async function checkChannelsStatus(
  config?: OpenClawConfig,
  timeoutMs = 5000,
): Promise<ComponentStatus> {
  try {
    const channelIds = listConfiguredChannelIdsForReadOnlyScope({ config: config ?? {} });
    if (channelIds.length === 0) {
      return { status: "pass", message: "No channels configured" };
    }

    const result = await callGateway<{
      channels?: Record<string, ChannelStatusSummary> | ChannelStatusSummary[];
      channelAccounts?: Record<
        string,
        Record<string, ChannelAccountStatusSummary> | ChannelAccountStatusSummary[]
      >;
    }>({
      method: "channels.status",
      params: {},
      timeoutMs,
    });

    const channels = listChannelStatusSummaries(result?.channels);
    const connectedFromAccounts = channelIds.filter((channelId) =>
      listChannelAccountStatusSummaries(result?.channelAccounts?.[channelId]).some(
        isChannelAccountConnected,
      ),
    ).length;
    const connected =
      result?.channelAccounts && Object.keys(result.channelAccounts).length > 0
        ? connectedFromAccounts
        : channels.filter(isChannelConnected).length;
    const total = channelIds.length;

    if (connected === total) {
      return {
        status: "pass",
        message: `All ${total} channels connected`,
        details: { connected, total },
      };
    } else if (connected > 0) {
      return {
        status: "warn",
        message: `${connected}/${total} channels connected`,
        details: { connected, total },
      };
    }

    return {
      status: "fail",
      message: `0/${total} channels connected`,
      details: { connected, total },
    };
  } catch (err) {
    return { status: "warn", message: formatErrorMessage(err) };
  }
}

async function checkAgentsStatus(config?: OpenClawConfig): Promise<ComponentStatus> {
  try {
    const entries = listAgentEntries(config ?? {});
    return {
      status: "pass",
      message: `${entries.length} agents`,
      details: { count: entries.length },
    };
  } catch (err) {
    return { status: "warn", message: formatErrorMessage(err) };
  }
}

async function checkTasksStatus(timeoutMs = 5000): Promise<ComponentStatus> {
  try {
    const count = await countActiveTasks(timeoutMs);
    return { status: "pass", message: `${count} active tasks`, details: { count } };
  } catch (err) {
    return { status: "warn", message: formatErrorMessage(err) };
  }
}

async function checkLocksStatus(): Promise<ComponentStatus> {
  try {
    const stateDir = resolveStateDir();
    const locksDir = path.join(stateDir, "locks");
    if (!fs.existsSync(locksDir)) {
      return { status: "pass", message: "No locks directory" };
    }
    const lockFiles = fs.readdirSync(locksDir).filter((f) => f.endsWith(".lock"));
    if (lockFiles.length === 0) {
      return { status: "pass", message: "No locks" };
    }
    return {
      status: "warn",
      message: `${lockFiles.length} stale locks`,
      details: { files: lockFiles },
    };
  } catch (err) {
    return { status: "warn", message: formatErrorMessage(err) };
  }
}

async function checkPluginsStatus(
  skip: boolean | undefined,
  config: OpenClawConfig,
): Promise<ComponentStatus> {
  if (skip) {
    return { status: "pass", message: "Skipped" };
  }

  try {
    const count = loadPluginManifestRegistry({ config }).plugins.length;
    return { status: "pass", message: `${count} plugins loaded`, details: { count } };
  } catch (err) {
    return { status: "warn", message: formatErrorMessage(err) };
  }
}
