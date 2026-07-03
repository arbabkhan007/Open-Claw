// Tests execution approval policy matching and persistence.
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { OpenClawConfig } from "../config/config.js";
import { DEFAULT_AGENT_ID } from "../routing/session-key.js";
import {
  makeMockCommandResolution,
  makeMockExecutableResolution,
} from "./exec-approvals-test-helpers.js";
import type { ExecApprovalsFile } from "./exec-approvals.js";

vi.unmock("./exec-approvals.js");
vi.unmock("./exec-approvals-effective.js");

let collectExecPolicyScopeSnapshots: typeof import("./exec-approvals-effective.js").collectExecPolicyScopeSnapshots;
let resolveExecPolicyScopeSnapshot: typeof import("./exec-approvals-effective.js").resolveExecPolicyScopeSnapshot;
let evaluateExecAllowlist: typeof import("./exec-approvals.js").evaluateExecAllowlist;
let hasDurableExecApproval: typeof import("./exec-approvals.js").hasDurableExecApproval;
let maxAsk: typeof import("./exec-approvals.js").maxAsk;
let minSecurity: typeof import("./exec-approvals.js").minSecurity;
let requireValidExecTarget: typeof import("./exec-approvals.js").requireValidExecTarget;
let normalizeExecAsk: typeof import("./exec-approvals.js").normalizeExecAsk;
let normalizeExecHost: typeof import("./exec-approvals.js").normalizeExecHost;
let normalizeExecMode: typeof import("./exec-approvals.js").normalizeExecMode;
let normalizeExecTarget: typeof import("./exec-approvals.js").normalizeExecTarget;
let normalizeExecSecurity: typeof import("./exec-approvals.js").normalizeExecSecurity;
let requiresExecApproval: typeof import("./exec-approvals.js").requiresExecApproval;
let commandRequiresOpenClawLifecycleApproval: typeof import("./exec-approvals.js").commandRequiresOpenClawLifecycleApproval;
let normalizeExecApprovalUnavailableDecisions: typeof import("./exec-approvals.js").normalizeExecApprovalUnavailableDecisions;
let resolveExecApprovalUnavailableDecisions: typeof import("./exec-approvals.js").resolveExecApprovalUnavailableDecisions;
let resolveExecApprovalRequestAllowedDecisions: typeof import("./exec-approvals.js").resolveExecApprovalRequestAllowedDecisions;
let resolveExecModeFromPolicy: typeof import("./exec-approvals.js").resolveExecModeFromPolicy;
let resolveExecModePolicy: typeof import("./exec-approvals.js").resolveExecModePolicy;
let resolveExecPolicyForMode: typeof import("./exec-approvals.js").resolveExecPolicyForMode;

async function loadActualExecApprovalModules(): Promise<void> {
  vi.resetModules();
  const execApprovals =
    await vi.importActual<typeof import("./exec-approvals.js")>("./exec-approvals.js");
  const effective = await vi.importActual<typeof import("./exec-approvals-effective.js")>(
    "./exec-approvals-effective.js",
  );
  collectExecPolicyScopeSnapshots = effective.collectExecPolicyScopeSnapshots;
  resolveExecPolicyScopeSnapshot = effective.resolveExecPolicyScopeSnapshot;
  evaluateExecAllowlist = execApprovals.evaluateExecAllowlist;
  hasDurableExecApproval = execApprovals.hasDurableExecApproval;
  maxAsk = execApprovals.maxAsk;
  minSecurity = execApprovals.minSecurity;
  requireValidExecTarget = execApprovals.requireValidExecTarget;
  normalizeExecAsk = execApprovals.normalizeExecAsk;
  normalizeExecHost = execApprovals.normalizeExecHost;
  normalizeExecMode = execApprovals.normalizeExecMode;
  normalizeExecTarget = execApprovals.normalizeExecTarget;
  normalizeExecSecurity = execApprovals.normalizeExecSecurity;
  requiresExecApproval = execApprovals.requiresExecApproval;
  commandRequiresOpenClawLifecycleApproval = execApprovals.commandRequiresOpenClawLifecycleApproval;
  normalizeExecApprovalUnavailableDecisions =
    execApprovals.normalizeExecApprovalUnavailableDecisions;
  resolveExecApprovalUnavailableDecisions = execApprovals.resolveExecApprovalUnavailableDecisions;
  resolveExecApprovalRequestAllowedDecisions =
    execApprovals.resolveExecApprovalRequestAllowedDecisions;
  resolveExecModeFromPolicy = execApprovals.resolveExecModeFromPolicy;
  resolveExecModePolicy = execApprovals.resolveExecModePolicy;
  resolveExecPolicyForMode = execApprovals.resolveExecPolicyForMode;
}

function summarizeExecPolicyScopeSnapshot(
  params: Parameters<typeof resolveExecPolicyScopeSnapshot>[0],
): Omit<ReturnType<typeof resolveExecPolicyScopeSnapshot>, "allowedDecisions"> {
  const { allowedDecisions: _allowedDecisions, ...summary } =
    resolveExecPolicyScopeSnapshot(params);
  return summary;
}

function expectFields(value: unknown, expected: Record<string, unknown>): void {
  if (!value || typeof value !== "object") {
    throw new Error("expected fields object");
  }
  const record = value as Record<string, unknown>;
  for (const [key, expectedValue] of Object.entries(expected)) {
    expect(record[key], key).toEqual(expectedValue);
  }
}

function expectMalformedAgentAskUsesDefaults(agentAsk: unknown): void {
  const approvals = {
    version: 1,
    defaults: {
      ask: "always",
    },
    agents: {
      runner: {
        ask: agentAsk,
      },
    },
  } as unknown as ExecApprovalsFile;
  const summary = summarizeExecPolicyScopeSnapshot({
    approvals,
    globalExecConfig: {
      ask: "off",
    },
    configPath: "agents.list.runner.tools.exec",
    scopeLabel: "agent:runner",
    agentId: "runner",
  });

  expectFields(summary.ask, {
    requested: "off",
    host: "always",
    hostSource: "~/.openclaw/exec-approvals.json defaults.ask",
    effective: "always",
    note: "more aggressive ask wins",
  });
}

describe("exec approvals policy helpers", () => {
  beforeEach(async () => {
    await loadActualExecApprovalModules();
  });

  it.each([
    { raw: " gateway ", expected: "gateway" },
    { raw: "NODE", expected: "node" },
    { raw: "", expected: null },
    { raw: "ssh", expected: null },
  ])("normalizes exec host value %j", ({ raw, expected }) => {
    expect(normalizeExecHost(raw)).toBe(expected);
  });

  it.each([
    { raw: " auto ", expected: "auto" },
    { raw: " gateway ", expected: "gateway" },
    { raw: "NODE", expected: "node" },
    { raw: "", expected: null },
    { raw: "ssh", expected: null },
  ])("normalizes exec target value %j", ({ raw, expected }) => {
    expect(normalizeExecTarget(raw)).toBe(expected);
  });

  it("requires direct exec target requests to use the closed host set", () => {
    expect(requireValidExecTarget(" gateway ")).toBe("gateway");
    expect(requireValidExecTarget("")).toBe(null);
    expect(requireValidExecTarget(undefined)).toBe(null);
    expect(() => requireValidExecTarget("spark-ff13")).toThrow(
      'Invalid exec host "spark-ff13". Allowed values: auto, sandbox, gateway, node.',
    );
    expect(() => requireValidExecTarget(42)).toThrow(
      "Invalid exec host value type number. Allowed values: auto, sandbox, gateway, node.",
    );
  });

  it.each([
    { raw: " allowlist ", expected: "allowlist" },
    { raw: "FULL", expected: "full" },
    { raw: "unknown", expected: null },
  ])("normalizes exec security value %j", ({ raw, expected }) => {
    expect(normalizeExecSecurity(raw)).toBe(expected);
  });

  it.each([
    { raw: " on-miss ", expected: "on-miss" },
    { raw: "ALWAYS", expected: "always" },
    { raw: "maybe", expected: null },
  ])("normalizes exec ask value %j", ({ raw, expected }) => {
    expect(normalizeExecAsk(raw)).toBe(expected);
  });

  it.each([
    { raw: " auto ", expected: "auto" },
    { raw: "ASK", expected: "ask" },
    { raw: "allowlist", expected: "allowlist" },
    { raw: "maybe", expected: null },
  ])("normalizes exec mode value %j", ({ raw, expected }) => {
    expect(normalizeExecMode(raw)).toBe(expected);
  });

  it.each([
    { security: "deny" as const, ask: "off" as const, expected: "deny" as const },
    {
      security: "allowlist" as const,
      ask: "off" as const,
      expected: "allowlist" as const,
    },
    {
      security: "allowlist" as const,
      ask: "on-miss" as const,
      expected: "ask" as const,
    },
    { security: "full" as const, ask: "off" as const, expected: "full" as const },
    { security: "full" as const, ask: "on-miss" as const, expected: "full" as const },
    { security: "full" as const, ask: "always" as const, expected: "ask" as const },
  ])("derives normalized exec mode from legacy policy %j", ({ security, ask, expected }) => {
    expect(resolveExecModeFromPolicy({ security, ask })).toBe(expected);
  });

  it.each([
    {
      mode: "deny" as const,
      expected: { security: "deny" as const, ask: "off" as const, autoReview: false },
    },
    {
      mode: "allowlist" as const,
      expected: { security: "allowlist" as const, ask: "off" as const, autoReview: false },
    },
    {
      mode: "ask" as const,
      expected: { security: "allowlist" as const, ask: "on-miss" as const, autoReview: false },
    },
    {
      mode: "auto" as const,
      expected: { security: "allowlist" as const, ask: "on-miss" as const, autoReview: true },
    },
    {
      mode: "full" as const,
      expected: { security: "full" as const, ask: "off" as const, autoReview: false },
    },
  ])("maps explicit exec mode to effective policy %j", ({ mode, expected }) => {
    expect(resolveExecPolicyForMode(mode)).toEqual(expected);
  });

  it("preserves legacy security and ask when no explicit mode is set", () => {
    expect(
      resolveExecModePolicy({
        security: "full",
        ask: "always",
      }),
    ).toEqual({
      mode: "ask",
      security: "full",
      ask: "always",
      autoReview: false,
    });
  });

  it("treats unavailable request decisions as optional approvals only", () => {
    expect(
      normalizeExecApprovalUnavailableDecisions(["allow-once", "deny", "allow-always", "bad"]),
    ).toEqual(["allow-always"]);
    expect(
      resolveExecApprovalRequestAllowedDecisions({
        ask: "on-miss",
        unavailableDecisions: ["allow-always"],
      }),
    ).toEqual(["allow-once", "deny"]);
    expect(
      resolveExecApprovalRequestAllowedDecisions({
        ask: "on-miss",
        unavailableDecisions: ["allow-once", "deny", "allow-always", "bad"],
      }),
    ).toEqual(["allow-once", "deny"]);
    expect(
      resolveExecApprovalRequestAllowedDecisions({
        ask: "always",
        unavailableDecisions: ["allow-always"],
      }),
    ).toEqual(["allow-once", "deny"]);
  });

  it("derives unavailable optional decisions from effective approval policy", () => {
    expect(resolveExecApprovalUnavailableDecisions({ ask: "on-miss" })).toEqual([]);
    expect(resolveExecApprovalUnavailableDecisions({ ask: "always" })).toEqual(["allow-always"]);
    expect(
      resolveExecApprovalUnavailableDecisions({
        ask: "on-miss",
        allowAlwaysPersistence: { kind: "one-shot", reasons: ["no-reusable-pattern"] },
      }),
    ).toEqual(["allow-always"]);
  });

  it.each([
    { left: "deny" as const, right: "full" as const, expected: "deny" as const },
    {
      left: "allowlist" as const,
      right: "full" as const,
      expected: "allowlist" as const,
    },
    {
      left: "full" as const,
      right: "allowlist" as const,
      expected: "allowlist" as const,
    },
  ])("minSecurity picks the more restrictive value for %j", ({ left, right, expected }) => {
    expect(minSecurity(left, right)).toBe(expected);
  });

  it.each([
    { left: "off" as const, right: "always" as const, expected: "always" as const },
    { left: "on-miss" as const, right: "off" as const, expected: "on-miss" as const },
    { left: "always" as const, right: "on-miss" as const, expected: "always" as const },
  ])("maxAsk picks the more aggressive ask mode for %j", ({ left, right, expected }) => {
    expect(maxAsk(left, right)).toBe(expected);
  });

  it.each([
    {
      ask: "always" as const,
      security: "allowlist" as const,
      analysisOk: true,
      allowlistSatisfied: true,
      expected: true,
    },
    {
      ask: "always" as const,
      security: "full" as const,
      analysisOk: true,
      allowlistSatisfied: false,
      durableApprovalSatisfied: true,
      expected: true,
    },
    {
      ask: "off" as const,
      security: "allowlist" as const,
      analysisOk: true,
      allowlistSatisfied: false,
      expected: false,
    },
    {
      ask: "on-miss" as const,
      security: "allowlist" as const,
      analysisOk: true,
      allowlistSatisfied: true,
      expected: false,
    },
    {
      ask: "on-miss" as const,
      security: "allowlist" as const,
      analysisOk: false,
      allowlistSatisfied: false,
      expected: true,
    },
    {
      ask: "on-miss" as const,
      security: "full" as const,
      analysisOk: false,
      allowlistSatisfied: false,
      expected: false,
    },
  ])("requiresExecApproval respects ask mode and allowlist satisfaction for %j", (testCase) => {
    expect(requiresExecApproval(testCase)).toBe(testCase.expected);
  });

  it.each([
    {
      command: "launchctl stop gui/$UID/com.openclaw.gateway",
      argv: ["launchctl", "stop", "gui/$UID/com.openclaw.gateway"],
    },
    {
      command: "launchctl kickstart -k gui/$UID/com.openclaw.gateway",
      argv: ["launchctl", "kickstart", "-k", "gui/$UID/com.openclaw.gateway"],
    },
    {
      command: "launchctl bootstrap gui/$UID ~/Library/LaunchAgents/com.openclaw.gateway.plist",
      argv: [
        "launchctl",
        "bootstrap",
        "gui/$UID",
        "~/Library/LaunchAgents/com.openclaw.gateway.plist",
      ],
    },
    {
      command: "systemctl --user restart openclaw-gateway.service",
      argv: ["systemctl", "--user", "restart", "openclaw-gateway.service"],
    },
    {
      command: "systemctl --user start openclaw-gateway.service",
      argv: ["systemctl", "--user", "start", "openclaw-gateway.service"],
    },
    {
      command: "systemctl --user try-reload-or-restart openclaw-gateway.service",
      argv: ["systemctl", "--user", "try-reload-or-restart", "openclaw-gateway.service"],
    },
    {
      command: "systemctl -s TERM kill openclaw-gateway.service",
      argv: ["systemctl", "-s", "TERM", "kill", "openclaw-gateway.service"],
    },
    {
      command: "systemctl --signal=TERM kill openclaw-gateway.service",
      argv: ["systemctl", "--signal=TERM", "kill", "openclaw-gateway.service"],
    },
    {
      command: "kill -TERM $(pidof openclaw)",
      argv: ["kill", "-TERM", "$(pidof", "openclaw)"],
    },
    {
      command: "pidof openclaw | xargs kill",
      argv: ["pidof", "openclaw"],
    },
    {
      command: "pgrep -f openclaw | xargs -r kill -TERM",
      argv: ["pgrep", "-f", "openclaw"],
    },
    {
      command: "openclaw gateway restart",
      argv: ["openclaw", "gateway", "restart"],
    },
    {
      command: "openclaw.cmd gateway restart",
      argv: ["openclaw.cmd", "gateway", "restart"],
    },
    {
      command: "openclaw.ps1 daemon restart",
      argv: ["openclaw.ps1", "daemon", "restart"],
    },
    {
      command: "./openclaw.mjs gateway restart",
      argv: ["./openclaw.mjs", "gateway", "restart"],
    },
    {
      command: "node openclaw.mjs daemon restart",
      argv: ["node", "openclaw.mjs", "daemon", "restart"],
    },
    {
      command: "node -r ts-node/register openclaw.mjs gateway restart",
      argv: ["node", "-r", "ts-node/register", "openclaw.mjs", "gateway", "restart"],
    },
    {
      command: "openclaw gateway start",
      argv: ["openclaw", "gateway", "start"],
    },
    {
      command: "openclaw gateway",
      argv: ["openclaw", "gateway"],
    },
    {
      command: "openclaw gateway run",
      argv: ["openclaw", "gateway", "run"],
    },
    {
      command: "openclaw gateway --force",
      argv: ["openclaw", "gateway", "--force"],
    },
    {
      command: "openclaw gateway --force restart",
      argv: ["openclaw", "gateway", "--force", "restart"],
    },
    {
      command: "openclaw gateway --port 18789 restart",
      argv: ["openclaw", "gateway", "--port", "18789", "restart"],
    },
    {
      command: "openclaw gateway --port 18789",
      argv: ["openclaw", "gateway", "--port", "18789"],
    },
    {
      command: "openclaw gateway run --force",
      argv: ["openclaw", "gateway", "run", "--force"],
    },
    {
      command: "openclaw gateway call update.run --params '{}'",
      argv: ["openclaw", "gateway", "call", "update.run", "--params", "{}"],
    },
    {
      command: "openclaw gateway call gateway.restart.request",
      argv: ["openclaw", "gateway", "call", "gateway.restart.request"],
    },
    {
      command: "openclaw gateway call --url ws://127.0.0.1:18789 update.run",
      argv: ["openclaw", "gateway", "call", "--url", "ws://127.0.0.1:18789", "update.run"],
    },
    {
      command: "openclaw update --yes",
      argv: ["openclaw", "update", "--yes"],
    },
    {
      command: "openclaw --update",
      argv: ["openclaw", "--update"],
    },
    {
      command: "openclaw --profile work --update --yes",
      argv: ["openclaw", "--profile", "work", "--update", "--yes"],
    },
    {
      command: "openclaw update repair --json --timeout 19",
      argv: ["openclaw", "update", "repair", "--json", "--timeout", "19"],
    },
    {
      command: "openclaw update --dry-run repair",
      argv: ["openclaw", "update", "--dry-run", "repair"],
    },
    {
      command: "openclaw update finalize --no-restart",
      argv: ["openclaw", "update", "finalize", "--no-restart"],
    },
    {
      command: "openclaw --update --dry-run finalize",
      argv: ["openclaw", "--update", "--dry-run", "finalize"],
    },
    {
      command: "openclaw update wizard --timeout 13",
      argv: ["openclaw", "update", "wizard", "--timeout", "13"],
    },
    {
      command: "openclaw uninstall --all --yes --non-interactive",
      argv: ["openclaw", "uninstall", "--all", "--yes", "--non-interactive"],
    },
    {
      command: "npx -y openclaw uninstall --all --yes --non-interactive",
      argv: ["npx", "-y", "openclaw", "uninstall", "--all", "--yes", "--non-interactive"],
    },
    {
      command: 'openclaw gateway "$(printf restart)"',
      argv: ["openclaw", "gateway", "$(printf restart)"],
    },
    {
      command: 'openclaw "$(printf gateway)" restart',
      argv: ["openclaw", "$(printf gateway)", "restart"],
    },
    {
      command: 'openclaw gateway call "$(printf update.run)"',
      argv: ["openclaw", "gateway", "call", "$(printf update.run)"],
    },
    {
      command: "openclaw gateway --profile work restart",
      argv: ["openclaw", "gateway", "--profile", "work", "restart"],
    },
    {
      command: "openclaw gateway --no-color restart",
      argv: ["openclaw", "gateway", "--no-color", "restart"],
    },
    {
      command: "openclaw gateway install --force",
      argv: ["openclaw", "gateway", "install", "--force"],
    },
    {
      command: "openclaw daemon uninstall",
      argv: ["openclaw", "daemon", "uninstall"],
    },
    {
      command: "sudo systemctl restart openclaw-gateway.service",
      argv: ["sudo", "systemctl", "restart", "openclaw-gateway.service"],
    },
    {
      command: "sudo FOO=bar systemctl restart openclaw-gateway.service",
      argv: ["sudo", "FOO=bar", "systemctl", "restart", "openclaw-gateway.service"],
    },
    {
      command: "env PATH=/usr/bin launchctl stop gui/$UID/com.openclaw.gateway",
      argv: ["env", "PATH=/usr/bin", "launchctl", "stop", "gui/$UID/com.openclaw.gateway"],
    },
    {
      command: "pnpm -C repo openclaw gateway restart",
      argv: ["pnpm", "-C", "repo", "openclaw", "gateway", "restart"],
    },
    {
      command: "pnpm.cmd -C repo openclaw.cmd gateway restart",
      argv: ["pnpm.cmd", "-C", "repo", "openclaw.cmd", "gateway", "restart"],
    },
    {
      command: "corepack pnpm openclaw gateway restart",
      argv: ["corepack", "pnpm", "openclaw", "gateway", "restart"],
    },
    {
      command: 'schtasks /End /TN "OpenClaw Gateway"',
      argv: ["schtasks", "/End", "/TN", "OpenClaw Gateway"],
    },
    {
      command: 'schtasks.exe /Run /TN "OpenClaw Gateway"',
      argv: ["schtasks.exe", "/Run", "/TN", "OpenClaw Gateway"],
    },
    {
      command: 'schtasks /Delete /TN "OpenClaw Gateway" /F',
      argv: ["schtasks", "/Delete", "/TN", "OpenClaw Gateway", "/F"],
    },
    {
      command: 'eval "launchctl stop gui/$UID/com.openclaw.gateway"',
      argv: ["eval", "launchctl stop gui/$UID/com.openclaw.gateway"],
    },
    {
      command: 'env -S "systemctl --user restart openclaw-gateway.service"',
      argv: ["env", "-S", "systemctl --user restart openclaw-gateway.service"],
    },
    {
      command: 'sh -lc "launchctl stop gui/$UID/com.openclaw.gateway"',
      argv: ["sh", "-lc", "launchctl stop gui/$UID/com.openclaw.gateway"],
    },
    {
      command: 'sh -c "openclaw update --yes"',
      argv: ["sh", "-c", "openclaw update --yes"],
    },
    {
      command: 'eval "true; openclaw update --yes"',
      argv: ["eval", "true; openclaw update --yes"],
    },
    {
      command: 'eval "true; openclaw --update"',
      argv: ["eval", "true; openclaw --update"],
    },
    {
      command: 'eval "true; openclaw uninstall --all --yes"',
      argv: ["eval", "true; openclaw uninstall --all --yes"],
    },
    {
      command: 'eval "true; openclaw gateway call update.run"',
      argv: ["eval", "true; openclaw gateway call update.run"],
    },
    {
      command: 'cmd.exe /d /s /c "schtasks /Run /TN \\"OpenClaw Gateway\\""',
      argv: ["cmd.exe", "/d", "/s", "/c", 'schtasks /Run /TN "OpenClaw Gateway"'],
    },
    {
      command: 'powershell.exe -NoProfile -Command "openclaw gateway restart"',
      argv: ["powershell.exe", "-NoProfile", "-Command", "openclaw gateway restart"],
    },
    {
      command: 'sh -c "openclaw gateway --force"',
      argv: ["sh", "-c", "openclaw gateway --force"],
    },
    {
      command: "timeout 5s openclaw gateway restart",
      argv: ["timeout", "5s", "openclaw", "gateway", "restart"],
    },
    {
      command: "timeout -sTERM 5s openclaw gateway restart",
      argv: ["timeout", "-sTERM", "5s", "openclaw", "gateway", "restart"],
    },
    {
      command: "timeout -f 5s openclaw gateway restart",
      argv: ["timeout", "-f", "5s", "openclaw", "gateway", "restart"],
    },
    {
      command: "timeout -p 5s openclaw gateway restart",
      argv: ["timeout", "-p", "5s", "openclaw", "gateway", "restart"],
    },
    {
      command: "/usr/bin/time -f%M openclaw gateway restart",
      argv: ["/usr/bin/time", "-f%M", "openclaw", "gateway", "restart"],
    },
    {
      command: '/usr/bin/time -f "" openclaw gateway restart',
      argv: ["/usr/bin/time", "-f", "", "openclaw", "gateway", "restart"],
    },
    {
      command: "/usr/bin/time -f --help openclaw gateway restart",
      argv: ["/usr/bin/time", "-f", "--help", "openclaw", "gateway", "restart"],
    },
    {
      command: "env -u --help openclaw gateway restart",
      argv: ["env", "-u", "--help", "openclaw", "gateway", "restart"],
    },
    {
      command: "env --argv0 --help /usr/bin/openclaw gateway restart",
      argv: ["env", "--argv0", "--help", "/usr/bin/openclaw", "gateway", "restart"],
    },
    {
      command: "env -a fake /usr/bin/openclaw gateway restart",
      argv: ["env", "-a", "fake", "/usr/bin/openclaw", "gateway", "restart"],
    },
    {
      command: "env --default-signal openclaw gateway restart",
      argv: ["env", "--default-signal", "openclaw", "gateway", "restart"],
    },
    {
      command: "env -v openclaw gateway restart",
      argv: ["env", "-v", "openclaw", "gateway", "restart"],
    },
    {
      command: "env --list-signal-handling openclaw gateway restart",
      argv: ["env", "--list-signal-handling", "openclaw", "gateway", "restart"],
    },
    {
      command: "env - openclaw gateway restart",
      argv: ["env", "-", "openclaw", "gateway", "restart"],
    },
    {
      command: 'env -S "FOO=bar openclaw gateway restart"',
      argv: ["env", "-S", "FOO=bar openclaw gateway restart"],
    },
    {
      command: "env -S '1=2 openclaw gateway restart'",
      argv: ["env", "-S", "1=2 openclaw gateway restart"],
    },
    {
      command: String.raw`env -S "X='a\'' openclaw gateway restart"`,
      argv: ["env", "-S", String.raw`X='a\'' openclaw gateway restart`],
    },
    {
      command: 'env -S "-u --help openclaw gateway restart"',
      argv: ["env", "-S", "-u --help openclaw gateway restart"],
    },
    {
      command: "env -S '-a \"\" openclaw gateway restart'",
      argv: ["env", "-S", '-a "" openclaw gateway restart'],
    },
    {
      command: "env -S '# ignored' openclaw gateway restart",
      argv: ["env", "-S", "# ignored", "openclaw", "gateway", "restart"],
    },
    {
      command: "env -S 'openclaw ${OC_AREA} ${OC_ACTION}'",
      argv: ["env", "-S", "openclaw ${OC_AREA} ${OC_ACTION}"],
    },
    {
      command: "env -u FOO -S 'openclaw ${OC_AREA} ${OC_ACTION}'",
      argv: ["env", "-u", "FOO", "-S", "openclaw ${OC_AREA} ${OC_ACTION}"],
    },
    {
      command: "env OC_BIN=openclaw env -S '${OC_BIN} gateway restart'",
      argv: ["env", "OC_BIN=openclaw", "env", "-S", "${OC_BIN} gateway restart"],
    },
    {
      command: "env CMD=openclaw env -S '${CMD} gateway restart'",
      argv: ["env", "CMD=openclaw", "env", "-S", "${CMD} gateway restart"],
    },
    {
      command: "env PNPM=pnpm env -S '${PNPM} -C repo openclaw gateway restart'",
      argv: ["env", "PNPM=pnpm", "env", "-S", "${PNPM} -C repo openclaw gateway restart"],
    },
    {
      command: "env -S '${OC_BIN} --profile work gateway restart'",
      argv: ["env", "-S", "${OC_BIN} --profile work gateway restart"],
    },
    {
      command: "env -S '${SYSTEMCTL} --user restart openclaw-gateway.service'",
      argv: ["env", "-S", "${SYSTEMCTL} --user restart openclaw-gateway.service"],
    },
    {
      command: "env -S '${EMPTY} systemctl --user restart openclaw-gateway.service'",
      argv: ["env", "-S", "${EMPTY} systemctl --user restart openclaw-gateway.service"],
    },
    {
      command: "env -S '${EMPTY}' openclaw gateway restart",
      argv: ["env", "-S", "${EMPTY}", "openclaw", "gateway", "restart"],
    },
    {
      command: "env -S '${EMPTY} -- openclaw gateway restart'",
      argv: ["env", "-S", "${EMPTY} -- openclaw gateway restart"],
    },
    {
      command: "env -S '${EMPTY} FOO=bar openclaw gateway restart'",
      argv: ["env", "-S", "${EMPTY} FOO=bar openclaw gateway restart"],
    },
    {
      command: "env -S '${EMPTY} nice -n 5 systemctl --user restart openclaw-gateway.service'",
      argv: ["env", "-S", "${EMPTY} nice -n 5 systemctl --user restart openclaw-gateway.service"],
    },
    {
      command: "env -S '${EMPTY}nice -n 5 systemctl --user restart openclaw-gateway.service'",
      argv: ["env", "-S", "${EMPTY}nice -n 5 systemctl --user restart openclaw-gateway.service"],
    },
    {
      command: "env -S 'nice ${EMPTY}-n 5 systemctl --user restart openclaw-gateway.service'",
      argv: ["env", "-S", "nice ${EMPTY}-n 5 systemctl --user restart openclaw-gateway.service"],
    },
    {
      command: 'env -S "" openclaw gateway restart',
      argv: ["env", "-S", "", "openclaw", "gateway", "restart"],
    },
    {
      command: String.raw`env -S "openclaw\_gateway\_restart"`,
      argv: ["env", "-S", String.raw`openclaw\_gateway\_restart`],
    },
    {
      command: String.raw`env -S 'sh -c "openclaw\_gateway\_restart"'`,
      argv: ["env", "-S", String.raw`sh -c "openclaw\_gateway\_restart"`],
    },
    {
      command: String.raw`env -S "openclaw\cignored" gateway restart`,
      argv: ["env", "-S", String.raw`openclaw\cignored`, "gateway", "restart"],
    },
    {
      command: "node /opt/openclaw/dist/index.js gateway restart",
      argv: ["node", "/opt/openclaw/dist/index.js", "gateway", "restart"],
    },
    {
      command: "npx --package openclaw openclaw gateway restart",
      argv: ["npx", "--package", "openclaw", "openclaw", "gateway", "restart"],
    },
    {
      command: "npx openclaw@latest gateway restart",
      argv: ["npx", "openclaw@latest", "gateway", "restart"],
    },
    {
      command: "npx openclaw@latest -- gateway restart",
      argv: ["npx", "openclaw@latest", "--", "gateway", "restart"],
    },
    {
      command: "pnpm dlx openclaw@2026.5.7 update --yes",
      argv: ["pnpm", "dlx", "openclaw@2026.5.7", "update", "--yes"],
    },
    {
      command: "pnpm dlx openclaw -- update --yes",
      argv: ["pnpm", "dlx", "openclaw", "--", "update", "--yes"],
    },
    {
      command: "bunx openclaw@latest uninstall --all --yes",
      argv: ["bunx", "openclaw@latest", "uninstall", "--all", "--yes"],
    },
    {
      command: "bunx openclaw@latest -- uninstall --all --yes",
      argv: ["bunx", "openclaw@latest", "--", "uninstall", "--all", "--yes"],
    },
    {
      command: "npm exec -c 'openclaw gateway restart'",
      argv: ["npm", "exec", "-c", "openclaw gateway restart"],
    },
    {
      command: "npx -c 'openclaw gateway restart'",
      argv: ["npx", "-c", "openclaw gateway restart"],
    },
    {
      command: String.raw`node C:\tools\openclaw\dist\entry.js daemon stop`,
      argv: ["node", String.raw`C:\tools\openclaw\dist\entry.js`, "daemon", "stop"],
    },
    {
      command: "exec -a display-name openclaw gateway restart",
      argv: ["exec", "-a", "display-name", "openclaw", "gateway", "restart"],
    },
    {
      command: "stdbuf -oL openclaw gateway restart",
      argv: ["stdbuf", "-oL", "openclaw", "gateway", "restart"],
    },
    {
      command: "/usr/bin/time -h openclaw gateway restart",
      argv: ["/usr/bin/time", "-h", "openclaw", "gateway", "restart"],
    },
    {
      command: "/usr/bin/time --portability openclaw gateway restart",
      argv: ["/usr/bin/time", "--portability", "openclaw", "gateway", "restart"],
    },
    {
      command: "nice -n 5 systemctl --user restart openclaw-gateway.service",
      argv: ["nice", "-n", "5", "systemctl", "--user", "restart", "openclaw-gateway.service"],
    },
    {
      command: "setsid openclaw gateway restart",
      argv: ["setsid", "openclaw", "gateway", "restart"],
    },
    {
      command: "setsid -fw openclaw gateway restart",
      argv: ["setsid", "-fw", "openclaw", "gateway", "restart"],
    },
    {
      command: "taskset 0x1 openclaw gateway restart",
      argv: ["taskset", "0x1", "openclaw", "gateway", "restart"],
    },
    {
      command: "ionice -c 2 -n 0 openclaw gateway restart",
      argv: ["ionice", "-c", "2", "-n", "0", "openclaw", "gateway", "restart"],
    },
    {
      command: "ionice -c2 -n0 openclaw gateway restart",
      argv: ["ionice", "-c2", "-n0", "openclaw", "gateway", "restart"],
    },
    {
      command: "chrt -f 50 systemctl --user restart openclaw-gateway.service",
      argv: ["chrt", "-f", "50", "systemctl", "--user", "restart", "openclaw-gateway.service"],
    },
    {
      command: "chrt -v -f 50 openclaw gateway restart",
      argv: ["chrt", "-v", "-f", "50", "openclaw", "gateway", "restart"],
    },
    {
      command: "chrt -Rf 50 systemctl --user restart openclaw-gateway.service",
      argv: ["chrt", "-Rf", "50", "systemctl", "--user", "restart", "openclaw-gateway.service"],
    },
    {
      command: "chrt -o openclaw gateway restart",
      argv: ["chrt", "-o", "openclaw", "gateway", "restart"],
    },
    {
      command: "chrt -o 0 openclaw gateway restart",
      argv: ["chrt", "-o", "0", "openclaw", "gateway", "restart"],
    },
    {
      command: "chrt -o systemctl --user restart openclaw-gateway.service",
      argv: ["chrt", "-o", "systemctl", "--user", "restart", "openclaw-gateway.service"],
    },
    {
      command: "flock /tmp/oc.lock -c 'systemctl --user restart openclaw-gateway.service'",
      argv: ["flock", "/tmp/oc.lock", "-c", "systemctl --user restart openclaw-gateway.service"],
    },
    {
      command: "CMD=openclaw flock /tmp/oc.lock -c 'env -S \"${CMD} gateway restart\"'",
      argv: ["flock", "/tmp/oc.lock", "-c", 'env -S "${CMD} gateway restart"'],
    },
    {
      command: "flock /tmp/oc.lock -c 'CMD=op\\enclaw env -S \"${CMD} gateway restart\"'",
      argv: ["flock", "/tmp/oc.lock", "-c", 'CMD=op\\enclaw env -S "${CMD} gateway restart"'],
    },
    {
      command: "printf x | xargs -I{} openclaw gateway restart",
      argv: ["xargs", "-I{}", "openclaw", "gateway", "restart"],
    },
    {
      command: "printf x | xargs --max-args=1 openclaw gateway restart",
      argv: ["xargs", "--max-args=1", "openclaw", "gateway", "restart"],
    },
    {
      command: "env env env env env openclaw gateway restart",
      argv: ["env", "env", "env", "env", "env", "openclaw", "gateway", "restart"],
    },
    {
      command: "find . -exec openclaw gateway restart {} ;",
      argv: ["find", ".", "-exec", "openclaw", "gateway", "restart", "{}", ";"],
    },
    {
      command: "find . -execdir sh -c 'systemctl --user restart openclaw-gateway.service' ;",
      argv: [
        "find",
        ".",
        "-execdir",
        "sh",
        "-c",
        "systemctl --user restart openclaw-gateway.service",
        ";",
      ],
    },
  ])("requires explicit approval for OpenClaw lifecycle command %j", ({ command, argv }) => {
    expect(
      commandRequiresOpenClawLifecycleApproval({
        command,
        segments: [{ raw: command, argv }],
      }),
    ).toBe(true);
  });

  it("fails closed when deeply nested transparent carriers exhaust structured matching", () => {
    const wrappers = Array.from({ length: 40 }, () => "env");
    const argv = [...wrappers, "openclaw", "gateway", "restart"];
    const command = argv.join(" ");

    expect(
      commandRequiresOpenClawLifecycleApproval({
        command,
        segments: [{ raw: command, argv }],
      }),
    ).toBe(true);
  });

  it("does not treat arbitrary Node dist entrypoints as OpenClaw lifecycle commands", () => {
    const command = "node /tmp/other/dist/index.js gateway restart";
    expect(
      commandRequiresOpenClawLifecycleApproval({
        command,
        segments: [
          { raw: command, argv: ["node", "/tmp/other/dist/index.js", "gateway", "restart"] },
        ],
      }),
    ).toBe(false);
  });

  it("uses cwd to classify relative OpenClaw Node entrypoints", () => {
    const command = "node ./dist/entry.js gateway restart";
    expect(
      commandRequiresOpenClawLifecycleApproval({
        command,
        cwd: "/opt/openclaw",
        segments: [{ raw: command, argv: ["node", "./dist/entry.js", "gateway", "restart"] }],
      }),
    ).toBe(true);
  });

  it("does not classify relative Node entrypoints outside an OpenClaw cwd", () => {
    const command = "node ./dist/entry.js gateway restart";
    expect(
      commandRequiresOpenClawLifecycleApproval({
        command,
        cwd: "/opt/other",
        segments: [{ raw: command, argv: ["node", "./dist/entry.js", "gateway", "restart"] }],
      }),
    ).toBe(false);
  });

  it("requires lifecycle approval when env -S expands a visible variable into a lifecycle command", () => {
    const command = "env -S '${CMD} gateway restart'";
    expect(
      commandRequiresOpenClawLifecycleApproval({
        command,
        env: {
          CMD: "openclaw",
        },
        segments: [{ raw: command, argv: ["env", "-S", "${CMD} gateway restart"] }],
      }),
    ).toBe(true);
  });

  it("requires lifecycle approval when env -S expands a visible bare variable into a lifecycle command", () => {
    const command = 'env -S "$CMD gateway restart"';
    expect(
      commandRequiresOpenClawLifecycleApproval({
        command,
        env: {
          CMD: "openclaw",
        },
        segments: [{ raw: command, argv: ["env", "-S", "$CMD gateway restart"] }],
      }),
    ).toBe(true);
  });

  it("requires lifecycle approval when shell defaults in env -S expand into a lifecycle command", () => {
    const command = 'env -S "${OC_BIN:-openclaw} gateway restart"';
    expect(
      commandRequiresOpenClawLifecycleApproval({
        command,
        env: {},
        segments: [{ raw: command, argv: ["env", "-S", "${OC_BIN:-openclaw} gateway restart"] }],
      }),
    ).toBe(true);
  });

  it("keeps partial shell defaults in env -S conservative after expansion", () => {
    const command = 'env -S "${OC_BIN:-openclaw} gateway restart"';
    expect(
      commandRequiresOpenClawLifecycleApproval({
        command,
        env: {},
        envComplete: false,
        segments: [{ raw: command, argv: ["env", "-S", "${OC_BIN:-openclaw} gateway restart"] }],
      }),
    ).toBe(true);
  });

  it("keeps partial env-S leading bare executable variables conservative", () => {
    const command = "env -S '$SHELL -c \"openclaw gateway restart\"'";
    expect(
      commandRequiresOpenClawLifecycleApproval({
        command,
        env: {},
        envComplete: false,
        segments: [{ raw: command, argv: ["env", "-S", '$SHELL -c "openclaw gateway restart"'] }],
      }),
    ).toBe(true);
  });

  it("requires lifecycle approval when env -S is followed by visible shell variables", () => {
    const command = "env -S '${CMD}' $AREA $ACTION";
    expect(
      commandRequiresOpenClawLifecycleApproval({
        command,
        env: {
          ACTION: "restart",
          AREA: "gateway",
          CMD: "openclaw",
        },
        segments: [{ raw: command, argv: ["env", "-S", "${CMD}", "$AREA", "$ACTION"] }],
      }),
    ).toBe(true);
  });

  it("does not use env -S assignments to expand trailing shell variables", () => {
    const command = "env -S 'AREA=gateway openclaw' $AREA restart";
    expect(
      commandRequiresOpenClawLifecycleApproval({
        command,
        env: {},
        segments: [
          { raw: command, argv: ["env", "-S", "AREA=gateway openclaw", "$AREA", "restart"] },
        ],
      }),
    ).toBe(false);
  });

  it("does not treat env -S literal dollar executables as shell variables", () => {
    const command = "env -S \"'${CMD}'\" $AREA $ACTION";
    expect(
      commandRequiresOpenClawLifecycleApproval({
        command,
        env: {},
        envComplete: false,
        segments: [{ raw: command, argv: ["env", "-S", "'${CMD}'", "$AREA", "$ACTION"] }],
      }),
    ).toBe(false);
  });

  it("does not use empty fallback when env -S variable has a benign visible value", () => {
    const command = "env -S '${CMD}' openclaw gateway restart";
    expect(
      commandRequiresOpenClawLifecycleApproval({
        command,
        env: {
          CMD: "echo",
        },
        segments: [
          { raw: command, argv: ["env", "-S", "${CMD}", "openclaw", "gateway", "restart"] },
        ],
      }),
    ).toBe(false);
  });

  it("does not retokenize env -S variable values containing spaces", () => {
    const command = "env -S '${CMD}'";
    expect(
      commandRequiresOpenClawLifecycleApproval({
        command,
        env: {
          CMD: "openclaw gateway restart",
        },
        segments: [{ raw: command, argv: ["env", "-S", "${CMD}"] }],
      }),
    ).toBe(false);
  });

  it("does not expand env -S variables inside single quotes", () => {
    const command = "env -S \"'${CMD}' gateway restart\"";
    expect(
      commandRequiresOpenClawLifecycleApproval({
        command,
        env: {
          CMD: "openclaw",
        },
        segments: [{ raw: command, argv: ["env", "-S", "'${CMD}' gateway restart"] }],
      }),
    ).toBe(false);
  });

  it("does not rescan substituted env -S variable values", () => {
    const command = "env -S '${CMD} gateway restart'";
    expect(
      commandRequiresOpenClawLifecycleApproval({
        command,
        env: {
          CMD: "${NEXT}",
          NEXT: "openclaw",
        },
        segments: [{ raw: command, argv: ["env", "-S", "${CMD} gateway restart"] }],
      }),
    ).toBe(false);
  });

  it("restores backslash markers before matching env -S variable executable paths", () => {
    const command = "env -S '${CMD} gateway restart'";
    expect(
      commandRequiresOpenClawLifecycleApproval({
        command,
        env: {
          CMD: String.raw`C:\tools\openclaw.exe`,
        },
        segments: [{ raw: command, argv: ["env", "-S", "${CMD} gateway restart"] }],
      }),
    ).toBe(true);
  });

  it("does not treat substituted env -S backslash escapes as env escapes", () => {
    const command = "CMD='openclaw\\_gateway\\_restart' env -S 'sh -c \"${CMD}\"'";
    expect(
      commandRequiresOpenClawLifecycleApproval({
        command,
        segments: [{ raw: command, argv: ["env", "-S", 'sh -c "${CMD}"'] }],
      }),
    ).toBe(false);
  });

  it("uses env -S assignments when escaped variables expand later inside shell wrappers", () => {
    const command = String.raw`env -S 'CMD=openclaw sh -c "\${CMD} gateway restart"'`;
    expect(
      commandRequiresOpenClawLifecycleApproval({
        command,
        segments: [
          {
            raw: command,
            argv: ["env", "-S", String.raw`CMD=openclaw sh -c "\${CMD} gateway restart"`],
          },
        ],
      }),
    ).toBe(true);
  });

  it("carries env assignments into unwrapped shell-wrapper payloads", () => {
    const command = "env CMD=$OC_BIN sh -c '$CMD gateway restart'";
    expect(
      commandRequiresOpenClawLifecycleApproval({
        command,
        env: {
          OC_BIN: "openclaw",
        },
        segments: [
          {
            raw: command,
            argv: ["env", "CMD=$OC_BIN", "sh", "-c", "$CMD gateway restart"],
          },
        ],
      }),
    ).toBe(true);
  });

  it("keeps unresolved env -S assignments conservative when shell wrappers expand them later", () => {
    const command = String.raw`CMD=\${OC_BIN:-openclaw} env -S 'sh -c "\${CMD} gateway restart"'`;
    expect(
      commandRequiresOpenClawLifecycleApproval({
        command,
        env: {},
        segments: [
          {
            raw: command,
            argv: ["env", "-S", String.raw`sh -c "\${CMD} gateway restart"`],
          },
        ],
      }),
    ).toBe(true);
  });

  it("honors outer env unset before evaluating nested env -S variables", () => {
    const command =
      "/usr/bin/env -u PATH /usr/bin/env -S '${PATH}' /usr/bin/openclaw gateway restart";
    expect(
      commandRequiresOpenClawLifecycleApproval({
        command,
        env: {
          PATH: "echo",
        },
        segments: [
          {
            raw: command,
            argv: [
              "/usr/bin/env",
              "-u",
              "PATH",
              "/usr/bin/env",
              "-S",
              "${PATH}",
              "/usr/bin/openclaw",
              "gateway",
              "restart",
            ],
          },
        ],
      }),
    ).toBe(true);
  });

  it("honors outer env clear before evaluating nested env -S variables", () => {
    const command = "/usr/bin/env - /usr/bin/env -S '${PATH}' /usr/bin/openclaw gateway restart";
    expect(
      commandRequiresOpenClawLifecycleApproval({
        command,
        env: {
          PATH: "echo",
        },
        segments: [
          {
            raw: command,
            argv: [
              "/usr/bin/env",
              "-",
              "/usr/bin/env",
              "-S",
              "${PATH}",
              "/usr/bin/openclaw",
              "gateway",
              "restart",
            ],
          },
        ],
      }),
    ).toBe(true);
  });

  it("uses the incoming env for env -S before same-invocation unsets are applied", () => {
    const command = "env -u CMD -S '${CMD} gateway restart'";
    expect(
      commandRequiresOpenClawLifecycleApproval({
        command,
        env: {
          CMD: "openclaw",
        },
        segments: [{ raw: command, argv: ["env", "-u", "CMD", "-S", "${CMD} gateway restart"] }],
      }),
    ).toBe(true);
  });

  it("requires lifecycle approval when env -S expands a visible wrapper variable", () => {
    const command = "env WRAP=timeout env -S '${WRAP} 5s openclaw gateway restart'";
    expect(
      commandRequiresOpenClawLifecycleApproval({
        command,
        segments: [
          {
            raw: command,
            argv: ["env", "WRAP=timeout", "env", "-S", "${WRAP} 5s openclaw gateway restart"],
          },
        ],
      }),
    ).toBe(true);
  });

  it("requires lifecycle approval when visible env -S expands into nested env -S", () => {
    const command = "env CMD=env NEXT=openclaw env -S '${CMD} -S ${NEXT} gateway restart'";
    expect(
      commandRequiresOpenClawLifecycleApproval({
        command,
        segments: [
          {
            raw: command,
            argv: [
              "env",
              "CMD=env",
              "NEXT=openclaw",
              "env",
              "-S",
              "${CMD} -S ${NEXT} gateway restart",
            ],
          },
        ],
      }),
    ).toBe(true);
  });

  it("requires lifecycle approval when an escaped env -S variable reaches a nested env", () => {
    const command = String.raw`env -S 'CMD=openclaw env -S "\${CMD} gateway restart"'`;
    expect(
      commandRequiresOpenClawLifecycleApproval({
        command,
        segments: [
          {
            raw: command,
            argv: ["env", "-S", String.raw`CMD=openclaw env -S "\${CMD} gateway restart"`],
          },
        ],
      }),
    ).toBe(true);
  });

  it("expands visible shell variables in env assignment operands before env -S checks", () => {
    const command = "env CMD=$OC_BIN env -S '${CMD} gateway restart'";
    expect(
      commandRequiresOpenClawLifecycleApproval({
        command,
        env: {
          OC_BIN: "openclaw",
        },
        segments: [
          {
            raw: command,
            argv: ["env", "CMD=$OC_BIN", "env", "-S", "${CMD} gateway restart"],
          },
        ],
      }),
    ).toBe(true);
  });

  it("expands env assignment operands from the incoming shell environment", () => {
    const command = "env CMD=echo CMD=$CMD env -S '${CMD} gateway restart'";
    expect(
      commandRequiresOpenClawLifecycleApproval({
        command,
        env: {
          CMD: "openclaw",
        },
        segments: [
          {
            raw: command,
            argv: ["env", "CMD=echo", "CMD=$CMD", "env", "-S", "${CMD} gateway restart"],
          },
        ],
      }),
    ).toBe(true);
  });

  it("does not trust unsupported shell expansion forms in env assignment operands", () => {
    const command = "CMD=${OC_BIN:-openclaw} env -S '${CMD} gateway restart'";
    expect(
      commandRequiresOpenClawLifecycleApproval({
        command,
        segments: [
          {
            raw: command,
            argv: ["env", "CMD=${OC_BIN:-openclaw}", "env", "-S", "${CMD} gateway restart"],
          },
        ],
      }),
    ).toBe(true);
  });

  it("carries env -S assignments into nested env -S expansion checks", () => {
    const command = String.raw`env -S 'CMD=openclaw AREA=gateway ACTION=restart env -S "\${CMD} \${AREA} \${ACTION}"'`;
    expect(
      commandRequiresOpenClawLifecycleApproval({
        command,
        segments: [
          {
            raw: command,
            argv: [
              "env",
              "-S",
              String.raw`CMD=openclaw AREA=gateway ACTION=restart env -S "\${CMD} \${AREA} \${ACTION}"`,
            ],
          },
        ],
      }),
    ).toBe(true);
  });

  it("requires lifecycle approval when env -S variables fill lifecycle positions behind a wrapper", () => {
    const command =
      "env OC_AREA=gateway OC_ACTION=restart env -S 'timeout 5s openclaw ${OC_AREA} ${OC_ACTION}'";
    expect(
      commandRequiresOpenClawLifecycleApproval({
        command,
        segments: [
          {
            raw: command,
            argv: [
              "env",
              "OC_AREA=gateway",
              "OC_ACTION=restart",
              "env",
              "-S",
              "timeout 5s openclaw ${OC_AREA} ${OC_ACTION}",
            ],
          },
        ],
      }),
    ).toBe(true);
  });

  it("requires lifecycle approval when a carrier OpenClaw executable is an env -S variable", () => {
    const command = "OC_BIN=openclaw env -S 'pnpm -C repo ${OC_BIN} gateway restart'";
    expect(
      commandRequiresOpenClawLifecycleApproval({
        command,
        segments: [
          {
            raw: command,
            argv: ["env", "-S", "pnpm -C repo ${OC_BIN} gateway restart"],
          },
        ],
      }),
    ).toBe(true);
  });

  it("requires lifecycle approval when env -S variables fill OpenClaw option positions", () => {
    const command = "DEV=--dev env -S 'openclaw ${DEV} gateway restart'";
    expect(
      commandRequiresOpenClawLifecycleApproval({
        command,
        segments: [
          {
            raw: command,
            argv: ["env", "-S", "openclaw ${DEV} gateway restart"],
          },
        ],
      }),
    ).toBe(true);
  });

  it("requires lifecycle approval when an unknown env -S executable may be a lifecycle wrapper", () => {
    const command = "WRAP=timeout env -S '${WRAP} 5s openclaw gateway restart'";
    expect(
      commandRequiresOpenClawLifecycleApproval({
        command,
        segments: [
          {
            raw: command,
            argv: ["env", "-S", "${WRAP} 5s openclaw gateway restart"],
          },
        ],
      }),
    ).toBe(true);
  });

  it("requires lifecycle approval when an unknown env -S executable may be a shell wrapper", () => {
    const command = "WRAP=${MISSING:-sh} env -S '${WRAP} -c \"openclaw gateway restart\"'";
    expect(
      commandRequiresOpenClawLifecycleApproval({
        command,
        segments: [
          {
            raw: command,
            argv: ["env", "-S", '${WRAP} -c "openclaw gateway restart"'],
          },
        ],
      }),
    ).toBe(true);
  });

  it("requires lifecycle approval when an unknown env -S executable may be another supported shell", () => {
    const command = "WRAP=${MISSING:-zsh} env -S '${WRAP} -c \"openclaw gateway restart\"'";
    expect(
      commandRequiresOpenClawLifecycleApproval({
        command,
        segments: [
          {
            raw: command,
            argv: ["env", "-S", '${WRAP} -c "openclaw gateway restart"'],
          },
        ],
      }),
    ).toBe(true);
  });

  it("requires lifecycle approval when an unknown env -S executable may be a shell multiplexer", () => {
    const command = "WRAP=${MISSING:-busybox} env -S '${WRAP} sh -c \"openclaw gateway restart\"'";
    expect(
      commandRequiresOpenClawLifecycleApproval({
        command,
        segments: [
          {
            raw: command,
            argv: ["env", "-S", '${WRAP} sh -c "openclaw gateway restart"'],
          },
        ],
      }),
    ).toBe(true);
  });

  it("requires lifecycle approval when an unknown env -S executable may be flock", () => {
    const command =
      "WRAP=flock env -S '${WRAP} /tmp/oc.lock systemctl --user restart openclaw-gateway.service'";
    expect(
      commandRequiresOpenClawLifecycleApproval({
        command,
        segments: [
          {
            raw: command,
            argv: [
              "env",
              "-S",
              "${WRAP} /tmp/oc.lock systemctl --user restart openclaw-gateway.service",
            ],
          },
        ],
      }),
    ).toBe(true);
  });

  it("requires lifecycle approval when an unknown env -S executable may be sudo", () => {
    const command =
      "WRAP=sudo env -S '${WRAP} -u root systemctl --user restart openclaw-gateway.service'";
    expect(
      commandRequiresOpenClawLifecycleApproval({
        command,
        segments: [
          {
            raw: command,
            argv: [
              "env",
              "-S",
              "${WRAP} -u root systemctl --user restart openclaw-gateway.service",
            ],
          },
        ],
      }),
    ).toBe(true);
  });

  it("carries sudo environment assignments into nested env -S lifecycle detection", () => {
    const command = "sudo CMD=openclaw env -S '${CMD} gateway restart'";
    expect(
      commandRequiresOpenClawLifecycleApproval({
        command,
        env: {},
        segments: [
          {
            raw: command,
            argv: ["sudo", "CMD=openclaw", "env", "-S", "${CMD} gateway restart"],
          },
        ],
      }),
    ).toBe(true);
  });

  it("carries sudo environment assignments after value-taking sudo options", () => {
    const command = "sudo -R /jail CMD=openclaw env -S '${CMD} gateway restart'";
    expect(
      commandRequiresOpenClawLifecycleApproval({
        command,
        env: {},
        segments: [
          {
            raw: command,
            argv: ["sudo", "-R", "/jail", "CMD=openclaw", "env", "-S", "${CMD} gateway restart"],
          },
        ],
      }),
    ).toBe(true);
  });

  it("keeps unresolved sudo environment assignments conservative for nested env -S lifecycle detection", () => {
    const command = "sudo CMD=${MISSING} env -S '${CMD} gateway restart'";
    expect(
      commandRequiresOpenClawLifecycleApproval({
        command,
        env: {},
        segments: [
          {
            raw: command,
            argv: ["sudo", "CMD=${MISSING}", "env", "-S", "${CMD} gateway restart"],
          },
        ],
      }),
    ).toBe(true);
  });

  it("requires lifecycle approval when an env -S process target may be OpenClaw", () => {
    const command = "PATTERN=${MISSING:-openclaw} env -S 'pkill ${PATTERN}'";
    expect(
      commandRequiresOpenClawLifecycleApproval({
        command,
        segments: [
          {
            raw: command,
            argv: ["env", "-S", "pkill ${PATTERN}"],
          },
        ],
      }),
    ).toBe(true);
  });

  it("requires lifecycle approval when ordinary shell variables fill OpenClaw lifecycle tokens", () => {
    const command = "openclaw $OC_AREA $OC_ACTION";
    expect(
      commandRequiresOpenClawLifecycleApproval({
        command,
        segments: [{ raw: command, argv: ["openclaw", "$OC_AREA", "$OC_ACTION"] }],
      }),
    ).toBe(true);
  });

  it("requires lifecycle approval when ordinary shell assignments fill systemctl lifecycle tokens", () => {
    const command = "ACTION=restart UNIT=openclaw-gateway.service systemctl --user $ACTION $UNIT";
    expect(
      commandRequiresOpenClawLifecycleApproval({
        command,
        segments: [
          {
            raw: command,
            argv: [
              "ACTION=restart",
              "UNIT=openclaw-gateway.service",
              "systemctl",
              "--user",
              "$ACTION",
              "$UNIT",
            ],
          },
        ],
      }),
    ).toBe(true);
  });

  it("requires lifecycle approval when ordinary shell assignments fill process targets", () => {
    const command = 'PATTERN=openclaw pkill "$PATTERN"';
    expect(
      commandRequiresOpenClawLifecycleApproval({
        command,
        segments: [{ raw: command, argv: ["PATTERN=openclaw", "pkill", "$PATTERN"] }],
      }),
    ).toBe(true);
  });

  it("uses visible ordinary shell assignments before conservative lifecycle expansion", () => {
    const command = "ACTION=status UNIT=openclaw-gateway.service systemctl --user $ACTION $UNIT";
    expect(
      commandRequiresOpenClawLifecycleApproval({
        command,
        segments: [
          {
            raw: command,
            argv: [
              "ACTION=status",
              "UNIT=openclaw-gateway.service",
              "systemctl",
              "--user",
              "$ACTION",
              "$UNIT",
            ],
          },
        ],
      }),
    ).toBe(false);
  });

  it("keeps partial environments conservative for ordinary shell lifecycle variables", () => {
    const command = "openclaw $OC_AREA $OC_ACTION";
    expect(
      commandRequiresOpenClawLifecycleApproval({
        command,
        env: { PATH: "/usr/bin" },
        envComplete: false,
        segments: [{ raw: command, argv: ["openclaw", "$OC_AREA", "$OC_ACTION"] }],
      }),
    ).toBe(true);
  });

  it("treats missing ordinary shell variables as empty when the environment is complete", () => {
    const command = "openclaw $OC_AREA $OC_ACTION";
    expect(
      commandRequiresOpenClawLifecycleApproval({
        command,
        env: { PATH: "/usr/bin" },
        envComplete: true,
        segments: [{ raw: command, argv: ["openclaw", "$OC_AREA", "$OC_ACTION"] }],
      }),
    ).toBe(false);
  });

  it("keeps partial environments conservative for gateway call method variables", () => {
    const command = "openclaw gateway call $METHOD";
    expect(
      commandRequiresOpenClawLifecycleApproval({
        command,
        env: { PATH: "/usr/bin" },
        envComplete: false,
        segments: [{ raw: command, argv: ["openclaw", "gateway", "call", "$METHOD"] }],
      }),
    ).toBe(true);
  });

  it("treats missing gateway call method variables as empty when the environment is complete", () => {
    const command = "openclaw gateway call $METHOD";
    expect(
      commandRequiresOpenClawLifecycleApproval({
        command,
        env: { PATH: "/usr/bin" },
        envComplete: true,
        segments: [{ raw: command, argv: ["openclaw", "gateway", "call", "$METHOD"] }],
      }),
    ).toBe(false);
  });

  it("carries assignment-only shell variables into later lifecycle segments", () => {
    const command = "OC_AREA=gateway; OC_ACTION=restart; openclaw $OC_AREA $OC_ACTION";
    expect(
      commandRequiresOpenClawLifecycleApproval({
        command,
        env: {},
        envComplete: true,
        segments: [
          { raw: "OC_AREA=gateway", argv: ["OC_AREA=gateway"] },
          { raw: "OC_ACTION=restart", argv: ["OC_ACTION=restart"] },
          { raw: "openclaw $OC_AREA $OC_ACTION", argv: ["openclaw", "$OC_AREA", "$OC_ACTION"] },
        ],
      }),
    ).toBe(true);
  });

  it("does not treat harmless assignment-only shell variables as lifecycle mutations", () => {
    const command = "OC_AREA=gateway; OC_ACTION=status; openclaw $OC_AREA $OC_ACTION";
    expect(
      commandRequiresOpenClawLifecycleApproval({
        command,
        env: {},
        envComplete: true,
        segments: [
          { raw: "OC_AREA=gateway", argv: ["OC_AREA=gateway"] },
          { raw: "OC_ACTION=status", argv: ["OC_ACTION=status"] },
          { raw: "openclaw $OC_AREA $OC_ACTION", argv: ["openclaw", "$OC_AREA", "$OC_ACTION"] },
        ],
      }),
    ).toBe(false);
  });

  it("carries exported shell variables into later lifecycle segments", () => {
    const command =
      "export OC_AREA=gateway; export OC_ACTION=restart; openclaw $OC_AREA $OC_ACTION";
    expect(
      commandRequiresOpenClawLifecycleApproval({
        command,
        env: {},
        envComplete: true,
        segments: [
          { raw: "export OC_AREA=gateway", argv: ["export", "OC_AREA=gateway"] },
          { raw: "export OC_ACTION=restart", argv: ["export", "OC_ACTION=restart"] },
          { raw: "openclaw $OC_AREA $OC_ACTION", argv: ["openclaw", "$OC_AREA", "$OC_ACTION"] },
        ],
      }),
    ).toBe(true);
  });

  it("does not treat harmless exported shell variables as lifecycle mutations", () => {
    const command = "export OC_AREA=gateway; export OC_ACTION=status; openclaw $OC_AREA $OC_ACTION";
    expect(
      commandRequiresOpenClawLifecycleApproval({
        command,
        env: {},
        envComplete: true,
        segments: [
          { raw: "export OC_AREA=gateway", argv: ["export", "OC_AREA=gateway"] },
          { raw: "export OC_ACTION=status", argv: ["export", "OC_ACTION=status"] },
          { raw: "openclaw $OC_AREA $OC_ACTION", argv: ["openclaw", "$OC_AREA", "$OC_ACTION"] },
        ],
      }),
    ).toBe(false);
  });

  it("field-splits expanded shell variables before matching OpenClaw lifecycle tokens", () => {
    const command = "ARGS='gateway restart'; openclaw $ARGS";
    expect(
      commandRequiresOpenClawLifecycleApproval({
        command,
        env: {},
        envComplete: true,
        segments: [
          { raw: "ARGS='gateway restart'", argv: ["ARGS=gateway restart"] },
          { raw: "openclaw $ARGS", argv: ["openclaw", "$ARGS"] },
        ],
      }),
    ).toBe(true);
  });

  it("field-splits expanded shell variables before matching systemctl lifecycle tokens", () => {
    const command = "ARGS='restart openclaw-gateway.service'; systemctl --user $ARGS";
    expect(
      commandRequiresOpenClawLifecycleApproval({
        command,
        env: {},
        envComplete: true,
        segments: [
          {
            raw: "ARGS='restart openclaw-gateway.service'",
            argv: ["ARGS=restart openclaw-gateway.service"],
          },
          { raw: "systemctl --user $ARGS", argv: ["systemctl", "--user", "$ARGS"] },
        ],
      }),
    ).toBe(true);
  });

  it("does not treat harmless field-split shell variables as lifecycle mutations", () => {
    const command = "ARGS='gateway status'; openclaw $ARGS";
    expect(
      commandRequiresOpenClawLifecycleApproval({
        command,
        env: {},
        envComplete: true,
        segments: [
          { raw: "ARGS='gateway status'", argv: ["ARGS=gateway status"] },
          { raw: "openclaw $ARGS", argv: ["openclaw", "$ARGS"] },
        ],
      }),
    ).toBe(false);
  });

  it("requires lifecycle approval when POSIX defaults fill OpenClaw lifecycle tokens", () => {
    const command = "openclaw ${OC_AREA:-gateway} ${OC_ACTION:-restart}";
    expect(
      commandRequiresOpenClawLifecycleApproval({
        command,
        env: {},
        envComplete: true,
        segments: [
          {
            raw: command,
            argv: ["openclaw", "${OC_AREA:-gateway}", "${OC_ACTION:-restart}"],
          },
        ],
      }),
    ).toBe(true);
  });

  it("requires lifecycle approval when unknown POSIX plus expansion can fill OpenClaw executable", () => {
    const command = 'env -S "${OC_BIN+openclaw} gateway restart"';
    expect(
      commandRequiresOpenClawLifecycleApproval({
        command,
        env: {},
        envComplete: false,
        segments: [{ raw: command, argv: ["env", "-S", "${OC_BIN+openclaw} gateway restart"] }],
      }),
    ).toBe(true);
  });

  it("requires lifecycle approval when POSIX defaults fill systemctl lifecycle tokens", () => {
    const command = "systemctl --user ${ACTION:-restart} ${UNIT:-openclaw-gateway.service}";
    expect(
      commandRequiresOpenClawLifecycleApproval({
        command,
        env: {},
        envComplete: true,
        segments: [
          {
            raw: command,
            argv: [
              "systemctl",
              "--user",
              "${ACTION:-restart}",
              "${UNIT:-openclaw-gateway.service}",
            ],
          },
        ],
      }),
    ).toBe(true);
  });

  it("does not require lifecycle approval when POSIX defaults keep OpenClaw read-only", () => {
    const command = "openclaw ${OC_AREA:-gateway} ${OC_ACTION:-status}";
    expect(
      commandRequiresOpenClawLifecycleApproval({
        command,
        env: {},
        envComplete: true,
        segments: [
          {
            raw: command,
            argv: ["openclaw", "${OC_AREA:-gateway}", "${OC_ACTION:-status}"],
          },
        ],
      }),
    ).toBe(false);
  });

  it("does not require lifecycle approval when unknown POSIX plus expansion stays benign", () => {
    const command = 'env -S "${OC_BIN+echo} gateway restart"';
    expect(
      commandRequiresOpenClawLifecycleApproval({
        command,
        env: {},
        envComplete: false,
        segments: [{ raw: command, argv: ["env", "-S", "${OC_BIN+echo} gateway restart"] }],
      }),
    ).toBe(false);
  });

  it("does not require lifecycle approval when an env -S process option variable is not a target", () => {
    const command = "SIGNAL=TERM env -S 'pkill -${SIGNAL} nginx'";
    expect(
      commandRequiresOpenClawLifecycleApproval({
        command,
        segments: [
          {
            raw: command,
            argv: ["env", "-S", "pkill -${SIGNAL} nginx"],
          },
        ],
      }),
    ).toBe(false);
  });

  it("does not require lifecycle approval when an env -S process option value variable is not a target", () => {
    const command = "SIGNAL=TERM env -S 'pkill --signal ${SIGNAL} nginx'";
    expect(
      commandRequiresOpenClawLifecycleApproval({
        command,
        segments: [
          {
            raw: command,
            argv: ["env", "-S", "pkill --signal ${SIGNAL} nginx"],
          },
        ],
      }),
    ).toBe(false);
  });

  it("still requires lifecycle approval when an env -S process flag is followed by an OpenClaw target", () => {
    const command = "env -S 'pkill -x openclaw'";
    expect(
      commandRequiresOpenClawLifecycleApproval({
        command,
        segments: [
          {
            raw: command,
            argv: ["env", "-S", "pkill -x openclaw"],
          },
        ],
      }),
    ).toBe(true);
  });

  it("does not reintroduce known benign env -S variables after partial substitution", () => {
    const command = "env -S '${CMD} gateway ${ACTION}'";
    expect(
      commandRequiresOpenClawLifecycleApproval({
        command,
        env: {
          CMD: "echo",
        },
        segments: [{ raw: command, argv: ["env", "-S", "${CMD} gateway ${ACTION}"] }],
      }),
    ).toBe(false);
  });

  it("uses shell-prefix assignments when evaluating env -S variables", () => {
    const command = "CMD=openclaw env -S 'sh -c \"${CMD} gateway restart\"'";
    expect(
      commandRequiresOpenClawLifecycleApproval({
        command,
        segments: [
          {
            raw: command,
            argv: ["env", "-S", 'sh -c "${CMD} gateway restart"'],
          },
        ],
      }),
    ).toBe(true);
  });

  it("treats env -S assignments after -- as environment operands before lifecycle commands", () => {
    const command = "env -S '-- FOO=bar openclaw gateway restart'";
    expect(
      commandRequiresOpenClawLifecycleApproval({
        command,
        segments: [{ raw: command, argv: ["env", "-S", "-- FOO=bar openclaw gateway restart"] }],
      }),
    ).toBe(true);
  });

  it("treats dash-prefixed env -S assignments after -- as environment operands before lifecycle commands", () => {
    const command = "env -S '-- -X=1 openclaw gateway restart'";
    expect(
      commandRequiresOpenClawLifecycleApproval({
        command,
        segments: [{ raw: command, argv: ["env", "-S", "-- -X=1 openclaw gateway restart"] }],
      }),
    ).toBe(true);
  });

  it("treats dash-prefixed env assignments after -- as environment operands before lifecycle commands", () => {
    const command = "env -- -X=1 openclaw gateway restart";
    expect(
      commandRequiresOpenClawLifecycleApproval({
        command,
        segments: [{ raw: command, argv: ["env", "--", "-X=1", "openclaw", "gateway", "restart"] }],
      }),
    ).toBe(true);
  });

  it("does not re-treat benign shell-prefix assignments as unknown env -S executables", () => {
    const command = "CMD=echo env -S '${CMD} gateway restart'";
    expect(
      commandRequiresOpenClawLifecycleApproval({
        command,
        segments: [
          {
            raw: command,
            argv: ["env", "-S", "${CMD} gateway restart"],
          },
        ],
      }),
    ).toBe(false);
  });

  it("treats missing env -S variables as empty when env is known", () => {
    const command = "env -S '${CMD} gateway restart'";
    expect(
      commandRequiresOpenClawLifecycleApproval({
        command,
        env: {},
        segments: [{ raw: command, argv: ["env", "-S", "${CMD} gateway restart"] }],
      }),
    ).toBe(false);
  });

  it("does not treat env -S bare variables as executable expansions", () => {
    const command = "env -S '$CMD'";
    expect(
      commandRequiresOpenClawLifecycleApproval({
        command,
        env: {
          CMD: "openclaw gateway restart",
        },
        segments: [{ raw: command, argv: ["env", "-S", "$CMD"] }],
      }),
    ).toBe(false);
  });

  it("treats missing env -S leading bare executable variables as empty when env is complete", () => {
    const command = "env -S '$SHELL -c \"openclaw gateway restart\"'";
    expect(
      commandRequiresOpenClawLifecycleApproval({
        command,
        env: {},
        segments: [{ raw: command, argv: ["env", "-S", '$SHELL -c "openclaw gateway restart"'] }],
      }),
    ).toBe(false);
  });

  it("does not treat escaped env -S variables as executable expansions", () => {
    const command = String.raw`env -S '\${CMD}'`;
    expect(
      commandRequiresOpenClawLifecycleApproval({
        command,
        env: {
          CMD: "openclaw gateway restart",
        },
        segments: [{ raw: command, argv: ["env", "-S", String.raw`\${CMD}`] }],
      }),
    ).toBe(false);
  });

  it.each([
    {
      command: "launchctl print gui/$UID/com.openclaw.gateway",
      argv: ["launchctl", "print", "gui/$UID/com.openclaw.gateway"],
    },
    {
      command: "systemctl --user status openclaw-gateway.service",
      argv: ["systemctl", "--user", "status", "openclaw-gateway.service"],
    },
    {
      command: "systemctl --type service status openclaw-gateway.service",
      argv: ["systemctl", "--type", "service", "status", "openclaw-gateway.service"],
    },
    {
      command: "openclaw update status --json --timeout 9",
      argv: ["openclaw", "update", "status", "--json", "--timeout", "9"],
    },
    {
      command: "openclaw update --dry-run --channel beta",
      argv: ["openclaw", "update", "--dry-run", "--channel", "beta"],
    },
    {
      command: "openclaw --update status --json",
      argv: ["openclaw", "--update", "status", "--json"],
    },
    {
      command: "openclaw --update --dry-run --channel beta",
      argv: ["openclaw", "--update", "--dry-run", "--channel", "beta"],
    },
    {
      command: "openclaw update --help",
      argv: ["openclaw", "update", "--help"],
    },
    {
      command: "openclaw uninstall --dry-run --all",
      argv: ["openclaw", "uninstall", "--dry-run", "--all"],
    },
    {
      command: "openclaw uninstall --help",
      argv: ["openclaw", "uninstall", "--help"],
    },
    {
      command: 'sh -c "openclaw update --dry-run --channel beta"',
      argv: ["sh", "-c", "openclaw update --dry-run --channel beta"],
    },
    {
      command: 'eval "true; openclaw update status --json"',
      argv: ["eval", "true; openclaw update status --json"],
    },
    {
      command: 'eval "true; openclaw gateway call update.status"',
      argv: ["eval", "true; openclaw gateway call update.status"],
    },
    {
      command: "sudo systemctl status openclaw-gateway.service",
      argv: ["sudo", "systemctl", "status", "openclaw-gateway.service"],
    },
    {
      command: "pidof openclaw",
      argv: ["pidof", "openclaw"],
    },
    {
      command: "kill 12345",
      argv: ["kill", "12345"],
    },
    {
      command: "openclaw gateway status",
      argv: ["openclaw", "gateway", "status"],
    },
    {
      command: "openclaw gateway --help",
      argv: ["openclaw", "gateway", "--help"],
    },
    {
      command: "openclaw gateway run --help",
      argv: ["openclaw", "gateway", "run", "--help"],
    },
    {
      command: 'sh -c "openclaw gateway run --help"',
      argv: ["sh", "-c", "openclaw gateway run --help"],
    },
    {
      command: "openclaw gateway call health",
      argv: ["openclaw", "gateway", "call", "health"],
    },
    {
      command: "openclaw gateway call update.status",
      argv: ["openclaw", "gateway", "call", "update.status"],
    },
    {
      command: "openclaw gateway call --json logs.tail --params '{}'",
      argv: ["openclaw", "gateway", "call", "--json", "logs.tail", "--params", "{}"],
    },
    {
      command: 'schtasks /Query /TN "OpenClaw Gateway"',
      argv: ["schtasks", "/Query", "/TN", "OpenClaw Gateway"],
    },
    {
      command: 'cmd.exe /d /s /c "schtasks /Query /TN \\"OpenClaw Gateway\\""',
      argv: ["cmd.exe", "/d", "/s", "/c", 'schtasks /Query /TN "OpenClaw Gateway"'],
    },
    {
      command: 'powershell.exe -NoProfile -Command "openclaw gateway status"',
      argv: ["powershell.exe", "-NoProfile", "-Command", "openclaw gateway status"],
    },
    {
      command: "timeout 5s openclaw gateway status",
      argv: ["timeout", "5s", "openclaw", "gateway", "status"],
    },
    {
      command: "nice -n 5 systemctl --user status openclaw-gateway.service",
      argv: ["nice", "-n", "5", "systemctl", "--user", "status", "openclaw-gateway.service"],
    },
    {
      command: 'nice -n 5 echo "openclaw gateway restart"',
      argv: ["nice", "-n", "5", "echo", "openclaw gateway restart"],
    },
    {
      command: 'nohup echo "openclaw gateway restart"',
      argv: ["nohup", "echo", "openclaw gateway restart"],
    },
    {
      command: "setsid openclaw gateway status",
      argv: ["setsid", "openclaw", "gateway", "status"],
    },
    {
      command: 'setsid echo "openclaw gateway restart"',
      argv: ["setsid", "echo", "openclaw gateway restart"],
    },
    {
      command: "taskset 0x1 openclaw gateway status",
      argv: ["taskset", "0x1", "openclaw", "gateway", "status"],
    },
    {
      command: "ionice -p 1234 openclaw gateway restart",
      argv: ["ionice", "-p", "1234", "openclaw", "gateway", "restart"],
    },
    {
      command: 'chrt -o echo "openclaw gateway restart"',
      argv: ["chrt", "-o", "echo", "openclaw gateway restart"],
    },
    {
      command: "flock /tmp/oc.lock echo -c 'systemctl --user restart openclaw-gateway.service'",
      argv: [
        "flock",
        "/tmp/oc.lock",
        "echo",
        "-c",
        "systemctl --user restart openclaw-gateway.service",
      ],
    },
    {
      command: "/usr/bin/time --help openclaw gateway restart",
      argv: ["/usr/bin/time", "--help", "openclaw", "gateway", "restart"],
    },
    {
      command: "timeout --help openclaw gateway restart",
      argv: ["timeout", "--help", "openclaw", "gateway", "restart"],
    },
    {
      command: "nice --help openclaw gateway restart",
      argv: ["nice", "--help", "openclaw", "gateway", "restart"],
    },
    {
      command: "flock --help openclaw gateway restart",
      argv: ["flock", "--help", "openclaw", "gateway", "restart"],
    },
    {
      command: "nohup --help openclaw gateway restart",
      argv: ["nohup", "--help", "openclaw", "gateway", "restart"],
    },
    {
      command: "env --help openclaw gateway restart",
      argv: ["env", "--help", "openclaw", "gateway", "restart"],
    },
    {
      command: "env --default-signal --help openclaw gateway restart",
      argv: ["env", "--default-signal", "--help", "openclaw", "gateway", "restart"],
    },
    {
      command: 'env -S "--help openclaw gateway restart"',
      argv: ["env", "-S", "--help openclaw gateway restart"],
    },
    {
      command: "env -S 'echo openclaw ${OC_AREA} ${OC_ACTION}'",
      argv: ["env", "-S", "echo openclaw ${OC_AREA} ${OC_ACTION}"],
    },
    {
      command: "env -S 'openclaw config get ${KEY}'",
      argv: ["env", "-S", "openclaw config get ${KEY}"],
    },
    {
      command: "env -S 'systemctl --user status ${UNIT}'",
      argv: ["env", "-S", "systemctl --user status ${UNIT}"],
    },
    {
      command: "env -S 'systemctl ${ACTION} nginx.service'",
      argv: ["env", "-S", "systemctl ${ACTION} nginx.service"],
    },
    {
      command: "env FOO=bar -u BAZ openclaw gateway restart",
      argv: ["env", "FOO=bar", "-u", "BAZ", "openclaw", "gateway", "restart"],
    },
    {
      command: "env -S '\"\" openclaw gateway restart'",
      argv: ["env", "-S", '"" openclaw gateway restart'],
    },
    {
      command: String.raw`env -S "echo '\c' openclaw gateway restart"`,
      argv: ["env", "-S", String.raw`echo '\c' openclaw gateway restart`],
    },
    {
      command: String.raw`env -S "openclaw\ngateway\trestart"`,
      argv: ["env", "-S", String.raw`openclaw\ngateway\trestart`],
    },
    {
      command: "env -S 'openclaw gateway restart $BAD'",
      argv: ["env", "-S", "openclaw gateway restart $BAD"],
    },
    {
      command: 'env -S "${OC_BIN:-echo} gateway restart"',
      argv: ["env", "-S", "${OC_BIN:-echo} gateway restart"],
    },
    {
      command: "env --help -S 'openclaw ${OC_AREA} ${OC_ACTION}'",
      argv: ["env", "--help", "-S", "openclaw ${OC_AREA} ${OC_ACTION}"],
    },
    {
      command: "echo env -S 'openclaw ${OC_AREA} ${OC_ACTION}'",
      argv: ["echo", "env", "-S", "openclaw ${OC_AREA} ${OC_ACTION}"],
    },
    {
      command: "node -e 'console.log(process.argv)' openclaw gateway restart",
      argv: ["node", "-e", "console.log(process.argv)", "openclaw", "gateway", "restart"],
    },
    {
      command: "node --print 'process.argv' openclaw gateway restart",
      argv: ["node", "--print", "process.argv", "openclaw", "gateway", "restart"],
    },
    {
      command: 'echo "kill -TERM $(pidof openclaw)"',
      argv: ["echo", "kill -TERM $(pidof openclaw)"],
    },
    {
      command: String.raw`sh -c 'echo openclaw\_gateway\_restart'`,
      argv: ["sh", "-c", String.raw`echo openclaw\_gateway\_restart`],
    },
    {
      command: "xargs --help openclaw gateway restart",
      argv: ["xargs", "--help", "openclaw", "gateway", "restart"],
    },
    {
      command: "xargs --max-args openclaw gateway restart",
      argv: ["xargs", "--max-args", "openclaw", "gateway", "restart"],
    },
    {
      command: "find . -name openclaw gateway restart",
      argv: ["find", ".", "-name", "openclaw", "gateway", "restart"],
    },
    {
      command: "npx @openclaw/plugin-sdk gateway restart",
      argv: ["npx", "@openclaw/plugin-sdk", "gateway", "restart"],
    },
  ])(
    "does not require lifecycle approval for read-only or generic command %j",
    ({ command, argv }) => {
      expect(
        commandRequiresOpenClawLifecycleApproval({
          command,
          segments: [{ raw: command, argv }],
        }),
      ).toBe(false);
    },
  );

  it("treats exact-command allow-always approvals as durable trust", () => {
    expect(
      hasDurableExecApproval({
        analysisOk: false,
        segmentAllowlistEntries: [],
        allowlist: [
          {
            pattern: "=command:613b5a60181648fd",
            source: "allow-always",
          },
        ],
        commandText: 'powershell -NoProfile -Command "Write-Output hi"',
      }),
    ).toBe(true);
  });

  it("treats fully allow-always-matched segments as durable trust", () => {
    expect(
      hasDurableExecApproval({
        analysisOk: true,
        segmentAllowlistEntries: [
          { pattern: "/usr/bin/echo", source: "allow-always" },
          { pattern: "/usr/bin/printf", source: "allow-always" },
        ],
        allowlist: [],
      }),
    ).toBe(true);
  });

  it("marks policy-blocked segments as non-durable allowlist entries", () => {
    const executable = makeMockExecutableResolution({
      rawExecutable: "/usr/bin/echo",
      resolvedPath: "/usr/bin/echo",
      resolvedRealPath: "/usr/bin/echo",
      executableName: "echo",
    });
    const result = evaluateExecAllowlist({
      analysis: {
        ok: true,
        segments: [
          {
            raw: "/usr/bin/echo ok",
            argv: ["/usr/bin/echo", "ok"],
            resolution: makeMockCommandResolution({
              execution: executable,
            }),
          },
          {
            raw: "/bin/sh -lc whoami",
            argv: ["/bin/sh", "-lc", "whoami"],
            resolution: makeMockCommandResolution({
              execution: makeMockExecutableResolution({
                rawExecutable: "/bin/sh",
                resolvedPath: "/bin/sh",
                executableName: "sh",
              }),
              policyBlocked: true,
            }),
          },
        ],
      },
      allowlist: [{ pattern: "/usr/bin/echo", source: "allow-always" }],
      safeBins: new Set(),
      cwd: "/tmp",
      platform: process.platform,
    });

    expect(result.allowlistSatisfied).toBe(false);
    expect(result.segmentAllowlistEntries).toHaveLength(2);
    expectFields(result.segmentAllowlistEntries[0], { pattern: "/usr/bin/echo" });
    expect(result.segmentAllowlistEntries[1]).toBeNull();
    expect(
      hasDurableExecApproval({
        analysisOk: true,
        segmentAllowlistEntries: result.segmentAllowlistEntries,
        allowlist: [{ pattern: "/usr/bin/echo", source: "allow-always" }],
      }),
    ).toBe(false);
  });

  it("explains stricter host security and ask precedence", () => {
    const summary = summarizeExecPolicyScopeSnapshot({
      approvals: {
        version: 1,
        defaults: {
          security: "allowlist",
          ask: "always",
          askFallback: "deny",
        },
      },
      scopeExecConfig: {
        security: "full",
        ask: "off",
      },
      configPath: "tools.exec",
      scopeLabel: "tools.exec",
    });

    expectFields(summary.security, {
      requested: "full",
      host: "allowlist",
      effective: "allowlist",
      hostSource: "~/.openclaw/exec-approvals.json defaults.security",
      note: "stricter host security wins",
    });
    expectFields(summary.ask, {
      requested: "off",
      host: "always",
      effective: "always",
      hostSource: "~/.openclaw/exec-approvals.json defaults.ask",
      note: "more aggressive ask wins",
    });
    expect(summary.askFallback).toEqual({
      effective: "deny",
      source: "~/.openclaw/exec-approvals.json defaults.askFallback",
    });
  });

  it("maps normalized requested mode into policy snapshots", () => {
    const summary = summarizeExecPolicyScopeSnapshot({
      approvals: {
        version: 1,
      },
      scopeExecConfig: {
        mode: "auto",
      },
      configPath: "tools.exec",
      scopeLabel: "tools.exec",
    });

    expectFields(summary.mode, {
      requested: "auto",
      requestedSource: "tools.exec.mode",
      effective: "auto",
      note: "requested mode applies",
    });
    expectFields(summary.security, {
      requested: "allowlist",
      requestedSource: "tools.exec.mode",
      effective: "allowlist",
    });
    expectFields(summary.ask, {
      requested: "on-miss",
      requestedSource: "tools.exec.mode",
      effective: "on-miss",
    });
  });

  it("lets narrower legacy policy override a global normalized mode in snapshots", () => {
    const summary = summarizeExecPolicyScopeSnapshot({
      approvals: {
        version: 1,
      },
      globalExecConfig: {
        mode: "deny",
      },
      scopeExecConfig: {
        security: "full",
        ask: "off",
      },
      configPath: "agents.list.runner.tools.exec",
      scopeLabel: "agent:runner",
      agentId: "runner",
    });

    expectFields(summary.mode, {
      requested: "full",
      requestedSource:
        "derived from agents.list.runner.tools.exec.security and agents.list.runner.tools.exec.ask",
      effective: "full",
    });
    expectFields(summary.security, {
      requested: "full",
      requestedSource: "agents.list.runner.tools.exec.security",
      effective: "full",
    });
  });

  it("preserves mode-derived siblings for partial narrower legacy policy snapshots", () => {
    const summary = summarizeExecPolicyScopeSnapshot({
      approvals: {
        version: 1,
      },
      globalExecConfig: {
        mode: "auto",
      },
      scopeExecConfig: {
        ask: "off",
      },
      configPath: "agents.list.runner.tools.exec",
      scopeLabel: "agent:runner",
      agentId: "runner",
    });

    expectFields(summary.security, {
      requested: "allowlist",
      requestedSource: "tools.exec.mode",
    });
    expectFields(summary.ask, {
      requested: "off",
      requestedSource: "agents.list.runner.tools.exec.ask",
    });
    expectFields(summary.mode, {
      requested: "allowlist",
      effective: "allowlist",
    });
  });

  it("reports full plus on-miss as full because on-miss only gates allowlist misses", () => {
    const summary = summarizeExecPolicyScopeSnapshot({
      approvals: {
        version: 1,
      },
      globalExecConfig: {
        mode: "auto",
      },
      scopeExecConfig: {
        security: "full",
      },
      configPath: "agents.list.runner.tools.exec",
      scopeLabel: "agent:runner",
      agentId: "runner",
    });

    expectFields(summary.security, {
      requested: "full",
      requestedSource: "agents.list.runner.tools.exec.security",
    });
    expectFields(summary.ask, {
      requested: "on-miss",
      requestedSource: "tools.exec.mode",
    });
    expectFields(summary.mode, {
      requested: "full",
      effective: "full",
    });
  });

  it("uses the actual approvals path when reporting host sources", () => {
    const summary = summarizeExecPolicyScopeSnapshot({
      approvals: {
        version: 1,
        defaults: {
          security: "allowlist",
          ask: "always",
          askFallback: "deny",
        },
      },
      scopeExecConfig: {
        security: "full",
        ask: "off",
      },
      configPath: "tools.exec",
      scopeLabel: "tools.exec",
      hostPath: "/tmp/node-exec-approvals.json",
    });

    expect(summary.security.hostSource).toBe("/tmp/node-exec-approvals.json defaults.security");
    expect(summary.ask.hostSource).toBe("/tmp/node-exec-approvals.json defaults.ask");
    expect(summary.askFallback).toEqual({
      effective: "deny",
      source: "/tmp/node-exec-approvals.json defaults.askFallback",
    });
  });

  it("uses OPENCLAW_STATE_DIR when reporting default host sources", () => {
    const originalOpenClawStateDir = process.env.OPENCLAW_STATE_DIR;
    const stateDir = path.join(process.cwd(), ".tmp-openclaw-state");
    process.env.OPENCLAW_STATE_DIR = stateDir;
    try {
      const summary = summarizeExecPolicyScopeSnapshot({
        approvals: {
          version: 1,
          defaults: {
            security: "allowlist",
          },
        },
        scopeExecConfig: {
          security: "full",
        },
        configPath: "tools.exec",
        scopeLabel: "tools.exec",
      });

      expect(summary.security.hostSource).toBe(
        `${path.join(stateDir, "exec-approvals.json")} defaults.security`,
      );
    } finally {
      if (originalOpenClawStateDir === undefined) {
        delete process.env.OPENCLAW_STATE_DIR;
      } else {
        process.env.OPENCLAW_STATE_DIR = originalOpenClawStateDir;
      }
    }
  });

  it("does not let host ask=off suppress a stricter requested ask", () => {
    const summary = summarizeExecPolicyScopeSnapshot({
      approvals: {
        version: 1,
        defaults: {
          ask: "off",
        },
      },
      scopeExecConfig: {
        ask: "always",
      },
      configPath: "tools.exec",
      scopeLabel: "tools.exec",
    });

    expectFields(summary.ask, {
      requested: "always",
      host: "off",
      effective: "always",
      note: "requested ask applies",
    });
  });

  it("clamps askFallback to the effective security", () => {
    const summary = summarizeExecPolicyScopeSnapshot({
      approvals: {
        version: 1,
        defaults: {
          security: "full",
          ask: "always",
          askFallback: "full",
        },
      },
      scopeExecConfig: {
        security: "allowlist",
        ask: "always",
      },
      configPath: "tools.exec",
      scopeLabel: "tools.exec",
    });

    expect(summary.askFallback).toEqual({
      effective: "allowlist",
      source: "~/.openclaw/exec-approvals.json defaults.askFallback",
    });
  });

  it("skips malformed host fields when attributing their source", () => {
    expectMalformedAgentAskUsesDefaults("foo");
  });

  it("ignores malformed non-string host fields when attributing their source", () => {
    expectMalformedAgentAskUsesDefaults(true);
  });

  it("does not credit mixed-case host fields that resolution ignores", () => {
    expectMalformedAgentAskUsesDefaults("Always");
  });

  it("attributes host policy to wildcard agent entries before defaults", () => {
    const summary = summarizeExecPolicyScopeSnapshot({
      approvals: {
        version: 1,
        defaults: {
          security: "full",
          ask: "off",
          askFallback: "full",
        },
        agents: {
          "*": {
            security: "allowlist",
            ask: "always",
            askFallback: "deny",
          },
        },
      },
      scopeExecConfig: {
        security: "full",
        ask: "off",
      },
      configPath: "agents.list.runner.tools.exec",
      scopeLabel: "agent:runner",
      agentId: "runner",
    });

    expectFields(summary.security, {
      host: "allowlist",
      hostSource: "~/.openclaw/exec-approvals.json agents.*.security",
    });
    expectFields(summary.ask, {
      host: "always",
      hostSource: "~/.openclaw/exec-approvals.json agents.*.ask",
    });
    expect(summary.askFallback).toEqual({
      effective: "deny",
      source: "~/.openclaw/exec-approvals.json agents.*.askFallback",
    });
  });

  it("inherits requested agent policy from global tools.exec config", () => {
    const summary = summarizeExecPolicyScopeSnapshot({
      approvals: {
        version: 1,
        agents: {
          runner: {
            security: "allowlist",
            ask: "always",
          },
        },
      },
      globalExecConfig: {
        security: "full",
        ask: "off",
      },
      configPath: "agents.list.runner.tools.exec",
      scopeLabel: "agent:runner",
      agentId: "runner",
    });

    expectFields(summary.security, {
      requested: "full",
      requestedSource: "tools.exec.security",
      host: "allowlist",
      effective: "allowlist",
    });
    expectFields(summary.ask, {
      requested: "off",
      requestedSource: "tools.exec.ask",
      host: "always",
      effective: "always",
    });
  });

  it("reports askFallback from the OpenClaw default when approvals omit it", () => {
    const summary = summarizeExecPolicyScopeSnapshot({
      approvals: {
        version: 1,
        agents: {},
      },
      configPath: "tools.exec",
      scopeLabel: "tools.exec",
    });

    expect(summary.askFallback).toEqual({
      effective: "deny",
      source: "OpenClaw default (deny)",
    });
  });

  it("collects global, configured-agent, and approvals-only agent scopes", () => {
    const snapshots = collectExecPolicyScopeSnapshots({
      cfg: {
        tools: {
          exec: {
            security: "full",
            ask: "off",
          },
        },
        agents: {
          list: [{ id: "runner" }],
        },
      } satisfies OpenClawConfig,
      approvals: {
        version: 1,
        agents: {
          runner: {
            security: "allowlist",
          },
          batch: {
            ask: "always",
          },
        },
      },
    });

    expect(snapshots.map((snapshot) => snapshot.scopeLabel)).toEqual([
      "tools.exec",
      "agent:batch",
      "agent:runner",
    ]);
    expectFields(snapshots[1]?.ask, {
      requested: "off",
      requestedSource: "tools.exec.ask",
      host: "always",
      effective: "always",
    });
    expectFields(snapshots[2]?.security, {
      requested: "full",
      requestedSource: "tools.exec.security",
      host: "allowlist",
      effective: "allowlist",
    });
  });

  it("avoids a duplicate default-agent scope when main only appears in approvals", () => {
    const snapshots = collectExecPolicyScopeSnapshots({
      cfg: {
        tools: {
          exec: {
            security: "full",
            ask: "off",
          },
        },
      } satisfies OpenClawConfig,
      approvals: {
        version: 1,
        agents: {
          [DEFAULT_AGENT_ID]: {
            security: "allowlist",
            ask: "always",
          },
        },
      },
    });

    expect(snapshots.map((snapshot) => snapshot.scopeLabel)).toEqual(["tools.exec"]);
    expectFields(snapshots[0]?.security, {
      host: "allowlist",
      hostSource: "~/.openclaw/exec-approvals.json agents.main.security",
    });
    expectFields(snapshots[0]?.ask, {
      host: "always",
      hostSource: "~/.openclaw/exec-approvals.json agents.main.ask",
    });
  });

  it("keeps the default agent scope when main has an explicit exec override", () => {
    const snapshots = collectExecPolicyScopeSnapshots({
      cfg: {
        tools: {
          exec: {
            security: "full",
            ask: "off",
          },
        },
        agents: {
          list: [
            {
              id: DEFAULT_AGENT_ID,
              tools: {
                exec: {
                  ask: "always",
                },
              },
            },
          ],
        },
      } satisfies OpenClawConfig,
      approvals: {
        version: 1,
      },
    });

    expect(snapshots.map((snapshot) => snapshot.scopeLabel)).toEqual(["tools.exec", "agent:main"]);
    expectFields(snapshots[1]?.ask, {
      requested: "always",
      requestedSource: "agents.list.main.tools.exec.ask",
    });
  });
});
