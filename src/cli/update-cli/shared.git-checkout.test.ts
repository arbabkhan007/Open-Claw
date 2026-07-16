import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ensureGitCheckout } from "./shared.js";

async function createCheckout(remotes: Array<{ name: string; url: string }>): Promise<string> {
  const dir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-git-adopt-")));
  execFileSync("git", ["-C", dir, "init", "--quiet"]);
  for (const remote of remotes) {
    execFileSync("git", ["-C", dir, "remote", "add", remote.name, remote.url]);
  }
  await fs.writeFile(
    path.join(dir, "package.json"),
    JSON.stringify({ name: "openclaw", version: "1.0.0" }),
  );
  return dir;
}

describe("ensureGitCheckout remote verification", () => {
  it("adopts an existing checkout of the canonical repository", async () => {
    const dir = await createCheckout([
      { name: "origin", url: "https://github.com/openclaw/openclaw.git" },
    ]);

    await expect(
      ensureGitCheckout({ dir, timeoutMs: 30_000, env: process.env }),
    ).resolves.toBeNull();
  });

  it.each([
    { name: "https clone of another repository", url: "https://github.com/attacker/evil.git" },
    { name: "lookalike host", url: "https://github.com.evil.test/openclaw/openclaw.git" },
    { name: "local path remote", url: "/tmp/attacker-repo" },
  ])("rejects an existing checkout whose remote is a $name", async ({ url }) => {
    const dir = await createCheckout([{ name: "origin", url }]);

    await expect(ensureGitCheckout({ dir, timeoutMs: 30_000, env: process.env })).rejects.toThrow(
      /unexpected git remote/u,
    );
  });

  it("rejects an existing checkout with a canonical origin plus a foreign remote", async () => {
    const dir = await createCheckout([
      { name: "origin", url: "https://github.com/openclaw/openclaw.git" },
      { name: "backup", url: "https://github.com/attacker/evil.git" },
    ]);

    await expect(ensureGitCheckout({ dir, timeoutMs: 30_000, env: process.env })).rejects.toThrow(
      /remote "backup"/u,
    );
  });

  it("rejects an existing checkout with no remote at all", async () => {
    const dir = await createCheckout([]);

    await expect(ensureGitCheckout({ dir, timeoutMs: 30_000, env: process.env })).rejects.toThrow(
      /no git remote/u,
    );
  });

  it.each([
    "git@github.com:openclaw/openclaw.git",
    "ssh://git@github.com/openclaw/openclaw.git",
    "https://github.com/openclaw/openclaw",
    "https://github.com/OpenClaw/OpenClaw.git",
  ])("accepts equivalent canonical remote form %s", async (url) => {
    const dir = await createCheckout([{ name: "origin", url }]);

    await expect(
      ensureGitCheckout({ dir, timeoutMs: 30_000, env: process.env }),
    ).resolves.toBeNull();
  });
});
