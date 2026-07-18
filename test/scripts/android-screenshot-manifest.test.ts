import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  type AndroidScreenshotFormFactor,
  validateAndroidScreenshotSet,
} from "../../scripts/android-screenshot-manifest.js";

const GIT_SHA = "a".repeat(40);
const temporaryRoots: string[] = [];

const FORM_FACTOR_CONFIG = {
  phone: {
    artifactDirectory: "android-screenshots",
    screenshotType: "phoneScreenshots",
  },
  wear: {
    artifactDirectory: "android-wear-screenshots",
    screenshotType: "wearScreenshots",
  },
} as const;

function makeRoot(): string {
  const root = mkdtempSync(path.join(tmpdir(), "openclaw-android-screenshot-manifest-"));
  temporaryRoots.push(root);
  return root;
}

function sha256(contents: string): string {
  return createHash("sha256").update(contents).digest("hex");
}

function screenshotPath(
  root: string,
  formFactor: AndroidScreenshotFormFactor,
  locale: string,
  scene: string,
): string {
  return path.join(
    root,
    "apps",
    "android",
    "fastlane",
    "metadata",
    "android",
    locale,
    "images",
    FORM_FACTOR_CONFIG[formFactor].screenshotType,
    `openclaw-${scene}.jpg`,
  );
}

function manifestPath(
  root: string,
  formFactor: AndroidScreenshotFormFactor,
  locale: string,
): string {
  return path.join(
    root,
    ".artifacts",
    FORM_FACTOR_CONFIG[formFactor].artifactDirectory,
    "latest",
    locale,
    "manifest.txt",
  );
}

function writeCapture(
  root: string,
  formFactor: AndroidScreenshotFormFactor,
  locale: string,
  scenes: string[],
): void {
  const manifestLines = [`git_sha=${GIT_SHA}`, `form_factor=${formFactor}`, `locale=${locale}`];
  for (const scene of scenes) {
    const contents = `${formFactor}:${locale}:${scene}`;
    const imagePath = screenshotPath(root, formFactor, locale, scene);
    mkdirSync(path.dirname(imagePath), { recursive: true });
    writeFileSync(imagePath, contents);
    manifestLines.push(
      `screenshot.${scene}.path=${path.relative(root, imagePath).split(path.sep).join("/")}`,
      `screenshot.${scene}.sha256=${sha256(contents)}`,
    );
  }
  const outputManifest = manifestPath(root, formFactor, locale);
  mkdirSync(path.dirname(outputManifest), { recursive: true });
  writeFileSync(outputManifest, `${manifestLines.join("\n")}\n`);
}

function rewriteManifest(
  root: string,
  formFactor: AndroidScreenshotFormFactor,
  locale: string,
  transform: (contents: string) => string,
): void {
  const filePath = manifestPath(root, formFactor, locale);
  writeFileSync(filePath, transform(readFileSync(filePath, "utf8")));
}

function validate(root: string, formFactor: AndroidScreenshotFormFactor) {
  return validateAndroidScreenshotSet({ expectedGitSha: GIT_SHA, formFactor, rootDir: root });
}

afterEach(() => {
  while (temporaryRoots.length > 0) {
    rmSync(temporaryRoots.pop()!, { recursive: true, force: true });
  }
});

describe("Android screenshot manifests", () => {
  it("validates independent current-SHA manifests for every uploaded locale and form factor", () => {
    const root = makeRoot();
    for (const locale of ["en-US", "pt-BR"]) {
      writeCapture(root, "phone", locale, ["home", "chat"]);
      writeCapture(root, "wear", locale, ["chat", "voice"]);
    }

    expect(validate(root, "phone").locales).toEqual(["en-US", "pt-BR"]);
    expect(validate(root, "wear").locales).toEqual(["en-US", "pt-BR"]);
  });

  it("rejects a stale locale manifest even when another locale is current", () => {
    const root = makeRoot();
    writeCapture(root, "wear", "en-US", ["chat"]);
    writeCapture(root, "wear", "pt-BR", ["chat"]);
    rewriteManifest(root, "wear", "pt-BR", (contents) =>
      contents.replace(`git_sha=${GIT_SHA}`, `git_sha=${"b".repeat(40)}`),
    );

    expect(() => validate(root, "wear")).toThrow(/pt-BR were captured for Git SHA/u);
  });

  it("rejects the wrong form factor", () => {
    const root = makeRoot();
    writeCapture(root, "wear", "en-US", ["chat"]);
    rewriteManifest(root, "wear", "en-US", (contents) =>
      contents.replace("form_factor=wear", "form_factor=phone"),
    );

    expect(() => validate(root, "wear")).toThrow(/wrong form factor/u);
  });

  it("rejects an image edited after capture", () => {
    const root = makeRoot();
    writeCapture(root, "phone", "en-US", ["home"]);
    writeFileSync(screenshotPath(root, "phone", "en-US", "home"), "edited");

    expect(() => validate(root, "phone")).toThrow(/does not match its capture manifest/u);
  });

  it("rejects missing and extra uploaded images", () => {
    const missingRoot = makeRoot();
    writeCapture(missingRoot, "phone", "en-US", ["home", "chat"]);
    rmSync(screenshotPath(missingRoot, "phone", "en-US", "chat"));
    expect(() => validate(missingRoot, "phone")).toThrow(/non-uploaded path/u);

    const extraRoot = makeRoot();
    writeCapture(extraRoot, "wear", "en-US", ["chat"]);
    writeFileSync(screenshotPath(extraRoot, "wear", "en-US", "voice"), "extra");
    expect(() => validate(extraRoot, "wear")).toThrow(/do not exactly match/u);
  });

  it("rejects unmatched manifest path and checksum entries", () => {
    const root = makeRoot();
    writeCapture(root, "phone", "en-US", ["home"]);
    rewriteManifest(root, "phone", "en-US", (contents) =>
      contents.replace(/^screenshot\.home\.sha256=.*\n/mu, ""),
    );

    expect(() => validate(root, "phone")).toThrow(/unmatched path or SHA-256/u);
  });

  it("rejects paths outside the expected locale upload directory", () => {
    const root = makeRoot();
    writeCapture(root, "wear", "en-US", ["chat"]);
    rewriteManifest(root, "wear", "en-US", (contents) =>
      contents.replace(
        /^screenshot\.chat\.path=.*$/mu,
        "screenshot.chat.path=apps/android/fastlane/metadata/android/pt-BR/images/wearScreenshots/openclaw-chat.jpg",
      ),
    );

    expect(() => validate(root, "wear")).toThrow(/escapes the en-US upload directory/u);
  });

  it("rejects a missing per-locale manifest", () => {
    const root = makeRoot();
    writeCapture(root, "phone", "en-US", ["home"]);
    rmSync(manifestPath(root, "phone", "en-US"));

    expect(() => validate(root, "phone")).toThrow(/Missing Android screenshot manifest/u);
  });
});
