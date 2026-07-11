// Launchd restart handoff tests cover restart coordination on macOS.
import { afterEach, describe, expect, it, vi } from "vitest";

const spawnMock = vi.hoisted(() => vi.fn());
const unrefMock = vi.hoisted(() => vi.fn());

vi.mock("node:child_process", async () => {
  const actual = await vi.importActual<typeof import("node:child_process")>("node:child_process");
  return {
    ...actual,
    spawn: (...args: unknown[]) => spawnMock(...args),
  };
});

import { scheduleDetachedLaunchdRestartHandoff } from "./launchd-restart-handoff.js";

type SpawnCall = [string, string[], { env: Record<string, string | undefined> }];

function requireSpawnCall(callIndex = 0): SpawnCall {
  const call = spawnMock.mock.calls[callIndex];
  if (!call) {
    throw new Error(`expected spawn call ${callIndex}`);
  }
  const [command, args, options] = call;
  if (
    typeof command !== "string" ||
    !Array.isArray(args) ||
    !options ||
    typeof options !== "object"
  ) {
    throw new Error(`expected spawn call ${callIndex} with command, args, and options`);
  }
  return [command, args as string[], options as SpawnCall[2]];
}

afterEach(() => {
  spawnMock.mockReset();
  unrefMock.mockReset();
  spawnMock.mockReturnValue({ pid: 4242, unref: unrefMock, once: vi.fn() });
});

describe("scheduleDetachedLaunchdRestartHandoff", () => {
  it("waits for the caller pid before kickstarting launchd", () => {
    const env = {
      HOME: "/Users/test",
      OPENCLAW_PROFILE: "default",
    };
    spawnMock.mockReturnValue({ pid: 4242, unref: unrefMock, once: vi.fn() });

    const result = scheduleDetachedLaunchdRestartHandoff({
      env,
      mode: "kickstart",
      waitForPid: 9876,
    });

    expect(result).toEqual({ ok: true, pid: 4242, settled: expect.any(Promise) });
    expect(spawnMock).toHaveBeenCalledTimes(1);
    const [, args] = requireSpawnCall();
    expect(args[0]).toBe("-c");
    expect(args[2]).toBe("openclaw-launchd-restart-handoff");
    expect(args[6]).toBe("9876");
    expect(args[7]).toBe("ai.openclaw.gateway");
    expect(args[1]).toContain('while kill -0 "$wait_pid" >/dev/null 2>&1; do');
    expect(args[1]).toContain("exec >>'/Users/test/.openclaw/logs/gateway-restart.log' 2>&1");
    expect(args[1]).toContain("openclaw restart attempt source=launchd-handoff mode=kickstart");
    expect(args[1]).toContain('launchctl enable "$service_target"');
    expect(args[1]).toContain('if launchctl kickstart -k "$service_target"; then');
    expect(args[1]).toContain(
      'if launchctl bootstrap "$domain" "$plist_path"; then\n    status=0\n  else\n    launchctl kickstart -k "$service_target"',
    );
    expect(args[1]).not.toMatch(/launchctl[^\n]*\/dev\/null/);
    expect(args[1]).not.toContain("sleep 1");
    expect(unrefMock).toHaveBeenCalledTimes(1);
  });

  it("passes the plain label separately for start-after-exit mode", () => {
    spawnMock.mockReturnValue({ pid: 4242, unref: unrefMock, once: vi.fn() });

    scheduleDetachedLaunchdRestartHandoff({
      env: {
        HOME: "/Users/test",
        OPENCLAW_PROFILE: "default",
      },
      mode: "start-after-exit",
    });

    const [, args] = requireSpawnCall();
    expect(args[7]).toBe("ai.openclaw.gateway");
    expect(args[1]).toContain('if launchctl print "$service_target" >/dev/null 2>&1; then');
    expect(args[1]).toContain("reason=launchd-auto-reload");
    expect(args[1]).toContain("print_retry_count=$((print_retry_count - 1))");
    expect(args[1]).toContain("sleep 0.2");
    expect(args[1]).toContain('if launchctl bootstrap "$domain" "$plist_path"; then');
    expect(args[1]).not.toContain('if launchctl start "$label"; then');
    expect(args[1]).not.toContain('basename "$service_target"');
  });

  it("polls after bootout and falls back to kickstart on bootstrap failure for reload mode", () => {
    spawnMock.mockReturnValue({ pid: 4242, unref: unrefMock, once: vi.fn() });

    scheduleDetachedLaunchdRestartHandoff({
      env: {
        HOME: "/Users/test",
        OPENCLAW_PROFILE: "default",
      },
      mode: "reload",
      waitForPid: 9876,
    });

    const [, args] = requireSpawnCall();
    expect(args[1]).toContain("openclaw restart attempt source=launchd-handoff mode=reload");
    expect(args[1]).toContain('launchctl enable "$service_target"');
    expect(args[1]).toContain('launchctl bootout "$service_target"');
    // polls until launchd finishes the async unload before re-bootstrapping
    expect(args[1]).toContain("bootout_wait_count=");
    expect(args[1]).toContain('if ! launchctl print "$service_target" >/dev/null 2>&1; then');
    expect(args[1]).toContain('if launchctl bootstrap "$domain" "$plist_path"; then');
    // fallback: kickstart -k on bootstrap failure so service isn't left deregistered
    expect(args[1]).toContain('launchctl kickstart -k "$service_target"');
  });

  it("sanitizes restart helper environment overrides before spawning", () => {
    spawnMock.mockReturnValue({ pid: 4242, unref: unrefMock, once: vi.fn() });

    scheduleDetachedLaunchdRestartHandoff({
      env: {
        HOME: "/Users/test",
        OPENCLAW_PROFILE: "default",
        PATH: "/tmp/evil-bin",
        DYLD_INSERT_LIBRARIES: "/tmp/evil.dylib",
        NPM_CONFIG_GLOBALCONFIG: "/tmp/evil-npmrc",
      },
      mode: "kickstart",
    });

    const [, args, options] = requireSpawnCall();
    expect(args[1]).toContain("exec >>'/Users/test/.openclaw/logs/gateway-restart.log' 2>&1");
    expect(args[1]).not.toContain("/tmp/evil-bin");
    expect(args[1]).not.toContain("/tmp/evil.dylib");
    expect(args[1]).not.toContain("/tmp/evil-npmrc");
    expect(options.env.OPENCLAW_PROFILE).toBe("default");
    expect(options.env.PATH).not.toBe("/tmp/evil-bin");
    expect(options.env.DYLD_INSERT_LIBRARIES).toBeUndefined();
    expect(options.env.NPM_CONFIG_GLOBALCONFIG).toBeUndefined();
  });

  it("rejects invalid launchd labels before spawning the helper", () => {
    expect(() => {
      scheduleDetachedLaunchdRestartHandoff({
        env: {
          HOME: "/Users/test",
          OPENCLAW_LAUNCHD_LABEL: "../evil/\n\u001b[31mlabel\u001b[0m",
        },
        mode: "kickstart",
      });
    }).toThrow("Invalid launchd label: ../evil/label");
    expect(spawnMock).not.toHaveBeenCalled();
  });
  it("kickstart-if-dead yields to a running KeepAlive replacement but restarts a pid=0 job (#104637 review)", async () => {
    const { execFileSync, mkdtempSync, writeFileSync, chmodSync, readFileSync, rmSync } =
      await (async () => {
        const cp = await vi.importActual<typeof import("node:child_process")>("node:child_process");
        const fs = await vi.importActual<typeof import("node:fs")>("node:fs");
        return {
          execFileSync: cp.execFileSync,
          mkdtempSync: fs.mkdtempSync,
          writeFileSync: fs.writeFileSync,
          chmodSync: fs.chmodSync,
          readFileSync: fs.readFileSync,
          rmSync: fs.rmSync,
        };
      })();
    const os = await vi.importActual<typeof import("node:os")>("node:os");
    const path = await vi.importActual<typeof import("node:path")>("node:path");

    scheduleDetachedLaunchdRestartHandoff({
      env: { HOME: "/Users/test", OPENCLAW_LAUNCHD_LABEL: "ai.openclaw.test" },
      mode: "kickstart-if-dead" as never,
      waitForPid: 0,
    });
    const [, spawnArgs] = requireSpawnCall(0);
    const script = spawnArgs[1];
    if (typeof script !== "string") {
      throw new Error("expected generated handoff script");
    }

    const runScript = (launchctlPrintOutput: string) => {
      const dir = mkdtempSync(path.join(os.tmpdir(), "handoff-script-"));
      const callLog = path.join(dir, "calls.log");
      writeFileSync(
        path.join(dir, "launchctl"),
        [
          "#!/bin/sh",
          `echo "$@" >> ${JSON.stringify(callLog)}`,
          'case "$1" in',
          `  print) printf '%s\n' ${JSON.stringify(launchctlPrintOutput)}; exit 0 ;;`,
          "  *) exit 0 ;;",
          "esac",
        ].join("\n"),
        "utf8",
      );
      chmodSync(path.join(dir, "launchctl"), 0o755);
      let status = 0;
      try {
        execFileSync(
          "/bin/sh",
          [
            "-c",
            script,
            "test-handoff",
            "gui/501/ai.openclaw.test",
            "gui/501",
            "/tmp/x.plist",
            "0",
            "ai.openclaw.test",
          ],
          {
            env: {
              PATH: `${dir}:/usr/bin:/bin`,
              HOME: dir,
              OPENCLAW_STATE_DIR: dir,
            },
            stdio: "pipe",
          },
        );
      } catch (err) {
        status = (err as { status?: number }).status ?? 1;
      }
      const calls = readFileSync(callLog, "utf8");
      rmSync(dir, { recursive: true, force: true });
      return { status, calls };
    };

    // A RUNNING replacement (KeepAlive won): the helper must not kickstart it.
    const running = runScript("state = running\n\tpid = 4242");
    expect(running.status).toBe(0);
    expect(running.calls).not.toContain("kickstart");

    // A loaded-but-stopped job prints pid = 0: NOT a healthy replacement — the
    // helper must run the kickstart chain instead of declaring success.
    const stopped = runScript("state = not running\n\tpid = 0");
    expect(stopped.status).toBe(0);
    expect(stopped.calls).toContain("kickstart -k gui/501/ai.openclaw.test");
  });
  it("settles false when the detached helper fails to spawn asynchronously (#104637 review)", async () => {
    const listeners = new Map<string, (arg?: unknown) => void>();
    spawnMock.mockReturnValue({
      pid: undefined,
      unref: unrefMock,
      once: vi.fn((event: string, cb: (arg?: unknown) => void) => listeners.set(event, cb)),
    });
    const result = scheduleDetachedLaunchdRestartHandoff({
      env: { HOME: "/Users/test", OPENCLAW_LAUNCHD_LABEL: "ai.openclaw.test" },
      mode: "kickstart-if-dead" as never,
      waitForPid: 123,
    });
    expect(result.ok).toBe(true);
    // The OS reports the failure after spawn() returned; the listener keeps it
    // from becoming an unhandled error and the caller can observe it.
    listeners.get("error")?.(new Error("spawn /bin/sh ENOENT"));
    await expect(result.settled).resolves.toBe(false);
  });

  it("settles true once the detached helper spawns", async () => {
    const listeners = new Map<string, (arg?: unknown) => void>();
    spawnMock.mockReturnValue({
      pid: 777,
      unref: unrefMock,
      once: vi.fn((event: string, cb: (arg?: unknown) => void) => listeners.set(event, cb)),
    });
    const result = scheduleDetachedLaunchdRestartHandoff({
      env: { HOME: "/Users/test", OPENCLAW_LAUNCHD_LABEL: "ai.openclaw.test" },
      mode: "kickstart-if-dead" as never,
      waitForPid: 123,
    });
    listeners.get("spawn")?.();
    await expect(result.settled).resolves.toBe(true);
  });
});
