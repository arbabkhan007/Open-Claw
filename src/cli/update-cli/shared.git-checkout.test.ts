import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createGitCheckout } from "./shared.js";

const CANONICAL_REPO_URL = "https://github.com/openclaw/openclaw.git";
const runCommandWithTimeout = vi.hoisted(() => vi.fn());

vi.mock("../../process/exec.js", () => ({ runCommandWithTimeout }));

function seedRemoteMain(dir: string): void {
  execFileSync("git", ["-C", dir, "update-ref", "refs/remotes/origin/main", "HEAD"]);
}

async function createHostileCheckout(setup: (dir: string) => void): Promise<string> {
  const dir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-git-adopt-")));
  execFileSync("git", ["-C", dir, "init", "--quiet"]);
  execFileSync("git", ["-C", dir, "config", "user.name", "OpenClaw Test"]);
  execFileSync("git", ["-C", dir, "config", "user.email", "test@openclaw.invalid"]);
  execFileSync("git", ["-C", dir, "remote", "add", "origin", CANONICAL_REPO_URL]);
  await fs.writeFile(path.join(dir, "package.json"), JSON.stringify({ name: "openclaw" }));
  execFileSync("git", ["-C", dir, "add", "package.json"]);
  execFileSync("git", ["-C", dir, "commit", "--quiet", "-m", "seed hostile checkout"]);
  setup(dir);
  return dir;
}

describe("createGitCheckout", () => {
  beforeEach(() => {
    runCommandWithTimeout.mockReset();
    runCommandWithTimeout.mockImplementation(async (argv: string[]) => {
      if (argv[0] === "git" && argv[1] === "clone" && argv[3]) {
        await fs.mkdir(path.join(argv[3], ".git"), { recursive: true });
      }
      return {
        stdout: "",
        stderr: "",
        code: 0,
        signal: null,
        killed: false,
        termination: "exit",
      };
    });
  });

  it("clones the canonical repository only when the destination does not exist", async () => {
    const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-git-clone-")));
    const dir = path.join(root, "checkout");

    const result = await createGitCheckout({
      dir,
      timeoutMs: 30_000,
      env: { ...process.env, OPENCLAW_STATE_DIR: path.join(root, "state") },
    });

    expect(result?.name).toBe("git clone");
    expect(runCommandWithTimeout).toHaveBeenCalledWith(
      ["git", "clone", CANONICAL_REPO_URL, dir],
      expect.objectContaining({
        env: expect.objectContaining({
          GIT_CONFIG_GLOBAL: os.devNull,
          GIT_CONFIG_NOSYSTEM: "1",
        }),
        timeoutMs: 30_000,
      }),
    );
  });

  it("ignores config injection that could rewrite the canonical clone URL", async () => {
    const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-git-clone-")));
    const dir = path.join(root, "checkout");

    await createGitCheckout({
      dir,
      timeoutMs: 30_000,
      env: {
        PATH: process.env.PATH,
        OPENCLAW_STATE_DIR: path.join(root, "state"),
        GIT_CONFIG_GLOBAL: "/tmp/hostile-global-config",
        GIT_CONFIG_PARAMETERS: "'url.https://evil.invalid/.insteadOf'='https://github.com/'",
        GIT_CONFIG_COUNT: "1",
        GIT_CONFIG_KEY_0: "url.https://evil.invalid/.insteadOf",
        GIT_CONFIG_VALUE_0: "https://github.com/",
      },
    });

    const env = vi.mocked(runCommandWithTimeout).mock.calls[0]?.[1]?.env;
    expect(env).toMatchObject({
      GIT_CONFIG_GLOBAL: os.devNull,
      GIT_CONFIG_NOSYSTEM: "1",
    });
    expect(env).not.toHaveProperty("GIT_CONFIG_PARAMETERS");
    expect(env).not.toHaveProperty("GIT_CONFIG_COUNT");
    expect(env).not.toHaveProperty("GIT_CONFIG_KEY_0");
    expect(env).not.toHaveProperty("GIT_CONFIG_VALUE_0");
  });

  it("replaces only a checkout recorded by an earlier conversion", async () => {
    const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-git-clone-")));
    const dir = path.join(root, "checkout");
    const env = { ...process.env, OPENCLAW_STATE_DIR: path.join(root, "state") };

    await createGitCheckout({ dir, timeoutMs: 30_000, env });
    await fs.writeFile(path.join(dir, "partial-build"), "retained\n");
    await createGitCheckout({ dir, timeoutMs: 30_000, env });

    await expect(fs.stat(path.join(dir, "partial-build"))).rejects.toMatchObject({
      code: "ENOENT",
    });
    expect(runCommandWithTimeout).toHaveBeenCalledTimes(2);
  });

  it.each([
    {
      name: "skipFetchAll",
      setup: (dir: string) => {
        execFileSync("git", ["-C", dir, "config", "remote.origin.skipFetchAll", "true"]);
        seedRemoteMain(dir);
      },
    },
    {
      name: "a hostile fetch refspec",
      setup: (dir: string) => {
        execFileSync("git", [
          "-C",
          dir,
          "config",
          "remote.origin.fetch",
          "+refs/heads/safe:refs/remotes/origin/safe",
        ]);
        seedRemoteMain(dir);
      },
    },
    {
      name: "a pre-seeded remote-tracking ref",
      setup: seedRemoteMain,
    },
  ])("rejects a canonical-url checkout containing $name", async ({ setup }) => {
    const dir = await createHostileCheckout(setup);

    await expect(createGitCheckout({ dir, timeoutMs: 30_000, env: process.env })).rejects.toThrow(
      /creates a fresh OpenClaw checkout and will not reuse existing directories/u,
    );
    await expect(fs.stat(dir)).resolves.toBeDefined();
    expect(runCommandWithTimeout).not.toHaveBeenCalled();
  });

  it("removes the directory it created when launching git clone throws", async () => {
    const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-git-clone-")));
    const dir = path.join(root, "checkout");
    runCommandWithTimeout.mockRejectedValueOnce(new Error("unable to launch git"));

    await expect(createGitCheckout({ dir, timeoutMs: 30_000, env: process.env })).rejects.toThrow(
      /unable to launch git/u,
    );
    await expect(fs.stat(dir)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("rejects even an existing empty directory", async () => {
    const dir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-git-empty-")));

    await expect(createGitCheckout({ dir, timeoutMs: 30_000, env: process.env })).rejects.toThrow(
      /OPENCLAW_GIT_DIR already exists/u,
    );
  });
});
