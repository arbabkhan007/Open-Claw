import type { Server } from "node:http";
import { createServer } from "node:http";
import process from "node:process";
// Behavior tests for chat avatar fetch bounding: verify the AbortController
// watchdog terminates a stalled gateway fetch instead of hanging avatar
// resolution, and that a normal metadata+image round trip still completes.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { refreshChatAvatar } from "./chat-avatar.js";

// The production helper issues fetch with a relative URL (browser-only). In the
// Node test runtime we rewrite the relative path onto the real local server so
// the actual fetch/timeout/abort path is exercised, not a fetch mock.
function installRelativeFetchBridge(serverUrl: string): void {
  const base = serverUrl.replace(/\/$/, "");
  const realFetch = globalThis.fetch.bind(globalThis);
  vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    const absolute = url.startsWith("http") ? url : `${base}${url}`;
    return realFetch(absolute, init);
  });
}

type Host = {
  connected: boolean;
  sessionKey: string;
  basePath: string;
  chatAvatarUrl: string | null;
};

describe("refreshChatAvatar fetch bounding", () => {
  let server: Server;
  let serverUrl: string;
  let stall: boolean;

  let onUnhandled: (reason: unknown) => void;

  beforeEach(async () => {
    stall = false;
    // fetch's internal body stream rejects on abort; swallow the benign
    // AbortError so Vitest does not flag it as an unhandled rejection.
    onUnhandled = (reason: unknown) => {
      if (reason instanceof Error && reason.name === "AbortError") return;
      process.emit("uncaughtExceptionMonitor", reason as Error);
    };
    process.on("unhandledRejection", onUnhandled);
    // Node test runtime has no URL.createObjectURL; spy only the method so
    // global URL (used by fetch to parse request URLs) stays intact.
    vi.spyOn(URL, "createObjectURL").mockImplementation(() => "blob:fake");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    server = createServer((req, res) => {
      if (stall) {
        // Accept the request but never finish the response: simulates a hung
        // gateway endpoint that the AbortController must terminate.
        return;
      }
      const url = req.url ?? "";
      if (url.includes("meta=1")) {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ avatarUrl: "/avatar/blob/abc123" }));
        return;
      }
      res.writeHead(200, { "content-type": "image/png" });
      res.end(Buffer.from("fake-image-bytes"));
    });
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const address = server.address();
    const port = typeof address === "object" && address ? address.port : 0;
    serverUrl = `http://127.0.0.1:${port}`;
    installRelativeFetchBridge(serverUrl);
    vi.useFakeTimers();
  });

  afterEach(() => {
    process.off("unhandledRejection", onUnhandled);
    vi.restoreAllMocks();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    server.close();
  });

  it("aborts a stalled metadata fetch after the bound instead of hanging", async () => {
    stall = true;
    const host: Host = {
      connected: true,
      sessionKey: "agent:abc123:session",
      basePath: "",
      chatAvatarUrl: null,
    };
    const call = refreshChatAvatar(host as never);
    // Fire the 30s watchdog without waiting in real time.
    await vi.advanceTimersByTimeAsync(30_000);
    // The bounded fetch must have settled (aborted via catch) and the helper
    // returned, instead of leaving the call pending forever.
    await expect(call).resolves.toBeUndefined();
    expect(host.chatAvatarUrl).toBeNull();
  });

  it("still resolves a normal metadata + image round trip", async () => {
    // Real timers so the local server fetch completes (fake timers freeze
    // Node's internal fetch scheduling and would hang the request).
    vi.useRealTimers();
    const host: Host = {
      connected: true,
      sessionKey: "agent:abc123:session",
      basePath: "",
      chatAvatarUrl: null,
    };
    await refreshChatAvatar(host as never);
    expect(host.chatAvatarUrl).toBe("blob:fake");
    vi.useFakeTimers();
  });

  it("resolves slow metadata + fast image within independent timeouts", async () => {
    vi.useRealTimers();
    let metadataDelay = 0;
    let imageDelay = 0;

    server.close();
    server = createServer((req, res) => {
      const url = req.url ?? "";
      if (url.includes("meta=1")) {
        setTimeout(() => {
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify({ avatarUrl: "/avatar/blob/abc123" }));
          metadataDelay = Date.now();
        }, 100);
        return;
      }
      setTimeout(() => {
        res.writeHead(200, { "content-type": "image/png" });
        res.end(Buffer.from("fake-image-bytes"));
        imageDelay = Date.now();
      }, 10);
    });
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const address = server.address();
    const port = typeof address === "object" && address ? address.port : 0;
    serverUrl = `http://127.0.0.1:${port}`;
    installRelativeFetchBridge(serverUrl);

    const host: Host = {
      connected: true,
      sessionKey: "agent:abc123:session",
      basePath: "",
      chatAvatarUrl: null,
    };
    await refreshChatAvatar(host as never);
    expect(host.chatAvatarUrl).toBe("blob:fake");
    expect(metadataDelay).toBeGreaterThan(0);
    expect(imageDelay).toBeGreaterThan(0);
    expect(imageDelay).toBeGreaterThanOrEqual(metadataDelay);
  });
});
