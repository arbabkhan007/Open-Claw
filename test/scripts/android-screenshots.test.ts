import { spawnSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const SCRIPT = "scripts/android-screenshots.sh";
const temporaryRoots: string[] = [];

function runAndroidScreenshots(args: string[], env: NodeJS.ProcessEnv = {}) {
  return spawnSync("bash", [SCRIPT, ...args], {
    encoding: "utf8",
    env: { ...process.env, ...env },
  });
}

function writeExecutable(filePath: string, contents: string) {
  writeFileSync(filePath, contents);
  chmodSync(filePath, 0o755);
}

function createBehaviorHarness() {
  const root = mkdtempSync(path.join(tmpdir(), "openclaw-android-screenshots-"));
  temporaryRoots.push(root);
  const scriptsDir = path.join(root, "scripts");
  const scriptsLibDir = path.join(scriptsDir, "lib");
  const binDir = path.join(root, "bin");
  mkdirSync(scriptsLibDir, { recursive: true });
  mkdirSync(binDir, { recursive: true });
  copyFileSync(SCRIPT, path.join(scriptsDir, "android-screenshots.sh"));
  copyFileSync(
    "scripts/lib/android-release-source.ts",
    path.join(scriptsLibDir, "android-release-source.ts"),
  );

  const statePath = path.join(root, "adb-state.json");
  const adbLogPath = path.join(root, "adb.log");
  const emulatorLogPath = path.join(root, "emulator.log");
  const gitLogPath = path.join(root, "git.log");
  const gitStatusPath = path.join(root, "git-status.txt");
  const fakeAdbPath = path.join(binDir, "adb");
  writeExecutable(
    fakeAdbPath,
    `#!/usr/bin/env node
const fs = require("node:fs");
const args = process.argv.slice(2);
const statePath = process.env.FAKE_ADB_STATE;
const logPath = process.env.FAKE_ADB_LOG;
fs.appendFileSync(logPath, JSON.stringify(args) + "\\n");
const readState = () => JSON.parse(fs.readFileSync(statePath, "utf8"));
const writeState = (state) => fs.writeFileSync(statePath, JSON.stringify(state));
if (args[0] === "devices") {
  const state = readState();
  process.stdout.write("List of devices attached\\n");
  for (const [serial, device] of Object.entries(state)) {
    process.stdout.write(serial + "\\t" + device.state + "\\n");
  }
  process.exit(0);
}
const serialIndex = args.indexOf("-s");
const serial = serialIndex >= 0 ? args[serialIndex + 1] : "";
const command = serialIndex >= 0 ? args.slice(serialIndex + 2) : args;
const state = readState();
const device = state[serial];
const starts = (...expected) => expected.every((value, index) => command[index] === value);
if (starts("emu", "avd", "name")) process.stdout.write((device?.avd || "") + "\\n");
else if (starts("emu", "kill")) { delete state[serial]; writeState(state); process.stdout.write("OK\\n"); }
else if (starts("get-state")) process.stdout.write(device?.state === "device" ? "device\\n" : "unknown\\n");
else if (starts("wait-for-device")) process.exit(device ? 0 : 1);
else if (starts("shell", "getprop", "ro.kernel.qemu")) process.stdout.write("1\\n");
else if (starts("shell", "getprop", "sys.boot_completed")) process.stdout.write("1\\n");
else if (starts("shell", "pm", "list", "features")) process.stdout.write(device?.watch ? "feature:android.hardware.type.watch\\n" : "feature:android.hardware.camera\\n");
else if (starts("shell", "wm", "size") && command.length === 3) process.stdout.write("Physical size: 454x454\\n");
else if (starts("shell", "wm", "density") && command.length === 3) process.stdout.write("Physical density: 320\\n");
else if (starts("exec-out", "uiautomator", "dump")) process.stdout.write("<hierarchy text=\\\"Overview Ready when you are Ready to talk OpenClaw mobile Wake listener Connection between this phone and OpenClaw. CHAT Dictate AGENTS SESSIONS CONTROLS\\\" />\\n");
else if (starts("exec-out", "screencap", "-p")) process.stdout.write("fake-png");
else if (starts("shell", "am", "start")) process.stdout.write("Status: ok\\n");
else if (starts("logcat", "-d")) process.stdout.write("fake logcat\\n");
`,
  );
  writeExecutable(
    path.join(binDir, "emulator"),
    `#!/bin/sh
printf '%s\\n' "$*" >> "$FAKE_EMULATOR_LOG"
exit 1
`,
  );
  writeExecutable(
    path.join(binDir, "sips"),
    `#!/bin/sh
cp "$7" "$9"
`,
  );
  writeExecutable(
    path.join(binDir, "file"),
    `#!/bin/sh
printf '%s: JPEG image data, %s\\n' "$1" "$FAKE_SCREENSHOT_SIZE"
`,
  );
  writeExecutable(
    path.join(binDir, "git"),
    `#!/bin/sh
printf '%s\\n' "$*" >> "$FAKE_GIT_LOG"
case " $* " in
  *" status --porcelain=v1 --untracked-files=all "*) cat "$FAKE_GIT_STATUS_FILE" ;;
  *" rev-parse --verify HEAD "*) printf '%s\\n' 0123456789abcdef0123456789abcdef01234567 ;;
  *) exit 1 ;;
esac
`,
  );
  writeExecutable(
    path.join(binDir, "sleep"),
    `#!/bin/sh
exit 0
`,
  );

  const run = (args: string[], state: object, screenshotSize = "454x454", gitStatus = "") => {
    writeFileSync(statePath, JSON.stringify(state));
    writeFileSync(adbLogPath, "");
    writeFileSync(emulatorLogPath, "");
    writeFileSync(gitLogPath, "");
    writeFileSync(gitStatusPath, gitStatus);
    const result = spawnSync("bash", [path.join(scriptsDir, "android-screenshots.sh"), ...args], {
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: `${binDir}:${process.env.PATH}`,
        ADB: fakeAdbPath,
        ANDROID_EMULATOR: path.join(binDir, "emulator"),
        SIPS: path.join(binDir, "sips"),
        FAKE_ADB_STATE: statePath,
        FAKE_ADB_LOG: adbLogPath,
        FAKE_EMULATOR_LOG: emulatorLogPath,
        FAKE_GIT_STATUS_FILE: gitStatusPath,
        FAKE_GIT_LOG: gitLogPath,
        FAKE_SCREENSHOT_SIZE: screenshotSize,
      },
    });
    const adbCalls = readFileSync(adbLogPath, "utf8")
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as string[]);
    const gitCalls = readFileSync(gitLogPath, "utf8").trim().split("\n").filter(Boolean);
    return { result, adbCalls, gitCalls, root, emulatorLogPath };
  };

  return { run };
}

afterEach(() => {
  while (temporaryRoots.length > 0) {
    rmSync(temporaryRoots.pop()!, { recursive: true, force: true });
  }
});

describe("android screenshots script", () => {
  it("keeps the package entrypoint on the two-form-factor orchestrator", () => {
    const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as {
      scripts: Record<string, string>;
    };
    const result = runAndroidScreenshots([
      "--form-factor",
      "all",
      "--dry-run",
      "--locale",
      "pt-BR",
    ]);

    expect(packageJson.scripts["android:screenshots"]).toContain("--form-factor all");
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("pt-BR/images/phoneScreenshots");
    expect(result.stdout).toContain("pt-BR/images/wearScreenshots");
  });

  it("dry-runs both store form factors with isolated defaults", () => {
    const phone = runAndroidScreenshots([
      "--form-factor",
      "phone",
      "--dry-run",
      "--locale",
      "pt-BR",
    ]);
    const wear = runAndroidScreenshots(
      ["--form-factor", "wear", "--dry-run", "--locale", "pt-BR"],
      {
        ANDROID_SCREENSHOT_AVD: "Phone_Only_Override",
        ANDROID_SCREENSHOT_SIZE: "1080x1920",
      },
    );

    expect(phone.status).toBe(0);
    expect(phone.stdout).toContain("pt-BR/images/phoneScreenshots");
    expect(phone.stdout).toContain(".artifacts/android-screenshots/latest/pt-BR");
    expect(phone.stdout).toContain("Android screenshot size: 1440x2560");
    expect(phone.stdout).toContain("Screenshot AVD: OpenClaw_Screenshots_API36");
    expect(wear.status).toBe(0);
    expect(wear.stdout).toContain("pt-BR/images/wearScreenshots");
    expect(wear.stdout).toContain(".artifacts/android-wear-screenshots/latest/pt-BR");
    expect(wear.stdout).toContain("Android screenshot size: 454x454");
    expect(wear.stdout).toContain("Screenshot AVD: OpenClaw_Wear_Screenshots_API36");
    expect(wear.stdout).toContain("Screenshot device profile: wearos_large_round");
    expect(wear.stdout).toContain("Scenes: chat voice agents sessions controls");
    expect(wear.stdout).not.toContain("Phone_Only_Override");
    expect(wear.stdout).not.toContain("1080x1920");
  });

  it("keeps artifact cleanup inside fixed repository-owned evidence directories", () => {
    const phone = runAndroidScreenshots(["--form-factor", "phone", "--dry-run"], {
      ANDROID_SCREENSHOT_ARTIFACT_DIR: process.env.HOME,
    });
    const wear = runAndroidScreenshots(["--form-factor", "wear", "--dry-run"], {
      ANDROID_SCREENSHOT_ARTIFACT_DIR: process.env.HOME,
    });

    expect(phone.status).toBe(0);
    expect(phone.stdout).toContain(".artifacts/android-screenshots/latest/en-US");
    expect(wear.status).toBe(0);
    expect(wear.stdout).toContain(".artifacts/android-wear-screenshots/latest/en-US");
    expect(`${phone.stdout}${wear.stdout}`).not.toContain(
      `Android screenshot artifacts: ${process.env.HOME}\n`,
    );
  });

  it("rejects dirty source before touching an emulator", () => {
    const harness = createBehaviorHarness();
    const { result, adbCalls, gitCalls } = harness.run(
      ["--form-factor", "wear", "--skip-build", "--skip-install", "--keep-emulator"],
      {},
      "454x454",
      " M apps/android/wear/src/main/WearScreens.kt\n",
    );

    expect(result.status).not.toBe(0);
    expect(result.stderr, gitCalls.join("\n")).toContain(
      "Android release builds require a clean Git checkout",
    );
    expect(gitCalls.some((call) => call === "status --porcelain=v1 --untracked-files=all")).toBe(
      true,
    );
    expect(adbCalls).toEqual([]);
  });

  it("selects the exact Wear AVD while another emulator is connected", () => {
    const harness = createBehaviorHarness();
    const { result, adbCalls, root, emulatorLogPath } = harness.run(
      ["--form-factor", "wear", "--skip-build", "--skip-install", "--keep-emulator"],
      {
        "emulator-5554": { avd: "Unrelated_Phone", state: "device", watch: false },
        "emulator-5556": {
          avd: "OpenClaw_Wear_Screenshots_API36",
          state: "device",
          watch: true,
        },
      },
    );

    expect(result.status, result.stderr).toBe(0);
    expect(readFileSync(emulatorLogPath, "utf8")).toBe("");
    const starts = adbCalls.filter((call) => call.includes("start"));
    expect(starts).toHaveLength(5);
    expect(starts.every((call) => call[1] === "emulator-5556")).toBe(true);
    expect(
      starts.every((call) =>
        call.includes("ai.openclaw.app/ai.openclaw.wear.WearScreenshotActivity"),
      ),
    ).toBe(true);
    expect(starts.every((call) => call.includes("--activity-clear-task"))).toBe(true);
    expect(starts.every((call) => !call.includes("openclaw.screenshotMode"))).toBe(true);
    const outputDir = path.join(
      root,
      "apps/android/fastlane/metadata/android/en-US/images/wearScreenshots",
    );
    expect(readdirSync(outputDir).filter((name) => name.endsWith(".jpg"))).toHaveLength(5);
    const manifest = readFileSync(
      path.join(root, ".artifacts/android-wear-screenshots/latest/en-US/manifest.txt"),
      "utf8",
    );
    expect(manifest).toContain("form_factor=wear");
    expect(manifest).toContain("device=emulator-5556");
    expect(manifest).toContain("component=ai.openclaw.app/ai.openclaw.wear.WearScreenshotActivity");
    expect(manifest).toContain(
      "screenshot.chat.path=apps/android/fastlane/metadata/android/en-US/images/wearScreenshots/openclaw-chat.jpg",
    );
    expect(manifest).toMatch(/screenshot\.chat\.sha256=[0-9a-f]{64}/);
  });

  it("rejects a phone-form emulator before launching a Wear scene", () => {
    const harness = createBehaviorHarness();
    const { result, adbCalls } = harness.run(
      [
        "--form-factor",
        "wear",
        "--device",
        "emulator-5554",
        "--skip-build",
        "--skip-install",
        "--keep-emulator",
      ],
      {
        "emulator-5554": { avd: "Unrelated_Phone", state: "device", watch: false },
      },
    );

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("requires a Wear OS emulator");
    expect(adbCalls.some((call) => call.includes("start"))).toBe(false);
  });

  it("accepts a non-watch emulator for the complete phone fixture capture", () => {
    const harness = createBehaviorHarness();
    const { result, adbCalls, root } = harness.run(
      [
        "--form-factor",
        "phone",
        "--device",
        "emulator-5554",
        "--skip-build",
        "--skip-install",
        "--keep-emulator",
      ],
      {
        "emulator-5554": {
          avd: "OpenClaw_Screenshots_API36",
          state: "device",
          watch: false,
        },
      },
      "1440x2560",
    );

    expect(result.status, result.stderr).toBe(0);
    const starts = adbCalls.filter((call) => call.includes("start"));
    expect(starts).toHaveLength(6);
    expect(starts.every((call) => call.includes("ai.openclaw.app/.MainActivity"))).toBe(true);
    expect(starts.every((call) => call.includes("openclaw.screenshotMode"))).toBe(true);
    const outputDir = path.join(
      root,
      "apps/android/fastlane/metadata/android/en-US/images/phoneScreenshots",
    );
    expect(readdirSync(outputDir).filter((name) => name.endsWith(".jpg"))).toHaveLength(6);
  });

  it.each(["383x383", "454x455"])("rejects invalid Wear store dimensions: %s", (size) => {
    const result = runAndroidScreenshots(["--form-factor", "wear", "--dry-run"], {
      ANDROID_SCREENSHOT_WEAR_SIZE: size,
    });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("must be square, at least 384x384");
  });

  it.each(["../escape", "en/US", ".hidden", "en..US", ""])(
    "rejects locale path escapes before dry-run output: %j",
    (locale) => {
      const result = runAndroidScreenshots(["--dry-run", "--locale", locale]);

      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain("Invalid Android screenshot locale");
      expect(result.stderr).toContain("path separators and dot segments are not allowed");
      expect(result.stdout).not.toContain("Android screenshot output:");
    },
  );

  it("rejects phone dimensions outside Google Play's aspect-ratio limit", () => {
    const result = runAndroidScreenshots(["--form-factor", "phone", "--dry-run"], {
      ANDROID_SCREENSHOT_PHONE_SIZE: "1080x2424",
    });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("does not meet Google Play dimension and aspect-ratio limits");
  });

  it("keeps current phone fixture readiness markers", () => {
    const script = readFileSync(SCRIPT, "utf8");

    expect(script).toContain("phone:settings) printf '%s\\n' \"OpenClaw mobile\"");
    expect(script).toContain(
      "phone:gateway) printf '%s\\n' \"Connection between this phone and OpenClaw.\"",
    );
    expect(existsSync(SCRIPT)).toBe(true);
  });

  it("keeps the exported Wear screenshot fixture in the debug source set only", () => {
    const debugActivity = path.join(
      "apps/android/wear/src/debug/java/ai/openclaw/wear/WearScreenshotActivity.kt",
    );
    const debugManifest = readFileSync("apps/android/wear/src/debug/AndroidManifest.xml", "utf8");
    const mainManifest = readFileSync("apps/android/wear/src/main/AndroidManifest.xml", "utf8");

    expect(existsSync(debugActivity)).toBe(true);
    expect(debugManifest).toContain('android:name=".WearScreenshotActivity"');
    expect(debugManifest).toContain('android:exported="true"');
    expect(mainManifest).not.toContain("WearScreenshotActivity");
    expect(
      existsSync("apps/android/wear/src/main/java/ai/openclaw/wear/WearScreenshotActivity.kt"),
    ).toBe(false);
  });
});
