// Real filesystem proof: cleanupFailedManagedPluginInstall removes stale
// install targets after a double-fault persistence rollback.
//
// This test creates actual directories and files on disk, then calls the
// cleanup helper with the REAL applyPluginUninstallDirectoryRemoval (not a
// mock) to prove that the target directory is physically removed when the
// surviving install record is from the current failed transaction.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  installRecords: vi.fn<() => Record<string, unknown>>(),
}));

// Only mock the SQLite read — filesystem operations are real.
vi.mock("./installed-plugin-index-records.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./installed-plugin-index-records.js")>()),
  loadInstalledPluginIndexInstallRecords: () => mocks.installRecords(),
}));

import { cleanupFailedManagedPluginInstall } from "./management-service.js";

describe("cleanupFailedManagedPluginInstall — real filesystem proof", () => {
  const tmpDirs: string[] = [];

  afterAll(() => {
    for (const dir of tmpDirs) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  function createTarget(): { tmpDir: string; targetDir: string } {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-proof-"));
    tmpDirs.push(tmpDir);
    const targetDir = path.join(tmpDir, "extensions", "demo-plugin");
    fs.mkdirSync(targetDir, { recursive: true });
    fs.writeFileSync(path.join(targetDir, "index.js"), "module.exports = {}");
    fs.writeFileSync(path.join(targetDir, "package.json"), JSON.stringify({ name: "demo" }));
    return { tmpDir, targetDir };
  }

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("★ DOUBLE-FAULT FIX: removes stale target when pre-snapshot has no record but post-failure read does", async () => {
    const { targetDir, tmpDir } = createTarget();
    mocks.installRecords.mockResolvedValue({
      "demo-plugin": { source: "clawhub", installPath: targetDir },
    });

    expect(fs.existsSync(targetDir)).toBe(true);

    const warnings = await cleanupFailedManagedPluginInstall({
      pluginId: "demo-plugin",
      install: { source: "clawhub", installPath: targetDir },
      targetDir,
      extensionsDir: path.join(tmpDir, "extensions"),
      previousInstallRecords: {}, // ← pre-persist snapshot: empty → stale!
    });

    expect(warnings).toEqual([]);
    expect(fs.existsSync(targetDir)).toBe(false); // ← real deletion
  });

  it("preserves target when both pre-snapshot and post-failure agree (prior committed install)", async () => {
    const { targetDir, tmpDir } = createTarget();
    const records = {
      "demo-plugin": { source: "clawhub", installPath: targetDir },
    };
    mocks.installRecords.mockResolvedValue(records);

    expect(fs.existsSync(targetDir)).toBe(true);

    const warnings = await cleanupFailedManagedPluginInstall({
      pluginId: "demo-plugin",
      install: { source: "clawhub", installPath: targetDir },
      targetDir,
      extensionsDir: path.join(tmpDir, "extensions"),
      previousInstallRecords: records, // ← same record → prior install
    });

    expect(warnings).toEqual([expect.stringContaining("retained the managed target")]);
    expect(fs.existsSync(targetDir)).toBe(true);
  });

  it("falls back to conservative when no pre-snapshot provided (backward compat)", async () => {
    const { targetDir, tmpDir } = createTarget();
    mocks.installRecords.mockResolvedValue({
      "demo-plugin": { source: "clawhub", installPath: targetDir },
    });

    expect(fs.existsSync(targetDir)).toBe(true);

    const warnings = await cleanupFailedManagedPluginInstall({
      pluginId: "demo-plugin",
      install: { source: "clawhub", installPath: targetDir },
      targetDir,
      extensionsDir: path.join(tmpDir, "extensions"),
      // previousInstallRecords omitted
    });

    expect(warnings).toEqual([expect.stringContaining("retained the managed target")]);
    expect(fs.existsSync(targetDir)).toBe(true);
  });
});
