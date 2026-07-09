// Manages exec approval policy, allowlist entries, and host targeting.
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  normalizeLowercaseStringOrEmpty,
  normalizeOptionalLowercaseString,
  normalizeOptionalString,
  readStringValue,
} from "@openclaw/normalization-core/string-coerce";
import { DEFAULT_AGENT_ID } from "../routing/session-key.js";
import { splitShellArgs } from "../utils/shell-argv.js";
import type { CommandExplanationSummary } from "./command-analysis/explain.js";
import { sha256Hex, sha256HexPrefix } from "./crypto-digest.js";
import {
  type AllowAlwaysPattern,
  resolveAllowAlwaysPatternEntries,
} from "./exec-approvals-allowlist.js";
import type { ExecCommandSegment } from "./exec-approvals-analysis.js";
import type { ExecAllowlistEntry } from "./exec-approvals.types.js";
import type { ExecAuthorizationPlan } from "./exec-authorization-plan.js";
import {
  extractBindableShellWrapperInlineCommand,
  extractShellWrapperInlineCommand,
  isShellWrapperInvocation,
  unwrapKnownDispatchWrapperInvocation,
} from "./exec-wrapper-resolution.js";
import { assertNoSymlinkParentsSync } from "./fs-safe-advanced.js";
import { expandHomePrefix, resolveHomeRelativePath, resolveRequiredHomeDir } from "./home-dir.js";
import { requestJsonlSocket } from "./jsonl-socket.js";
import {
  hasPosixInteractiveStartupBeforeInlineCommand,
  hasPosixLoginStartupBeforeInlineCommand,
  POSIX_INLINE_COMMAND_FLAGS,
} from "./shell-inline-command.js";
export * from "./exec-approvals-analysis.js";
export * from "./exec-approvals-allowlist.js";
export type { ExecAllowlistEntry } from "./exec-approvals.types.js";

export type ExecHost = "sandbox" | "gateway" | "node";
export type ExecTarget = "auto" | ExecHost;
export type ExecSecurity = "deny" | "allowlist" | "full";
export type ExecAsk = "off" | "on-miss" | "always";
export type ExecMode = "deny" | "allowlist" | "ask" | "auto" | "full";

export const EXEC_TARGET_VALUES: readonly ExecTarget[] = ["auto", "sandbox", "gateway", "node"];

export function normalizeExecHost(value?: string | null): ExecHost | null {
  const normalized = normalizeOptionalLowercaseString(value);
  if (normalized === "sandbox" || normalized === "gateway" || normalized === "node") {
    return normalized;
  }
  return null;
}

export function normalizeExecTarget(value?: string | null): ExecTarget | null {
  const normalized = normalizeOptionalLowercaseString(value);
  if (normalized === "auto") {
    return normalized;
  }
  return normalizeExecHost(normalized);
}

export function requireValidExecTarget(value?: unknown): ExecTarget | null {
  if (value == null) {
    return null;
  }
  if (typeof value !== "string") {
    throw new Error(
      `Invalid exec host value type ${typeof value}. Allowed values: ${EXEC_TARGET_VALUES.join(
        ", ",
      )}.`,
    );
  }
  const normalized = normalizeOptionalLowercaseString(value);
  if (!normalized) {
    return null;
  }
  const target = normalizeExecTarget(normalized);
  if (target) {
    return target;
  }
  throw new Error(
    `Invalid exec host "${value}". Allowed values: ${EXEC_TARGET_VALUES.join(", ")}.`,
  );
}

/** Coerce a raw JSON field to string, returning undefined for non-string types. */
const toStringOrUndefined = readStringValue;

export function normalizeExecSecurity(value?: string | null): ExecSecurity | null {
  const normalized = normalizeOptionalLowercaseString(value);
  if (normalized === "deny" || normalized === "allowlist" || normalized === "full") {
    return normalized;
  }
  return null;
}

export function normalizeExecAsk(value?: string | null): ExecAsk | null {
  const normalized = normalizeOptionalLowercaseString(value);
  if (normalized === "off" || normalized === "on-miss" || normalized === "always") {
    return normalized;
  }
  return null;
}

export function normalizeExecMode(value?: string | null): ExecMode | null {
  const normalized = normalizeOptionalLowercaseString(value);
  if (
    normalized === "deny" ||
    normalized === "allowlist" ||
    normalized === "ask" ||
    normalized === "auto" ||
    normalized === "full"
  ) {
    return normalized;
  }
  return null;
}

export function resolveExecModeFromPolicy(params: {
  security: ExecSecurity;
  ask: ExecAsk;
}): ExecMode {
  if (params.security === "deny") {
    return "deny";
  }
  if (params.security === "allowlist" && params.ask === "off") {
    return "allowlist";
  }
  if (params.security === "full" && params.ask !== "always") {
    return "full";
  }
  return "ask";
}

export function resolveExecPolicyForMode(mode: ExecMode): {
  security: ExecSecurity;
  ask: ExecAsk;
  autoReview: boolean;
} {
  switch (mode) {
    case "deny":
      return { security: "deny", ask: "off", autoReview: false };
    case "allowlist":
      return { security: "allowlist", ask: "off", autoReview: false };
    case "ask":
      return { security: "allowlist", ask: "on-miss", autoReview: false };
    case "auto":
      return { security: "allowlist", ask: "on-miss", autoReview: true };
    case "full":
      return { security: "full", ask: "off", autoReview: false };
  }
  const exhaustiveMode: never = mode;
  throw new Error(`Unsupported exec mode: ${String(exhaustiveMode)}`);
}

export function resolveExecModePolicy(params: {
  mode?: ExecMode | null;
  security: ExecSecurity;
  ask: ExecAsk;
}): {
  mode: ExecMode;
  security: ExecSecurity;
  ask: ExecAsk;
  autoReview: boolean;
} {
  if (!params.mode) {
    return {
      mode: resolveExecModeFromPolicy({ security: params.security, ask: params.ask }),
      security: params.security,
      ask: params.ask,
      autoReview: false,
    };
  }
  return {
    mode: params.mode,
    ...resolveExecPolicyForMode(params.mode),
  };
}

export type SystemRunApprovalBinding = {
  argv: string[];
  cwd: string | null;
  agentId: string | null;
  sessionKey: string | null;
  envHash: string | null;
};

export type SystemRunApprovalFileOperand = {
  argvIndex: number;
  path: string;
  sha256: string;
};

export type SystemRunApprovalPlan = {
  argv: string[];
  cwd: string | null;
  commandText: string;
  commandPreview?: string | null;
  agentId: string | null;
  sessionKey: string | null;
  mutableFileOperand?: SystemRunApprovalFileOperand | null;
};

export type ExecApprovalCommandSpan = {
  startIndex: number;
  endIndex: number;
};

export type ExecApprovalRequestPayload = {
  command: string;
  commandPreview?: string | null;
  commandArgv?: string[];
  // Optional UI-safe env key preview for approval prompts.
  envKeys?: string[];
  systemRunBinding?: SystemRunApprovalBinding | null;
  systemRunPlan?: SystemRunApprovalPlan | null;
  cwd?: string | null;
  nodeId?: string | null;
  host?: string | null;
  security?: string | null;
  ask?: string | null;
  warningText?: string | null;
  commandAnalysis?: CommandExplanationSummary | null;
  commandSpans?: ExecApprovalCommandSpan[];
  unavailableDecisions?: readonly ExecApprovalUnavailableDecision[];
  allowedDecisions?: readonly ExecApprovalDecision[];
  agentId?: string | null;
  resolvedPath?: string | null;
  sessionKey?: string | null;
  turnSourceChannel?: string | null;
  turnSourceTo?: string | null;
  turnSourceAccountId?: string | null;
  turnSourceThreadId?: string | number | null;
};

export type ExecApprovalRequest = {
  id: string;
  request: ExecApprovalRequestPayload;
  createdAtMs: number;
  expiresAtMs: number;
};

export type ExecApprovalResolved = {
  id: string;
  decision: ExecApprovalDecision;
  resolvedBy?: string | null;
  ts: number;
  request?: ExecApprovalRequest["request"];
};

export type ExecApprovalsDefaults = {
  security?: ExecSecurity;
  ask?: ExecAsk;
  askFallback?: ExecSecurity;
  autoAllowSkills?: boolean;
};

export type ExecApprovalsAgent = ExecApprovalsDefaults & {
  allowlist?: ExecAllowlistEntry[];
};

export type ExecApprovalsFile = {
  version: 1;
  socket?: {
    path?: string;
    token?: string;
  };
  defaults?: ExecApprovalsDefaults;
  agents?: Record<string, ExecApprovalsAgent>;
};

export type ExecApprovalsSnapshot = {
  path: string;
  exists: boolean;
  raw: string | null;
  file: ExecApprovalsFile;
  hash: string;
};

export type ExecApprovalsResolved = {
  path: string;
  socketPath: string;
  token: string;
  defaults: Required<ExecApprovalsDefaults>;
  agent: Required<ExecApprovalsDefaults>;
  agentSources: {
    security: string | null;
    ask: string | null;
    askFallback: string | null;
  };
  allowlist: ExecAllowlistEntry[];
  file: ExecApprovalsFile;
};

// Keep CLI + gateway defaults in sync.
export const DEFAULT_EXEC_APPROVAL_TIMEOUT_MS = 1_800_000;

const DEFAULT_SECURITY: ExecSecurity = "full";
const DEFAULT_ASK: ExecAsk = "off";
export const DEFAULT_EXEC_APPROVAL_ASK_FALLBACK: ExecSecurity = "deny";
const DEFAULT_AUTO_ALLOW_SKILLS = false;
const DEFAULT_EXEC_APPROVALS_STATE_DIR = "~/.openclaw";
const EXEC_APPROVALS_FILE = "exec-approvals.json";
const EXEC_APPROVALS_SOCKET = "exec-approvals.sock";

function hashExecApprovalsRaw(raw: string | null): string {
  return sha256Hex(raw ?? "");
}

function resolveExecApprovalsStateDir(env: NodeJS.ProcessEnv = process.env): {
  path: string;
  displayPath: string;
} {
  const override = env.OPENCLAW_STATE_DIR?.trim();
  if (override) {
    const resolved = resolveHomeRelativePath(override, { env });
    return {
      path: resolved,
      displayPath: resolved,
    };
  }
  return {
    path: expandHomePrefix(DEFAULT_EXEC_APPROVALS_STATE_DIR, { env }),
    displayPath: DEFAULT_EXEC_APPROVALS_STATE_DIR,
  };
}

export function resolveExecApprovalsPath(): string {
  return path.join(resolveExecApprovalsStateDir().path, EXEC_APPROVALS_FILE);
}

export function resolveExecApprovalsSocketPath(): string {
  return path.join(resolveExecApprovalsStateDir().path, EXEC_APPROVALS_SOCKET);
}

export function resolveExecApprovalsDisplayPath(): string {
  const stateDir = resolveExecApprovalsStateDir().displayPath;
  return stateDir === DEFAULT_EXEC_APPROVALS_STATE_DIR
    ? `${stateDir}/${EXEC_APPROVALS_FILE}`
    : path.join(stateDir, EXEC_APPROVALS_FILE);
}

export function resolveExecApprovalsTranscriptPath(): string {
  return process.env.OPENCLAW_STATE_DIR?.trim()
    ? `$OPENCLAW_STATE_DIR/${EXEC_APPROVALS_FILE}`
    : `${DEFAULT_EXEC_APPROVALS_STATE_DIR}/${EXEC_APPROVALS_FILE}`;
}

function resolveLegacyExecApprovalsPath(): string {
  return path.join(expandHomePrefix(DEFAULT_EXEC_APPROVALS_STATE_DIR), EXEC_APPROVALS_FILE);
}

function hasUnmigratedLegacyExecApprovals(filePath: string): boolean {
  if (!process.env.OPENCLAW_STATE_DIR?.trim()) {
    return false;
  }
  const legacyPath = resolveLegacyExecApprovalsPath();
  return (
    path.resolve(legacyPath) !== path.resolve(filePath) &&
    !fs.existsSync(filePath) &&
    fs.existsSync(legacyPath)
  );
}

function createUnmigratedLegacyExecApprovalsFallback(): ExecApprovalsFile {
  return normalizeExecApprovals({
    version: 1,
    defaults: {
      security: "deny",
      ask: "always",
      askFallback: "deny",
    },
    agents: {},
  });
}

function normalizeAllowlistPattern(value: string | undefined): string | null {
  const trimmed = normalizeOptionalString(value) ?? "";
  return trimmed ? normalizeLowercaseStringOrEmpty(trimmed) : null;
}

function mergeLegacyAgent(
  current: ExecApprovalsAgent,
  legacy: ExecApprovalsAgent,
): ExecApprovalsAgent {
  const allowlist: ExecAllowlistEntry[] = [];
  const seen = new Set<string>();
  const pushEntry = (entry: ExecAllowlistEntry) => {
    const patternKey = normalizeAllowlistPattern(entry.pattern);
    if (!patternKey) {
      return;
    }
    const key = `${patternKey}\x00${entry.argPattern?.trim() ?? ""}`;
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    allowlist.push(entry);
  };
  for (const entry of current.allowlist ?? []) {
    pushEntry(entry);
  }
  for (const entry of legacy.allowlist ?? []) {
    pushEntry(entry);
  }

  return {
    security: current.security ?? legacy.security,
    ask: current.ask ?? legacy.ask,
    askFallback: current.askFallback ?? legacy.askFallback,
    autoAllowSkills: current.autoAllowSkills ?? legacy.autoAllowSkills,
    allowlist: allowlist.length > 0 ? allowlist : undefined,
  };
}

function ensureDir(filePath: string) {
  const dir = path.dirname(filePath);
  assertNoExecApprovalsSymlinkParents(dir, resolveRequiredHomeDir());
  fs.mkdirSync(dir, { recursive: true });
  const dirStat = fs.lstatSync(dir);
  if (!dirStat.isDirectory() || dirStat.isSymbolicLink()) {
    throw new Error(`Refusing to use unsafe exec approvals directory: ${dir}`);
  }
  try {
    fs.chmodSync(dir, 0o700);
  } catch (err) {
    if (process.platform !== "win32") {
      throw err;
    }
  }
  return dir;
}

function assertNoExecApprovalsSymlinkParents(targetPath: string, trustedRoot: string): void {
  assertNoSymlinkParentsSync({
    rootDir: trustedRoot,
    targetPath,
    allowOutsideRoot: true,
    messagePrefix: "Refusing to traverse symlink in exec approvals path",
  });
}

function assertSafeExecApprovalsDestination(filePath: string): void {
  try {
    const stat = fs.lstatSync(filePath);
    if (stat.isSymbolicLink()) {
      throw new Error(`Refusing to write exec approvals via symlink: ${filePath}`);
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      throw err;
    }
  }
}

function assertSafeExecApprovalsOverwriteFallback(filePath: string): void {
  assertSafeExecApprovalsDestination(filePath);
  try {
    const stat = fs.statSync(filePath);
    if (stat.nlink > 1) {
      throw new Error(`Refusing copy fallback for hard-linked exec approvals file: ${filePath}`);
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      throw err;
    }
  }
}

type ExecApprovalsFallbackDestination = {
  existed: boolean;
  fd: number;
  snapshot: Buffer | null;
};

function sameFilesystemEntry(left: fs.Stats, right: fs.Stats): boolean {
  return left.dev === right.dev && left.ino === right.ino;
}

function readExecApprovalsFallbackSnapshotFromFd(fd: number): Buffer {
  const chunks: Buffer[] = [];
  const buffer = Buffer.alloc(64 * 1024);
  let position = 0;
  while (true) {
    const bytesRead = fs.readSync(fd, buffer, 0, buffer.length, position);
    if (bytesRead === 0) {
      break;
    }
    chunks.push(Buffer.from(buffer.subarray(0, bytesRead)));
    position += bytesRead;
  }
  return Buffer.concat(chunks);
}

function validateExecApprovalsFallbackFd(filePath: string, fd: number): fs.Stats {
  const linkStat = fs.lstatSync(filePath);
  if (linkStat.isSymbolicLink()) {
    throw new Error(`Refusing to write exec approvals via symlink: ${filePath}`);
  }
  const pathStat = fs.statSync(filePath);
  const fdStat = fs.fstatSync(fd);
  if (!fdStat.isFile()) {
    throw new Error(`Refusing copy fallback for non-file exec approvals path: ${filePath}`);
  }
  if (fdStat.nlink > 1) {
    throw new Error(`Refusing copy fallback for hard-linked exec approvals file: ${filePath}`);
  }
  if (!sameFilesystemEntry(pathStat, fdStat)) {
    throw new Error(`Refusing copy fallback after exec approvals path changed: ${filePath}`);
  }
  return fdStat;
}

function openExistingExecApprovalsFallbackDestination(
  filePath: string,
): ExecApprovalsFallbackDestination {
  const noFollowFlag = fs.constants.O_NOFOLLOW ?? 0;
  const fd = fs.openSync(filePath, fs.constants.O_RDWR | noFollowFlag, 0o600);
  try {
    validateExecApprovalsFallbackFd(filePath, fd);
    return {
      existed: true,
      fd,
      snapshot: readExecApprovalsFallbackSnapshotFromFd(fd),
    };
  } catch (err) {
    try {
      fs.closeSync(fd);
    } catch {
      // best-effort after validation failure
    }
    throw err;
  }
}

function createExecApprovalsFallbackDestination(
  filePath: string,
): ExecApprovalsFallbackDestination {
  const noFollowFlag = fs.constants.O_NOFOLLOW ?? 0;
  try {
    const fd = fs.openSync(
      filePath,
      fs.constants.O_RDWR | fs.constants.O_CREAT | fs.constants.O_EXCL | noFollowFlag,
      0o600,
    );
    try {
      validateExecApprovalsFallbackFd(filePath, fd);
      return { existed: false, fd, snapshot: null };
    } catch (err) {
      try {
        fs.closeSync(fd);
      } catch {
        // best-effort after validation failure
      }
      throw err;
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "EEXIST") {
      return openExistingExecApprovalsFallbackDestination(filePath);
    }
    throw err;
  }
}

function openExecApprovalsFallbackDestination(filePath: string): ExecApprovalsFallbackDestination {
  try {
    return openExistingExecApprovalsFallbackDestination(filePath);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return createExecApprovalsFallbackDestination(filePath);
    }
    throw err;
  }
}

function writeExecApprovalsFallbackBuffer(fd: number, contents: Buffer): void {
  fs.ftruncateSync(fd, 0);
  let written = 0;
  while (written < contents.length) {
    written += fs.writeSync(fd, contents, written, contents.length - written, written);
  }
  fs.ftruncateSync(fd, contents.length);
  try {
    fs.fchmodSync(fd, 0o600);
  } catch {
    // best-effort on platforms without chmod
  }
}

function restoreExecApprovalsFallbackDestination(
  filePath: string,
  destination: ExecApprovalsFallbackDestination,
): void {
  if (!destination.existed) {
    try {
      const pathStat = fs.statSync(filePath);
      const fdStat = fs.fstatSync(destination.fd);
      if (sameFilesystemEntry(pathStat, fdStat)) {
        fs.rmSync(filePath, { force: true });
      }
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
        throw err;
      }
    }
    return;
  }
  writeExecApprovalsFallbackBuffer(destination.fd, destination.snapshot ?? Buffer.alloc(0));
}

function copyExecApprovalsFallback(tempPath: string, filePath: string): void {
  const contents = fs.readFileSync(tempPath);
  const destination = openExecApprovalsFallbackDestination(filePath);
  try {
    writeExecApprovalsFallbackBuffer(destination.fd, contents);
    validateExecApprovalsFallbackFd(filePath, destination.fd);
  } catch (copyErr) {
    try {
      restoreExecApprovalsFallbackDestination(filePath, destination);
    } catch (restoreErr) {
      throw new Error(
        `Failed to restore exec approvals after copy fallback failure for ${filePath}: ${String(
          copyErr,
        )}`,
        { cause: restoreErr },
      );
    }
    throw copyErr;
  } finally {
    fs.closeSync(destination.fd);
  }
}

function renameExecApprovalsWithFallback(tempPath: string, filePath: string): void {
  try {
    fs.renameSync(tempPath, filePath);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    // Windows can reject rename-overwrite when another process has a transient
    // handle on the target approvals file.
    if (code !== "EPERM" && code !== "EEXIST") {
      throw err;
    }
    assertSafeExecApprovalsOverwriteFallback(filePath);
    copyExecApprovalsFallback(tempPath, filePath);
    fs.rmSync(tempPath, { force: true });
  }
}

// Coerce legacy/corrupted allowlists into `ExecAllowlistEntry[]` before we spread
// entries to add ids (spreading strings creates {"0":"l","1":"s",...}).
function coerceAllowlistEntries(allowlist: unknown): ExecAllowlistEntry[] | undefined {
  if (!Array.isArray(allowlist) || allowlist.length === 0) {
    return Array.isArray(allowlist) ? (allowlist as ExecAllowlistEntry[]) : undefined;
  }
  let changed = false;
  const result: ExecAllowlistEntry[] = [];
  for (const item of allowlist) {
    if (typeof item === "string") {
      const trimmed = item.trim();
      if (trimmed) {
        result.push({ pattern: trimmed });
        changed = true;
      } else {
        changed = true; // dropped empty string
      }
    } else if (item && typeof item === "object" && !Array.isArray(item)) {
      const pattern = (item as { pattern?: unknown }).pattern;
      if (typeof pattern === "string" && pattern.trim().length > 0) {
        result.push(item as ExecAllowlistEntry);
      } else {
        changed = true; // dropped invalid entry
      }
    } else {
      changed = true; // dropped invalid entry
    }
  }
  return changed ? (result.length > 0 ? result : undefined) : (allowlist as ExecAllowlistEntry[]);
}

function ensureAllowlistIds(
  allowlist: ExecAllowlistEntry[] | undefined,
): ExecAllowlistEntry[] | undefined {
  if (!Array.isArray(allowlist) || allowlist.length === 0) {
    return allowlist;
  }
  let changed = false;
  const next = allowlist.map((entry) => {
    if (entry.id) {
      return entry;
    }
    changed = true;
    return { ...entry, id: crypto.randomUUID() };
  });
  return changed ? next : allowlist;
}

function stripAllowlistCommandText(
  allowlist: ExecAllowlistEntry[] | undefined,
): ExecAllowlistEntry[] | undefined {
  if (!Array.isArray(allowlist) || allowlist.length === 0) {
    return allowlist;
  }
  let changed = false;
  const next = allowlist.map((entry) => {
    if (typeof entry.commandText !== "string") {
      return entry;
    }
    changed = true;
    const { commandText: _commandText, ...rest } = entry;
    return rest;
  });
  return changed ? next : allowlist;
}

function sanitizeExecApprovalPolicy(
  policy: ExecApprovalsDefaults | ExecApprovalsAgent | undefined,
): ExecApprovalsDefaults {
  const security = toStringOrUndefined(policy?.security)?.trim();
  const ask = toStringOrUndefined(policy?.ask)?.trim();
  const askFallback = toStringOrUndefined(policy?.askFallback)?.trim();
  return {
    security:
      security === "deny" || security === "allowlist" || security === "full" ? security : undefined,
    ask: ask === "off" || ask === "on-miss" || ask === "always" ? ask : undefined,
    askFallback:
      askFallback === "deny" || askFallback === "allowlist" || askFallback === "full"
        ? askFallback
        : undefined,
    autoAllowSkills: policy?.autoAllowSkills,
  };
}

export function normalizeExecApprovals(file: ExecApprovalsFile): ExecApprovalsFile {
  const socketPath = file.socket?.path?.trim();
  const token = file.socket?.token?.trim();
  const agents = { ...file.agents };
  const legacyDefault = agents.default;
  if (legacyDefault) {
    const main = agents[DEFAULT_AGENT_ID];
    agents[DEFAULT_AGENT_ID] = main ? mergeLegacyAgent(main, legacyDefault) : legacyDefault;
    delete agents.default;
  }
  for (const [key, agent] of Object.entries(agents)) {
    const coerced = coerceAllowlistEntries(agent.allowlist);
    const withIds = ensureAllowlistIds(coerced);
    const allowlist = stripAllowlistCommandText(withIds);
    const sanitizedPolicy = sanitizeExecApprovalPolicy(agent);
    const agentChanged =
      allowlist !== agent.allowlist ||
      sanitizedPolicy.security !== agent.security ||
      sanitizedPolicy.ask !== agent.ask ||
      sanitizedPolicy.askFallback !== agent.askFallback;
    if (agentChanged) {
      agents[key] = {
        ...agent,
        allowlist,
        security: sanitizedPolicy.security,
        ask: sanitizedPolicy.ask,
        askFallback: sanitizedPolicy.askFallback,
      };
    }
  }
  const sanitizedDefaults = sanitizeExecApprovalPolicy(file.defaults);
  const normalized: ExecApprovalsFile = {
    version: 1,
    socket: {
      path: socketPath && socketPath.length > 0 ? socketPath : undefined,
      token: token && token.length > 0 ? token : undefined,
    },
    defaults: {
      ...sanitizedDefaults,
    },
    agents,
  };
  return normalized;
}

export function mergeExecApprovalsSocketDefaults(params: {
  normalized: ExecApprovalsFile;
  current?: ExecApprovalsFile;
}): ExecApprovalsFile {
  const currentSocketPath = params.current?.socket?.path?.trim();
  const currentToken = params.current?.socket?.token?.trim();
  const socketPath =
    params.normalized.socket?.path?.trim() ?? currentSocketPath ?? resolveExecApprovalsSocketPath();
  const token = params.normalized.socket?.token?.trim() ?? currentToken ?? "";
  return {
    ...params.normalized,
    socket: {
      path: socketPath,
      token,
    },
  };
}

function generateToken(): string {
  return randomBytes(24).toString("base64url");
}

export function readExecApprovalsSnapshot(): ExecApprovalsSnapshot {
  const filePath = resolveExecApprovalsPath();
  if (hasUnmigratedLegacyExecApprovals(filePath)) {
    const file = createUnmigratedLegacyExecApprovalsFallback();
    return {
      path: filePath,
      exists: false,
      raw: null,
      file,
      hash: hashExecApprovalsRaw(null),
    };
  }
  if (!fs.existsSync(filePath)) {
    const file = normalizeExecApprovals({ version: 1, agents: {} });
    return {
      path: filePath,
      exists: false,
      raw: null,
      file,
      hash: hashExecApprovalsRaw(null),
    };
  }
  const raw = fs.readFileSync(filePath, "utf8");
  let parsed: ExecApprovalsFile | null;
  try {
    parsed = JSON.parse(raw) as ExecApprovalsFile;
  } catch {
    parsed = null;
  }
  const file =
    parsed?.version === 1
      ? normalizeExecApprovals(parsed)
      : normalizeExecApprovals({ version: 1, agents: {} });
  return {
    path: filePath,
    exists: true,
    raw,
    file,
    hash: hashExecApprovalsRaw(raw),
  };
}

export function loadExecApprovals(): ExecApprovalsFile {
  const filePath = resolveExecApprovalsPath();
  if (hasUnmigratedLegacyExecApprovals(filePath)) {
    return createUnmigratedLegacyExecApprovalsFallback();
  }
  try {
    if (!fs.existsSync(filePath)) {
      return normalizeExecApprovals({ version: 1, agents: {} });
    }
    const raw = fs.readFileSync(filePath, "utf8");
    const parsed = JSON.parse(raw) as ExecApprovalsFile;
    if (parsed?.version !== 1) {
      return normalizeExecApprovals({ version: 1, agents: {} });
    }
    return normalizeExecApprovals(parsed);
  } catch {
    return normalizeExecApprovals({ version: 1, agents: {} });
  }
}

export function saveExecApprovals(file: ExecApprovalsFile) {
  const filePath = resolveExecApprovalsPath();
  const raw = `${JSON.stringify(file, null, 2)}\n`;
  writeExecApprovalsRaw(filePath, raw);
}

function writeExecApprovalsRaw(filePath: string, raw: string) {
  const dir = ensureDir(filePath);
  assertSafeExecApprovalsDestination(filePath);
  const tempPath = path.join(dir, `.exec-approvals.${process.pid}.${crypto.randomUUID()}.tmp`);
  let tempWritten = false;
  try {
    fs.writeFileSync(tempPath, raw, { mode: 0o600, flag: "wx" });
    try {
      fs.chmodSync(tempPath, 0o600);
    } catch {
      // best-effort on platforms without chmod
    }
    tempWritten = true;
    renameExecApprovalsWithFallback(tempPath, filePath);
  } finally {
    if (tempWritten && fs.existsSync(tempPath)) {
      fs.rmSync(tempPath, { force: true });
    }
  }
  try {
    fs.chmodSync(filePath, 0o600);
  } catch {
    // best-effort on platforms without chmod
  }
}

export function restoreExecApprovalsSnapshot(snapshot: ExecApprovalsSnapshot): void {
  if (!snapshot.exists) {
    fs.rmSync(snapshot.path, { force: true });
    return;
  }
  if (snapshot.raw !== null) {
    writeExecApprovalsRaw(snapshot.path, snapshot.raw);
    return;
  }
  saveExecApprovals(snapshot.file);
}

export function ensureExecApprovals(): ExecApprovalsFile {
  if (hasUnmigratedLegacyExecApprovals(resolveExecApprovalsPath())) {
    return createUnmigratedLegacyExecApprovalsFallback();
  }
  const loaded = loadExecApprovals();
  const next = normalizeExecApprovals(loaded);
  const socketPath = next.socket?.path?.trim();
  const token = next.socket?.token?.trim();
  const updated: ExecApprovalsFile = {
    ...next,
    socket: {
      path: socketPath && socketPath.length > 0 ? socketPath : resolveExecApprovalsSocketPath(),
      token: token && token.length > 0 ? token : generateToken(),
    },
  };
  saveExecApprovals(updated);
  return updated;
}

function readExecApprovalsForNoPersistence(filePath: string): ExecApprovalsFile {
  if (hasUnmigratedLegacyExecApprovals(filePath)) {
    return createUnmigratedLegacyExecApprovalsFallback();
  }
  const dir = path.dirname(filePath);
  assertNoExecApprovalsSymlinkParents(dir, resolveRequiredHomeDir());
  assertSafeExecApprovalsDestination(filePath);

  let raw: string;
  try {
    raw = fs.readFileSync(filePath, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      throw err;
    }
    return normalizeExecApprovals({ version: 1, agents: {} });
  }
  try {
    const parsed = JSON.parse(raw) as ExecApprovalsFile;
    if (parsed?.version === 1) {
      return normalizeExecApprovals(parsed);
    }
  } catch {
    // Empty or invalid persisted approvals have no usable stricter policy.
  }
  return normalizeExecApprovals({ version: 1, agents: {} });
}

function isExecSecurity(value: unknown): value is ExecSecurity {
  return value === "allowlist" || value === "full" || value === "deny";
}

function isExecAsk(value: unknown): value is ExecAsk {
  return value === "always" || value === "off" || value === "on-miss";
}

function normalizeSecurity(value: unknown, fallback: ExecSecurity): ExecSecurity {
  return isExecSecurity(value) ? value : fallback;
}

function normalizeAsk(value: unknown, fallback: ExecAsk): ExecAsk {
  return isExecAsk(value) ? value : fallback;
}

type ResolvedExecPolicyField<TValue extends ExecSecurity | ExecAsk> = {
  value: TValue;
  source: string | null;
};

function resolveDefaultSecurityField(params: {
  field: "security" | "askFallback";
  defaults: ExecApprovalsDefaults;
  fallback: ExecSecurity;
}): ResolvedExecPolicyField<ExecSecurity> {
  const defaultValue = params.defaults[params.field];
  if (isExecSecurity(defaultValue)) {
    return {
      value: defaultValue,
      source: `defaults.${params.field}`,
    };
  }
  return {
    value: params.fallback,
    source: null,
  };
}

function resolveDefaultAskField(params: {
  defaults: ExecApprovalsDefaults;
  fallback: ExecAsk;
}): ResolvedExecPolicyField<ExecAsk> {
  if (isExecAsk(params.defaults.ask)) {
    return {
      value: params.defaults.ask,
      source: "defaults.ask",
    };
  }
  return {
    value: params.fallback,
    source: null,
  };
}

function resolveAgentSecurityField(params: {
  field: "security" | "askFallback";
  defaults: ExecApprovalsDefaults;
  agent: ExecApprovalsAgent;
  rawAgent: ExecApprovalsAgent;
  wildcard: ExecApprovalsAgent;
  rawWildcard: ExecApprovalsAgent;
  agentKey: string;
  fallback: ExecSecurity;
}): ResolvedExecPolicyField<ExecSecurity> {
  const fallbackField = resolveDefaultSecurityField({
    field: params.field,
    defaults: params.defaults,
    fallback: params.fallback,
  });
  const rawAgentValue = params.rawAgent[params.field];
  if (rawAgentValue != null) {
    if (isExecSecurity(params.agent[params.field])) {
      return {
        value: params.agent[params.field] as ExecSecurity,
        source: `agents.${params.agentKey}.${params.field}`,
      };
    }
    return fallbackField;
  }
  const rawWildcardValue = params.rawWildcard[params.field];
  if (rawWildcardValue != null) {
    if (isExecSecurity(params.wildcard[params.field])) {
      return {
        value: params.wildcard[params.field] as ExecSecurity,
        source: `agents.*.${params.field}`,
      };
    }
    return fallbackField;
  }
  return fallbackField;
}

function resolveAgentAskField(params: {
  defaults: ExecApprovalsDefaults;
  agent: ExecApprovalsAgent;
  rawAgent: ExecApprovalsAgent;
  wildcard: ExecApprovalsAgent;
  rawWildcard: ExecApprovalsAgent;
  agentKey: string;
  fallback: ExecAsk;
}): ResolvedExecPolicyField<ExecAsk> {
  const fallbackField = resolveDefaultAskField({
    defaults: params.defaults,
    fallback: params.fallback,
  });
  if (params.rawAgent.ask != null) {
    if (isExecAsk(params.agent.ask)) {
      return {
        value: params.agent.ask,
        source: `agents.${params.agentKey}.ask`,
      };
    }
    return fallbackField;
  }
  if (params.rawWildcard.ask != null) {
    if (isExecAsk(params.wildcard.ask)) {
      return {
        value: params.wildcard.ask,
        source: "agents.*.ask",
      };
    }
    return fallbackField;
  }
  return fallbackField;
}

export type ExecApprovalsDefaultOverrides = {
  security?: ExecSecurity;
  ask?: ExecAsk;
  askFallback?: ExecSecurity;
  autoAllowSkills?: boolean;
  requireSocket?: boolean;
};

export function resolveExecApprovals(
  agentId?: string,
  overrides?: ExecApprovalsDefaultOverrides,
): ExecApprovalsResolved {
  const filePath = resolveExecApprovalsPath();
  if (hasUnmigratedLegacyExecApprovals(filePath)) {
    return resolveExecApprovalsFromFile({
      file: createUnmigratedLegacyExecApprovalsFallback(),
      agentId,
      overrides,
      path: filePath,
      socketPath: resolveExecApprovalsSocketPath(),
      token: "",
    });
  }
  if (!overrides?.requireSocket) {
    const file = readExecApprovalsForNoPersistence(filePath);
    const resolved = resolveExecApprovalsFromFile({
      file,
      agentId,
      overrides,
      path: filePath,
      socketPath: resolveExecApprovalsSocketPath(),
      token: "",
    });
    if (
      resolved.agent.security === "full" &&
      resolved.agent.ask === "off" &&
      !file.socket?.token?.trim()
    ) {
      return resolved;
    }
  }
  const file = ensureExecApprovals();
  return resolveExecApprovalsFromFile({
    file,
    agentId,
    overrides,
    path: resolveExecApprovalsPath(),
    socketPath: expandHomePrefix(file.socket?.path ?? resolveExecApprovalsSocketPath()),
    token: file.socket?.token ?? "",
  });
}

export function resolveExecApprovalsFromFile(params: {
  file: ExecApprovalsFile;
  agentId?: string;
  overrides?: ExecApprovalsDefaultOverrides;
  path?: string;
  socketPath?: string;
  token?: string;
}): ExecApprovalsResolved {
  const rawFile = params.file;
  const file = normalizeExecApprovals(params.file);
  const defaults = file.defaults ?? {};
  const agentKey = params.agentId ?? DEFAULT_AGENT_ID;
  const agent = file.agents?.[agentKey] ?? {};
  const wildcard = file.agents?.["*"] ?? {};
  const rawAgent = rawFile.agents?.[agentKey] ?? {};
  const rawWildcard = rawFile.agents?.["*"] ?? {};
  const fallbackSecurity = params.overrides?.security ?? DEFAULT_SECURITY;
  const fallbackAsk = params.overrides?.ask ?? DEFAULT_ASK;
  const fallbackAskFallback = params.overrides?.askFallback ?? DEFAULT_EXEC_APPROVAL_ASK_FALLBACK;
  const fallbackAutoAllowSkills = params.overrides?.autoAllowSkills ?? DEFAULT_AUTO_ALLOW_SKILLS;
  const resolvedDefaults: Required<ExecApprovalsDefaults> = {
    security: normalizeSecurity(defaults.security, fallbackSecurity),
    ask: normalizeAsk(defaults.ask, fallbackAsk),
    askFallback: normalizeSecurity(
      defaults.askFallback ?? fallbackAskFallback,
      fallbackAskFallback,
    ),
    autoAllowSkills: defaults.autoAllowSkills ?? fallbackAutoAllowSkills,
  };
  const resolvedAgentSecurity = resolveAgentSecurityField({
    field: "security",
    defaults,
    agent,
    rawAgent,
    wildcard,
    rawWildcard,
    agentKey,
    fallback: resolvedDefaults.security,
  });
  const resolvedAgentAsk = resolveAgentAskField({
    defaults,
    agent,
    rawAgent,
    wildcard,
    rawWildcard,
    agentKey,
    fallback: resolvedDefaults.ask,
  });
  const resolvedAgentAskFallback = resolveAgentSecurityField({
    field: "askFallback",
    defaults,
    agent,
    rawAgent,
    wildcard,
    rawWildcard,
    agentKey,
    fallback: resolvedDefaults.askFallback,
  });
  const resolvedAgent: Required<ExecApprovalsDefaults> = {
    security: resolvedAgentSecurity.value,
    ask: resolvedAgentAsk.value,
    askFallback: resolvedAgentAskFallback.value,
    autoAllowSkills:
      agent.autoAllowSkills ?? wildcard.autoAllowSkills ?? resolvedDefaults.autoAllowSkills,
  };
  const allowlist = [
    ...(Array.isArray(wildcard.allowlist) ? wildcard.allowlist : []),
    ...(Array.isArray(agent.allowlist) ? agent.allowlist : []),
  ];
  return {
    path: params.path ?? resolveExecApprovalsPath(),
    socketPath: expandHomePrefix(
      params.socketPath ?? file.socket?.path ?? resolveExecApprovalsSocketPath(),
    ),
    token: params.token ?? file.socket?.token ?? "",
    defaults: resolvedDefaults,
    agent: resolvedAgent,
    agentSources: {
      security: resolvedAgentSecurity.source,
      ask: resolvedAgentAsk.source,
      askFallback: resolvedAgentAskFallback.source,
    },
    allowlist,
    file,
  };
}

export function requiresExecApproval(params: {
  ask: ExecAsk;
  security: ExecSecurity;
  analysisOk: boolean;
  allowlistSatisfied: boolean;
  durableApprovalSatisfied?: boolean;
}): boolean {
  if (params.ask === "always") {
    return true;
  }
  if (params.durableApprovalSatisfied === true) {
    return false;
  }
  return (
    params.ask === "on-miss" &&
    params.security === "allowlist" &&
    (!params.analysisOk || !params.allowlistSatisfied)
  );
}

function normalizeCommandName(value: string | undefined): string {
  return ((value ?? "").split(/[\\/]/).pop()?.toLowerCase() ?? "").replace(
    /\.(?:bat|cjs|cmd|exe|js|mjs|ps1)$/,
    "",
  );
}

function textMentionsSecurityAuditSuppressions(value: string): boolean {
  const normalized = value.toLowerCase();
  return (
    normalized.includes("security.audit.suppressions") ||
    /["']?security["']?[\s\S]{0,200}["']?audit["']?[\s\S]{0,200}["']?suppressions["']?/.test(
      normalized,
    )
  );
}

function isReadOnlySecurityAuditSuppressionInspection(argv: string[]): boolean {
  const command = normalizeCommandName(argv[0]);
  let offset = command === "pnpm" && argv[1] === "openclaw" ? 1 : 0;
  if (normalizeCommandName(argv[offset]) !== "openclaw") {
    return false;
  }
  offset += 1;
  while (offset < argv.length) {
    const arg = argv[offset];
    if (["--dev", "--no-color"].includes(arg ?? "")) {
      offset += 1;
      continue;
    }
    if (["--profile", "--container", "--log-level"].includes(arg ?? "")) {
      offset += 2;
      continue;
    }
    if (
      arg?.startsWith("--profile=") ||
      arg?.startsWith("--container=") ||
      arg?.startsWith("--log-level=")
    ) {
      offset += 1;
      continue;
    }
    break;
  }
  return (
    argv[offset] === "config" && ["get", "schema", "validate"].includes(argv[offset + 1] ?? "")
  );
}

const OPENCLAW_LIFECYCLE_TARGET_RE =
  /\b(?:openclaw|com\.openclaw|ai\.openclaw|io\.openclaw|openclaw[-_.]gateway|openclaw[-_.]daemon)\b/i;
const MAX_LIFECYCLE_CARRIER_UNWRAP_DEPTH = 32;
const PROCESS_LIFECYCLE_COMMANDS = new Set([
  "kill",
  "pkill",
  "killall",
  "taskkill",
  "stop-process",
]);
const KILL_OPTIONS_WITH_VALUE = new Set(["-s", "--signal", "-n", "--queue"]);
const PKILL_OPTIONS_WITH_VALUE = new Set([
  "-g",
  "--pgroup",
  "-G",
  "--group",
  "-P",
  "--parent",
  "-s",
  "--session",
  "-t",
  "--terminal",
  "-u",
  "--euid",
  "-U",
  "--uid",
  "--signal",
]);
const KILLALL_OPTIONS_WITH_VALUE = new Set([
  "-s",
  "--signal",
  "-u",
  "--user",
  "-o",
  "--older-than",
  "-y",
  "--younger-than",
]);
const OPENCLAW_CLI_LIFECYCLE_ACTIONS = new Set([
  "install",
  "kill",
  "restart",
  "start",
  "stop",
  "uninstall",
]);
const OPENCLAW_GATEWAY_RUN_VALUE_FLAGS = new Set([
  "--auth",
  "--bind",
  "--password",
  "--password-file",
  "--port",
  "--raw-stream-path",
  "--tailscale",
  "--token",
  "--token-file",
  "--ws-log",
]);
const OPENCLAW_GATEWAY_RUN_BOOLEAN_FLAGS = new Set([
  "--allow-unconfigured",
  "--claude-cli-logs",
  "--cli-backend-logs",
  "--compact",
  "--dev",
  "--force",
  "--raw-stream",
  "--reset",
  "--tailscale-reset-on-exit",
  "--verbose",
]);
const OPENCLAW_GATEWAY_CALL_LIFECYCLE_METHODS = new Set(["gateway.restart.request", "update.run"]);
const OPENCLAW_GATEWAY_CALL_VALUE_FLAGS = new Set([
  "--params",
  "--password",
  "--timeout",
  "--token",
  "--url",
]);
const OPENCLAW_GATEWAY_CALL_BOOLEAN_FLAGS = new Set(["--expect-final", "--json"]);
const OPENCLAW_GATEWAY_READ_ONLY_SUBCOMMANDS = new Set([
  "diagnostics",
  "discover",
  "probe",
  "stability",
  "status",
  "usage-cost",
]);
const OPENCLAW_GATEWAY_NON_EXEC_TOKENS = new Set(["-h", "--help", "--version", "help"]);
const OPENCLAW_UPDATE_READ_ONLY_SUBCOMMANDS = new Set(["status"]);
const OPENCLAW_UPDATE_MUTATING_SUBCOMMANDS = new Set(["finalize", "repair", "wizard"]);
const OPENCLAW_UPDATE_NON_EXEC_TOKENS = new Set(["-h", "--help", "--version", "help"]);
const OPENCLAW_UPDATE_OPTIONS_WITH_VALUE = new Set(["--channel", "--tag", "--timeout"]);
const OPENCLAW_UPDATE_DRY_RUN_OPTIONS = new Set(["--dry-run"]);
const OPENCLAW_UNINSTALL_NON_EXEC_TOKENS = new Set(["-h", "--help", "--version", "help"]);
const OPENCLAW_UNINSTALL_DRY_RUN_OPTIONS = new Set(["--dry-run"]);
const OPENCLAW_CLI_CARRIER_COMMANDS = new Set([
  "bun",
  "bunx",
  "corepack",
  "node",
  "npx",
  "npm",
  "pnpm",
  "yarn",
]);
const LAUNCHCTL_LIFECYCLE_ACTIONS = new Set([
  "bootstrap",
  "bootout",
  "disable",
  "enable",
  "kickstart",
  "kill",
  "load",
  "remove",
  "stop",
  "unload",
]);
const SYSTEMCTL_LIFECYCLE_ACTIONS = new Set([
  "disable",
  "enable",
  "kill",
  "mask",
  "reload-or-restart",
  "restart",
  "start",
  "stop",
  "try-reload-or-restart",
  "try-restart",
  "unmask",
]);
const SYSTEMCTL_OPTIONS_WITH_VALUE = new Set([
  "-H",
  "-M",
  "-n",
  "-o",
  "-p",
  "-s",
  "-t",
  "--host",
  "--image",
  "--job-mode",
  "--kill-who",
  "--lines",
  "--machine",
  "--message",
  "--output",
  "--preset-mode",
  "--property",
  "--root",
  "--signal",
  "--state",
  "--timestamp",
  "--transport",
  "--type",
  "--when",
]);
const SYSTEMCTL_INLINE_OPTIONS_WITH_VALUE =
  /^(?:-[HMnopst].+|--(?:host|image|job-mode|kill-who|lines|machine|message|output|preset-mode|property|root|signal|state|timestamp|transport|type|when)=)/;
const SCHTASKS_LIFECYCLE_ACTIONS = new Set(["/change", "/create", "/delete", "/end", "/run"]);
const TRANSPARENT_LIFECYCLE_CARRIERS = new Set(["command", "doas", "env", "exec", "nohup", "sudo"]);
const XARGS_OPTIONS_WITH_VALUE = new Set([
  "-a",
  "--arg-file",
  "-d",
  "--delimiter",
  "-E",
  "-e",
  "--eof",
  "-I",
  "-i",
  "--replace",
  "-L",
  "-l",
  "--max-lines",
  "-n",
  "--max-args",
  "-P",
  "--max-procs",
  "--process-slot-var",
  "-s",
  "--max-chars",
]);
const XARGS_STANDALONE_OPTIONS = new Set([
  "-0",
  "--null",
  "-o",
  "--open-tty",
  "-p",
  "--interactive",
  "-r",
  "--no-run-if-empty",
  "-t",
  "--verbose",
  "-x",
  "--exit",
]);
const XARGS_NON_EXEC_OPTIONS = new Set(["--help", "--show-limits", "--version"]);
const ENV_OPTIONS_WITH_VALUE = new Set([
  "-a",
  "-C",
  "-P",
  "--argv0",
  "--chdir",
  "-S",
  "-s",
  "-u",
  "--split-string",
  "--unset",
]);
const ENV_NON_EXEC_OPTIONS = new Set(["--help", "--version"]);
const ENV_SPLIT_STRING_OPTIONS = new Set(["-S", "-s", "--split-string"]);
const ENV_STANDALONE_OPTIONS = new Set([
  "-",
  "-0",
  "-i",
  "-v",
  "--debug",
  "--block-signal",
  "--default-signal",
  "--ignore-environment",
  "--ignore-signal",
  "--list-signal-handling",
  "--null",
]);
const GENERIC_WRAPPER_NON_EXEC_OPTIONS = new Set(["-h", "--help", "-V", "--version"]);
const SETSID_STANDALONE_OPTIONS = new Set(["-c", "--ctty", "-f", "--fork", "-w", "--wait"]);
const SETSID_NON_EXEC_OPTIONS = new Set(["-h", "--help", "-V", "--version"]);
const TASKSET_STANDALONE_OPTIONS = new Set(["-a", "--all-tasks", "-c", "--cpu-list"]);
const TASKSET_NON_EXEC_OPTIONS = new Set(["-h", "--help", "-p", "--pid", "-V", "--version"]);
const IONICE_STANDALONE_OPTIONS = new Set(["-t", "--ignore"]);
const IONICE_OPTIONS_WITH_VALUE = new Set(["-c", "--class", "-n", "--classdata"]);
const IONICE_NON_EXEC_OPTIONS = new Set([
  "-h",
  "--help",
  "-p",
  "--pid",
  "-P",
  "--pgid",
  "-u",
  "--uid",
  "-V",
  "--version",
]);
const CHRT_STANDALONE_OPTIONS = new Set([
  "-a",
  "--all-tasks",
  "-b",
  "--batch",
  "-d",
  "--deadline",
  "-e",
  "--ext",
  "-f",
  "--fifo",
  "-G",
  "--reclaim-grub",
  "-i",
  "--idle",
  "-o",
  "--other",
  "-O",
  "--deadline-overrun",
  "-r",
  "--rr",
  "-R",
  "--reset-on-fork",
  "-v",
  "--verbose",
]);
const CHRT_OPTIONS_WITH_VALUE = new Set([
  "-D",
  "--sched-deadline",
  "-P",
  "--sched-period",
  "-T",
  "--sched-runtime",
]);
const CHRT_NON_EXEC_OPTIONS = new Set([
  "-h",
  "--help",
  "-m",
  "--max",
  "-p",
  "--pid",
  "-V",
  "--version",
]);
const NOHUP_NON_EXEC_OPTIONS = new Set(["--help", "--version"]);
const STDBUF_OPTIONS_WITH_VALUE = new Set(["-e", "--error", "-i", "--input", "-o", "--output"]);
const STDBUF_NON_EXEC_OPTIONS = new Set(["--help", "--version"]);
const TIME_STANDALONE_OPTIONS = new Set([
  "-a",
  "--append",
  "-h",
  "-l",
  "-p",
  "--portability",
  "-q",
  "--quiet",
  "-v",
  "--verbose",
]);
const TIME_OPTIONS_WITH_VALUE = new Set(["-f", "--format", "-o", "--output"]);
const TIME_NON_EXEC_OPTIONS = new Set(["--help", "-V", "--version"]);
const TIMEOUT_STANDALONE_OPTIONS = new Set([
  "-f",
  "--foreground",
  "-p",
  "--preserve-status",
  "-v",
  "--verbose",
]);
const TIMEOUT_OPTIONS_WITH_VALUE = new Set(["-k", "--kill-after", "-s", "--signal"]);
const TIMEOUT_NON_EXEC_OPTIONS = new Set(["--help", "--version"]);
const VARIABLE_EXECUTABLE_LIFECYCLE_CANDIDATES = [
  "openclaw",
  ...OPENCLAW_CLI_CARRIER_COMMANDS,
  "launchctl",
  "systemctl",
  "schtasks",
  ...PROCESS_LIFECYCLE_COMMANDS,
  "chrt",
  "command",
  "doas",
  "env",
  "exec",
  "flock",
  "ionice",
  "ash",
  "bash",
  "busybox",
  "cmd",
  "dash",
  "fish",
  "ksh",
  "nice",
  "nohup",
  "powershell",
  "pwsh",
  "setsid",
  "sh",
  "stdbuf",
  "sudo",
  "taskset",
  "time",
  "timeout",
  "toybox",
  "zsh",
] as const;
const ENV_SPLIT_DOUBLE_QUOTE_ESCAPES = new Set(["\\", '"', "$", "`", "\n", "\r"]);
const ENV_SPLIT_LITERAL_DOLLAR_MARKER = "\uE000";
const ENV_SPLIT_LITERAL_BACKSLASH_MARKER = "\uE001";
const ENV_SPLIT_UNKNOWN_ASSIGNMENT_VALUE = "\uE002";
const SHELL_VARIABLE_REFERENCE_SOURCE = String.raw`\$\{[A-Za-z_][A-Za-z0-9_]*(?:(?::?[-+?=])[^}]*)?\}|\$[A-Za-z_][A-Za-z0-9_]*`;
const SHELL_VARIABLE_REFERENCE_PATTERN = new RegExp(SHELL_VARIABLE_REFERENCE_SOURCE);
const SHELL_VARIABLE_REFERENCE_GLOBAL_PATTERN = new RegExp(
  String.raw`\$\{([A-Za-z_][A-Za-z0-9_]*)(?:(:?[-+?=])([^}]*))?\}|\$([A-Za-z_][A-Za-z0-9_]*)`,
  "g",
);
const ENV_SPLIT_CONTROL_ESCAPES: Record<string, string> = {
  f: "\f",
  n: "\n",
  r: "\r",
  t: "\t",
  v: "\v",
};
const SUDO_OPTIONS_WITH_VALUE = new Set([
  "-a",
  "-C",
  "-D",
  "-g",
  "-h",
  "-p",
  "-R",
  "-r",
  "-t",
  "-T",
  "-u",
  "--chdir",
  "--chroot",
  "--close-from",
  "--command-timeout",
  "--group",
  "--host",
  "--login-class",
  "--prompt",
  "--role",
  "--type",
  "--user",
]);

function tokenMentionsOpenClawLifecycleTarget(token: string | undefined): boolean {
  return typeof token === "string" && OPENCLAW_LIFECYCLE_TARGET_RE.test(token);
}

function argvMentionsOpenClawLifecycleTarget(argv: readonly string[]): boolean {
  return argv.some((token) => tokenMentionsOpenClawLifecycleTarget(token));
}

function skipOpenClawGlobalOptions(argv: readonly string[], offset: number): number {
  let next = offset;
  while (next < argv.length) {
    const arg = argv[next];
    if (["--dev", "--no-color"].includes(arg ?? "")) {
      next += 1;
      continue;
    }
    if (["--profile", "--container", "--log-level"].includes(arg ?? "")) {
      next += 2;
      continue;
    }
    if (
      arg?.startsWith("--profile=") ||
      arg?.startsWith("--container=") ||
      arg?.startsWith("--log-level=")
    ) {
      next += 1;
      continue;
    }
    break;
  }
  return next;
}

function skipOpenClawArgvSeparator(argv: readonly string[], offset: number): number {
  return argv[offset] === "--" ? offset + 1 : offset;
}

function splitCommandPathSegments(value: string | undefined): string[] {
  return (value ?? "")
    .replaceAll("\\", "/")
    .split("/")
    .filter(Boolean)
    .map((segment) => segment.toLowerCase());
}

function pathSegmentsIncludeOpenClawPackage(segments: readonly string[]): boolean {
  return segments.includes("openclaw");
}

function tokenPathLooksAbsolute(value: string | undefined): boolean {
  return typeof value === "string" && /^(?:[A-Za-z]:[\\/]|[\\/])/.test(value);
}

function tokenLooksLikeOpenClawPackageSpec(value: string | undefined): boolean {
  return typeof value === "string" && /^openclaw@[^\\/\s]+$/i.test(value);
}

function tokenLooksLikeOpenClawNodeEntrypoint(value: string | undefined, cwd?: string): boolean {
  const segments = splitCommandPathSegments(value);
  if (segments.length < 2) {
    return false;
  }
  const file = segments.at(-1);
  if (
    !["entry.js", "entry.cjs", "entry.mjs", "index.js", "index.cjs", "index.mjs"].includes(
      file ?? "",
    )
  ) {
    return false;
  }
  const parent = segments.at(-2);
  if (parent !== "dist") {
    return false;
  }
  if (pathSegmentsIncludeOpenClawPackage(segments.slice(0, -2))) {
    return true;
  }
  return (
    !tokenPathLooksAbsolute(value) &&
    pathSegmentsIncludeOpenClawPackage(splitCommandPathSegments(cwd))
  );
}

const NODE_OPTIONS_WITH_VALUE = new Set([
  "-C",
  "-e",
  "-p",
  "-r",
  "--conditions",
  "--eval",
  "--import",
  "--loader",
  "--print",
  "--require",
]);

function nodeOptionConsumesValue(arg: string): boolean {
  if (arg === "-e" || arg === "-p" || arg === "-r" || arg === "-C") {
    return true;
  }
  if (/^-[eprC].+/u.test(arg)) {
    return false;
  }
  const equalsIndex = arg.indexOf("=");
  const flag = equalsIndex === -1 ? arg : arg.slice(0, equalsIndex);
  return NODE_OPTIONS_WITH_VALUE.has(flag) && equalsIndex === -1;
}

function nodeOptionDisablesScriptPath(arg: string): boolean {
  return (
    arg === "-e" ||
    arg === "-p" ||
    arg.startsWith("-e") ||
    arg.startsWith("-p") ||
    arg === "--eval" ||
    arg.startsWith("--eval=") ||
    arg === "--print" ||
    arg.startsWith("--print=")
  );
}

function findOpenClawNodeCliOffset(argv: readonly string[], cwd?: string): number | null {
  let index = 1;
  while (index < argv.length) {
    const arg = argv[index];
    if (!arg) {
      index += 1;
      continue;
    }
    if (arg === "--") {
      index += 1;
      break;
    }
    if (!arg.startsWith("-")) {
      break;
    }
    if (nodeOptionDisablesScriptPath(arg)) {
      return null;
    }
    index += nodeOptionConsumesValue(arg) ? 2 : 1;
  }
  const script = argv[index];
  return normalizeCommandName(script) === "openclaw" ||
    tokenLooksLikeOpenClawNodeEntrypoint(script, cwd)
    ? index
    : null;
}

function findOpenClawCliOffsets(argv: readonly string[], cwd?: string): number[] {
  const command = normalizeCommandName(argv[0]);
  if (command === "openclaw") {
    return [0];
  }
  if (command === "node") {
    const offset = findOpenClawNodeCliOffset(argv, cwd);
    return offset === null ? [] : [offset];
  }
  if (!OPENCLAW_CLI_CARRIER_COMMANDS.has(command)) {
    return [];
  }
  const offsets: number[] = [];
  for (let index = 1; index < argv.length; index += 1) {
    const arg = argv[index];
    if (
      normalizeCommandName(arg) === "openclaw" ||
      tokenLooksLikeOpenClawPackageSpec(arg) ||
      tokenLooksLikeOpenClawNodeEntrypoint(arg, cwd)
    ) {
      offsets.push(index);
    }
  }
  return offsets;
}

function consumeOpenClawGatewayRunOptionToken(argv: readonly string[], offset: number): number {
  const token = argv[offset];
  if (!token || token === "--" || !token.startsWith("-")) {
    return 0;
  }
  const equalsIndex = token.indexOf("=");
  const flag = equalsIndex === -1 ? token : token.slice(0, equalsIndex);
  if (OPENCLAW_GATEWAY_RUN_BOOLEAN_FLAGS.has(flag)) {
    return equalsIndex === -1 ? 1 : 0;
  }
  if (!OPENCLAW_GATEWAY_RUN_VALUE_FLAGS.has(flag)) {
    return 0;
  }
  if (equalsIndex !== -1) {
    return token.slice(equalsIndex + 1).trim() ? 1 : 0;
  }
  return offset + 1 < argv.length ? 2 : 1;
}

function consumeOpenClawGatewayCallOptionToken(argv: readonly string[], offset: number): number {
  const token = argv[offset];
  if (!token || token === "--" || !token.startsWith("-")) {
    return 0;
  }
  const equalsIndex = token.indexOf("=");
  const flag = equalsIndex === -1 ? token : token.slice(0, equalsIndex);
  if (OPENCLAW_GATEWAY_CALL_BOOLEAN_FLAGS.has(flag)) {
    return equalsIndex === -1 ? 1 : 0;
  }
  if (!OPENCLAW_GATEWAY_CALL_VALUE_FLAGS.has(flag)) {
    return 0;
  }
  if (equalsIndex !== -1) {
    return token.slice(equalsIndex + 1).trim() ? 1 : 0;
  }
  return offset + 1 < argv.length ? 2 : 1;
}

function findOpenClawGatewayCallMethod(
  argv: readonly string[],
  offset: number,
): string | undefined {
  let index = offset;
  while (index < argv.length) {
    const token = argv[index];
    if (!token) {
      index += 1;
      continue;
    }
    if (token === "--") {
      return argv[index + 1];
    }
    const consumed = consumeOpenClawGatewayCallOptionToken(argv, index);
    if (consumed > 0) {
      index += consumed;
      continue;
    }
    if (token.startsWith("-")) {
      index += 1;
      continue;
    }
    return token;
  }
  return undefined;
}

function segmentIsOpenClawGatewayCallLifecycleMutation(
  argv: readonly string[],
  offset: number,
): boolean {
  const method = findOpenClawGatewayCallMethod(argv, offset);
  return (
    OPENCLAW_GATEWAY_CALL_LIFECYCLE_METHODS.has(normalizeLowercaseStringOrEmpty(method)) ||
    textContainsCommandSubstitution(method)
  );
}

function segmentIsOpenClawGatewayForegroundLifecycleMutation(
  argv: readonly string[],
  offset: number,
): boolean {
  let index = offset;
  let sawRun = false;
  let sawRuntimeSurface = false;
  while (index < argv.length) {
    const token = argv[index];
    if (!token) {
      index += 1;
      continue;
    }
    const normalized = normalizeLowercaseStringOrEmpty(token);
    if (OPENCLAW_GATEWAY_NON_EXEC_TOKENS.has(normalized)) {
      return false;
    }
    if (token === "--") {
      return sawRun || sawRuntimeSurface || index === offset;
    }
    if (!sawRun && normalized === "run") {
      sawRun = true;
      sawRuntimeSurface = true;
      index += 1;
      continue;
    }
    if (!sawRun && normalized === "call") {
      return segmentIsOpenClawGatewayCallLifecycleMutation(argv, index + 1);
    }
    if (!sawRun && OPENCLAW_GATEWAY_READ_ONLY_SUBCOMMANDS.has(normalized)) {
      return false;
    }
    if (OPENCLAW_CLI_LIFECYCLE_ACTIONS.has(normalized) || textContainsCommandSubstitution(token)) {
      return true;
    }
    const consumed = consumeOpenClawGatewayRunOptionToken(argv, index);
    if (consumed > 0) {
      sawRuntimeSurface = true;
      index += consumed;
      continue;
    }
    if (token.startsWith("-")) {
      sawRuntimeSurface = true;
      index += 1;
      continue;
    }
    return false;
  }
  return sawRun || sawRuntimeSurface || index === offset;
}

function consumeOpenClawUpdateOptionToken(argv: readonly string[], offset: number): number {
  const token = argv[offset];
  if (!token || token === "--" || !token.startsWith("-")) {
    return 0;
  }
  const equalsIndex = token.indexOf("=");
  const flag = equalsIndex === -1 ? token : token.slice(0, equalsIndex);
  if (OPENCLAW_UPDATE_DRY_RUN_OPTIONS.has(flag)) {
    return equalsIndex === -1 ? 1 : 0;
  }
  if (!OPENCLAW_UPDATE_OPTIONS_WITH_VALUE.has(flag)) {
    return 0;
  }
  if (equalsIndex !== -1) {
    return token.slice(equalsIndex + 1).trim() ? 1 : 0;
  }
  return offset + 1 < argv.length ? 2 : 1;
}

function segmentIsOpenClawUpdateLifecycleMutation(
  argv: readonly string[],
  offset: number,
): boolean {
  let index = offset;
  let sawDryRun = false;
  while (index < argv.length) {
    const token = argv[index];
    if (!token) {
      index += 1;
      continue;
    }
    const normalized = normalizeLowercaseStringOrEmpty(token);
    if (OPENCLAW_UPDATE_NON_EXEC_TOKENS.has(normalized)) {
      return false;
    }
    if (token === "--") {
      return !sawDryRun;
    }
    if (OPENCLAW_UPDATE_READ_ONLY_SUBCOMMANDS.has(normalized)) {
      return false;
    }
    if (OPENCLAW_UPDATE_MUTATING_SUBCOMMANDS.has(normalized)) {
      return true;
    }
    const consumed = consumeOpenClawUpdateOptionToken(argv, index);
    if (consumed > 0) {
      if (OPENCLAW_UPDATE_DRY_RUN_OPTIONS.has(normalized)) {
        sawDryRun = true;
      }
      index += consumed;
      continue;
    }
    if (token.startsWith("-")) {
      index += 1;
      continue;
    }
    return !sawDryRun;
  }
  return !sawDryRun;
}

function segmentIsOpenClawUninstallLifecycleMutation(
  argv: readonly string[],
  offset: number,
): boolean {
  for (let index = offset; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token) {
      continue;
    }
    const normalized = normalizeLowercaseStringOrEmpty(token);
    if (OPENCLAW_UNINSTALL_NON_EXEC_TOKENS.has(normalized)) {
      return false;
    }
    if (OPENCLAW_UNINSTALL_DRY_RUN_OPTIONS.has(normalized)) {
      return false;
    }
  }
  return true;
}

function segmentIsOpenClawCliLifecycleMutation(argv: readonly string[], cwd?: string): boolean {
  for (const cliOffset of findOpenClawCliOffsets(argv, cwd)) {
    const offset = skipOpenClawArgvSeparator(argv, skipOpenClawGlobalOptions(argv, cliOffset + 1));
    const area = normalizeLowercaseStringOrEmpty(argv[offset]);
    const actionOffset = skipOpenClawGlobalOptions(argv, offset + 1);
    const action = normalizeLowercaseStringOrEmpty(argv[actionOffset]);
    if (area === "gateway") {
      if (
        OPENCLAW_CLI_LIFECYCLE_ACTIONS.has(action) ||
        textContainsCommandSubstitution(argv[actionOffset]) ||
        segmentIsOpenClawGatewayForegroundLifecycleMutation(argv, actionOffset)
      ) {
        return true;
      }
      continue;
    }
    if (
      area === "daemon" &&
      (OPENCLAW_CLI_LIFECYCLE_ACTIONS.has(action) ||
        textContainsCommandSubstitution(argv[actionOffset]))
    ) {
      return true;
    }
    if (
      textContainsCommandSubstitution(argv[offset]) &&
      tokenCouldBeOpenClawLifecycleAction(argv[actionOffset])
    ) {
      return true;
    }
    if (area === "update" && segmentIsOpenClawUpdateLifecycleMutation(argv, actionOffset)) {
      return true;
    }
    if (area === "--update" && segmentIsOpenClawUpdateLifecycleMutation(argv, offset + 1)) {
      return true;
    }
    if (area === "uninstall" && segmentIsOpenClawUninstallLifecycleMutation(argv, actionOffset)) {
      return true;
    }
  }
  return false;
}

function firstNonOptionArgIndex(argv: readonly string[], offset: number): number | null {
  let next = offset;
  while (next < argv.length) {
    const arg = argv[next];
    if (!arg) {
      next += 1;
      continue;
    }
    if (arg === "--") {
      return next + 1 < argv.length ? next + 1 : null;
    }
    if (!arg.startsWith("-")) {
      return next;
    }
    next += 1;
  }
  return null;
}

function firstNonOptionArg(argv: readonly string[], offset: number): string | undefined {
  const index = firstNonOptionArgIndex(argv, offset);
  return index === null ? undefined : argv[index];
}

function firstSystemctlActionArgIndex(argv: readonly string[], offset: number): number | null {
  let next = offset;
  while (next < argv.length) {
    const arg = argv[next];
    if (!arg) {
      next += 1;
      continue;
    }
    if (arg === "--") {
      return next + 1 < argv.length ? next + 1 : null;
    }
    if (!arg.startsWith("-")) {
      return next;
    }
    if (SYSTEMCTL_OPTIONS_WITH_VALUE.has(arg)) {
      next += 2;
      continue;
    }
    if (SYSTEMCTL_INLINE_OPTIONS_WITH_VALUE.test(arg)) {
      next += 1;
      continue;
    }
    next += 1;
  }
  return null;
}

function firstSystemctlActionArg(argv: readonly string[], offset: number): string | undefined {
  const index = firstSystemctlActionArgIndex(argv, offset);
  return index === null ? undefined : argv[index];
}

function argvTargetsMayMentionOpenClaw(
  argv: readonly string[],
  actionIndex: number | null,
): boolean {
  if (actionIndex === null) {
    return false;
  }
  const targetArgv = argv.slice(actionIndex + 1);
  return (
    argvMentionsOpenClawLifecycleTarget(targetArgv) ||
    targetArgv.some(textContainsVariableReference)
  );
}

function argvProcessTargetsMayMentionOpenClaw(argv: readonly string[]): boolean {
  const command = normalizeCommandName(argv[0]);
  const targets: string[] = [];
  for (let index = 1; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token) {
      continue;
    }
    if (token === "--") {
      targets.push(...argv.slice(index + 1));
      break;
    }
    if (processLifecycleOptionConsumesValue(command, token)) {
      index += 1;
      continue;
    }
    if (processLifecycleInlineOptionConsumesValue(command, token)) {
      continue;
    }
    if (token.startsWith("-") || token.startsWith("/")) {
      continue;
    }
    targets.push(token);
  }
  return (
    argvMentionsOpenClawLifecycleTarget(targets) ||
    targets.some((token) => textContainsVariableReference(token))
  );
}

function processLifecycleOptionConsumesValue(command: string, token: string): boolean {
  if (command === "kill") {
    return KILL_OPTIONS_WITH_VALUE.has(token);
  }
  if (command === "pkill") {
    return PKILL_OPTIONS_WITH_VALUE.has(token);
  }
  if (command === "killall") {
    return KILLALL_OPTIONS_WITH_VALUE.has(token);
  }
  return false;
}

function processLifecycleInlineOptionConsumesValue(command: string, token: string): boolean {
  if (command === "kill") {
    return /^-(?:[A-Za-z]+|\d+)$/.test(token) || /^--(?:signal|queue)=/.test(token);
  }
  if (command === "pkill") {
    return /^--(?:pgroup|group|parent|session|terminal|euid|uid|signal)=/.test(token);
  }
  if (command === "killall") {
    return /^--(?:signal|user|older-than|younger-than)=/.test(token);
  }
  return false;
}

function segmentIsLaunchctlLifecycleMutation(argv: readonly string[]): boolean {
  if (normalizeCommandName(argv[0]) !== "launchctl") {
    return false;
  }
  const action = normalizeLowercaseStringOrEmpty(firstNonOptionArg(argv, 1));
  return LAUNCHCTL_LIFECYCLE_ACTIONS.has(action) && argvMentionsOpenClawLifecycleTarget(argv);
}

function segmentIsSystemctlLifecycleMutation(argv: readonly string[]): boolean {
  if (normalizeCommandName(argv[0]) !== "systemctl") {
    return false;
  }
  const action = normalizeLowercaseStringOrEmpty(firstSystemctlActionArg(argv, 1));
  return SYSTEMCTL_LIFECYCLE_ACTIONS.has(action) && argvMentionsOpenClawLifecycleTarget(argv);
}

function segmentIsSchtasksLifecycleMutation(argv: readonly string[]): boolean {
  if (normalizeCommandName(argv[0]) !== "schtasks") {
    return false;
  }
  return (
    argv.some((arg) => SCHTASKS_LIFECYCLE_ACTIONS.has(normalizeLowercaseStringOrEmpty(arg))) &&
    argvMentionsOpenClawLifecycleTarget(argv)
  );
}

function segmentIsProcessLifecycleMutation(argv: readonly string[]): boolean {
  const command = normalizeCommandName(argv[0]);
  return PROCESS_LIFECYCLE_COMMANDS.has(command) && argvMentionsOpenClawLifecycleTarget(argv);
}

function segmentHasLifecycleStringPayload(argv: readonly string[]): boolean {
  const command = normalizeCommandName(argv[0]);
  if (command === "eval") {
    return commandTextMentionsOpenClawLifecycleMutation(argv.slice(1).join(" "));
  }
  if (argv.length === 1) {
    return commandTextMentionsOpenClawLifecycleMutation(argv[0] ?? "");
  }
  const inlineCommand =
    extractBindableShellWrapperInlineCommand([...argv]) ??
    extractShellWrapperInlineCommand([...argv]);
  if (inlineCommand !== null && commandTextMentionsOpenClawLifecycleMutation(inlineCommand)) {
    return true;
  }
  const carrierPayload = extractNpmExecCallPayload(argv);
  return carrierPayload !== null && commandTextMentionsOpenClawLifecycleMutation(carrierPayload);
}

function extractNpmExecCallPayload(argv: readonly string[]): string | null {
  const command = normalizeCommandName(argv[0]);
  let offset = 1;
  if (command === "npm") {
    const subcommand = normalizeLowercaseStringOrEmpty(argv[1]);
    if (subcommand !== "exec" && subcommand !== "x") {
      return null;
    }
    offset = 2;
  } else if (command !== "npx") {
    return null;
  }
  for (let index = offset; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token) {
      continue;
    }
    if (token === "-c" || token === "--call") {
      return argv[index + 1] ?? null;
    }
    if (token.startsWith("--call=")) {
      return token.slice("--call=".length);
    }
    if (token.startsWith("-c") && token.length > 2) {
      return token.slice(2);
    }
  }
  return null;
}

function isEnvAssignmentToken(token: string | undefined): boolean {
  return typeof token === "string" && /^[A-Za-z_][A-Za-z0-9_]*=/.test(token);
}

function isEnvOperandAssignmentToken(token: string | undefined, optionParsing = true): boolean {
  return (
    typeof token === "string" && token.includes("=") && (!optionParsing || !token.startsWith("-"))
  );
}

function expandShellVariableReferencesInText(
  value: string,
  env: NodeJS.ProcessEnv | undefined,
  envComplete: boolean,
  state: { sawVariable: boolean; sawUnknownVariable: boolean },
  depth = 0,
): string {
  if (depth > 4) {
    return value;
  }
  return value.replace(
    new RegExp(SHELL_VARIABLE_REFERENCE_GLOBAL_PATTERN.source, "g"),
    (
      _match,
      bracedName: string | undefined,
      operator: string | undefined,
      word: string | undefined,
      bareName: string | undefined,
    ) => {
      state.sawVariable = true;
      const name = bracedName ?? bareName ?? "";
      const hasValue = Object.hasOwn(env ?? {}, name);
      const rawValue = env?.[name];
      if (rawValue === ENV_SPLIT_UNKNOWN_ASSIGNMENT_VALUE) {
        state.sawUnknownVariable = true;
        return "";
      }
      const resolvedValue = hasValue ? restoreEnvSplitBackslashMarkers(rawValue ?? "") : undefined;
      if (operator && bracedName !== undefined) {
        const op = operator.at(-1);
        const hasUsableValue = operator.startsWith(":")
          ? resolvedValue !== undefined && resolvedValue !== ""
          : hasValue;
        const expandWord = () =>
          expandShellVariableReferencesInText(word ?? "", env, envComplete, state, depth + 1);
        if (op === "-" || op === "=") {
          if (hasUsableValue) {
            return resolvedValue ?? "";
          }
          if (!envComplete) {
            state.sawUnknownVariable = true;
          }
          return expandWord();
        }
        if (op === "+") {
          if (!hasUsableValue) {
            if (!envComplete) {
              state.sawUnknownVariable = true;
            }
            return "";
          }
          return expandWord();
        }
        if (op === "?") {
          if (hasUsableValue) {
            return resolvedValue ?? "";
          }
          if (!envComplete) {
            state.sawUnknownVariable = true;
          }
          return "";
        }
      }
      if (hasValue) {
        return resolvedValue ?? "";
      }
      if (!envComplete) {
        state.sawUnknownVariable = true;
      }
      return "";
    },
  );
}

function resolveShellExpandedAssignmentValue(
  value: string,
  env?: NodeJS.ProcessEnv,
): string | null {
  const state = { sawVariable: false, sawUnknownVariable: false };
  const resolved = expandShellVariableReferencesInText(value, env, false, state);
  if (state.sawUnknownVariable || /(^|[^\\])\$/.test(resolved)) {
    return null;
  }
  return resolved;
}

function collectShellPrefixAssignmentsFromRaw(
  raw: string | undefined,
  env?: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv | undefined {
  if (!raw) {
    return env;
  }
  const argv = splitShellArgs(raw);
  if (!argv) {
    return env;
  }
  let nextEnv: NodeJS.ProcessEnv | undefined;
  for (const token of argv) {
    if (!isEnvAssignmentToken(token)) {
      break;
    }
    nextEnv ??= { ...env };
    const delimiter = token.indexOf("=");
    const key = token.slice(0, delimiter);
    const value = resolveShellExpandedAssignmentValue(token.slice(delimiter + 1), env);
    nextEnv[key] = value ?? ENV_SPLIT_UNKNOWN_ASSIGNMENT_VALUE;
  }
  return nextEnv ?? env;
}

function dropShellPrefixAssignments(argv: readonly string[]): readonly string[] {
  let offset = 0;
  while (offset < argv.length && isEnvAssignmentToken(argv[offset])) {
    offset += 1;
  }
  return argv.slice(offset);
}

function collectStandaloneShellAssignmentsFromArgv(
  argv: readonly string[],
  env?: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv | undefined {
  if (argv.length === 0) {
    return env;
  }
  if (normalizeCommandName(argv[0]) === "export") {
    let nextEnv: NodeJS.ProcessEnv | undefined;
    for (const token of argv.slice(1)) {
      if (!token || token === "--") {
        continue;
      }
      if (token.startsWith("-") || !isEnvAssignmentToken(token)) {
        return env;
      }
      nextEnv ??= { ...env };
      const delimiter = token.indexOf("=");
      const key = token.slice(0, delimiter);
      const value = resolveShellExpandedAssignmentValue(token.slice(delimiter + 1), env);
      nextEnv[key] = value ?? ENV_SPLIT_UNKNOWN_ASSIGNMENT_VALUE;
    }
    return nextEnv ?? env;
  }
  let nextEnv: NodeJS.ProcessEnv | undefined;
  for (const token of argv) {
    if (!isEnvAssignmentToken(token)) {
      return env;
    }
    nextEnv ??= { ...env };
    const delimiter = token.indexOf("=");
    const key = token.slice(0, delimiter);
    const value = resolveShellExpandedAssignmentValue(token.slice(delimiter + 1), env);
    nextEnv[key] = value ?? ENV_SPLIT_UNKNOWN_ASSIGNMENT_VALUE;
  }
  return nextEnv ?? env;
}

function removeShellVariableReferences(value: string): string {
  return value.replace(new RegExp(SHELL_VARIABLE_REFERENCE_SOURCE, "g"), "");
}

function fieldSplitExpandedShellArgv(argv: readonly string[]): string[] {
  return argv.flatMap((token) => {
    if (!/\s/.test(token)) {
      return [token];
    }
    const split = token.trim().split(/\s+/).filter(Boolean);
    return split.length > 0 ? split : [token];
  });
}

function collectSudoAssignmentsFromArgv(
  argv: readonly string[],
  env?: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv {
  let nextEnv: NodeJS.ProcessEnv | undefined;
  let offset = 1;
  while (offset < argv.length) {
    const arg = argv[offset];
    if (!arg) {
      offset += 1;
      continue;
    }
    if (arg === "--") {
      break;
    }
    if (isEnvAssignmentToken(arg)) {
      nextEnv ??= { ...env };
      const delimiter = arg.indexOf("=");
      const key = arg.slice(0, delimiter);
      const value = resolveShellExpandedAssignmentValue(arg.slice(delimiter + 1), env);
      nextEnv[key] = value ?? ENV_SPLIT_UNKNOWN_ASSIGNMENT_VALUE;
      offset += 1;
      continue;
    }
    if (!arg.startsWith("-")) {
      break;
    }
    if (SUDO_OPTIONS_WITH_VALUE.has(arg)) {
      offset += 2;
      continue;
    }
    if (
      Array.from(SUDO_OPTIONS_WITH_VALUE).some(
        (option) => option.startsWith("--") && arg.startsWith(`${option}=`),
      )
    ) {
      offset += 1;
      continue;
    }
    offset += 1;
  }
  return nextEnv ?? { ...env };
}

function skipSudoCarrierArgs(argv: readonly string[]): number {
  let offset = 1;
  while (offset < argv.length) {
    const arg = argv[offset];
    if (!arg) {
      offset += 1;
      continue;
    }
    if (arg === "--") {
      return offset + 1;
    }
    if (isEnvAssignmentToken(arg)) {
      offset += 1;
      continue;
    }
    if (!arg.startsWith("-")) {
      return offset;
    }
    if (SUDO_OPTIONS_WITH_VALUE.has(arg)) {
      offset += 2;
      continue;
    }
    if (
      Array.from(SUDO_OPTIONS_WITH_VALUE).some(
        (option) => option.startsWith("--") && arg.startsWith(`${option}=`),
      )
    ) {
      offset += 1;
      continue;
    }
    offset += 1;
  }
  return offset;
}

type ParsedLifecycleWrapperOption = {
  hasInlineValue: boolean;
  inlineValue?: string;
  name: string;
};

function parseLifecycleWrapperOptionToken(
  token: string,
  optionsWithValue: ReadonlySet<string> = new Set(),
): ParsedLifecycleWrapperOption[] | null {
  const delimiter = token.indexOf("=");
  if (token.startsWith("--")) {
    return [
      {
        hasInlineValue: delimiter !== -1,
        inlineValue: delimiter === -1 ? undefined : token.slice(delimiter + 1),
        name: delimiter === -1 ? token : token.slice(0, delimiter),
      },
    ];
  }
  if (!/^-[A-Za-z0-9]/u.test(token)) {
    return null;
  }
  const options: ParsedLifecycleWrapperOption[] = [];
  for (let index = 1; index < token.length; index += 1) {
    const shortName = `-${token[index] ?? ""}`;
    if (optionsWithValue.has(shortName)) {
      options.push({
        hasInlineValue: index < token.length - 1,
        inlineValue: index < token.length - 1 ? token.slice(index + 1) : undefined,
        name: shortName,
      });
      return options;
    }
    options.push({ hasInlineValue: false, name: shortName });
  }
  return options.length > 0 ? options : null;
}

function readEnvSplitVariableReference(
  value: string,
  offset: number,
): { braced: boolean; endOffset: number; name: string; raw: string } | null {
  if (value[offset] !== "$") {
    return null;
  }
  const braced = value[offset + 1] === "{";
  const match = braced
    ? /^\$\{([A-Za-z_][A-Za-z0-9_]*)\}/.exec(value.slice(offset))
    : /^\$([A-Za-z_][A-Za-z0-9_]*)/.exec(value.slice(offset));
  if (!match?.[1]) {
    return null;
  }
  return {
    braced,
    endOffset: offset + match[0].length,
    name: match[1],
    raw: match[0],
  };
}

function isEnvSplitDoubleQuoteEscape(next: string | undefined): next is string {
  return Boolean(next && ENV_SPLIT_DOUBLE_QUOTE_ESCAPES.has(next));
}

function splitEnvSplitStringPayload(
  payload: string,
  env?: NodeJS.ProcessEnv,
  envComplete = false,
): string[] | null {
  const effectivePayload = payload;
  const tokens: string[] = [];
  let buf = "";
  let inSingle = false;
  let inDouble = false;
  let escaped = false;
  let tokenStarted = false;

  const pushToken = () => {
    if (tokenStarted) {
      tokens.push(buf);
      buf = "";
      tokenStarted = false;
    }
  };

  const appendVariableReference = (
    reference: { braced: boolean; endOffset: number; name: string; raw: string },
    fallback: string,
  ): boolean => {
    if (Object.hasOwn(env ?? {}, reference.name)) {
      const rawValue = env?.[reference.name] ?? "";
      if (rawValue === ENV_SPLIT_UNKNOWN_ASSIGNMENT_VALUE) {
        buf += reference.raw;
        tokenStarted = true;
        return true;
      }
      const value = rawValue
        .replaceAll("\\", ENV_SPLIT_LITERAL_BACKSLASH_MARKER)
        .replaceAll("$", `${ENV_SPLIT_LITERAL_DOLLAR_MARKER}$`);
      buf += value;
      tokenStarted ||= value.length > 0;
      return true;
    }
    if (!reference.braced) {
      if (envComplete) {
        return true;
      }
      return false;
    }
    if (envComplete) {
      return true;
    }
    buf += fallback;
    tokenStarted = true;
    return true;
  };

  for (let index = 0; index < effectivePayload.length; index += 1) {
    const ch = effectivePayload[index];
    if (escaped) {
      buf += ch === "$" ? `${ENV_SPLIT_LITERAL_DOLLAR_MARKER}$` : ch;
      escaped = false;
      tokenStarted = true;
      continue;
    }
    if (inSingle) {
      if (ch === "'") {
        inSingle = false;
      } else if (
        ch === "\\" &&
        (effectivePayload[index + 1] === "'" || effectivePayload[index + 1] === "\\")
      ) {
        buf += effectivePayload[index + 1] ?? "";
        tokenStarted = true;
        index += 1;
      } else {
        buf += ch === "$" ? `${ENV_SPLIT_LITERAL_DOLLAR_MARKER}$` : ch;
        tokenStarted = true;
      }
      continue;
    }
    if (ch === "\\") {
      const next = effectivePayload[index + 1];
      if (next === "c" && !inDouble) {
        break;
      }
      if (next === "_") {
        if (inDouble) {
          buf += " ";
          tokenStarted = true;
        } else {
          pushToken();
        }
        index += 1;
        continue;
      }
      if (next && Object.hasOwn(ENV_SPLIT_CONTROL_ESCAPES, next)) {
        buf += ENV_SPLIT_CONTROL_ESCAPES[next] ?? "";
        tokenStarted = true;
        index += 1;
        continue;
      }
      if (!inDouble || isEnvSplitDoubleQuoteEscape(next)) {
        escaped = true;
        tokenStarted = true;
        continue;
      }
      buf += ch;
      tokenStarted = true;
      continue;
    }
    if (inDouble) {
      if (ch === '"') {
        inDouble = false;
        continue;
      }
      const reference = readEnvSplitVariableReference(effectivePayload, index);
      if (reference) {
        if (!appendVariableReference(reference, reference.raw)) {
          return null;
        }
        index = reference.endOffset - 1;
        continue;
      }
      if (ch === "$") {
        return null;
      }
      buf += ch;
      tokenStarted = true;
      continue;
    }
    if (ch === "'") {
      inSingle = true;
      tokenStarted = true;
      continue;
    }
    if (ch === '"') {
      inDouble = true;
      tokenStarted = true;
      continue;
    }
    if (ch === "#" && !tokenStarted) {
      break;
    }
    const reference = readEnvSplitVariableReference(effectivePayload, index);
    if (reference) {
      if (!appendVariableReference(reference, reference.raw)) {
        return null;
      }
      index = reference.endOffset - 1;
      continue;
    }
    if (ch === "$") {
      return null;
    }
    if (/\s/.test(ch)) {
      pushToken();
      continue;
    }
    buf += ch;
    tokenStarted = true;
  }

  if (escaped || inSingle || inDouble) {
    return null;
  }
  pushToken();
  return tokens;
}

function textContainsVariableReference(value: string | undefined): boolean {
  return typeof value === "string" && SHELL_VARIABLE_REFERENCE_PATTERN.test(value);
}

function textContainsCommandSubstitution(value: string | undefined): boolean {
  return typeof value === "string" && (value.includes("$(") || value.includes("`"));
}

function textContainsDynamicShellExpansion(value: string | undefined): boolean {
  return textContainsVariableReference(value) || textContainsCommandSubstitution(value);
}

function textContainsEnvSplitVariableReference(value: string | undefined): boolean {
  return typeof value === "string" && /(^|[^\\\uE000])\$\{[A-Za-z_][A-Za-z0-9_]*\}/.test(value);
}

function removeEnvSplitVariableReferences(value: string): string {
  return value.replace(/(^|[^\\\uE000])\$\{[A-Za-z_][A-Za-z0-9_]*\}/g, "$1");
}

function argvContainsEnvSplitVariableReference(argv: readonly string[]): boolean {
  return argv.some((token) => textContainsEnvSplitVariableReference(token));
}

function stripEnvSplitLiteralDollarMarkers(value: string): string {
  return value
    .replaceAll(ENV_SPLIT_LITERAL_DOLLAR_MARKER, "")
    .replaceAll(ENV_SPLIT_LITERAL_BACKSLASH_MARKER, "\\");
}

function restoreEnvSplitBackslashMarkers(value: string): string {
  return value.replaceAll(ENV_SPLIT_LITERAL_BACKSLASH_MARKER, "\\");
}

function restoreEnvSplitBackslashMarkersInArgv(argv: readonly string[]): string[] {
  return argv.map(restoreEnvSplitBackslashMarkers);
}

function argvContainsRestoredEnvSplitVariableReference(argv: readonly string[]): boolean {
  return argv.some((token) =>
    textContainsEnvSplitVariableReference(stripEnvSplitLiteralDollarMarkers(token)),
  );
}

function shellWrapperPayloadMayExpandWithEnvToLifecycle(
  argv: readonly string[],
  env: NodeJS.ProcessEnv,
  envComplete: boolean,
): boolean {
  if (!isShellWrapperInvocation([...argv])) {
    return false;
  }
  const inlineCommand =
    extractBindableShellWrapperInlineCommand([...argv]) ??
    extractShellWrapperInlineCommand([...argv]);
  if (inlineCommand === null) {
    return false;
  }
  const payload = stripEnvSplitLiteralDollarMarkers(inlineCommand);
  const state = { sawVariable: false, sawUnknownVariable: false };
  const expanded = expandShellVariableReferencesInText(payload, env, envComplete, state);
  if (!state.sawVariable) {
    return false;
  }
  if (commandTextMentionsOpenClawLifecycleMutation(expanded)) {
    return true;
  }
  return state.sawUnknownVariable && commandTextMentionsOpenClawLifecycleMutation(payload);
}

function shellWrapperPayloadUnknownEnvMayExpandToLifecycle(
  argv: readonly string[],
  env: NodeJS.ProcessEnv,
): boolean {
  if (!envContainsUnknownAssignmentValue(env) || !isShellWrapperInvocation([...argv])) {
    return false;
  }
  const inlineCommand =
    extractBindableShellWrapperInlineCommand([...argv]) ??
    extractShellWrapperInlineCommand([...argv]);
  if (inlineCommand === null) {
    return false;
  }
  const payload = stripEnvSplitLiteralDollarMarkers(inlineCommand);
  const expanded = payload.replace(
    new RegExp(SHELL_VARIABLE_REFERENCE_GLOBAL_PATTERN.source, "g"),
    (
      match,
      bracedName: string | undefined,
      _operator: string | undefined,
      _word: string | undefined,
      bareName: string | undefined,
    ) => {
      const name = bracedName ?? bareName ?? "";
      return env[name] === ENV_SPLIT_UNKNOWN_ASSIGNMENT_VALUE ? "openclaw" : match;
    },
  );
  return commandTextMentionsOpenClawLifecycleMutation(expanded);
}

function envSplitArgvIsLifecycleMutation(argv: readonly string[]): boolean {
  if (argv.length === 1 && /\s/.test(argv[0] ?? "")) {
    return false;
  }
  return segmentIsOpenClawLifecycleMutation(argv);
}

function argvHasVariableExecutableLifecycleShape(argv: readonly string[]): boolean {
  if (!textContainsVariableReference(argv[0])) {
    return false;
  }
  const tail = argv.slice(1);
  const emptyExpandedExecutable = removeShellVariableReferences(argv[0] ?? "");
  if (
    emptyExpandedExecutable.length > 0 &&
    segmentIsOpenClawLifecycleMutation([emptyExpandedExecutable, ...tail])
  ) {
    return true;
  }
  for (const command of VARIABLE_EXECUTABLE_LIFECYCLE_CANDIDATES) {
    const candidate = [command, ...tail];
    if (segmentIsOpenClawLifecycleMutation(candidate)) {
      return true;
    }
  }
  const envTailArgv = unwrapLifecycleEnvArgv(["env", ...tail]);
  if (envTailArgv && segmentIsOpenClawLifecycleMutation(envTailArgv)) {
    return true;
  }
  return segmentIsOpenClawLifecycleMutation(tail);
}

function tokenCouldBeOpenClawLifecycleArea(token: string | undefined): boolean {
  const normalized = normalizeLowercaseStringOrEmpty(token);
  return (
    normalized === "gateway" ||
    normalized === "daemon" ||
    normalized === "update" ||
    normalized === "uninstall" ||
    textContainsDynamicShellExpansion(token)
  );
}

function tokenCouldBeOpenClawLifecycleAction(token: string | undefined): boolean {
  return (
    OPENCLAW_CLI_LIFECYCLE_ACTIONS.has(normalizeLowercaseStringOrEmpty(token)) ||
    textContainsDynamicShellExpansion(token)
  );
}

function argvCouldBeOpenClawLifecycleFromAreaOffset(
  argv: readonly string[],
  areaOffset: number,
): boolean {
  if (areaOffset >= argv.length) {
    return false;
  }
  const normalizedAreaOffset = skipOpenClawGlobalOptions(argv, areaOffset);
  const actionOffset = skipOpenClawGlobalOptions(argv, normalizedAreaOffset + 1);
  return (
    tokenCouldBeOpenClawLifecycleArea(argv[normalizedAreaOffset]) &&
    tokenCouldBeOpenClawLifecycleAction(argv[actionOffset])
  );
}

function argvCouldBeOpenClawGatewayCallLifecycleFromActionOffset(
  argv: readonly string[],
  actionOffset: number,
): boolean {
  if (normalizeLowercaseStringOrEmpty(argv[actionOffset]) !== "call") {
    return false;
  }
  const method = findOpenClawGatewayCallMethod(argv, actionOffset + 1);
  return (
    OPENCLAW_GATEWAY_CALL_LIFECYCLE_METHODS.has(normalizeLowercaseStringOrEmpty(method)) ||
    textContainsVariableReference(method)
  );
}

function argvMayExpandToLifecycleMutationOnce(argv: readonly string[]): boolean {
  if (argvHasVariableExecutableLifecycleShape(argv)) {
    return true;
  }
  const command = normalizeCommandName(argv[0]);
  if (command === "openclaw" || OPENCLAW_CLI_CARRIER_COMMANDS.has(command)) {
    const offsets = findOpenClawCliOffsets(argv);
    if (offsets.length === 0) {
      if (OPENCLAW_CLI_CARRIER_COMMANDS.has(command)) {
        return argv.some(
          (arg, index) =>
            index > 0 &&
            textContainsVariableReference(arg) &&
            segmentIsOpenClawCliLifecycleMutation(["openclaw", ...argv.slice(index + 1)]),
        );
      }
      return false;
    }
    for (const cliOffset of offsets) {
      const offset = skipOpenClawGlobalOptions(argv, cliOffset + 1);
      if (
        textContainsVariableReference(argv[offset]) &&
        (argvCouldBeOpenClawLifecycleFromAreaOffset(argv, offset + 1) ||
          argvCouldBeOpenClawLifecycleFromAreaOffset(argv, offset + 2))
      ) {
        return true;
      }
      const actionOffset = skipOpenClawGlobalOptions(argv, offset + 1);
      if (
        (textContainsVariableReference(argv[offset]) ||
          textContainsVariableReference(argv[actionOffset])) &&
        tokenCouldBeOpenClawLifecycleArea(argv[offset]) &&
        tokenCouldBeOpenClawLifecycleAction(argv[actionOffset])
      ) {
        return true;
      }
      if (
        normalizeLowercaseStringOrEmpty(argv[offset]) === "gateway" &&
        argvCouldBeOpenClawGatewayCallLifecycleFromActionOffset(argv, actionOffset)
      ) {
        return true;
      }
    }
    return false;
  }
  if (command === "systemctl" || command === "launchctl") {
    const actionIndex =
      command === "systemctl"
        ? firstSystemctlActionArgIndex(argv, 1)
        : firstNonOptionArgIndex(argv, 1);
    const action = actionIndex === null ? undefined : argv[actionIndex];
    return (
      (textContainsVariableReference(action) || argv.some(textContainsVariableReference)) &&
      (textContainsVariableReference(action) ||
        SYSTEMCTL_LIFECYCLE_ACTIONS.has(normalizeLowercaseStringOrEmpty(action)) ||
        LAUNCHCTL_LIFECYCLE_ACTIONS.has(normalizeLowercaseStringOrEmpty(action))) &&
      argvTargetsMayMentionOpenClaw(argv, actionIndex)
    );
  }
  if (command === "schtasks" || PROCESS_LIFECYCLE_COMMANDS.has(command)) {
    return argv.some(textContainsVariableReference) && argvProcessTargetsMayMentionOpenClaw(argv);
  }
  return false;
}

function argvMayExpandToLifecycleMutation(argv: readonly string[]): boolean {
  let current: readonly string[] | null = argv;
  for (
    let depth = 0;
    current && current.length > 0 && depth < MAX_LIFECYCLE_CARRIER_UNWRAP_DEPTH;
    depth += 1
  ) {
    if (argvMayExpandToLifecycleMutationOnce(current)) {
      return true;
    }
    current = unwrapLifecycleCarrierArgv(current);
  }
  return false;
}

function expandShellVariableReferencesInArgv(
  argv: readonly string[],
  env: NodeJS.ProcessEnv | undefined,
  envComplete: boolean,
): { argv: readonly string[]; sawVariable: boolean; sawUnknownVariable: boolean } {
  const state = { sawVariable: false, sawUnknownVariable: false };
  const expanded = argv.map((token) =>
    expandShellVariableReferencesInText(token, env, envComplete, state),
  );
  return { argv: expanded, ...state };
}

function envArgvHasSplitStringOption(argv: readonly string[]): boolean {
  if (normalizeCommandName(argv[0]) !== "env") {
    return false;
  }
  let sawAssignmentOperand = false;
  let optionParsing = true;
  for (let index = 1; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg) {
      break;
    }
    if (arg === "--" && optionParsing) {
      optionParsing = false;
      continue;
    }
    if (isEnvOperandAssignmentToken(arg, optionParsing && !sawAssignmentOperand)) {
      sawAssignmentOperand = true;
      continue;
    }
    if (sawAssignmentOperand || !optionParsing || !arg.startsWith("-")) {
      break;
    }
    const options = parseLifecycleWrapperOptionToken(arg, ENV_OPTIONS_WITH_VALUE);
    if (!options) {
      break;
    }
    for (const option of options) {
      if (ENV_SPLIT_STRING_OPTIONS.has(option.name)) {
        return true;
      }
      if (ENV_OPTIONS_WITH_VALUE.has(option.name) && !option.hasInlineValue) {
        index += 1;
        break;
      }
    }
  }
  return false;
}

function textContainsShellParameterExpansionOperator(value: string | undefined): boolean {
  return typeof value === "string" && /\$\{[A-Za-z_][A-Za-z0-9_]*(?::?[-+?=])[^}]*\}/.test(value);
}

function textContainsUnknownPlusExpansionToLifecycle(value: string | undefined): boolean {
  if (typeof value !== "string") {
    return false;
  }
  const expandedIfSet = value.replace(/\$\{[A-Za-z_][A-Za-z0-9_]*(?::?\+)([^}]*)\}/g, "$1");
  return expandedIfSet !== value && commandTextMentionsOpenClawLifecycleMutation(expandedIfSet);
}

function envArgvHasShellParameterExpansionInSplitString(argv: readonly string[]): boolean {
  if (normalizeCommandName(argv[0]) !== "env") {
    return false;
  }
  let sawAssignmentOperand = false;
  let optionParsing = true;
  for (let index = 1; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg) {
      break;
    }
    if (arg === "--" && optionParsing) {
      optionParsing = false;
      continue;
    }
    if (isEnvOperandAssignmentToken(arg, optionParsing && !sawAssignmentOperand)) {
      sawAssignmentOperand = true;
      continue;
    }
    if (sawAssignmentOperand || !optionParsing || !arg.startsWith("-")) {
      break;
    }
    const options = parseLifecycleWrapperOptionToken(arg, ENV_OPTIONS_WITH_VALUE);
    if (!options) {
      break;
    }
    for (const option of options) {
      if (ENV_SPLIT_STRING_OPTIONS.has(option.name)) {
        const payload = option.hasInlineValue ? option.inlineValue : argv[index + 1];
        return textContainsShellParameterExpansionOperator(payload);
      }
      if (ENV_OPTIONS_WITH_VALUE.has(option.name) && !option.hasInlineValue) {
        index += 1;
        break;
      }
    }
  }
  return false;
}

function envArgvHasUnknownPlusExpansionToLifecycleInSplitString(argv: readonly string[]): boolean {
  if (normalizeCommandName(argv[0]) !== "env") {
    return false;
  }
  let sawAssignmentOperand = false;
  let optionParsing = true;
  for (let index = 1; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg) {
      break;
    }
    if (arg === "--" && optionParsing) {
      optionParsing = false;
      continue;
    }
    if (isEnvOperandAssignmentToken(arg, optionParsing && !sawAssignmentOperand)) {
      sawAssignmentOperand = true;
      continue;
    }
    if (sawAssignmentOperand || !optionParsing || !arg.startsWith("-")) {
      break;
    }
    const options = parseLifecycleWrapperOptionToken(arg, ENV_OPTIONS_WITH_VALUE);
    if (!options) {
      break;
    }
    for (const option of options) {
      if (ENV_SPLIT_STRING_OPTIONS.has(option.name)) {
        const payload = option.hasInlineValue ? option.inlineValue : argv[index + 1];
        return textContainsUnknownPlusExpansionToLifecycle(payload);
      }
      if (ENV_OPTIONS_WITH_VALUE.has(option.name) && !option.hasInlineValue) {
        index += 1;
        break;
      }
    }
  }
  return false;
}

function envContainsUnknownAssignmentValue(env: NodeJS.ProcessEnv | undefined): boolean {
  return Object.values(env ?? {}).includes(ENV_SPLIT_UNKNOWN_ASSIGNMENT_VALUE);
}

function argvMayExpandWithShellVariablesToLifecycle(
  argv: readonly string[],
  env: NodeJS.ProcessEnv | undefined,
  envComplete: boolean,
  cwd?: string,
): boolean {
  const executableArgv = dropShellPrefixAssignments(argv);
  const hasEnvSplitStringWithKnownEnv =
    envArgvHasSplitStringOption(executableArgv) && !envContainsUnknownAssignmentValue(env);
  if (
    hasEnvSplitStringWithKnownEnv &&
    !envArgvHasShellParameterExpansionInSplitString(executableArgv)
  ) {
    return false;
  }
  const expanded = expandShellVariableReferencesInArgv(executableArgv, env, envComplete);
  if (!expanded.sawVariable) {
    return false;
  }
  if (
    segmentIsOpenClawLifecycleMutation(expanded.argv, cwd) ||
    segmentIsOpenClawLifecycleMutation(fieldSplitExpandedShellArgv(expanded.argv), cwd)
  ) {
    return true;
  }
  if (!expanded.sawUnknownVariable) {
    return false;
  }
  if (
    !envComplete &&
    hasEnvSplitStringWithKnownEnv &&
    envArgvHasUnknownPlusExpansionToLifecycleInSplitString(executableArgv)
  ) {
    return true;
  }
  if (hasEnvSplitStringWithKnownEnv && envComplete) {
    return false;
  }
  return argvMayExpandToLifecycleMutation(executableArgv);
}

function envSplitPayloadMayExpandToLifecycleCommand(
  payload: string | undefined,
  trailingArgv: readonly string[] = [],
  env?: NodeJS.ProcessEnv,
  expansionDepth = 0,
  envComplete = false,
): boolean {
  if (expansionDepth > MAX_LIFECYCLE_CARRIER_UNWRAP_DEPTH) {
    return false;
  }
  if (typeof payload !== "string") {
    return false;
  }
  if (
    envSplitPayloadLeadingBareVariableMayExpandToLifecycleCommand(
      payload,
      trailingArgv,
      env,
      expansionDepth,
      envComplete,
    )
  ) {
    return true;
  }
  const splitArgv = splitEnvSplitStringPayload(payload, env, envComplete);
  if (!splitArgv) {
    return false;
  }
  const carriedEnv = collectEnvAssignmentsFromEnvArgv(["env", ...splitArgv], { ...env });
  const shellExpandedTrailing = expandShellVariableReferencesInArgv(trailingArgv, env, envComplete);
  const trailingArgvCandidates: readonly (readonly string[])[] = shellExpandedTrailing.sawVariable
    ? [
        shellExpandedTrailing.argv,
        fieldSplitExpandedShellArgv(shellExpandedTrailing.argv),
        shellExpandedTrailing.sawUnknownVariable ? trailingArgv : [],
      ].filter((candidate) => candidate.length > 0)
    : [trailingArgv];
  const carriedArgv = unwrapLifecycleEnvArgv(["env", ...splitArgv, ...trailingArgv]);
  const lifecycleCarriedArgv = carriedArgv
    ? restoreEnvSplitBackslashMarkersInArgv(carriedArgv)
    : null;
  if (lifecycleCarriedArgv && envSplitArgvIsLifecycleMutation(lifecycleCarriedArgv)) {
    return true;
  }
  for (const candidateTrailingArgv of trailingArgvCandidates) {
    const shellExpandedCarriedArgv = unwrapLifecycleEnvArgv([
      "env",
      ...splitArgv,
      ...candidateTrailingArgv,
    ]);
    const lifecycleShellExpandedCarriedArgv = shellExpandedCarriedArgv
      ? restoreEnvSplitBackslashMarkersInArgv(shellExpandedCarriedArgv)
      : null;
    if (
      lifecycleShellExpandedCarriedArgv &&
      envSplitArgvIsLifecycleMutation(lifecycleShellExpandedCarriedArgv)
    ) {
      return true;
    }
    if (
      lifecycleShellExpandedCarriedArgv &&
      shellWrapperPayloadMayExpandWithEnvToLifecycle(
        lifecycleShellExpandedCarriedArgv,
        carriedEnv,
        envComplete,
      )
    ) {
      return true;
    }
    if (
      lifecycleShellExpandedCarriedArgv &&
      shellWrapperPayloadUnknownEnvMayExpandToLifecycle(
        lifecycleShellExpandedCarriedArgv,
        carriedEnv,
      )
    ) {
      return true;
    }
    if (
      lifecycleShellExpandedCarriedArgv &&
      shellExpandedTrailing.sawUnknownVariable &&
      argvMayExpandToLifecycleMutation(lifecycleShellExpandedCarriedArgv)
    ) {
      return true;
    }
  }
  if (
    lifecycleCarriedArgv &&
    shellWrapperPayloadMayExpandWithEnvToLifecycle(lifecycleCarriedArgv, carriedEnv, envComplete)
  ) {
    return true;
  }
  if (
    lifecycleCarriedArgv &&
    shellWrapperPayloadUnknownEnvMayExpandToLifecycle(lifecycleCarriedArgv, carriedEnv)
  ) {
    return true;
  }
  if (
    carriedArgv &&
    (argvContainsEnvSplitVariableReference(carriedArgv) ||
      (normalizeCommandName(carriedArgv[0]) === "env" &&
        argvContainsRestoredEnvSplitVariableReference(carriedArgv))) &&
    (argvHasPotentialEnvSplitLifecycleExpansion(
      carriedArgv,
      carriedEnv,
      expansionDepth + 1,
      envComplete,
    ) ||
      argvMayExpandToLifecycleMutation(lifecycleCarriedArgv ?? carriedArgv))
  ) {
    return true;
  }
  if (splitArgv.includes("")) {
    return false;
  }
  const emptyExpandedArgv = splitArgv
    .map(removeEnvSplitVariableReferences)
    .filter((token) => token !== "");
  const emptyExpandedCarriedArgv = unwrapLifecycleEnvArgv([
    "env",
    ...emptyExpandedArgv,
    ...trailingArgv,
  ]);
  if (emptyExpandedCarriedArgv && envSplitArgvIsLifecycleMutation(emptyExpandedCarriedArgv)) {
    return true;
  }
  return (
    carriedArgv !== null &&
    argvContainsEnvSplitVariableReference(carriedArgv) &&
    argvMayExpandToLifecycleMutation(carriedArgv)
  );
}

function envSplitPayloadLeadingBareVariableMayExpandToLifecycleCommand(
  payload: string,
  trailingArgv: readonly string[],
  env: NodeJS.ProcessEnv | undefined,
  expansionDepth: number,
  envComplete: boolean,
): boolean {
  if (envComplete || expansionDepth > 4) {
    return false;
  }
  const match = /^\s*\$([A-Za-z_][A-Za-z0-9_]*)([\s\S]*)$/u.exec(payload);
  const name = match?.[1];
  if (!name || Object.hasOwn(env ?? {}, name)) {
    return false;
  }
  const suffix = match?.[2] ?? "";
  return VARIABLE_EXECUTABLE_LIFECYCLE_CANDIDATES.some((candidate) =>
    envSplitPayloadMayExpandToLifecycleCommand(
      `${candidate}${suffix}`,
      trailingArgv,
      env,
      expansionDepth + 1,
      envComplete,
    ),
  );
}

function envArgvHasPotentialEnvSplitLifecycleExpansion(
  argv: readonly string[],
  env?: NodeJS.ProcessEnv,
  expansionDepth = 0,
  envComplete = false,
): boolean {
  if (normalizeCommandName(argv[0]) !== "env") {
    return false;
  }
  let sawAssignmentOperand = false;
  for (let index = 1; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg || arg === "--") {
      break;
    }
    if (isEnvOperandAssignmentToken(arg, !sawAssignmentOperand)) {
      sawAssignmentOperand = true;
      continue;
    }
    if (sawAssignmentOperand) {
      break;
    }
    if (!arg.startsWith("-")) {
      break;
    }
    const options = parseLifecycleWrapperOptionToken(arg, ENV_OPTIONS_WITH_VALUE);
    if (!options) {
      break;
    }
    let consumedValue = false;
    for (const option of options) {
      if (ENV_NON_EXEC_OPTIONS.has(option.name)) {
        return false;
      }
      if (!ENV_SPLIT_STRING_OPTIONS.has(option.name)) {
        if (ENV_OPTIONS_WITH_VALUE.has(option.name)) {
          index += option.hasInlineValue ? 0 : 1;
          consumedValue = true;
          break;
        }
        continue;
      }
      const rawPayload = option.hasInlineValue ? option.inlineValue : argv[index + 1];
      const payload =
        typeof rawPayload === "string" ? stripEnvSplitLiteralDollarMarkers(rawPayload) : rawPayload;
      const trailingArgv = argv.slice(index + (option.hasInlineValue ? 1 : 2));
      if (
        envSplitPayloadMayExpandToLifecycleCommand(
          payload,
          trailingArgv,
          env,
          expansionDepth,
          envComplete,
        )
      ) {
        return true;
      }
      index += option.hasInlineValue ? 0 : 1;
      consumedValue = true;
      break;
    }
    if (consumedValue) {
      continue;
    }
  }
  return false;
}

function collectEnvAssignmentsFromEnvArgv(
  argv: readonly string[],
  env: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv {
  if (normalizeCommandName(argv[0]) !== "env") {
    return env;
  }
  let nextEnv: NodeJS.ProcessEnv = { ...env };
  let sawAssignmentOperand = false;
  let optionParsing = true;
  for (let index = 1; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg) {
      break;
    }
    if (arg === "--" && optionParsing) {
      optionParsing = false;
      continue;
    }
    if (isEnvOperandAssignmentToken(arg, optionParsing && !sawAssignmentOperand)) {
      sawAssignmentOperand = true;
      const delimiter = arg.indexOf("=");
      const key = arg.slice(0, delimiter);
      const value = resolveShellExpandedAssignmentValue(arg.slice(delimiter + 1), env);
      nextEnv[key] = value ?? ENV_SPLIT_UNKNOWN_ASSIGNMENT_VALUE;
      continue;
    }
    if (sawAssignmentOperand) {
      break;
    }
    if (arg === "-") {
      nextEnv = {};
      continue;
    }
    if (!optionParsing || !arg.startsWith("-")) {
      break;
    }
    const options = parseLifecycleWrapperOptionToken(arg, ENV_OPTIONS_WITH_VALUE);
    if (!options) {
      break;
    }
    for (const option of options) {
      if (option.name === "-" || option.name === "-i" || option.name === "--ignore-environment") {
        nextEnv = {};
        continue;
      }
      if (option.name === "-u" || option.name === "--unset") {
        const key = option.hasInlineValue ? option.inlineValue : argv[index + 1];
        if (key) {
          delete nextEnv[key];
        }
      }
      if (ENV_OPTIONS_WITH_VALUE.has(option.name) && !option.hasInlineValue) {
        index += 1;
        break;
      }
    }
  }
  return nextEnv;
}

function collectLifecycleCarrierAssignmentsFromArgv(
  argv: readonly string[],
  env: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv {
  const command = normalizeCommandName(argv[0]);
  if (command === "env") {
    return collectEnvAssignmentsFromEnvArgv(argv, env);
  }
  if (command === "sudo" || command === "doas") {
    return collectSudoAssignmentsFromArgv(argv, env);
  }
  return env;
}

function argvHasPotentialEnvSplitLifecycleExpansion(
  argv: readonly string[],
  env?: NodeJS.ProcessEnv,
  expansionDepth = 0,
  envComplete = env !== undefined,
): boolean {
  if (expansionDepth > MAX_LIFECYCLE_CARRIER_UNWRAP_DEPTH) {
    return false;
  }
  if (normalizeCommandName(argv[0]) === "flock") {
    const shellPayload = extractFlockShellCommandPayload(argv);
    const shellArgv = shellPayload === null ? null : splitShellArgs(shellPayload);
    const shellEnv = collectShellPrefixAssignmentsFromRaw(shellPayload ?? undefined, env);
    const commandArgv = shellArgv ? dropShellPrefixAssignments(shellArgv) : null;
    if (
      commandArgv &&
      (argvHasPotentialEnvSplitLifecycleExpansion(
        commandArgv,
        shellEnv,
        expansionDepth + 1,
        envComplete,
      ) ||
        segmentIsOpenClawLifecycleMutation(commandArgv))
    ) {
      return true;
    }
  }
  let current: readonly string[] | null = argv;
  let visibleEnv: NodeJS.ProcessEnv = { ...env };
  for (
    let depth = 0;
    current && current.length > 0 && depth < MAX_LIFECYCLE_CARRIER_UNWRAP_DEPTH;
    depth += 1
  ) {
    if (shellWrapperPayloadMayExpandWithEnvToLifecycle(current, visibleEnv, envComplete)) {
      return true;
    }
    if (shellWrapperPayloadUnknownEnvMayExpandToLifecycle(current, visibleEnv)) {
      return true;
    }
    if (
      envArgvHasPotentialEnvSplitLifecycleExpansion(
        current,
        visibleEnv,
        expansionDepth,
        envComplete,
      )
    ) {
      return true;
    }
    visibleEnv = collectLifecycleCarrierAssignmentsFromArgv(current, visibleEnv);
    current = unwrapLifecycleCarrierArgv(current);
  }
  return false;
}

function unwrapLifecycleEnvArgv(argv: readonly string[], depth = 0): readonly string[] | null {
  if (depth > 32) {
    return null;
  }
  let offset = 1;
  let sawAssignmentOperand = false;
  let optionParsing = true;
  while (offset < argv.length) {
    const arg = argv[offset];
    if (arg === "") {
      return null;
    }
    if (arg === "--" && optionParsing) {
      optionParsing = false;
      offset += 1;
      continue;
    }
    if (isEnvOperandAssignmentToken(arg, optionParsing && !sawAssignmentOperand)) {
      sawAssignmentOperand = true;
      offset += 1;
      continue;
    }
    if (sawAssignmentOperand) {
      return argv.slice(offset);
    }
    if (arg === "-") {
      offset += 1;
      continue;
    }
    if (!optionParsing || !arg.startsWith("-")) {
      return argv.slice(offset);
    }
    const options = parseLifecycleWrapperOptionToken(arg, ENV_OPTIONS_WITH_VALUE);
    if (!options) {
      return null;
    }
    let consumedValue = false;
    for (const option of options) {
      if (ENV_NON_EXEC_OPTIONS.has(option.name)) {
        return null;
      }
      if (ENV_STANDALONE_OPTIONS.has(option.name)) {
        continue;
      }
      if (!ENV_OPTIONS_WITH_VALUE.has(option.name)) {
        return null;
      }
      const value = option.hasInlineValue ? option.inlineValue : argv[offset + 1];
      if (typeof value !== "string") {
        return null;
      }
      const nextOffset = offset + (option.hasInlineValue ? 1 : 2);
      if (ENV_SPLIT_STRING_OPTIONS.has(option.name)) {
        const splitArgv = splitEnvSplitStringPayload(stripEnvSplitLiteralDollarMarkers(value));
        if (splitArgv?.length === 1 && /\s/.test(splitArgv[0] ?? "")) {
          return null;
        }
        return splitArgv
          ? unwrapLifecycleEnvArgv(["env", ...splitArgv, ...argv.slice(nextOffset)], depth + 1)
          : null;
      }
      offset = nextOffset;
      consumedValue = true;
      break;
    }
    if (!consumedValue) {
      offset += 1;
    }
  }
  return null;
}

function skipLifecycleWrapperOptions(
  argv: readonly string[],
  params: {
    standaloneOptions?: ReadonlySet<string>;
    optionsWithValue?: ReadonlySet<string>;
    nonExecOptions?: ReadonlySet<string>;
  },
): number | null {
  let offset = 1;
  while (offset < argv.length) {
    const arg = argv[offset];
    if (!arg) {
      offset += 1;
      continue;
    }
    if (arg === "--") {
      return offset + 1;
    }
    if (!arg.startsWith("-") || arg === "-") {
      return offset;
    }
    const options = parseLifecycleWrapperOptionToken(arg, params.optionsWithValue);
    if (!options) {
      return null;
    }
    let consumesNextValue = false;
    for (const option of options) {
      const optionName = option.name;
      if (params.nonExecOptions?.has(optionName)) {
        return null;
      }
      if (params.standaloneOptions?.has(optionName)) {
        continue;
      }
      if (params.optionsWithValue?.has(optionName)) {
        consumesNextValue = !option.hasInlineValue;
        break;
      }
      return null;
    }
    offset += consumesNextValue ? 2 : 1;
  }
  return null;
}

function lifecycleWrapperHasNonExecOptionBeforeCommand(
  argv: readonly string[],
  params: {
    nonExecOptions: ReadonlySet<string>;
    optionsWithValue?: ReadonlySet<string>;
  },
): boolean {
  let offset = 1;
  while (offset < argv.length) {
    const arg = argv[offset];
    if (!arg || arg === "--") {
      return false;
    }
    if (!arg.startsWith("-") || arg === "-") {
      return false;
    }
    const options = parseLifecycleWrapperOptionToken(arg, params.optionsWithValue);
    if (!options) {
      return false;
    }
    let consumesNextValue = false;
    for (const option of options) {
      if (params.nonExecOptions.has(option.name)) {
        return true;
      }
      if (params.optionsWithValue?.has(option.name)) {
        consumesNextValue = !option.hasInlineValue;
        break;
      }
    }
    offset += consumesNextValue ? 2 : 1;
  }
  return false;
}

function dispatchWrapperInvocationIsNonExecuting(
  wrapper: string,
  argv: readonly string[],
): boolean {
  if (wrapper === "nohup") {
    return lifecycleWrapperHasNonExecOptionBeforeCommand(argv, {
      nonExecOptions: NOHUP_NON_EXEC_OPTIONS,
    });
  }
  if (wrapper === "stdbuf") {
    return lifecycleWrapperHasNonExecOptionBeforeCommand(argv, {
      nonExecOptions: STDBUF_NON_EXEC_OPTIONS,
      optionsWithValue: STDBUF_OPTIONS_WITH_VALUE,
    });
  }
  if (wrapper === "time") {
    return lifecycleWrapperHasNonExecOptionBeforeCommand(argv, {
      nonExecOptions: TIME_NON_EXEC_OPTIONS,
      optionsWithValue: TIME_OPTIONS_WITH_VALUE,
    });
  }
  if (wrapper === "timeout") {
    return lifecycleWrapperHasNonExecOptionBeforeCommand(argv, {
      nonExecOptions: TIMEOUT_NON_EXEC_OPTIONS,
      optionsWithValue: TIMEOUT_OPTIONS_WITH_VALUE,
    });
  }
  return lifecycleWrapperHasNonExecOptionBeforeCommand(argv, {
    nonExecOptions: GENERIC_WRAPPER_NON_EXEC_OPTIONS,
  });
}

function isChrtPriorityToken(token: string | undefined): boolean {
  return typeof token === "string" && /^\d+$/.test(token);
}

function extractFlockShellCommandPayload(argv: readonly string[]): string | null {
  let offset = 1;
  while (offset < argv.length) {
    const arg = argv[offset];
    if (!arg) {
      offset += 1;
      continue;
    }
    if (arg === "-c" || arg === "--command") {
      return argv[offset + 1] ?? null;
    }
    if (arg.startsWith("--command=")) {
      return arg.slice("--command=".length);
    }
    if (arg.startsWith("-c") && arg.length > 2) {
      return arg.slice(2);
    }
    if (!arg.startsWith("-") || arg === "-") {
      offset += 1;
      break;
    }
    if (
      arg === "-E" ||
      arg === "-w" ||
      arg === "--conflict-exit-code" ||
      arg === "--timeout" ||
      arg === "--wait"
    ) {
      offset += 2;
      continue;
    }
    offset += 1;
  }
  const afterLock = argv[offset];
  if (afterLock === "-c" || afterLock === "--command") {
    return argv[offset + 1] ?? null;
  }
  if (afterLock?.startsWith("--command=")) {
    return afterLock.slice("--command=".length);
  }
  if (afterLock?.startsWith("-c") && afterLock.length > 2) {
    return afterLock.slice(2);
  }
  return null;
}

function unwrapXargsCarrierArgv(argv: readonly string[]): readonly string[] | null {
  if (
    lifecycleWrapperHasNonExecOptionBeforeCommand(argv, {
      nonExecOptions: XARGS_NON_EXEC_OPTIONS,
      optionsWithValue: XARGS_OPTIONS_WITH_VALUE,
    })
  ) {
    return null;
  }
  const commandOffset = skipLifecycleWrapperOptions(argv, {
    standaloneOptions: XARGS_STANDALONE_OPTIONS,
    optionsWithValue: XARGS_OPTIONS_WITH_VALUE,
    nonExecOptions: XARGS_NON_EXEC_OPTIONS,
  });
  return commandOffset !== null && commandOffset < argv.length ? argv.slice(commandOffset) : null;
}

function segmentStartsWithLifecycleCommand(argv: readonly string[]): boolean {
  return (
    segmentIsOpenClawCliLifecycleMutation(argv) ||
    segmentIsLaunchctlLifecycleMutation(argv) ||
    segmentIsSystemctlLifecycleMutation(argv) ||
    segmentIsSchtasksLifecycleMutation(argv) ||
    segmentIsProcessLifecycleMutation(argv) ||
    (isShellWrapperInvocation([...argv]) && segmentHasLifecycleStringPayload(argv))
  );
}

function findLifecycleCommandStartOffset(argv: readonly string[]): number | null {
  for (let offset = 1; offset < argv.length; offset += 1) {
    if (segmentStartsWithLifecycleCommand(argv.slice(offset))) {
      return offset;
    }
  }
  return null;
}

function unwrapBlockedLifecycleDispatchWrapperArgv(
  wrapper: string,
  argv: readonly string[],
  allowGenericScan = true,
): readonly string[] | null {
  if (dispatchWrapperInvocationIsNonExecuting(wrapper, argv)) {
    return null;
  }
  if (wrapper === "setsid") {
    const commandOffset = skipLifecycleWrapperOptions(argv, {
      standaloneOptions: SETSID_STANDALONE_OPTIONS,
      nonExecOptions: SETSID_NON_EXEC_OPTIONS,
    });
    return commandOffset !== null && commandOffset < argv.length ? argv.slice(commandOffset) : null;
  }
  if (wrapper === "taskset") {
    const maskOffset = skipLifecycleWrapperOptions(argv, {
      standaloneOptions: TASKSET_STANDALONE_OPTIONS,
      nonExecOptions: TASKSET_NON_EXEC_OPTIONS,
    });
    return maskOffset !== null && maskOffset + 1 < argv.length ? argv.slice(maskOffset + 1) : null;
  }
  if (wrapper === "ionice") {
    const commandOffset = skipLifecycleWrapperOptions(argv, {
      standaloneOptions: IONICE_STANDALONE_OPTIONS,
      optionsWithValue: IONICE_OPTIONS_WITH_VALUE,
      nonExecOptions: IONICE_NON_EXEC_OPTIONS,
    });
    return commandOffset !== null && commandOffset < argv.length ? argv.slice(commandOffset) : null;
  }
  if (wrapper === "stdbuf") {
    const commandOffset = skipLifecycleWrapperOptions(argv, {
      optionsWithValue: STDBUF_OPTIONS_WITH_VALUE,
      nonExecOptions: STDBUF_NON_EXEC_OPTIONS,
    });
    return commandOffset !== null && commandOffset < argv.length ? argv.slice(commandOffset) : null;
  }
  if (wrapper === "time") {
    const commandOffset = skipLifecycleWrapperOptions(argv, {
      standaloneOptions: TIME_STANDALONE_OPTIONS,
      optionsWithValue: TIME_OPTIONS_WITH_VALUE,
      nonExecOptions: TIME_NON_EXEC_OPTIONS,
    });
    return commandOffset !== null && commandOffset < argv.length ? argv.slice(commandOffset) : null;
  }
  if (wrapper === "timeout") {
    const durationOffset = skipLifecycleWrapperOptions(argv, {
      standaloneOptions: TIMEOUT_STANDALONE_OPTIONS,
      optionsWithValue: TIMEOUT_OPTIONS_WITH_VALUE,
      nonExecOptions: TIMEOUT_NON_EXEC_OPTIONS,
    });
    return durationOffset !== null && durationOffset + 1 < argv.length
      ? argv.slice(durationOffset + 1)
      : null;
  }
  if (wrapper === "chrt") {
    const priorityOffset = skipLifecycleWrapperOptions(argv, {
      standaloneOptions: CHRT_STANDALONE_OPTIONS,
      optionsWithValue: CHRT_OPTIONS_WITH_VALUE,
      nonExecOptions: CHRT_NON_EXEC_OPTIONS,
    });
    if (priorityOffset === null || priorityOffset >= argv.length) {
      return null;
    }
    return isChrtPriorityToken(argv[priorityOffset]) && priorityOffset + 1 < argv.length
      ? argv.slice(priorityOffset + 1)
      : argv.slice(priorityOffset);
  }
  if (wrapper === "flock") {
    const shellPayload = extractFlockShellCommandPayload(argv);
    if (shellPayload !== null && commandTextMentionsOpenClawLifecycleMutation(shellPayload)) {
      return ["sh", "-c", shellPayload];
    }
  }
  const commandOffset = allowGenericScan ? findLifecycleCommandStartOffset(argv) : null;
  if (commandOffset !== null) {
    return argv.slice(commandOffset);
  }
  return null;
}

function unwrapFindExecLifecycleArgv(argv: readonly string[]): readonly string[] | null {
  for (let offset = 1; offset < argv.length; offset += 1) {
    const arg = normalizeLowercaseStringOrEmpty(argv[offset]);
    if (arg !== "-exec" && arg !== "-execdir") {
      continue;
    }
    const startOffset = offset + 1;
    let endOffset = startOffset;
    while (endOffset < argv.length && argv[endOffset] !== ";" && argv[endOffset] !== "+") {
      endOffset += 1;
    }
    const execArgv = argv.slice(startOffset, endOffset);
    if (execArgv.length > 0 && segmentStartsWithLifecycleCommand(execArgv)) {
      return execArgv;
    }
    offset = endOffset;
  }
  return null;
}

function unwrapExecCarrierArgv(argv: readonly string[]): readonly string[] | null {
  let offset = 1;
  while (offset < argv.length) {
    const arg = argv[offset];
    if (!arg) {
      offset += 1;
      continue;
    }
    if (arg === "--") {
      return argv.slice(offset + 1);
    }
    if (!arg.startsWith("-") || arg === "-") {
      return argv.slice(offset);
    }
    if (arg === "-a") {
      return offset + 2 <= argv.length ? argv.slice(offset + 2) : null;
    }
    if (arg.startsWith("-a") && arg.length > 2) {
      offset += 1;
      continue;
    }
    if (/^-[cl]+$/.test(arg)) {
      offset += 1;
      continue;
    }
    const commandOffset = findLifecycleCommandStartOffset(argv);
    return commandOffset === null ? null : argv.slice(commandOffset);
  }
  return null;
}

function unwrapLifecycleCarrierArgv(argv: readonly string[]): readonly string[] | null {
  const command = normalizeCommandName(argv[0]);
  if (command === "env") {
    return unwrapLifecycleEnvArgv(argv);
  }
  if (command === "find") {
    return unwrapFindExecLifecycleArgv(argv);
  }
  if (command === "sudo" || command === "doas") {
    return argv.slice(skipSudoCarrierArgs(argv));
  }
  if (command === "exec") {
    return unwrapExecCarrierArgv(argv);
  }
  if (command === "xargs") {
    return unwrapXargsCarrierArgv(argv);
  }
  const unwrap = unwrapKnownDispatchWrapperInvocation([...argv]);
  if (unwrap.kind === "unwrapped" && unwrap.argv.length > 0) {
    if (dispatchWrapperInvocationIsNonExecuting(unwrap.wrapper, argv)) {
      return null;
    }
    const lifecycleUnwrap = unwrapBlockedLifecycleDispatchWrapperArgv(unwrap.wrapper, argv, false);
    if (lifecycleUnwrap && lifecycleUnwrap.length > 0) {
      return lifecycleUnwrap;
    }
    return unwrap.argv;
  }
  if (unwrap.kind === "blocked") {
    return unwrapBlockedLifecycleDispatchWrapperArgv(unwrap.wrapper, argv);
  }
  if (!TRANSPARENT_LIFECYCLE_CARRIERS.has(command)) {
    return null;
  }
  let offset = 1;
  while (offset < argv.length && argv[offset]?.startsWith("-")) {
    offset += 1;
  }
  return argv.slice(offset);
}

function segmentIsOpenClawLifecycleMutation(argv: readonly string[], cwd?: string): boolean {
  let current: readonly string[] | null = argv;
  for (
    let depth = 0;
    current && current.length > 0 && depth < MAX_LIFECYCLE_CARRIER_UNWRAP_DEPTH;
    depth += 1
  ) {
    if (
      segmentIsOpenClawCliLifecycleMutation(current, cwd) ||
      segmentIsLaunchctlLifecycleMutation(current) ||
      segmentIsSystemctlLifecycleMutation(current) ||
      segmentIsSchtasksLifecycleMutation(current) ||
      segmentIsProcessLifecycleMutation(current)
    ) {
      return true;
    }
    if (segmentHasLifecycleStringPayload(current)) {
      return true;
    }
    current = unwrapLifecycleCarrierArgv(current);
  }
  return (
    current !== null &&
    current.length > 0 &&
    commandTextRegexMentionsOpenClawLifecycleMutation(current.join(" "))
  );
}

function commandTextRegexMentionsOpenClawLifecycleMutation(value: string): boolean {
  const normalized = value.toLowerCase();
  return (
    /\b(?:kill|pkill|killall|taskkill|stop-process)\b[\s\S]{0,200}\b(?:pidof|pgrep)?[\s\S]{0,120}\bopenclaw\b/.test(
      normalized,
    ) ||
    /\b(?:pidof|pgrep)\b[\s\S]{0,120}\bopenclaw\b[\s\S]{0,200}\|[\s\S]{0,200}\bxargs\b[\s\S]{0,120}\b(?:kill|pkill|killall|taskkill|stop-process)\b/.test(
      normalized,
    ) ||
    /\blaunchctl\b(?:[^\S\r\n]+-\S+)*[^\S\r\n]+(?:bootstrap|bootout|disable|enable|kickstart|kill|load|remove|stop|unload)\b[\s\S]{0,200}\bopenclaw\b/.test(
      normalized,
    ) ||
    /\bsystemctl\b[\s\S]{0,120}\b(?:disable|enable|kill|mask|reload-or-restart|restart|start|stop|try-reload-or-restart|try-restart|unmask)\b[\s\S]{0,200}\bopenclaw\b/.test(
      normalized,
    ) ||
    /\bschtasks(?:\.exe)?\b[\s\S]{0,160}\/(?:change|create|delete|end|run)\b[\s\S]{0,200}\bopenclaw\b/.test(
      normalized,
    ) ||
    /\b(?:pnpm(?:\.(?:bat|cmd|exe|ps1))?[^\S\r\n]+)?openclaw(?:\.(?:bat|cjs|cmd|exe|js|mjs|ps1))?\b[\s\S]{0,160}\b(?:gateway|daemon)\b[\s\S]{0,160}\b(?:install|kill|restart|run(?![^\S\r\n]+(?:-h|--help)\b)|start|stop|uninstall)\b/.test(
      normalized,
    ) ||
    /\b(?:pnpm(?:\.(?:bat|cmd|exe|ps1))?[^\S\r\n]+)?openclaw(?:\.(?:bat|cjs|cmd|exe|js|mjs|ps1))?\b[\s\S]{0,160}\bgateway\b(?:[^\S\r\n]+(?:(?:--(?:auth|bind|password|password-file|port|raw-stream-path|tailscale|token|token-file|ws-log)(?:=(?!\s)[^\s;&|]+|[^\S\r\n]+[^\s;&|]+)?)|--(?:allow-unconfigured|claude-cli-logs|cli-backend-logs|compact|dev|force|raw-stream|reset|tailscale-reset-on-exit|verbose))){0,12}(?:[^\S\r\n]*(?:$|[;&|]))/.test(
      normalized,
    )
  );
}

function commandTextMentionsOpenClawProcessKillPipeline(value: string): boolean {
  const normalized = value.toLowerCase();
  return /\b(?:pidof|pgrep)\b[\s\S]{0,120}\bopenclaw\b[\s\S]{0,200}\|[\s\S]{0,200}\bxargs\b[\s\S]{0,120}\b(?:kill|pkill|killall|taskkill|stop-process)\b/.test(
    normalized,
  );
}

function commandTextMentionsOpenClawLifecycleMutation(value: string): boolean {
  const parsedArgv = splitShellArgs(value);
  if (parsedArgv && parsedArgv.length > 1 && segmentIsOpenClawLifecycleMutation(parsedArgv)) {
    return true;
  }
  if (shellTextSegmentsMentionOpenClawLifecycleMutation(value)) {
    return true;
  }
  return commandTextRegexMentionsOpenClawLifecycleMutation(value);
}

function shellTextSegmentsMentionOpenClawLifecycleMutation(value: string): boolean {
  for (const shellSegment of value.split(/(?:\r?\n|&&|\|\||[;&|])/)) {
    const segmentText = shellSegment.trim();
    if (!segmentText) {
      continue;
    }
    const parsedArgv = splitShellArgs(segmentText);
    if (parsedArgv && parsedArgv.length > 1 && segmentIsOpenClawLifecycleMutation(parsedArgv)) {
      return true;
    }
  }
  return false;
}

export function commandRequiresOpenClawLifecycleApproval(params: {
  command: string;
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  envComplete?: boolean;
  segments: Array<{ argv: string[]; raw?: string; sourceArgv?: string[] }>;
}): boolean {
  let sawLifecycleMention = false;
  const envComplete = params.envComplete ?? params.env !== undefined;
  let visibleEnv = params.env;
  if (commandTextMentionsOpenClawProcessKillPipeline(params.command)) {
    return true;
  }
  for (const segment of params.segments) {
    const lifecycleArgv = segment.sourceArgv?.length ? segment.sourceArgv : segment.argv;
    const segmentEnv = collectShellPrefixAssignmentsFromRaw(segment.raw, visibleEnv);
    const nextVisibleEnv = collectStandaloneShellAssignmentsFromArgv(lifecycleArgv, visibleEnv);
    if (
      argvMayExpandWithShellVariablesToLifecycle(lifecycleArgv, segmentEnv, envComplete, params.cwd)
    ) {
      return true;
    }
    if (argvHasPotentialEnvSplitLifecycleExpansion(lifecycleArgv, segmentEnv, 0, envComplete)) {
      return true;
    }
    if (segmentIsOpenClawLifecycleMutation(lifecycleArgv, params.cwd)) {
      return true;
    }
    const segmentText = `${segment.raw ?? ""} ${lifecycleArgv.join(" ")}`;
    if (!commandTextMentionsOpenClawLifecycleMutation(segmentText)) {
      visibleEnv = nextVisibleEnv;
      continue;
    }
    sawLifecycleMention = true;
    visibleEnv = nextVisibleEnv;
  }
  if (sawLifecycleMention) {
    return false;
  }
  return commandTextMentionsOpenClawLifecycleMutation(params.command);
}

function removeParsedSegmentText(
  command: string,
  segments: Array<{ argv?: string[]; raw?: string }>,
): string {
  let remaining = command;
  for (const segment of segments) {
    const raw = (segment.raw ?? segment.argv?.join(" "))?.trim();
    if (!raw) {
      continue;
    }
    remaining = remaining.replace(raw, " ");
  }
  return remaining;
}

export function commandRequiresSecurityAuditSuppressionApproval(params: {
  command: string;
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  segments: Array<{ argv: string[]; raw?: string }>;
}): boolean {
  let sawSegmentMention = false;
  for (const segment of params.segments) {
    const segmentText = `${segment.raw ?? ""} ${segment.argv.join(" ")}`;
    if (!textMentionsSecurityAuditSuppressions(segmentText)) {
      continue;
    }
    sawSegmentMention = true;
    if (!isReadOnlySecurityAuditSuppressionInspection(segment.argv)) {
      return true;
    }
  }
  if (sawSegmentMention) {
    const unparsedText = removeParsedSegmentText(params.command, params.segments);
    if (textMentionsSecurityAuditSuppressions(unparsedText)) {
      return true;
    }
    return false;
  }
  return textMentionsSecurityAuditSuppressions(params.command);
}

export function hasDurableExecApproval(params: {
  analysisOk: boolean;
  segmentAllowlistEntries: Array<ExecAllowlistEntry | null>;
  allowlist?: readonly ExecAllowlistEntry[];
  commandText?: string | null;
}): boolean {
  return (
    hasExactCommandDurableExecApproval({
      allowlist: params.allowlist,
      commandText: params.commandText,
    }) ||
    hasSegmentDurableExecApproval({
      analysisOk: params.analysisOk,
      segmentAllowlistEntries: params.segmentAllowlistEntries,
    })
  );
}

// Digest input is the trimmed command text only. Shipped approvals files
// already hold `=command:` entries in this format; changing the input
// silently orphans every persisted exact-command grant.
function buildDurableCommandApprovalPattern(commandText: string): string {
  return `=command:${sha256HexPrefix(commandText, 16)}`;
}

function buildNodeCommandApprovalPattern(commandText: string): string {
  return `=node-command:${sha256HexPrefix(commandText, 16)}`;
}

export function hasNodeCommandAllowAlwaysMarker(params: {
  allowlist?: readonly ExecAllowlistEntry[];
  commandText?: string | null;
}): boolean {
  const normalizedCommand = params.commandText?.trim();
  if (!normalizedCommand) {
    return false;
  }
  const commandPattern = buildNodeCommandApprovalPattern(normalizedCommand);
  return (params.allowlist ?? []).some(
    (entry) => entry.source === "allow-always" && entry.pattern === commandPattern,
  );
}

export function hasExactCommandDurableExecApproval(params: {
  allowlist?: readonly ExecAllowlistEntry[];
  commandText?: string | null;
}): boolean {
  const normalizedCommand = params.commandText?.trim();
  if (!normalizedCommand) {
    return false;
  }
  const commandPattern = buildDurableCommandApprovalPattern(normalizedCommand);
  return (params.allowlist ?? []).some(
    (entry) =>
      entry.source === "allow-always" &&
      (entry.pattern === commandPattern ||
        (typeof entry.commandText === "string" && entry.commandText.trim() === normalizedCommand)),
  );
}

function hasSegmentDurableExecApproval(params: {
  analysisOk: boolean;
  segmentAllowlistEntries: Array<ExecAllowlistEntry | null>;
}): boolean {
  return (
    params.analysisOk &&
    params.segmentAllowlistEntries.length > 0 &&
    params.segmentAllowlistEntries.every((entry) => entry?.source === "allow-always")
  );
}

export function recordAllowlistUse(
  approvals: ExecApprovalsFile,
  agentId: string | undefined,
  entry: ExecAllowlistEntry,
  command: string,
  resolvedPath?: string,
) {
  const target = agentId ?? DEFAULT_AGENT_ID;
  const agents = approvals.agents ?? {};
  const existing = agents[target] ?? {};
  const allowlist = Array.isArray(existing.allowlist) ? existing.allowlist : [];
  const nextAllowlist = allowlist.map((item) =>
    item.pattern === entry.pattern &&
    (item.argPattern ?? undefined) === (entry.argPattern ?? undefined)
      ? Object.assign({}, item, {
          id: item.id ?? crypto.randomUUID(),
          lastUsedAt: Date.now(),
          lastUsedCommand: command,
          lastResolvedPath: resolvedPath,
        })
      : item,
  );
  agents[target] = { ...existing, allowlist: nextAllowlist };
  approvals.agents = agents;
  saveExecApprovals(approvals);
}

function buildAllowlistEntryMatchKey(
  entry: Pick<ExecAllowlistEntry, "pattern" | "argPattern">,
): string {
  return `${entry.pattern}\x00${entry.argPattern?.trim() ?? ""}`;
}

export function recordAllowlistMatchesUse(params: {
  approvals: ExecApprovalsFile;
  agentId: string | undefined;
  matches: readonly ExecAllowlistEntry[];
  command: string;
  resolvedPath?: string;
}): void {
  if (params.matches.length === 0) {
    return;
  }
  const seen = new Set<string>();
  for (const match of params.matches) {
    if (!match.pattern) {
      continue;
    }
    const key = buildAllowlistEntryMatchKey(match);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    recordAllowlistUse(
      params.approvals,
      params.agentId,
      match,
      params.command,
      params.resolvedPath,
    );
  }
}

export function addAllowlistEntry(
  approvals: ExecApprovalsFile,
  agentId: string | undefined,
  pattern: string,
  options?: {
    argPattern?: string;
    source?: ExecAllowlistEntry["source"];
  },
) {
  const target = agentId ?? DEFAULT_AGENT_ID;
  const agents = approvals.agents ?? {};
  const existing = agents[target] ?? {};
  const allowlist = Array.isArray(existing.allowlist) ? existing.allowlist : [];
  const trimmed = pattern.trim();
  if (!trimmed) {
    return;
  }
  const trimmedArgPattern = normalizeOptionalString(options?.argPattern);
  const existingEntry = allowlist.find(
    (entry) => entry.pattern === trimmed && (entry.argPattern ?? undefined) === trimmedArgPattern,
  );
  if (existingEntry && (!options?.source || existingEntry.source === options.source)) {
    return;
  }
  const now = Date.now();
  const nextAllowlist = existingEntry
    ? allowlist.map((entry) =>
        entry.pattern === trimmed && (entry.argPattern ?? undefined) === trimmedArgPattern
          ? {
              ...entry,
              argPattern: trimmedArgPattern,
              source: options?.source ?? entry.source,
              lastUsedAt: now,
            }
          : entry,
      )
    : [
        ...allowlist,
        {
          id: crypto.randomUUID(),
          pattern: trimmed,
          argPattern: trimmedArgPattern,
          source: options?.source,
          lastUsedAt: now,
        },
      ];
  agents[target] = { ...existing, allowlist: nextAllowlist };
  approvals.agents = agents;
  saveExecApprovals(approvals);
}

export function addDurableCommandApproval(
  approvals: ExecApprovalsFile,
  agentId: string | undefined,
  commandText: string,
) {
  const normalized = commandText.trim();
  if (!normalized) {
    return;
  }
  addAllowlistEntry(approvals, agentId, buildDurableCommandApprovalPattern(normalized), {
    source: "allow-always",
  });
}

export function resolveAllowAlwaysPatternCoverage(params: {
  segments: ExecCommandSegment[];
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  platform?: string | null;
  strictInlineEval?: boolean;
}): {
  complete: boolean;
  patterns: ReturnType<typeof resolveAllowAlwaysPatternEntries>;
} {
  const byKey = new Map<string, ReturnType<typeof resolveAllowAlwaysPatternEntries>[number]>();
  let representedSegmentCount = 0;
  for (const segment of params.segments) {
    if (isShellWrapperInvocation(segment.argv)) {
      const segmentPatterns = resolveAllowAlwaysPatternEntries({
        segments: [segment],
        cwd: params.cwd,
        env: params.env,
        platform: params.platform,
        strictInlineEval: params.strictInlineEval,
      });
      for (const pattern of segmentPatterns) {
        byKey.set(`${pattern.pattern}\x00${pattern.argPattern ?? ""}`, pattern);
      }
      continue;
    }
    const segmentPatterns = resolveAllowAlwaysPatternEntries({
      segments: [segment],
      cwd: params.cwd,
      env: params.env,
      platform: params.platform,
      strictInlineEval: params.strictInlineEval,
    });
    if (segmentPatterns.length === 0) {
      continue;
    }
    representedSegmentCount += 1;
    for (const pattern of segmentPatterns) {
      byKey.set(`${pattern.pattern}\x00${pattern.argPattern ?? ""}`, pattern);
    }
  }
  return {
    complete: params.segments.length > 0 && representedSegmentCount === params.segments.length,
    patterns: [...byKey.values()],
  };
}

export function persistAllowAlwaysPatterns(params: {
  approvals: ExecApprovalsFile;
  agentId: string | undefined;
  segments: ExecCommandSegment[];
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  platform?: string | null;
  commandText?: string;
  strictInlineEval?: boolean;
}): ReturnType<typeof resolveAllowAlwaysPatternEntries> {
  const coverage = resolveAllowAlwaysPatternCoverage({
    segments: params.segments,
    cwd: params.cwd,
    env: params.env,
    platform: params.platform,
    strictInlineEval: params.strictInlineEval,
  });
  const patterns = coverage.patterns;
  for (const pattern of patterns) {
    if (!pattern.pattern) {
      continue;
    }
    addAllowlistEntry(params.approvals, params.agentId, pattern.pattern, {
      argPattern: pattern.argPattern,
      source: "allow-always",
    });
  }
  const normalizedCommand = params.commandText?.trim();
  if (normalizedCommand && coverage.complete && patterns.length > 0) {
    addAllowlistEntry(
      params.approvals,
      params.agentId,
      buildNodeCommandApprovalPattern(normalizedCommand),
      {
        source: "allow-always",
      },
    );
  }
  return patterns;
}

export type AllowAlwaysPersistenceReason =
  | "no-reusable-pattern"
  | "prompt-only"
  | "runtime-payload"
  | "unplanned";

export type AllowAlwaysPersistenceDecision =
  | { kind: "patterns"; patterns: readonly AllowAlwaysPattern[]; commandText?: string }
  | { kind: "exact-command"; commandText: string }
  | { kind: "one-shot"; reasons: AllowAlwaysPersistenceReason[] };

function hasRuntimeShellPayload(argv: readonly string[]): boolean {
  const inlineCommand = extractBindableShellWrapperInlineCommand([...argv]);
  return Boolean(
    inlineCommand &&
    (/(?:\$[A-Za-z0-9_@*?#$!-]|\$\{|`|\$\()/u.test(inlineCommand) ||
      hasPosixInteractiveStartupBeforeInlineCommand(argv, POSIX_INLINE_COMMAND_FLAGS) ||
      hasPosixLoginStartupBeforeInlineCommand(argv, POSIX_INLINE_COMMAND_FLAGS)),
  );
}

function resolvePlanPersistenceState(plan: ExecAuthorizationPlan | undefined): {
  reusablePatternsAllowed: boolean;
  reasons: AllowAlwaysPersistenceReason[];
} {
  if (!plan) {
    return { reusablePatternsAllowed: true, reasons: [] };
  }
  if (!plan.ok) {
    return { reusablePatternsAllowed: false, reasons: ["unplanned"] };
  }
  const reasons = new Set<AllowAlwaysPersistenceReason>();
  let reusablePatternsAllowed = true;
  const candidates = plan.groups.flatMap((group) => group.candidates);
  for (const candidate of candidates) {
    if (candidate.trustMode === "prompt-only") {
      reasons.add("prompt-only");
    }
    if (candidate.trustMode === "exact-command") {
      // Durable `=command:` entries are command-text-only and cannot bind
      // cwd, env, or PATH, so planner exact-command candidates stay one-shot.
      reasons.add("no-reusable-pattern");
    }
    if (candidate.trustMode === "executable" && !candidate.allowAlways) {
      reasons.add("no-reusable-pattern");
    }
    reusablePatternsAllowed = reusablePatternsAllowed && candidate.allowAlways;
    if (hasRuntimeShellPayload(candidate.sourceSegment.argv)) {
      reasons.add("runtime-payload");
    }
    if (
      candidate.transport.kind === "shell-wrapper" &&
      hasRuntimeShellPayload(candidate.transport.wrapperArgv)
    ) {
      reasons.add("runtime-payload");
    }
  }
  return {
    reusablePatternsAllowed,
    reasons: [...reasons],
  };
}

export function resolveAllowAlwaysPersistenceDecision(params: {
  segments: ExecCommandSegment[];
  commandText?: string | null;
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  platform?: string | null;
  strictInlineEval?: boolean;
  authorizationPlan?: ExecAuthorizationPlan;
  runtimePayload?: boolean;
  preparedCoverage?: ReturnType<typeof resolveAllowAlwaysPatternCoverage> | null;
}): AllowAlwaysPersistenceDecision {
  const planPersistence = resolvePlanPersistenceState(params.authorizationPlan);
  const reasons = new Set<AllowAlwaysPersistenceReason>(planPersistence.reasons);
  if (params.runtimePayload === true) {
    reasons.add("runtime-payload");
  }
  const commandText = params.commandText?.trim();
  const hardReasons = [...reasons].filter((reason) => reason !== "no-reusable-pattern");
  if (hardReasons.length > 0) {
    return { kind: "one-shot", reasons: hardReasons };
  }

  if (params.preparedCoverage?.complete === true && params.preparedCoverage.patterns.length > 0) {
    return {
      kind: "patterns",
      patterns: params.preparedCoverage.patterns,
      ...(commandText ? { commandText } : {}),
    };
  }

  if (planPersistence.reusablePatternsAllowed) {
    const coverage = resolveAllowAlwaysPatternCoverage({
      segments: params.segments,
      cwd: params.cwd,
      env: params.env,
      platform: params.platform,
      strictInlineEval: params.strictInlineEval,
    });
    if (coverage.patterns.length > 0) {
      return {
        kind: "patterns",
        patterns: coverage.patterns,
        ...(commandText && coverage.complete ? { commandText } : {}),
      };
    }
  }

  reasons.add("no-reusable-pattern");
  return { kind: "one-shot", reasons: [...reasons] };
}

export function persistAllowAlwaysDecision(params: {
  approvals: ExecApprovalsFile;
  agentId: string | undefined;
  decision: AllowAlwaysPersistenceDecision;
}): void {
  if (params.decision.kind === "one-shot") {
    return;
  }
  if (params.decision.kind === "exact-command") {
    addDurableCommandApproval(params.approvals, params.agentId, params.decision.commandText);
    return;
  }
  for (const pattern of params.decision.patterns) {
    if (!pattern.pattern) {
      continue;
    }
    addAllowlistEntry(params.approvals, params.agentId, pattern.pattern, {
      argPattern: pattern.argPattern,
      source: "allow-always",
    });
  }
  const normalizedCommand = params.decision.commandText?.trim();
  if (normalizedCommand) {
    addAllowlistEntry(
      params.approvals,
      params.agentId,
      buildNodeCommandApprovalPattern(normalizedCommand),
      {
        source: "allow-always",
      },
    );
  }
}

export function minSecurity(a: ExecSecurity, b: ExecSecurity): ExecSecurity {
  const order: Record<ExecSecurity, number> = { deny: 0, allowlist: 1, full: 2 };
  return order[a] <= order[b] ? a : b;
}

export function maxAsk(a: ExecAsk, b: ExecAsk): ExecAsk {
  const order: Record<ExecAsk, number> = { off: 0, "on-miss": 1, always: 2 };
  return order[a] >= order[b] ? a : b;
}

export type ExecApprovalDecision = "allow-once" | "allow-always" | "deny";
export const DEFAULT_EXEC_APPROVAL_DECISIONS = [
  "allow-once",
  "allow-always",
  "deny",
] as const satisfies readonly ExecApprovalDecision[];
export const OPTIONAL_EXEC_APPROVAL_DECISIONS = [
  "allow-always",
] as const satisfies readonly ExecApprovalDecision[];
export type ExecApprovalUnavailableDecision = (typeof OPTIONAL_EXEC_APPROVAL_DECISIONS)[number];

const OPTIONAL_EXEC_APPROVAL_DECISION_SET: ReadonlySet<string> = new Set(
  OPTIONAL_EXEC_APPROVAL_DECISIONS,
);

function isOptionalExecApprovalDecision(
  decision: string,
): decision is ExecApprovalUnavailableDecision {
  return OPTIONAL_EXEC_APPROVAL_DECISION_SET.has(decision);
}

function collectExecApprovalUnavailableDecisionSet(
  decisions?: readonly string[] | readonly ExecApprovalUnavailableDecision[] | null,
): ReadonlySet<ExecApprovalUnavailableDecision> {
  const unavailable = new Set<ExecApprovalUnavailableDecision>();
  if (!Array.isArray(decisions)) {
    return unavailable;
  }
  for (const decision of decisions) {
    if (isOptionalExecApprovalDecision(decision)) {
      unavailable.add(decision);
    }
  }
  return unavailable;
}

export function normalizeExecApprovalUnavailableDecisions(
  decisions?: readonly string[] | readonly ExecApprovalUnavailableDecision[] | null,
): readonly ExecApprovalUnavailableDecision[] {
  const unavailable = collectExecApprovalUnavailableDecisionSet(decisions);
  return OPTIONAL_EXEC_APPROVAL_DECISIONS.filter((decision) => unavailable.has(decision));
}

export function resolveExecApprovalAllowedDecisions(params?: {
  ask?: string | null;
  allowAlwaysPersistence?: AllowAlwaysPersistenceDecision | null;
}): readonly ExecApprovalDecision[] {
  const ask = normalizeExecAsk(params?.ask);
  if (ask === "always" || params?.allowAlwaysPersistence?.kind === "one-shot") {
    return ["allow-once", "deny"];
  }
  return DEFAULT_EXEC_APPROVAL_DECISIONS;
}

export function resolveExecApprovalUnavailableDecisions(params?: {
  ask?: string | null;
  allowAlwaysPersistence?: AllowAlwaysPersistenceDecision | null;
}): readonly ExecApprovalUnavailableDecision[] {
  const allowed = new Set(resolveExecApprovalAllowedDecisions(params));
  return OPTIONAL_EXEC_APPROVAL_DECISIONS.filter((decision) => !allowed.has(decision));
}

export function resolveExecApprovalRequestAllowedDecisions(params?: {
  ask?: string | null;
  unavailableDecisions?: readonly ExecApprovalUnavailableDecision[] | readonly string[] | null;
}): readonly ExecApprovalDecision[] {
  const policyDecisions = resolveExecApprovalAllowedDecisions({ ask: params?.ask });
  const unavailableDecisions = collectExecApprovalUnavailableDecisionSet(
    params?.unavailableDecisions,
  );
  if (unavailableDecisions.size === 0) {
    return policyDecisions;
  }
  return policyDecisions.filter(
    (decision) => !isOptionalExecApprovalDecision(decision) || !unavailableDecisions.has(decision),
  );
}

export function isExecApprovalDecisionAllowed(params: {
  decision: ExecApprovalDecision;
  ask?: string | null;
}): boolean {
  return resolveExecApprovalAllowedDecisions({ ask: params.ask }).includes(params.decision);
}

export async function requestExecApprovalViaSocket(params: {
  socketPath: string;
  token: string;
  request: Record<string, unknown>;
  timeoutMs?: number;
}): Promise<ExecApprovalDecision | null> {
  const { socketPath, token, request } = params;
  if (!socketPath || !token) {
    return null;
  }
  const timeoutMs = params.timeoutMs ?? 15_000;
  const payload = JSON.stringify({
    type: "request",
    token,
    id: crypto.randomUUID(),
    request,
  });

  return await requestJsonlSocket({
    socketPath,
    requestLine: payload,
    timeoutMs,
    accept: (value) => {
      const msg = value as { type?: string; decision?: ExecApprovalDecision };
      if (msg?.type === "decision" && msg.decision) {
        return msg.decision;
      }
      return undefined;
    },
  });
}
