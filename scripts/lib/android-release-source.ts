import { execFileSync } from "node:child_process";
import { realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const FULL_GIT_COMMIT_RE = /^[a-f0-9]{40}$/u;

function normalizeFullGitCommit(raw: string): string {
  const commit = raw.trim().toLowerCase();
  if (!FULL_GIT_COMMIT_RE.test(commit)) {
    throw new Error("Android release commit must be a full 40-character hexadecimal SHA");
  }
  return commit;
}

export function verifyAndroidReleaseSource(
  expectedCommit: string,
  options: {
    rootDir?: string;
    runGit?: (args: string[], cwd: string) => string;
  } = {},
): void {
  const expected = normalizeFullGitCommit(expectedCommit);
  const rootDir = path.resolve(options.rootDir ?? ".");
  const runGit =
    options.runGit ??
    ((args: string[], cwd: string) =>
      execFileSync("git", args, {
        cwd,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      }));

  let head: string;
  let status: string;
  try {
    head = normalizeFullGitCommit(runGit(["rev-parse", "--verify", "HEAD"], rootDir));
    status = runGit(["status", "--porcelain=v1", "--untracked-files=all"], rootDir).trim();
  } catch {
    throw new Error("Android release builds require a readable Git checkout");
  }
  if (head !== expected) {
    throw new Error(`Android release commit mismatch: metadata ${expected}, checkout ${head}`);
  }
  if (status) {
    throw new Error("Android release builds require a clean Git checkout");
  }
}

function usage(): string {
  return [
    "Usage:",
    "  node --import tsx scripts/lib/android-release-source.ts --root <repository> --expected-commit <full-sha>",
  ].join("\n");
}

function readOptionValue(argv: string[], index: number, flag: string): string {
  const value = argv[index + 1];
  if (!value || value.startsWith("-")) {
    throw new Error(`Missing value for ${flag}.`);
  }
  return value;
}

function parseArgs(argv: string[]): { expectedCommit: string; rootDir: string } {
  let expectedCommit = "";
  let rootDir = "";
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    switch (arg) {
      case "--expected-commit":
        expectedCommit = readOptionValue(argv, index, arg);
        index += 1;
        break;
      case "--root":
        rootDir = readOptionValue(argv, index, arg);
        index += 1;
        break;
      case "-h":
      case "--help":
        throw new Error(usage());
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }
  if (!rootDir) {
    throw new Error("Missing required --root.");
  }
  if (!expectedCommit) {
    throw new Error("Missing required --expected-commit.");
  }
  return { expectedCommit, rootDir };
}

function main(argv: string[]): number {
  try {
    const options = parseArgs(argv);
    verifyAndroidReleaseSource(options.expectedCommit, { rootDir: options.rootDir });
    process.stdout.write(
      `Verified Android release source: commit=${options.expectedCommit.toLowerCase()} clean=true\n`,
    );
    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.startsWith("Usage:")) {
      process.stdout.write(`${message}\n`);
      return 0;
    }
    process.stderr.write(`${message}\n`);
    return 1;
  }
}

const invokedPath = process.argv[1];
if (invokedPath && realpathSync(fileURLToPath(import.meta.url)) === realpathSync(invokedPath)) {
  const exitCode = main(process.argv.slice(2));
  if (exitCode !== 0) {
    process.exit(exitCode);
  }
}
