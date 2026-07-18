import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, type Dirent } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

export type AndroidScreenshotFormFactor = "phone" | "wear";

type ValidateAndroidScreenshotSetOptions = {
  expectedGitSha: string;
  formFactor: AndroidScreenshotFormFactor;
  rootDir: string;
};

type ScreenshotSetConfig = {
  artifactDirectory: string;
  displayName: string;
  screenshotType: string;
};

const SCREENSHOT_EXTENSION_RE = /\.(?:jpe?g|png)$/iu;
const FULL_GIT_SHA_RE = /^[0-9a-f]{40}$/iu;

const SCREENSHOT_SET_CONFIG: Record<AndroidScreenshotFormFactor, ScreenshotSetConfig> = {
  phone: {
    artifactDirectory: "android-screenshots",
    displayName: "Phone",
    screenshotType: "phoneScreenshots",
  },
  wear: {
    artifactDirectory: "android-wear-screenshots",
    displayName: "Wear",
    screenshotType: "wearScreenshots",
  },
};

function screenshotFiles(directory: string, entries: Dirent[]): string[] {
  const files: string[] = [];
  for (const entry of entries) {
    if (!SCREENSHOT_EXTENSION_RE.test(entry.name)) {
      continue;
    }
    if (entry.isSymbolicLink()) {
      throw new Error(
        `Screenshot upload does not accept symbolic links: ${path.join(directory, entry.name)}.`,
      );
    }
    if (entry.isFile()) {
      files.push(path.resolve(directory, entry.name));
    }
  }
  return files.toSorted();
}

function uploadedScreenshotsByLocale(
  rootDir: string,
  screenshotType: string,
): Map<string, string[]> {
  const metadataRoot = path.join(rootDir, "apps", "android", "fastlane", "metadata", "android");
  if (!existsSync(metadataRoot)) {
    return new Map();
  }

  const locales = new Map<string, string[]>();
  const localeEntries = readdirSync(metadataRoot, { withFileTypes: true }).toSorted((left, right) =>
    left.name < right.name ? -1 : left.name > right.name ? 1 : 0,
  );
  for (const localeEntry of localeEntries) {
    if (!localeEntry.isDirectory()) {
      continue;
    }
    const directory = path.join(metadataRoot, localeEntry.name, "images", screenshotType);
    if (!existsSync(directory)) {
      continue;
    }
    const screenshots = screenshotFiles(directory, readdirSync(directory, { withFileTypes: true }));
    if (screenshots.length > 0) {
      locales.set(localeEntry.name, screenshots);
    }
  }
  return locales;
}

function readManifest(manifestPath: string): Map<string, string> {
  if (!existsSync(manifestPath)) {
    throw new Error(`Missing Android screenshot manifest at ${manifestPath}.`);
  }
  const manifest = new Map<string, string>();
  for (const line of readFileSync(manifestPath, "utf8").split(/\r?\n/u)) {
    if (line.length === 0) {
      continue;
    }
    const separator = line.indexOf("=");
    if (separator <= 0) {
      throw new Error(`Malformed Android screenshot manifest line in ${manifestPath}: ${line}`);
    }
    const key = line.slice(0, separator);
    if (manifest.has(key)) {
      throw new Error(`Duplicate Android screenshot manifest key '${key}' in ${manifestPath}.`);
    }
    manifest.set(key, line.slice(separator + 1));
  }
  return manifest;
}

function sha256(filePath: string): string {
  return createHash("sha256").update(readFileSync(filePath)).digest("hex");
}

function samePaths(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function validateLocaleManifest(options: {
  config: ScreenshotSetConfig;
  expectedGitSha: string;
  expectedPaths: string[];
  formFactor: AndroidScreenshotFormFactor;
  locale: string;
  rootDir: string;
}): void {
  const manifestPath = path.join(
    options.rootDir,
    ".artifacts",
    options.config.artifactDirectory,
    "latest",
    options.locale,
    "manifest.txt",
  );
  const manifest = readManifest(manifestPath);
  if (manifest.get("form_factor") !== options.formFactor) {
    throw new Error(
      `${options.config.displayName} screenshot manifest has the wrong form factor for ${options.locale}.`,
    );
  }
  if (manifest.get("locale") !== options.locale) {
    throw new Error(
      `${options.config.displayName} screenshot manifest has the wrong locale for ${options.locale}.`,
    );
  }
  if (manifest.get("git_sha") !== options.expectedGitSha) {
    const actual = manifest.get("git_sha") || "(missing)";
    throw new Error(
      `${options.config.displayName} screenshots for ${options.locale} were captured for Git SHA ${actual}, expected ${options.expectedGitSha}.`,
    );
  }

  const pathScenes = new Set<string>();
  const checksumScenes = new Set<string>();
  for (const key of manifest.keys()) {
    const pathMatch = /^screenshot\.(.+)\.path$/u.exec(key);
    const checksumMatch = /^screenshot\.(.+)\.sha256$/u.exec(key);
    if (pathMatch?.[1]) {
      pathScenes.add(pathMatch[1]);
    }
    if (checksumMatch?.[1]) {
      checksumScenes.add(checksumMatch[1]);
    }
  }
  if (pathScenes.size === 0) {
    throw new Error(
      `${options.config.displayName} screenshot manifest has no captured image entries for ${options.locale}.`,
    );
  }
  if (
    pathScenes.size !== checksumScenes.size ||
    [...pathScenes].some((scene) => !checksumScenes.has(scene))
  ) {
    throw new Error(
      `${options.config.displayName} screenshot manifest has an unmatched path or SHA-256 entry for ${options.locale}.`,
    );
  }

  const expectedDirectory = path.resolve(
    options.rootDir,
    "apps",
    "android",
    "fastlane",
    "metadata",
    "android",
    options.locale,
    "images",
    options.config.screenshotType,
  );
  const capturedPaths: string[] = [];
  for (const scene of [...pathScenes].toSorted()) {
    const relativePath = manifest.get(`screenshot.${scene}.path`) ?? "";
    if (path.isAbsolute(relativePath)) {
      throw new Error(
        `${options.config.displayName} screenshot manifest path must be repository-relative: ${relativePath}.`,
      );
    }
    const absolutePath = path.resolve(options.rootDir, relativePath);
    if (!absolutePath.startsWith(`${expectedDirectory}${path.sep}`)) {
      throw new Error(
        `${options.config.displayName} screenshot manifest path escapes the ${options.locale} upload directory: ${relativePath}.`,
      );
    }
    if (!options.expectedPaths.includes(absolutePath)) {
      throw new Error(
        `${options.config.displayName} screenshot manifest references a non-uploaded path: ${relativePath}.`,
      );
    }
    const expectedChecksum = manifest.get(`screenshot.${scene}.sha256`) ?? "";
    if (!/^[0-9a-f]{64}$/iu.test(expectedChecksum)) {
      throw new Error(
        `${options.config.displayName} screenshot manifest has an invalid SHA-256 for ${scene}.`,
      );
    }
    if (sha256(absolutePath) !== expectedChecksum.toLowerCase()) {
      throw new Error(
        `${options.config.displayName} screenshot ${relativePath} does not match its capture manifest.`,
      );
    }
    capturedPaths.push(absolutePath);
  }

  if (!samePaths(capturedPaths.toSorted(), options.expectedPaths)) {
    throw new Error(
      `${options.config.displayName} screenshot files for ${options.locale} do not exactly match the current capture manifest.`,
    );
  }
}

export function validateAndroidScreenshotSet(options: ValidateAndroidScreenshotSetOptions): {
  locales: string[];
} {
  const rootDir = path.resolve(options.rootDir);
  const expectedGitSha = options.expectedGitSha.trim().toLowerCase();
  if (!FULL_GIT_SHA_RE.test(expectedGitSha)) {
    throw new Error("Android screenshot validation requires a full 40-character Git SHA.");
  }
  const config = SCREENSHOT_SET_CONFIG[options.formFactor];
  const screenshots = uploadedScreenshotsByLocale(rootDir, config.screenshotType);
  if (screenshots.size === 0) {
    throw new Error(
      `Screenshot upload requires at least one ${config.displayName} screenshot under apps/android/fastlane/metadata/android/*/images/${config.screenshotType}/.`,
    );
  }

  for (const [locale, expectedPaths] of screenshots) {
    validateLocaleManifest({
      config,
      expectedGitSha,
      expectedPaths,
      formFactor: options.formFactor,
      locale,
      rootDir,
    });
  }
  return { locales: [...screenshots.keys()].toSorted() };
}

function usage(): string {
  return [
    "Usage:",
    "  node --import tsx scripts/android-screenshot-manifest.ts --root <repository> --form-factor phone|wear --expected-git-sha <full-sha>",
  ].join("\n");
}

function readOptionValue(argv: string[], index: number, flag: string): string {
  const value = argv[index + 1];
  if (!value || value.startsWith("-")) {
    throw new Error(`Missing value for ${flag}.`);
  }
  return value;
}

function parseArgs(argv: string[]): ValidateAndroidScreenshotSetOptions {
  let expectedGitSha = "";
  let formFactor: AndroidScreenshotFormFactor | null = null;
  let rootDir = path.resolve(".");
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    switch (arg) {
      case "--expected-git-sha":
        expectedGitSha = readOptionValue(argv, index, arg);
        index += 1;
        break;
      case "--form-factor": {
        const value = readOptionValue(argv, index, arg);
        if (value !== "phone" && value !== "wear") {
          throw new Error("Invalid --form-factor. Expected phone or wear.");
        }
        formFactor = value;
        index += 1;
        break;
      }
      case "--root":
        rootDir = path.resolve(readOptionValue(argv, index, arg));
        index += 1;
        break;
      case "-h":
      case "--help":
        throw new Error(usage());
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }
  if (formFactor == null) {
    throw new Error("Missing --form-factor. Expected phone or wear.");
  }
  return { expectedGitSha, formFactor, rootDir };
}

async function main(argv: string[]): Promise<number> {
  try {
    const options = parseArgs(argv);
    const result = validateAndroidScreenshotSet(options);
    process.stdout.write(
      `Validated ${options.formFactor} screenshots for ${result.locales.join(", ")} at ${options.expectedGitSha.toLowerCase()}.\n`,
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
