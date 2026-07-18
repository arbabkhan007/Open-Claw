import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  type AndroidReleaseArtifactFlavor,
  androidReleaseArtifactManifestPath,
  validateAndroidReleaseArtifactManifest,
  writeAndroidReleaseArtifactManifest,
} from "../../scripts/android-release-artifact-manifest.js";

const GIT_SHA = "a".repeat(40);
const VERSION = "2026.7.17";
const PHONE_VERSION_CODE = 2026071701;
const temporaryRoots: string[] = [];

function makeRoot(): string {
  const root = mkdtempSync(path.join(tmpdir(), "openclaw-android-release-manifest-"));
  temporaryRoots.push(root);
  mkdirSync(path.join(root, "apps", "android", "build", "release-artifacts"), {
    recursive: true,
  });
  return root;
}

function sha256(contents: string): string {
  return createHash("sha256").update(contents).digest("hex");
}

function writeArtifact(root: string, flavor: AndroidReleaseArtifactFlavor) {
  const extension = flavor === "third-party" ? "apk" : "aab";
  const file = `openclaw-${VERSION}-${flavor}-release.${extension}`;
  const contents = `${flavor} artifact bytes`;
  writeFileSync(path.join(root, "apps", "android", "build", "release-artifacts", file), contents);
  return { file, flavor, sha256: sha256(contents) };
}

function writeManifest(root: string, flavors: AndroidReleaseArtifactFlavor[] = ["play", "wear"]) {
  return writeAndroidReleaseArtifactManifest({
    artifacts: flavors.map((flavor) => writeArtifact(root, flavor)),
    buildTimestamp: "2026-07-17T12:34:56.000Z",
    gitCommit: GIT_SHA,
    phoneVersionCode: PHONE_VERSION_CODE,
    rootDir: root,
    versionName: VERSION,
    wearVersionCode: PHONE_VERSION_CODE + 50,
  });
}

function validate(root: string) {
  return validateAndroidReleaseArtifactManifest({
    expectedGitSha: GIT_SHA,
    phoneVersionCode: PHONE_VERSION_CODE,
    rootDir: root,
    versionName: VERSION,
  });
}

afterEach(() => {
  while (temporaryRoots.length > 0) {
    rmSync(temporaryRoots.pop()!, { recursive: true, force: true });
  }
});

describe("Android release artifact manifest", () => {
  it("binds the phone and Wear AAB bytes to version codes and a Git commit", () => {
    const root = makeRoot();
    const manifestPath = writeManifest(root);

    expect(manifestPath).toBe(androidReleaseArtifactManifestPath(root));
    const manifest = validate(root);
    expect(manifest.gitCommit).toBe(GIT_SHA);
    expect(manifest.phoneVersionCode).toBe(PHONE_VERSION_CODE);
    expect(manifest.wearVersionCode).toBe(PHONE_VERSION_CODE + 50);
    expect(manifest.artifacts.play?.file).toBe(`openclaw-${VERSION}-play-release.aab`);
    expect(manifest.artifacts.wear?.file).toBe(`openclaw-${VERSION}-wear-release.aab`);
  });

  it("rejects stale commit, version, and versionCode provenance", () => {
    const root = makeRoot();
    writeManifest(root);

    expect(() =>
      validateAndroidReleaseArtifactManifest({
        expectedGitSha: "b".repeat(40),
        phoneVersionCode: PHONE_VERSION_CODE,
        rootDir: root,
        versionName: VERSION,
      }),
    ).toThrow(/built for Git SHA/u);
    expect(() =>
      validateAndroidReleaseArtifactManifest({
        expectedGitSha: GIT_SHA,
        phoneVersionCode: PHONE_VERSION_CODE,
        rootDir: root,
        versionName: "2026.7.18",
      }),
    ).toThrow(/built for version/u);
    expect(() =>
      validateAndroidReleaseArtifactManifest({
        expectedGitSha: GIT_SHA,
        phoneVersionCode: PHONE_VERSION_CODE + 1,
        rootDir: root,
        versionName: VERSION,
      }),
    ).toThrow(/phone versionCode/u);
  });

  it("rejects an AAB changed after the signed build", () => {
    const root = makeRoot();
    writeManifest(root);
    writeFileSync(
      path.join(
        root,
        "apps",
        "android",
        "build",
        "release-artifacts",
        `openclaw-${VERSION}-wear-release.aab`,
      ),
      "tampered",
    );

    expect(() => validate(root)).toThrow(/does not match its build manifest/u);
  });

  it("rejects a missing archived AAB", () => {
    const root = makeRoot();
    writeManifest(root);
    rmSync(
      path.join(
        root,
        "apps",
        "android",
        "build",
        "release-artifacts",
        `openclaw-${VERSION}-play-release.aab`,
      ),
    );

    expect(() => validate(root)).toThrow(/Missing Android release artifact/u);
  });

  it("rejects a partial build manifest before Play upload", () => {
    const root = makeRoot();
    writeManifest(root, ["third-party"]);

    expect(() => validate(root)).toThrow(/missing play/u);
  });

  it("rejects missing and path-escaping manifest entries", () => {
    const missingRoot = makeRoot();
    expect(() => validate(missingRoot)).toThrow(/Missing Android release artifact manifest/u);

    const escapingRoot = makeRoot();
    const manifestPath = writeManifest(escapingRoot);
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
      artifacts: { play: { file: string } };
    };
    manifest.artifacts.play.file = "../stale.aab";
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    expect(() => validate(escapingRoot)).toThrow(/invalid filename for play/u);
  });

  it("rejects malformed, unknown-flavor, and wrong Wear-code manifests", () => {
    const malformedRoot = makeRoot();
    const malformedPath = androidReleaseArtifactManifestPath(malformedRoot);
    writeFileSync(malformedPath, "{not-json\n");
    expect(() => validate(malformedRoot)).toThrow(/Invalid Android release artifact manifest/u);

    const unknownRoot = makeRoot();
    const unknownPath = writeManifest(unknownRoot);
    const unknown = JSON.parse(readFileSync(unknownPath, "utf8")) as {
      artifacts: Record<string, unknown>;
    };
    unknown.artifacts.beta = { file: "beta.aab", sha256: "b".repeat(64) };
    writeFileSync(unknownPath, `${JSON.stringify(unknown, null, 2)}\n`);
    expect(() => validate(unknownRoot)).toThrow(/unknown flavor: beta/u);

    const wrongCodeRoot = makeRoot();
    const wrongCodePath = writeManifest(wrongCodeRoot);
    const wrongCode = JSON.parse(readFileSync(wrongCodePath, "utf8")) as {
      wearVersionCode: number;
    };
    wrongCode.wearVersionCode += 1;
    writeFileSync(wrongCodePath, `${JSON.stringify(wrongCode, null, 2)}\n`);
    expect(() => validate(wrongCodeRoot)).toThrow(/Wear versionCode/u);
  });

  it("keeps the archive builder and upload lane on the manifest contract", () => {
    const builder = readFileSync("apps/android/scripts/build-release-artifacts.ts", "utf8");
    const fastfile = readFileSync("apps/android/fastlane/Fastfile", "utf8");

    expect(builder).toContain("writeAndroidReleaseArtifactManifest({");
    expect(builder).toContain("wearVersionCode: version.versionCode + 50");
    expect(fastfile).toContain("validate_android_release_artifact_manifest!");
    expect(fastfile).toContain('"android-release-artifact-manifest.ts"');
  });
});
