import { createHash } from "node:crypto";
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

export type AndroidReleaseArtifactFlavor = "play" | "third-party" | "wear";

export type AndroidReleaseArtifactRecord = {
  file: string;
  flavor: AndroidReleaseArtifactFlavor;
  sha256: string;
};

type AndroidReleaseArtifactManifest = {
  artifacts: Partial<Record<AndroidReleaseArtifactFlavor, { file: string; sha256: string }>>;
  buildTimestamp: string;
  gitCommit: string;
  phoneVersionCode: number;
  schemaVersion: 1;
  versionName: string;
  wearVersionCode: number;
};

const FULL_GIT_SHA_RE = /^[0-9a-f]{40}$/iu;
const SHA256_RE = /^[0-9a-f]{64}$/iu;
const ALLOWED_FLAVORS = new Set<AndroidReleaseArtifactFlavor>(["play", "third-party", "wear"]);
const MANIFEST_FILENAME = "release-manifest.json";

function sha256(filePath: string): string {
  return createHash("sha256").update(readFileSync(filePath)).digest("hex");
}

function releaseOutputDirectory(rootDir: string): string {
  return path.join(rootDir, "apps", "android", "build", "release-artifacts");
}

export function androidReleaseArtifactManifestPath(rootDir: string): string {
  return path.join(releaseOutputDirectory(path.resolve(rootDir)), MANIFEST_FILENAME);
}

function requireFullGitSha(value: unknown): string {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (!FULL_GIT_SHA_RE.test(normalized)) {
    throw new Error("Android release artifact manifest requires a full 40-character Git SHA.");
  }
  return normalized;
}

function requirePositiveVersionCode(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`Android release artifact manifest has an invalid ${label}.`);
  }
  return value;
}

function requireSha256(value: string, label: string): string {
  const normalized = value.trim().toLowerCase();
  if (!SHA256_RE.test(normalized)) {
    throw new Error(`Android release artifact manifest has an invalid SHA-256 for ${label}.`);
  }
  return normalized;
}

export function writeAndroidReleaseArtifactManifest(options: {
  artifacts: AndroidReleaseArtifactRecord[];
  buildTimestamp: string;
  gitCommit: string;
  phoneVersionCode: number;
  rootDir: string;
  versionName: string;
  wearVersionCode: number;
}): string {
  const artifacts: AndroidReleaseArtifactManifest["artifacts"] = {};
  const orderedArtifacts = options.artifacts.toSorted((left, right) =>
    left.flavor < right.flavor ? -1 : left.flavor > right.flavor ? 1 : 0,
  );
  for (const artifact of orderedArtifacts) {
    if (artifacts[artifact.flavor]) {
      throw new Error(`Duplicate Android release artifact flavor: ${artifact.flavor}.`);
    }
    if (path.basename(artifact.file) !== artifact.file) {
      throw new Error(
        `Android release artifact manifest accepts basenames only: ${artifact.file}.`,
      );
    }
    artifacts[artifact.flavor] = {
      file: artifact.file,
      sha256: requireSha256(artifact.sha256, artifact.flavor),
    };
  }

  const manifest: AndroidReleaseArtifactManifest = {
    schemaVersion: 1,
    versionName: options.versionName,
    phoneVersionCode: requirePositiveVersionCode(options.phoneVersionCode, "phone versionCode"),
    wearVersionCode: requirePositiveVersionCode(options.wearVersionCode, "Wear versionCode"),
    gitCommit: requireFullGitSha(options.gitCommit),
    buildTimestamp: options.buildTimestamp,
    artifacts,
  };
  const manifestPath = androidReleaseArtifactManifestPath(options.rootDir);
  const temporaryPath = `${manifestPath}.tmp`;
  writeFileSync(temporaryPath, `${JSON.stringify(manifest, null, 2)}\n`);
  renameSync(temporaryPath, manifestPath);
  return manifestPath;
}

function readManifest(rootDir: string): AndroidReleaseArtifactManifest {
  const manifestPath = androidReleaseArtifactManifestPath(rootDir);
  if (!existsSync(manifestPath)) {
    throw new Error(`Missing Android release artifact manifest at ${manifestPath}.`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(manifestPath, "utf8"));
  } catch {
    throw new Error(`Invalid Android release artifact manifest at ${manifestPath}.`);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`Invalid Android release artifact manifest at ${manifestPath}.`);
  }
  return parsed as AndroidReleaseArtifactManifest;
}

function validateManifestShape(manifest: AndroidReleaseArtifactManifest): void {
  if (manifest.schemaVersion !== 1) {
    throw new Error("Android release artifact manifest has an unsupported schema version.");
  }
  requireFullGitSha(manifest.gitCommit);
  requirePositiveVersionCode(manifest.phoneVersionCode, "phone versionCode");
  requirePositiveVersionCode(manifest.wearVersionCode, "Wear versionCode");
  if (typeof manifest.versionName !== "string" || !manifest.versionName.trim()) {
    throw new Error("Android release artifact manifest has an invalid versionName.");
  }
  if (typeof manifest.buildTimestamp !== "string" || !manifest.buildTimestamp.trim()) {
    throw new Error("Android release artifact manifest has an invalid build timestamp.");
  }
  if (
    !manifest.artifacts ||
    typeof manifest.artifacts !== "object" ||
    Array.isArray(manifest.artifacts)
  ) {
    throw new Error("Android release artifact manifest has an invalid artifacts map.");
  }
  for (const [flavor, artifact] of Object.entries(manifest.artifacts).toSorted(([left], [right]) =>
    left < right ? -1 : left > right ? 1 : 0,
  )) {
    if (!ALLOWED_FLAVORS.has(flavor as AndroidReleaseArtifactFlavor)) {
      throw new Error(`Android release artifact manifest has an unknown flavor: ${flavor}.`);
    }
    if (
      !artifact ||
      typeof artifact.file !== "string" ||
      path.basename(artifact.file) !== artifact.file
    ) {
      throw new Error(`Android release artifact manifest has an invalid filename for ${flavor}.`);
    }
    if (typeof artifact.sha256 !== "string") {
      throw new Error(`Android release artifact manifest has an invalid SHA-256 for ${flavor}.`);
    }
    requireSha256(artifact.sha256, flavor);
  }
}

export function validateAndroidReleaseArtifactManifest(options: {
  expectedGitSha: string;
  phoneVersionCode: number;
  rootDir: string;
  versionName: string;
}): AndroidReleaseArtifactManifest {
  const rootDir = path.resolve(options.rootDir);
  const expectedGitSha = requireFullGitSha(options.expectedGitSha);
  requirePositiveVersionCode(options.phoneVersionCode, "expected phone versionCode");
  if (!options.versionName.trim()) {
    throw new Error("Android release artifact validation requires a version.");
  }
  const manifest = readManifest(rootDir);
  validateManifestShape(manifest);
  if (manifest.gitCommit.toLowerCase() !== expectedGitSha) {
    throw new Error(
      `Android release artifacts were built for Git SHA ${manifest.gitCommit}, expected ${expectedGitSha}.`,
    );
  }
  if (manifest.versionName !== options.versionName) {
    throw new Error(
      `Android release artifacts were built for version ${manifest.versionName}, expected ${options.versionName}.`,
    );
  }
  if (manifest.phoneVersionCode !== options.phoneVersionCode) {
    throw new Error(
      `Android release artifacts use phone versionCode ${manifest.phoneVersionCode}, expected ${options.phoneVersionCode}.`,
    );
  }
  const expectedWearVersionCode = options.phoneVersionCode + 50;
  if (manifest.wearVersionCode !== expectedWearVersionCode) {
    throw new Error(
      `Android release artifacts use Wear versionCode ${manifest.wearVersionCode}, expected ${expectedWearVersionCode}.`,
    );
  }

  const outputDirectory = releaseOutputDirectory(rootDir);
  const expectedFiles: Record<"play" | "wear", string> = {
    play: `openclaw-${options.versionName}-play-release.aab`,
    wear: `openclaw-${options.versionName}-wear-release.aab`,
  };
  for (const flavor of ["play", "wear"] as const) {
    const artifact = manifest.artifacts[flavor];
    if (!artifact) {
      throw new Error(`Android release artifact manifest is missing ${flavor}.`);
    }
    if (artifact.file !== expectedFiles[flavor]) {
      throw new Error(`Android release artifact manifest has the wrong filename for ${flavor}.`);
    }
    const artifactPath = path.join(outputDirectory, artifact.file);
    if (!existsSync(artifactPath)) {
      throw new Error(`Missing Android release artifact at ${artifactPath}.`);
    }
    if (sha256(artifactPath) !== artifact.sha256.toLowerCase()) {
      throw new Error(
        `Android release artifact ${artifact.file} does not match its build manifest.`,
      );
    }
  }
  return manifest;
}

function usage(): string {
  return [
    "Usage:",
    "  node --import tsx scripts/android-release-artifact-manifest.ts validate --root <repository> --expected-git-sha <full-sha> --version <version> --phone-version-code <integer>",
  ].join("\n");
}

function readOptionValue(argv: string[], index: number, flag: string): string {
  const value = argv[index + 1];
  if (!value || value.startsWith("-")) {
    throw new Error(`Missing value for ${flag}.`);
  }
  return value;
}

function parseArgs(argv: string[]): {
  expectedGitSha: string;
  phoneVersionCode: number;
  rootDir: string;
  versionName: string;
} {
  if (argv[0] === "-h" || argv[0] === "--help") {
    throw new Error(usage());
  }
  if (argv[0] !== "validate") {
    throw new Error("Expected Android release artifact manifest command: validate.");
  }
  let expectedGitSha = "";
  let phoneVersionCode = Number.NaN;
  let rootDir = path.resolve(".");
  let versionName = "";
  for (let index = 1; index < argv.length; index += 1) {
    const arg = argv[index];
    switch (arg) {
      case "--expected-git-sha":
        expectedGitSha = readOptionValue(argv, index, arg);
        index += 1;
        break;
      case "--phone-version-code":
        phoneVersionCode = Number(readOptionValue(argv, index, arg));
        index += 1;
        break;
      case "--root":
        rootDir = path.resolve(readOptionValue(argv, index, arg));
        index += 1;
        break;
      case "--version":
        versionName = readOptionValue(argv, index, arg);
        index += 1;
        break;
      case "-h":
      case "--help":
        throw new Error(usage());
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return { expectedGitSha, phoneVersionCode, rootDir, versionName };
}

async function main(argv: string[]): Promise<number> {
  try {
    const options = parseArgs(argv);
    validateAndroidReleaseArtifactManifest(options);
    process.stdout.write(
      `Validated Android release artifacts for ${options.versionName} at ${options.expectedGitSha.toLowerCase()}.\n`,
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

if (import.meta.url === pathToFileURL(path.resolve(process.argv[1] ?? "")).href) {
  const exitCode = await main(process.argv.slice(2));
  if (exitCode !== 0) {
    process.exit(exitCode);
  }
}
