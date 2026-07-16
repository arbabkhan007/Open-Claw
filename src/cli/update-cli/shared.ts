// Shared update command primitives for channel resolution, install roots, and subprocess steps.
import { spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { normalizeLowercaseStringOrEmpty } from "@openclaw/normalization-core/string-coerce";
import { theme } from "../../../packages/terminal-core/src/theme.js";
import { resolveStateDir } from "../../config/paths.js";
import { resolveRequiredHomeDir } from "../../infra/home-dir.js";
import { resolveOpenClawPackageRoot } from "../../infra/openclaw-root.js";
import { readPackageName, readPackageVersion } from "../../infra/package-json.js";
import { normalizePackageTagInput } from "../../infra/package-tag.js";
import { parseStrictPositiveInteger } from "../../infra/parse-finite-number.js";
import { trimLogTail } from "../../infra/restart-sentinel.js";
import { parseSemver } from "../../infra/runtime-guard.js";
import { fetchNpmTagVersion } from "../../infra/update-check.js";
import {
  canResolveRegistryVersionForPackageTarget,
  createGlobalInstallEnv,
  detectGlobalInstallManagerByPresence,
  detectGlobalInstallManagerForRoot,
  type CommandRunner,
  type GlobalInstallManager,
} from "../../infra/update-global.js";
import type { UpdateStepProgress, UpdateStepResult } from "../../infra/update-runner.js";
import { runCommandWithTimeout } from "../../process/exec.js";
import { defaultRuntime } from "../../runtime.js";
import { pathExists } from "../../utils.js";
import { COMPLETION_SKIP_PLUGIN_COMMANDS_ENV } from "../completion-runtime.js";

export type UpdateCommandOptions = {
  json?: boolean;
  restart?: boolean;
  dryRun?: boolean;
  channel?: string;
  tag?: string;
  timeout?: string;
  yes?: boolean;
  acknowledgeClawHubRisk?: boolean;
};

export type UpdateStatusOptions = {
  json?: boolean;
  timeout?: string;
};

export type UpdateFinalizeOptions = {
  json?: boolean;
  channel?: string;
  timeout?: string;
  yes?: boolean;
  restart?: boolean;
  acknowledgeClawHubRisk?: boolean;
};

export type UpdateWizardOptions = {
  timeout?: string;
};

const INVALID_TIMEOUT_ERROR = "--timeout must be a positive integer (seconds)";
const MAX_SAFE_TIMEOUT_SECONDS = Math.floor(Number.MAX_SAFE_INTEGER / 1000);
const MANAGED_CHECKOUT_MARKER = ".openclaw-update-managed";

function managedCheckoutRecordPath(dir: string, env?: NodeJS.ProcessEnv): string {
  const digest = createHash("sha256").update(path.resolve(dir)).digest("hex");
  return path.join(resolveStateDir(env), "update-checkouts", `${digest}.token`);
}

async function readTrimmed(file: string): Promise<string | null> {
  return await fs
    .readFile(file, "utf8")
    .then((value) => value.trim())
    .catch(() => null);
}

export async function isManagedGitCheckoutRetry(
  dir: string,
  env?: NodeJS.ProcessEnv,
): Promise<boolean> {
  const [recordToken, markerToken] = await Promise.all([
    readTrimmed(managedCheckoutRecordPath(dir, env)),
    readTrimmed(path.join(dir, ".git", MANAGED_CHECKOUT_MARKER)),
  ]);
  return Boolean(recordToken && markerToken && recordToken === markerToken);
}

export async function completeManagedGitCheckout(
  dir: string,
  env?: NodeJS.ProcessEnv,
): Promise<void> {
  await fs.rm(managedCheckoutRecordPath(dir, env), { force: true });
  await fs.rm(path.join(dir, ".git", MANAGED_CHECKOUT_MARKER), { force: true });
}

/** Build a Git environment that cannot redirect the canonical repository through config. */
export function createSanitizedGitEnv(env?: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const gitEnv = { ...(env ?? process.env) };
  gitEnv.GIT_CONFIG_NOSYSTEM = "1";
  gitEnv.GIT_CONFIG_GLOBAL = os.devNull;
  delete gitEnv.GIT_CONFIG_PARAMETERS;
  delete gitEnv.GIT_CONFIG_COUNT;
  for (const key of Object.keys(gitEnv)) {
    if (/^GIT_CONFIG_(?:KEY|VALUE)_\d+$/u.test(key)) {
      delete gitEnv[key];
    }
  }
  return gitEnv;
}

/** Parse a CLI timeout in seconds, exiting through the runtime on invalid input. */
export function parseTimeoutMsOrExit(timeout?: string): number | undefined | null {
  if (timeout === undefined) {
    return undefined;
  }
  const trimmed = timeout.trim();
  const seconds = parseStrictPositiveInteger(trimmed);
  if (seconds === undefined || seconds > MAX_SAFE_TIMEOUT_SECONDS) {
    defaultRuntime.error(INVALID_TIMEOUT_ERROR);
    defaultRuntime.exit(1);
    return null;
  }
  return seconds * 1000;
}

const OPENCLAW_REPO_URL = "https://github.com/openclaw/openclaw.git";
const MAX_LOG_CHARS = 8000;

export const DEFAULT_PACKAGE_NAME = "openclaw";

/** Normalize a CLI tag/version/spec into the npm target form accepted by update flows. */
export function normalizeTag(value?: string | null): string | null {
  return normalizePackageTagInput(value, ["openclaw", DEFAULT_PACKAGE_NAME]);
}

function normalizeVersionTag(tag: string): string | null {
  const trimmed = tag.trim();
  if (!trimmed) {
    return null;
  }
  const cleaned = trimmed.startsWith("v") ? trimmed.slice(1) : trimmed;
  return parseSemver(cleaned) ? cleaned : null;
}

export { readPackageName, readPackageVersion };

/** Resolve an npm dist-tag or explicit version into a concrete package version. */
export async function resolveTargetVersion(
  tag: string,
  timeoutMs?: number,
  options: { spec?: string; command?: string; cwd?: string; env?: NodeJS.ProcessEnv } = {},
): Promise<string | null> {
  if (!canResolveRegistryVersionForPackageTarget(tag)) {
    return null;
  }
  const direct = normalizeVersionTag(tag);
  if (direct) {
    return direct;
  }
  const res = await fetchNpmTagVersion({
    tag,
    timeoutMs,
    spec: options.spec,
    command: options.command,
    cwd: options.cwd,
    env: options.env,
  });
  return res.version ?? null;
}

/** Resolve the checkout path used by source-based self-update. */
export function resolveGitInstallDir(): string {
  const override = process.env.OPENCLAW_GIT_DIR?.trim();
  if (override) {
    return path.resolve(override);
  }
  return resolveDefaultGitDir();
}

function resolveDefaultGitDir(): string {
  const home = resolveRequiredHomeDir(process.env, os.homedir);
  if (home.startsWith("/")) {
    return path.posix.join(home, "openclaw");
  }
  return path.join(home, "openclaw");
}

/** Prefer the current Node executable, falling back to `node` when run through another shim. */
export function resolveNodeRunner(): string {
  const base = normalizeLowercaseStringOrEmpty(path.basename(process.execPath));
  if (base === "node" || base === "node.exe") {
    return process.execPath;
  }
  return "node";
}

/** Locate the installed OpenClaw package root that should receive update operations. */
export async function resolveUpdateRoot(): Promise<string> {
  // Preserve the lexical package path from the invoking shim. pnpm 11 package
  // modules realpath into a shared store, which is not the install owner.
  const invocationRoot = process.argv[1]
    ? await resolveOpenClawPackageRoot({ cwd: path.dirname(path.resolve(process.argv[1])) })
    : null;
  return (
    invocationRoot ??
    (await resolveOpenClawPackageRoot({ moduleUrl: import.meta.url, cwd: process.cwd() })) ??
    process.cwd()
  );
}

/** Run one update subprocess and report bounded stdout/stderr tails to progress listeners. */
export async function runUpdateStep(params: {
  name: string;
  argv: string[];
  cwd?: string;
  timeoutMs: number;
  progress?: UpdateStepProgress;
  env?: NodeJS.ProcessEnv;
}): Promise<UpdateStepResult> {
  const command = params.argv.join(" ");
  params.progress?.onStepStart?.({
    name: params.name,
    command,
    index: 0,
    total: 0,
  });

  const started = Date.now();
  const res = await runCommandWithTimeout(params.argv, {
    cwd: params.cwd,
    env: params.env,
    timeoutMs: params.timeoutMs,
  });
  const durationMs = Date.now() - started;
  const stderrTail = trimLogTail(res.stderr, MAX_LOG_CHARS);

  params.progress?.onStepComplete?.({
    name: params.name,
    command,
    index: 0,
    total: 0,
    durationMs,
    exitCode: res.code,
    stderrTail,
    signal: res.signal,
    killed: res.killed,
    termination: res.termination,
  });

  return {
    name: params.name,
    command,
    cwd: params.cwd ?? process.cwd(),
    durationMs,
    exitCode: res.code,
    stdoutTail: trimLogTail(res.stdout, MAX_LOG_CHARS),
    stderrTail,
    signal: res.signal,
    killed: res.killed,
    termination: res.termination,
  };
}

/** Create the source-update checkout without adopting any pre-existing directory state. */
export async function createGitCheckout(params: {
  dir: string;
  timeoutMs: number;
  progress?: UpdateStepProgress;
  env?: NodeJS.ProcessEnv;
  beforeReplaceManagedCheckout?: () => Promise<void>;
}): Promise<UpdateStepResult> {
  const recordPath = managedCheckoutRecordPath(params.dir, params.env);
  const managedRetry = await isManagedGitCheckoutRetry(params.dir, params.env);
  const cloneDir = managedRetry
    ? path.join(
        path.dirname(params.dir),
        `.${path.basename(params.dir)}.replacement-${randomUUID()}`,
      )
    : params.dir;
  const markerPath = path.join(cloneDir, ".git", MANAGED_CHECKOUT_MARKER);
  if (managedRetry) {
    await params.beforeReplaceManagedCheckout?.();
  }
  await fs.mkdir(path.dirname(params.dir), { recursive: true });
  try {
    // Creating the destination ourselves closes the check/create race that
    // would otherwise let an existing empty directory be adopted by git clone.
    await fs.mkdir(cloneDir);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "EEXIST") {
      throw new Error(
        `OPENCLAW_GIT_DIR already exists: ${params.dir}. Package-to-dev conversion creates a fresh OpenClaw checkout and will not reuse existing directories. Move it or set OPENCLAW_GIT_DIR to an unused path.`,
        { cause: err },
      );
    }
    throw err;
  }

  try {
    const gitEnv = createSanitizedGitEnv(params.env ?? (await createGlobalInstallEnv()));
    const result = await runUpdateStep({
      name: "git clone",
      argv: ["git", "clone", OPENCLAW_REPO_URL, cloneDir],
      env: gitEnv,
      timeoutMs: params.timeoutMs,
      progress: params.progress,
    });
    if (managedRetry && result.exitCode !== 0) {
      await fs.rm(cloneDir, { recursive: true, force: true });
    }
    if (result.exitCode === 0) {
      const token = randomUUID();
      await fs.mkdir(path.dirname(recordPath), { recursive: true });
      await fs.writeFile(markerPath, `${token}\n`, { encoding: "utf8", mode: 0o600 });
      if (managedRetry) {
        const backupDir = `${params.dir}.previous-${randomUUID()}`;
        await fs.rename(params.dir, backupDir);
        try {
          await fs.rename(cloneDir, params.dir);
          await fs.writeFile(recordPath, `${token}\n`, { encoding: "utf8", mode: 0o600 });
        } catch (err) {
          await fs.rm(params.dir, { recursive: true, force: true });
          await fs.rename(backupDir, params.dir);
          throw err;
        }
        await fs.rm(backupDir, { recursive: true, force: true }).catch(() => undefined);
      } else {
        await fs.writeFile(recordPath, `${token}\n`, { encoding: "utf8", mode: 0o600 });
      }
    }
    return result;
  } catch (err) {
    const cleanupError = await fs.rm(cloneDir, { recursive: true, force: true }).then(
      () => null,
      (error: unknown) => error,
    );
    if (cleanupError) {
      throw new AggregateError(
        [err, cleanupError],
        `Git clone failed (${String(err)}) and its new checkout could not be removed (${String(cleanupError)})`,
        { cause: err },
      );
    }
    throw err;
  }
}

/** Detect the package manager that owns a global/package OpenClaw install. */
export async function resolveGlobalManager(params: {
  root: string;
  installKind: "git" | "package" | "unknown";
  timeoutMs: number;
}): Promise<GlobalInstallManager> {
  const runCommand = createGlobalCommandRunner();

  if (params.installKind === "package") {
    const detected = await detectGlobalInstallManagerForRoot(
      runCommand,
      params.root,
      params.timeoutMs,
    );
    if (detected) {
      return detected;
    }
  }

  const byPresence = await detectGlobalInstallManagerByPresence(runCommand, params.timeoutMs);
  return byPresence ?? "npm";
}

const COMPLETION_CACHE_WRITE_TIMEOUT_MS = 30_000;
const COMPLETION_CACHE_MANUAL_REFRESH_HINT =
  "Shell tab-completion may be stale; refresh manually with: openclaw completion --write-state";

/** Best-effort refresh of shell completion state after a successful update. */
export async function tryWriteCompletionCache(root: string, jsonMode: boolean): Promise<void> {
  const binPath = path.join(root, "openclaw.mjs");
  if (!(await pathExists(binPath))) {
    return;
  }

  const result = spawnSync(resolveNodeRunner(), [binPath, "completion", "--write-state"], {
    cwd: root,
    env: {
      ...process.env,
      [COMPLETION_SKIP_PLUGIN_COMMANDS_ENV]: "1",
    },
    encoding: "utf-8",
    timeout: COMPLETION_CACHE_WRITE_TIMEOUT_MS,
  });

  if (result.error) {
    if (!jsonMode) {
      const err = result.error as NodeJS.ErrnoException;
      const reason =
        err.code === "ETIMEDOUT"
          ? `timed out after ${COMPLETION_CACHE_WRITE_TIMEOUT_MS / 1000}s`
          : String(result.error);
      defaultRuntime.log(
        theme.warn(
          `Completion cache update failed: ${reason}. ${COMPLETION_CACHE_MANUAL_REFRESH_HINT}`,
        ),
      );
    }
    return;
  }

  if (result.status !== 0 && !jsonMode) {
    const stderr = (result.stderr ?? "").trim();
    const detail = stderr ? ` (${stderr})` : "";
    defaultRuntime.log(
      theme.warn(
        `Completion cache update failed${detail}. ${COMPLETION_CACHE_MANUAL_REFRESH_HINT}`,
      ),
    );
  }
}

/** Adapter used by global-install detection helpers to execute bounded subprocess probes. */
export function createGlobalCommandRunner(): CommandRunner {
  return async (argv, options) => {
    const res = await runCommandWithTimeout(argv, options);
    return { stdout: res.stdout, stderr: res.stderr, code: res.code };
  };
}
